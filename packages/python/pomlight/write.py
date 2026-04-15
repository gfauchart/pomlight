from __future__ import annotations

import json
from typing import Any

from .types import (
    Block,
    ContentMultiMedia,
    ContentMultiMediaBinary,
    Heading,
    ListBlock,
    Message,
    MultiMediaBlock,
    OutputFormat,
    Paragraph,
    RichContent,
    SerializedNode,
    Speaker,
    ToolDefinition,
    WriteOptions,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def write(blocks: list[Block], options: WriteOptions | None = None) -> str | list[Message]:
    if options and options.get("speaker"):
        return _write_speaker(blocks)
    return _write_string(blocks)


# ---------------------------------------------------------------------------
# Format conversions
# ---------------------------------------------------------------------------

_SPEAKER_TO_OPENAI_ROLE: dict[Speaker, str] = {
    "system": "system",
    "human": "user",
    "ai": "assistant",
    "tool": "tool",
}


def _is_multimedia_binary(part: ContentMultiMedia) -> bool:
    return isinstance(part, ContentMultiMediaBinary)


def _multimedia_to_text(part: ContentMultiMedia) -> str:
    if isinstance(part, ContentMultiMediaBinary):
        return part.alt or ""
    return json.dumps(part.__dict__ if hasattr(part, "__dict__") else str(part))


def _convert_content_to_openai(content: RichContent) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    result = []
    for part in content:
        if isinstance(part, str):
            result.append({"type": "text", "text": part})
        elif isinstance(part, ContentMultiMediaBinary):
            result.append({"type": "image_url", "image_url": {"url": f"data:{part.type};base64,{part.base64}"}})
        else:
            result.append({"type": "text", "text": json.dumps(part.__dict__ if hasattr(part, "__dict__") else str(part))})
    return result


def _convert_content_to_langchain(content: RichContent) -> str | list[dict[str, Any]]:
    if isinstance(content, str):
        return content
    result = []
    for part in content:
        if isinstance(part, str):
            result.append({"type": "text", "text": part})
        elif isinstance(part, ContentMultiMediaBinary):
            result.append({"type": "image", "source_type": "base64", "data": part.base64, "mime_type": part.type})
        else:
            result.append({"type": "text", "text": json.dumps(part.__dict__ if hasattr(part, "__dict__") else str(part))})
    return result


def _camel_to_snake_case(s: str) -> str:
    import re
    return re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), s)


def _content_part_to_dict(part: ContentMultiMedia) -> Any:
    if isinstance(part, ContentMultiMediaBinary):
        d: dict[str, Any] = {"type": part.type, "base64": part.base64}
        if part.alt is not None:
            d["alt"] = part.alt
        return d
    if hasattr(part, "_to_dict"):
        return part._to_dict()
    return {"type": getattr(part, "type", ""), "content": getattr(part, "content", None)}


def _serialize_content(content: RichContent) -> Any:
    if isinstance(content, str):
        return content
    return [p if isinstance(p, str) else _content_part_to_dict(p) for p in content]


def _message_to_dict(m: Message) -> dict[str, Any]:
    return {"speaker": m.speaker, "content": _serialize_content(m.content)}


class FormatSideband:
    def __init__(
        self,
        tools: list[ToolDefinition] | None = None,
        schema: dict[str, Any] | None = None,
        runtime: dict[str, Any] | None = None,
    ):
        self.tools = tools
        self.schema = schema
        self.runtime = runtime


def format_messages(messages: list[Message], format: OutputFormat, sideband: FormatSideband | None = None) -> Any:
    if format == "message_dict":
        return messages

    if format == "dict":
        result: dict[str, Any] = {
            "messages": [{"speaker": m.speaker, "content": m.content} for m in messages],
        }
        if sideband and sideband.schema:
            result["schema"] = sideband.schema
        if sideband and sideband.tools:
            result["tools"] = sideband.tools
        if sideband and sideband.runtime:
            result["runtime"] = sideband.runtime
        return result

    if format == "openai_chat":
        result = {
            "messages": [
                {
                    "role": _SPEAKER_TO_OPENAI_ROLE.get(m.speaker, m.speaker),
                    "content": _convert_content_to_openai(m.content),
                }
                for m in messages
            ],
        }
        if sideband and sideband.tools:
            result["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        **({"description": t.description} if t.description else {}),
                        "parameters": t.parameters,
                    },
                }
                for t in sideband.tools
            ]
        if sideband and sideband.schema:
            result["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "schema",
                    "schema": sideband.schema,
                    "strict": True,
                },
            }
        if sideband and sideband.runtime:
            for key, value in sideband.runtime.items():
                result[_camel_to_snake_case(key)] = value
        return result

    if format == "raw":
        return json.dumps({"messages": [_message_to_dict(m) for m in messages]}, separators=(",", ":"))

    if format == "langchain":
        return {
            "messages": [
                {
                    "type": m.speaker,
                    "data": {"content": _convert_content_to_langchain(m.content)},
                }
                for m in messages
            ],
        }

    if format == "pydantic":
        return {"messages": messages}

    return messages


def render_content(content: RichContent) -> str:
    if isinstance(content, str):
        return content
    outputs = []
    for part in content:
        if isinstance(part, str):
            outputs.append(part)
        else:
            outputs.append(_multimedia_to_text(part))
    return "\n\n".join(outputs)


def render_messages(messages: list[Message]) -> str:
    return "\n\n".join(
        f"===== {m.speaker} =====\n\n{render_content(m.content)}"
        for m in messages
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _write_string(blocks: list[Block]) -> str:
    parts: list[str] = []
    for i, b in enumerate(blocks):
        if isinstance(b, MultiMediaBlock):
            continue
        if isinstance(b, SerializedNode):
            parts.append(_render_xml_root(b))
            continue
        rendered = _render_block(b, "")
        if i > 0:
            sep = "\n" if isinstance(b, Paragraph) and b.blank_line is False else "\n\n"
            parts.append(sep)
        parts.append(rendered)
    return "".join(parts)


def _write_speaker(blocks: list[Block]) -> list[Message]:
    has_speaker = any(b.speaker is not None for b in blocks)

    groups: list[dict[str, Any]] = []
    seen_speaker = False
    for b in blocks:
        if b.speaker is not None:
            sp = b.speaker
            seen_speaker = True
        elif not has_speaker:
            sp = "human"
        elif not seen_speaker:
            sp = "system"
        else:
            sp = groups[-1]["speaker"] if groups else "human"

        if groups and groups[-1]["speaker"] == sp:
            groups[-1]["blocks"].append(b)
        else:
            groups.append({"speaker": sp, "blocks": [b]})

    if not groups:
        return [Message(speaker="human", content="")]

    messages = []
    for g in groups:
        has_multimedia = any(isinstance(b, MultiMediaBlock) for b in g["blocks"])
        if has_multimedia:
            parts: list[str | ContentMultiMedia] = []
            text_blocks: list[Block] = []

            def flush_text() -> None:
                nonlocal text_blocks
                if not text_blocks:
                    return
                text = _write_string(text_blocks)
                if text:
                    parts.append(text)
                text_blocks = []

            for b in g["blocks"]:
                if isinstance(b, MultiMediaBlock):
                    flush_text()
                    parts.extend(b.content)
                else:
                    text_blocks.append(b)
            flush_text()
            messages.append(Message(speaker=g["speaker"], content=parts))
        else:
            messages.append(Message(speaker=g["speaker"], content=_write_string(g["blocks"])))

    # Drop trailing empty messages
    while len(messages) > 1:
        last = messages[-1]
        is_empty = (isinstance(last.content, list) and len(last.content) == 0) or last.content == ""
        if is_empty:
            messages.pop()
        else:
            break

    # If all empty, collapse to single default
    all_empty = all(
        (isinstance(m.content, list) and len(m.content) == 0) or m.content == ""
        for m in messages
    )
    if all_empty:
        return [Message(speaker="human", content=[])]

    return messages


def _render_block(block: Block, indent: str) -> str:
    if isinstance(block, Heading):
        return "#" * block.depth + " " + block.text
    if isinstance(block, Paragraph):
        return indent + block.text
    if isinstance(block, ListBlock):
        return _render_list(block, indent)
    if isinstance(block, SerializedNode):
        return _render_xml_root(block)
    return ""


def _render_list(lst: ListBlock, indent: str) -> str:
    has_nested = any(item.children for item in lst.items)
    style = lst.list_style or ("decimal" if lst.ordered else "dash")

    lines = []
    for i, item in enumerate(lst.items):
        if style == "decimal":
            prefix = f"{i + 1}. "
        elif style == "latin":
            prefix = f"{chr(97 + i)}. "
        elif style == "star":
            prefix = "* "
        elif style == "plus":
            prefix = "+ "
        else:
            prefix = "- "

        line = f"{indent}{prefix}{item.text}"
        if not item.children:
            lines.append(line)
        else:
            child_indent = indent + " " * len(prefix)
            parts = [_render_block(b, child_indent) for b in item.children]
            lines.append(f"{line}\n\n" + "\n\n".join(parts))

    return ("\n\n" if has_nested else "\n").join(lines)


# ---------------------------------------------------------------------------
# XML serialization
# ---------------------------------------------------------------------------

def _render_xml_root(node: SerializedNode) -> str:
    if node.name == "_root" and node.children:
        return "\n".join(_render_xml_node(c, "") for c in node.children)
    return _render_xml_node(node, "")


def _render_xml_node(node: SerializedNode, indent: str) -> str:
    if node.name == "_group" and node.children:
        return "\n".join(_render_xml_node(c, indent) for c in node.children)
    if node.name == "_text":
        return indent + _escape_xml(node.value or "")

    tag = node.name
    if node.value is not None and not node.children:
        return f"{indent}<{tag}>{_escape_xml(node.value)}</{tag}>"
    if node.children:
        child_indent = indent + "  "
        inner = "\n".join(_render_xml_node(c, child_indent) for c in node.children)
        return f"{indent}<{tag}>\n{inner}\n{indent}</{tag}>"
    return f"{indent}<{tag}/>"


def _escape_xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
