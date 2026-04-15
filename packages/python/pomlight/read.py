from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from .xml_parser import XmlElement, XmlNode, parse_xml
from .types import (
    Block,
    ContentMultiMediaBinary,
    ContentMultiMediaJson,
    Heading,
    ListBlock,
    ListItem,
    MultiMediaBlock,
    Paragraph,
    ReadResult,
    Sideband,
    Speaker,
    State,
    StyleSheet,
    ToolDefinition,
    ReadOptions,
)
from .tags import normalize_tag, is_block_node
from .expr import eval_expr, eval_condition, interpolate
from .style import pre_parse_stylesheet, apply_stylesheet, get_style_prop, apply_text_transform
from .inline import render_inline, render_inline_pre
from .components import process_document, process_table, process_object, process_tree, parse_python_style_slice
from .directives import process_let, process_include, convert_runtime_value
from .serialize import process_serialize


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def read(
    element: str,
    options: ReadOptions | None = None,
    context: dict[str, Any] | None = None,
    stylesheet: StyleSheet | None = None,
    source_path: str | None = None,
) -> list[Block]:
    result = read_full(element, options, context, stylesheet, source_path)
    return result.blocks


def read_full(
    element: str,
    _options: ReadOptions | None = None,
    context: dict[str, Any] | None = None,
    stylesheet: StyleSheet | None = None,
    source_path: str | None = None,
) -> ReadResult:
    root = parse_xml(element)
    initial_styles = dict(stylesheet) if stylesheet else None
    sideband = Sideband()
    blocks = _process_element(root, State(
        ctx=context or {},
        depth=1,
        file_path=source_path,
        styles=initial_styles,
        sideband=sideband,
    ))
    result = ReadResult(blocks=blocks)
    if sideband.schema is not None:
        result.schema = sideband.schema
    if sideband.tools:
        result.tools = sideband.tools
    if sideband.runtime is not None:
        result.runtime = sideband.runtime
    return result


# ---------------------------------------------------------------------------
# Element processing
# ---------------------------------------------------------------------------

def _process_element(node: XmlElement, state: State) -> list[Block]:
    if_attr = node.attrs.get("if")
    if if_attr is not None:
        if not eval_condition(if_attr, state.ctx):
            return []

    for_attr = node.attrs.get("for")
    if for_attr is not None:
        return _expand_for(node, state)

    node = apply_stylesheet(node, state)
    blocks = _dispatch_element(node, state)

    speaker_attr = node.attrs.get("speaker")
    if speaker_attr and blocks:
        _tag_speaker(blocks, speaker_attr)

    return blocks


def _dispatch_element(node: XmlElement, state: State) -> list[Block]:
    tag = normalize_tag(node.tag)

    if tag in ("poml", "_root"):
        syntax = node.attrs.get("syntax")
        if syntax in ("xml", "json", "yaml"):
            return process_serialize(node, State(
                ctx=state.ctx, depth=state.depth, file_path=state.file_path,
                chat=state.chat, presentation="serialize", serializer=syntax,
                styles=state.styles, sideband=state.sideband,
            ))
        state_with_styles = pre_parse_stylesheet(node, state)
        return _process_children(node.children, state_with_styles)

    if tag == "p":
        syntax = node.attrs.get("syntax")
        if syntax in ("json", "yaml", "xml", "text"):
            txt = _read_whitespace(node, state)
            if not txt:
                return []
            serialized = json.dumps(txt) if syntax == "json" else txt
            lang = "" if syntax == "text" else syntax
            code = "```" + lang + "\n" + serialized + "\n```"
            return [Paragraph(text=code)]
        txt = _read_whitespace(node, state)
        if not txt:
            return []
        return [Paragraph(text=txt)]

    if tag == "h":
        return [Heading(depth=state.depth, text=render_inline(node.children, state).strip())]

    if tag == "section":
        return _process_children(node.children, State(
            ctx=state.ctx, depth=state.depth + 1, file_path=state.file_path,
            chat=state.chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        ))

    if tag == "list":
        list_style = node.attrs.get("listStyle") or get_style_prop("list", "listStyle", state) or "dash"
        ordered = list_style in ("decimal", "latin")
        items = _process_list_items(node.children, state)
        if not items:
            return []
        return [ListBlock(ordered=ordered, list_style=list_style, items=items)]

    if tag == "include":
        return process_include(node, state, _process_element)

    if tag == "cp":
        return _process_cp(node, state)

    if tag == "role":
        role_caption = apply_text_transform("Role", get_style_prop("cp", "captionTextTransform", state))
        txt = render_inline(node.children, state).strip()
        return [
            Heading(depth=state.depth, text=role_caption),
            Paragraph(text=txt),
        ]

    if tag == "task":
        task_caption = apply_text_transform("Task", get_style_prop("cp", "captionTextTransform", state))
        has_block = any(is_block_node(c) for c in node.children)
        if has_block:
            blocks = _process_children(node.children, state)
        else:
            blocks = [Paragraph(text=render_inline(node.children, state).strip())]
        return [Heading(depth=state.depth, text=task_caption), *blocks]

    if tag == "hint":
        return _process_intention(node, state, _IntentionOpts(
            default_caption="Hint", default_style="bold", caption_style_from="hint",
        ))

    if tag == "introducer":
        caption = node.attrs.get("caption", "Introducer")
        caption_style = node.attrs.get("captionStyle", "hidden")
        txt = render_inline(node.children, state).strip()
        return _render_captioned_intention(caption, caption_style, txt, state)

    if tag == "output-format":
        return _process_intention(node, state, _IntentionOpts(
            default_caption="Output Format", default_style="header",
            caption_style_from="output-format",
        ))

    if tag == "qa":
        return _process_qa(node, state)

    if tag == "stepwise-instructions":
        return _process_intention(node, state, _IntentionOpts(
            default_caption="Stepwise Instructions", default_style="header",
            caption_style_from="stepwise-instructions", block_only=True,
        ))

    if tag == "example":
        chat = node.attrs.get("chat") != "false" and state.chat is not False
        caption = interpolate(node.attrs.get("caption", "Example"), state.ctx)
        caption_style = node.attrs.get("captionStyle") or ("hidden" if chat else "header")
        caption_ending = node.attrs.get("captionEnding") or get_style_prop("example", "captionEnding", state)
        blocks = _process_children(node.children, State(
            ctx=state.ctx, depth=state.depth, file_path=state.file_path,
            chat=chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        ))
        if caption_style == "hidden":
            return blocks
        return [*_render_caption_block(caption, caption_style, state, caption_ending), *blocks]

    if tag == "examples":
        caption = node.attrs.get("caption", "Examples")
        caption_style = node.attrs.get("captionStyle", "header")
        chat = node.attrs.get("chat") != "false"
        caption_ending = node.attrs.get("captionEnding") or get_style_prop("examples", "captionEnding", state)
        blocks = _process_children(node.children, State(
            ctx=state.ctx, depth=state.depth + 1, file_path=state.file_path,
            chat=chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        ))
        caption_blocks = _render_caption_block(caption, caption_style, state, caption_ending)
        introducer = node.attrs.get("introducer")
        if introducer:
            caption_blocks.append(Paragraph(text=interpolate(introducer, state.ctx)))
        if any(b.speaker is not None for b in blocks):
            _tag_speaker(caption_blocks, "system")
        return [*caption_blocks, *blocks]

    if tag == "input":
        chat = state.chat is not False
        caption = node.attrs.get("caption", "Input")
        caption_style = node.attrs.get("captionStyle") or get_style_prop("input", "captionStyle", state) or ("hidden" if chat else "bold")
        caption_ending = node.attrs.get("captionEnding") or get_style_prop("input", "captionEnding", state)
        blocks = _process_input_output(node, caption, caption_style, state, caption_ending)
        if chat:
            _tag_speaker(blocks, "human")
        return blocks

    if tag == "output":
        chat = state.chat is not False
        caption = node.attrs.get("caption", "Output")
        caption_style = node.attrs.get("captionStyle") or get_style_prop("output", "captionStyle", state) or ("hidden" if chat else "bold")
        caption_ending = node.attrs.get("captionEnding") or get_style_prop("output", "captionEnding", state)
        blocks = _process_input_output(node, caption, caption_style, state, caption_ending)
        if chat:
            _tag_speaker(blocks, "ai")
        return blocks

    if tag == "system-msg":
        return _process_speaker_message(node, state, "system")

    if tag == "ai-msg":
        return _process_speaker_message(node, state, "ai")

    if tag in ("user-msg", "human-msg"):
        return _process_speaker_message(node, state, "human")

    if tag == "conversation":
        return _process_conversation(node, state)

    if tag == "ToolRequest":
        return _process_tool_request(node, state)

    if tag == "ToolResponse":
        return _process_tool_response(node, state)

    if tag == "msg-content":
        return _process_msg_content(node, state)

    if tag == "img":
        return _process_img(node, state)

    if tag == "document":
        return process_document(node, state)

    if tag == "table":
        return process_table(node, state)

    if tag == "object":
        return process_object(node, state)

    if tag == "tree":
        return process_tree(node, state)

    if tag == "code":
        if node.attrs.get("inline") == "false":
            lang = node.attrs.get("lang", "")
            inner_blocks = _process_children(node.children, state)
            from .write import write
            inner = re.sub(r"[ \t]+$", "", write(inner_blocks), flags=re.MULTILINE)
            fence = "```" + lang + "\n" + inner + "\n```"
            return [Paragraph(text=fence)]
        return [Paragraph(text="`" + render_inline(node.children, state).strip() + "`")]

    if tag == "text":
        syntax = node.attrs.get("syntax")
        if syntax == "text":
            raw = render_inline_pre(node.children, state)
            return [Paragraph(text="```\n" + raw + "\n```")]
        if syntax:
            raw = render_inline_pre(node.children, state)
            return [Paragraph(text="```" + syntax + "\n" + raw + "\n```")]
        txt = render_inline(node.children, state).strip()
        return [Paragraph(text=txt)] if txt else []

    if tag == "br":
        count_str = node.attrs.get("newLineCount", "1")
        try:
            count = int(count_str)
        except ValueError:
            count = 1
        if count <= 1:
            return []
        return [Paragraph(text="\n" * (count - 1), blank_line=False)]

    if tag == "span":
        ws = node.attrs.get("whiteSpace") or node.attrs.get("white-space")
        if ws == "trim":
            txt = render_inline_pre(node.children, state).strip()
            if not txt:
                return []
            return [Paragraph(text=txt)]
        if ws == "pre":
            txt = render_inline_pre(node.children, state)
            if not txt.strip():
                return []
            return [Paragraph(text=txt)]
        txt = render_inline(node.children, state).strip()
        if not txt:
            return []
        return [Paragraph(text=txt)]

    if tag == "output-schema":
        if state.sideband is not None:
            text = "".join(c for c in node.children if isinstance(c, str)).strip()
            if text:
                processed = interpolate(text, state.ctx)
                try:
                    state.sideband.schema = json.loads(processed)
                except (json.JSONDecodeError, TypeError):
                    pass
        return []

    if tag == "tool-definition":
        if state.sideband is not None:
            name = interpolate(node.attrs["name"], state.ctx) if "name" in node.attrs else None
            if name:
                description = interpolate(node.attrs["description"], state.ctx) if "description" in node.attrs else None
                text = "".join(c for c in node.children if isinstance(c, str)).strip()
                parameters: dict[str, Any] = {}
                if text:
                    processed = interpolate(text, state.ctx)
                    try:
                        parameters = json.loads(processed)
                    except (json.JSONDecodeError, TypeError):
                        pass
                tool = ToolDefinition(name=name, parameters=parameters)
                if description:
                    tool.description = description
                state.sideband.tools.append(tool)
        return []

    if tag == "runtime":
        if state.sideband is not None:
            params: dict[str, Any] = {}
            for key, val in node.attrs.items():
                camel_key = re.sub(r"-([a-z])", lambda m: m.group(1).upper(), key)
                params[camel_key] = convert_runtime_value(interpolate(val, state.ctx))
            state.sideband.runtime = params
        return []

    if tag in ("audio", "stylesheet"):
        return []

    return []


# ---------------------------------------------------------------------------
# Whitespace helper
# ---------------------------------------------------------------------------

def _read_whitespace(node: XmlElement, state: State) -> str:
    ws = node.attrs.get("whiteSpace") or node.attrs.get("white-space")
    if ws == "pre":
        return render_inline_pre(node.children, state)
    if ws == "trim":
        return render_inline_pre(node.children, state).strip()
    return render_inline(node.children, state).strip()


# ---------------------------------------------------------------------------
# Intention helpers
# ---------------------------------------------------------------------------

class _IntentionOpts:
    def __init__(
        self,
        default_caption: str,
        default_style: str,
        caption_style_from: str,
        block_only: bool = False,
    ):
        self.default_caption = default_caption
        self.default_style = default_style
        self.caption_style_from = caption_style_from
        self.block_only = block_only


def _process_intention(node: XmlElement, state: State, opts: _IntentionOpts) -> list[Block]:
    caption = apply_text_transform(
        node.attrs.get("caption", opts.default_caption),
        get_style_prop("cp", "captionTextTransform", state),
    )
    caption_style = node.attrs.get("captionStyle") or get_style_prop(opts.caption_style_from, "captionStyle", state) or opts.default_style
    caption_ending = node.attrs.get("captionEnding") or get_style_prop(opts.caption_style_from, "captionEnding", state)

    has_block_child = opts.block_only or any(is_block_node(c) for c in node.children)
    if has_block_child:
        blocks = _process_children(node.children, state)
        if not blocks:
            return _render_caption_block(caption, caption_style, state, caption_ending)
        if caption_ending in ("newline", "colon-newline") and blocks and blocks[0].type == "paragraph":
            blocks[0] = Paragraph(text=blocks[0].text, blank_line=False, speaker=blocks[0].speaker)
        return [*_render_caption_block(caption, caption_style, state, caption_ending), *blocks]
    txt = render_inline(node.children, state).strip()
    return _render_captioned_intention(caption, caption_style, txt, state, caption_ending)


def _process_cp(node: XmlElement, state: State) -> list[Block]:
    raw_caption = interpolate(node.attrs.get("caption", ""), state.ctx)
    caption = apply_text_transform(raw_caption, get_style_prop("cp", "captionTextTransform", state))
    caption_style = node.attrs.get("captionStyle") or get_style_prop("cp", "captionStyle", state) or "header"
    caption_ending = node.attrs.get("captionEnding") or get_style_prop("cp", "captionEnding", state)
    if caption_style == "header" and not caption_ending:
        blocks = _process_children(node.children, State(
            ctx=state.ctx, depth=state.depth + 1, file_path=state.file_path,
            chat=state.chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        ))
        return [Heading(depth=state.depth, text=caption), *blocks]
    has_block_child = any(is_block_node(c) for c in node.children)
    if has_block_child:
        blocks = _process_children(node.children, State(
            ctx=state.ctx, depth=state.depth + 1, file_path=state.file_path,
            chat=state.chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        ))
        if caption_ending in ("newline", "colon-newline") and blocks and blocks[0].type == "paragraph":
            blocks[0] = Paragraph(text=blocks[0].text, blank_line=False, speaker=blocks[0].speaker)
        return [*_render_caption_block(caption, caption_style, state, caption_ending), *blocks]
    txt = render_inline(node.children, state).strip()
    return _render_captioned_intention(caption, caption_style, txt, state, caption_ending)


def _process_qa(node: XmlElement, state: State) -> list[Block]:
    q_caption = apply_text_transform(
        node.attrs.get("questionCaption", "Question"),
        get_style_prop("cp", "captionTextTransform", state),
    )
    a_caption = node.attrs.get("answerCaption", "Answer")
    caption_style = node.attrs.get("captionStyle") or get_style_prop("qa", "captionStyle", state) or "bold"
    caption_ending = node.attrs.get("captionEnding") or get_style_prop("qa", "captionEnding", state)
    txt = render_inline(node.children, state).strip()
    out = _render_captioned_intention(q_caption, caption_style, txt, state, caption_ending)
    if caption_style == "bold":
        out.append(Paragraph(text=f"**{a_caption}:**"))
    elif caption_style == "header":
        out.append(Heading(depth=state.depth, text=a_caption))
    return out


# ---------------------------------------------------------------------------
# Caption rendering
# ---------------------------------------------------------------------------

def _render_caption_block(
    caption: str,
    style: str,
    state: State,
    caption_ending: str | None = None,
) -> list[Block]:
    ending = caption_ending or "default"
    if style == "header":
        return [Heading(depth=state.depth, text=caption)]
    if style == "bold":
        if ending in ("newline", "colon-newline"):
            suffix = ":" if ending == "colon-newline" else ""
            return [Paragraph(text=f"**{caption}{suffix}**")]
        return [Paragraph(text=f"**{caption}:**")]
    if style == "plain":
        if ending in ("newline", "colon-newline"):
            suffix = ":" if ending == "colon-newline" else ""
            return [Paragraph(text=f"{caption}{suffix}")]
        return [Paragraph(text=f"{caption}:")]
    # hidden or default
    return []


def _render_captioned_intention(
    caption: str,
    style: str,
    text: str,
    state: State,
    caption_ending: str | None = None,
) -> list[Block]:
    ending = caption_ending or "default"
    if style == "header":
        return [
            Heading(depth=state.depth, text=caption),
            Paragraph(text=text),
        ]
    if style == "bold":
        if ending == "colon-newline":
            return [
                Paragraph(text=f"**{caption}:**"),
                Paragraph(text=text, blank_line=False),
            ]
        if ending == "newline":
            return [
                Paragraph(text=f"**{caption}**"),
                Paragraph(text=text, blank_line=False),
            ]
        if ending == "none":
            return [Paragraph(text=f"**{caption}** {text}")]
        return [Paragraph(text=f"**{caption}:** {text}")]
    if style == "plain":
        if ending == "colon-newline":
            return [
                Paragraph(text=f"{caption}:"),
                Paragraph(text=text, blank_line=False),
            ]
        if ending == "newline":
            return [
                Paragraph(text=caption),
                Paragraph(text=text, blank_line=False),
            ]
        if ending == "none":
            return [Paragraph(text=f"{caption} {text}")]
        return [Paragraph(text=f"{caption}: {text}")]
    # hidden or default
    return [Paragraph(text=text)]


# ---------------------------------------------------------------------------
# Input/Output helper
# ---------------------------------------------------------------------------

def _process_input_output(
    node: XmlElement,
    caption: str,
    caption_style: str,
    state: State,
    caption_ending: str | None = None,
) -> list[Block]:
    has_block_child = any(is_block_node(c) for c in node.children)
    if has_block_child:
        blocks = _process_children(node.children, state)
        if caption_style == "hidden":
            return blocks
        caption_blocks = _render_caption_block(caption, caption_style, state, caption_ending)
        if caption_ending in ("colon-newline", "newline") and blocks and blocks[0].type == "paragraph":
            blocks[0] = Paragraph(text=blocks[0].text, blank_line=False, speaker=blocks[0].speaker)
        return [*caption_blocks, *blocks]
    txt = render_inline(node.children, state).strip()
    return _render_captioned_intention(caption, caption_style, txt, state, caption_ending)


# ---------------------------------------------------------------------------
# Message components
# ---------------------------------------------------------------------------

def _process_speaker_message(node: XmlElement, state: State, speaker: Speaker) -> list[Block]:
    has_block_child = any(is_block_node(c) for c in node.children)
    if has_block_child:
        blocks = _process_children(node.children, state)
        return _tag_speaker(blocks, speaker)
    txt = render_inline(node.children, state).strip()
    if not txt:
        return []
    return [Paragraph(text=txt, blank_line=False, speaker=speaker)]


def _tag_speaker(blocks: list[Block], speaker: Speaker) -> list[Block]:
    for b in blocks:
        b.speaker = speaker
    return blocks


def _process_conversation(node: XmlElement, state: State) -> list[Block]:
    msgs_expr = node.attrs.get("messages")
    if not msgs_expr:
        return []
    raw = msgs_expr.strip()
    if raw.startswith("{{") and raw.endswith("}}"):
        raw = raw[2:-2].strip()
    msgs = eval_expr(raw, state.ctx)
    if not isinstance(msgs, list):
        return []

    selected_messages = node.attrs.get("selectedMessages")
    if selected_messages:
        start, end = parse_python_style_slice(selected_messages, len(msgs))
        msgs = msgs[start:end]

    result: list[Block] = []
    for msg in msgs:
        sp_raw = msg.get("speaker", "human") if isinstance(msg, dict) else "human"
        if sp_raw == "system":
            sp: Speaker = "system"
        elif sp_raw == "ai":
            sp = "ai"
        else:
            sp = "human"
        content = str(msg.get("content", "")) if isinstance(msg, dict) else ""
        result.append(Paragraph(text=content, blank_line=False, speaker=sp))
    return result


def _process_tool_request(node: XmlElement, state: State) -> list[Block]:
    id_ = node.attrs.get("id", "")
    name = node.attrs.get("name", "")
    params_expr = node.attrs.get("parameters")
    content: Any = {}
    if params_expr:
        raw = params_expr.strip()
        if raw.startswith("{{") and raw.endswith("}}"):
            raw = raw[2:-2].strip()
        content = eval_expr(raw, state.ctx)
    return [MultiMediaBlock(content=[
        ContentMultiMediaJson(type="application/vnd.poml.toolrequest", content=content, id=id_, name=name),
    ], speaker="ai")]


def _process_tool_response(node: XmlElement, state: State) -> list[Block]:
    id_ = node.attrs.get("id", "")
    name = node.attrs.get("name", "")
    from .write import write
    inner_blocks = _process_children(node.children, state)
    text_content = write(inner_blocks)
    return [MultiMediaBlock(content=[
        ContentMultiMediaJson(type="application/vnd.poml.toolresponse", content=text_content, id=id_, name=name),
    ], speaker="tool")]


def _process_msg_content(node: XmlElement, state: State) -> list[Block]:
    raw_content = node.attrs.get("content")
    if raw_content:
        expr_match = re.match(r"^\{\{(.+)\}\}$", raw_content)
        resolved = eval_expr(expr_match.group(1).strip(), state.ctx) if expr_match else interpolate(raw_content, state.ctx)
        if isinstance(resolved, str):
            return [Paragraph(text=resolved, blank_line=False)]
        if isinstance(resolved, list):
            text_parts = []
            for part in resolved:
                if isinstance(part, str):
                    text_parts.append(part)
                elif isinstance(part, dict) and "alt" in part:
                    text_parts.append(part["alt"])
                elif isinstance(part, dict) and "content" in part:
                    text_parts.append(str(part["content"]))
                else:
                    text_parts.append(str(part))
            return [Paragraph(text="\n".join(text_parts), blank_line=False)]
        return [Paragraph(text=str(resolved or ""), blank_line=False)]
    return [MultiMediaBlock(content=[])]


# ---------------------------------------------------------------------------
# Image component
# ---------------------------------------------------------------------------

def _process_img(node: XmlElement, state: State) -> list[Block]:
    img_syntax = node.attrs.get("syntax")
    is_multimedia = img_syntax == "multimedia" or (not img_syntax and "alt" not in node.attrs)
    if is_multimedia:
        img_src = node.attrs.get("src")
        if img_src and state.file_path:
            dir_path = state.file_path[: state.file_path.rfind("/") + 1]
            img_path = dir_path + img_src
            try:
                img_data = Path(img_path).read_bytes()
                b64 = base64.b64encode(img_data).decode("ascii")
                if img_src.endswith(".png"):
                    mime_type = "image/png"
                elif img_src.endswith((".jpg", ".jpeg")):
                    mime_type = "image/jpeg"
                elif img_src.endswith(".gif"):
                    mime_type = "image/gif"
                elif img_src.endswith(".webp"):
                    mime_type = "image/webp"
                else:
                    mime_type = "image/png"
                media = ContentMultiMediaBinary(type=mime_type, base64=b64)
                alt = node.attrs.get("alt")
                if alt:
                    media.alt = interpolate(alt, state.ctx)
                return [MultiMediaBlock(content=[media])]
            except OSError:
                pass
        alt = node.attrs.get("alt")
        if alt:
            return [Paragraph(text=interpolate(alt, state.ctx))]
        return []
    alt = node.attrs.get("alt")
    if alt:
        return [Paragraph(text=interpolate(alt, state.ctx))]
    return []


# ---------------------------------------------------------------------------
# Children processing
# ---------------------------------------------------------------------------

def _process_children(children: list[XmlNode], state: State) -> list[Block]:
    blocks: list[Block] = []
    inline_buf: list[XmlNode] = []

    def flush(before_block: bool = False) -> None:
        nonlocal inline_buf
        if not inline_buf:
            return
        raw = render_inline(inline_buf, state)
        first_has_content = isinstance(inline_buf[0], str) and inline_buf[0].strip() != ""
        if not before_block and blocks and first_has_content:
            txt = raw.rstrip()
        elif before_block:
            txt = raw.strip()
        else:
            txt = raw.strip()
        if txt.strip():
            blocks.append(Paragraph(text=txt))
        inline_buf = []

    for child in children:
        if isinstance(child, str):
            inline_buf.append(child)
        elif normalize_tag(child.tag) == "let":
            flush(True)
            process_let(child, state)
        elif is_block_node(child):
            flush(True)
            blocks.extend(_process_element(child, state))
        else:
            inline_buf.append(child)
    flush()
    return blocks


# ---------------------------------------------------------------------------
# For-loop expansion
# ---------------------------------------------------------------------------

def _expand_for(node: XmlElement, state: State) -> list[Block]:
    for_attr = node.attrs["for"]
    m = re.match(r"^(\w+)\s+in\s+(.+)$", for_attr)
    if not m:
        return []
    var_name = m.group(1)
    arr_expr = m.group(2).strip()
    arr = eval_expr(arr_expr, state.ctx)
    if not isinstance(arr, list):
        return []

    rest = {k: v for k, v in node.attrs.items() if k != "for"}
    out: list[Block] = []

    for i, item in enumerate(arr):
        loop_ctx = {
            **state.ctx,
            var_name: item,
            "loop": {"index": i, "length": len(arr), "first": i == 0, "last": i == len(arr) - 1},
        }
        clone = XmlElement(tag=node.tag, attrs=dict(rest), children=node.children)
        out.extend(_process_element(clone, State(
            ctx=loop_ctx, depth=state.depth, file_path=state.file_path,
            chat=state.chat, presentation=state.presentation,
            serializer=state.serializer, styles=state.styles,
            sideband=state.sideband,
        )))
    return out


# ---------------------------------------------------------------------------
# List items
# ---------------------------------------------------------------------------

def _process_list_items(children: list[XmlNode], state: State) -> list[ListItem]:
    items: list[ListItem] = []

    for child in children:
        if isinstance(child, str):
            continue
        if normalize_tag(child.tag) != "item":
            continue

        for_attr = child.attrs.get("for")
        if for_attr is not None:
            m = re.match(r"^(\w+)\s+in\s+(.+)$", for_attr)
            if not m:
                continue
            var_name = m.group(1)
            arr_expr = m.group(2).strip()
            arr = eval_expr(arr_expr, state.ctx)
            if not isinstance(arr, list):
                continue

            rest = {k: v for k, v in child.attrs.items() if k not in ("for", "if")}
            if_expr = child.attrs.get("if")
            for i, val in enumerate(arr):
                loop_ctx = {
                    **state.ctx,
                    var_name: val,
                    "loop": {"index": i, "length": len(arr), "first": i == 0, "last": i == len(arr) - 1},
                }
                if if_expr is not None and not eval_condition(if_expr, loop_ctx):
                    continue
                clone = XmlElement(tag=child.tag, attrs=rest, children=child.children)
                items.append(_build_item(clone, State(
                    ctx=loop_ctx, depth=state.depth, file_path=state.file_path,
                    chat=state.chat, presentation=state.presentation,
                    serializer=state.serializer, styles=state.styles,
                    sideband=state.sideband,
                )))
            continue

        if_attr = child.attrs.get("if")
        if if_attr is not None:
            if not eval_condition(if_attr, state.ctx):
                continue

        items.append(_build_item(child, state))
    return items


def _build_item(node: XmlElement, state: State) -> ListItem:
    inline_nodes: list[XmlNode] = []
    block_nodes: list[XmlElement] = []
    seen_block = False

    for c in node.children:
        if isinstance(c, str):
            if not seen_block:
                inline_nodes.append(c)
        elif normalize_tag(c.tag) == "list":
            seen_block = True
            block_nodes.append(c)
        else:
            if not seen_block:
                inline_nodes.append(c)

    text = render_inline(inline_nodes, state)
    if not block_nodes:
        text = text.rstrip()
    sub_blocks: list[Block] = []
    for b in block_nodes:
        sub_blocks.extend(_process_element(b, state))
    return ListItem(text=text, children=sub_blocks)
