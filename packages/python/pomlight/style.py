from __future__ import annotations

import json
from .xml_parser import XmlElement
from .types import State, StyleSheet
from .tags import normalize_tag


def pre_parse_stylesheet(node: XmlElement, state: State) -> State:
    for child in node.children:
        if isinstance(child, str):
            continue
        if normalize_tag(child.tag) == "stylesheet":
            text = "".join(c for c in child.children if isinstance(c, str)).strip()
            if not text:
                continue
            try:
                parsed: StyleSheet = json.loads(text)
                new_styles = {**(state.styles or {}), **parsed}
                return State(
                    ctx=state.ctx, depth=state.depth, file_path=state.file_path,
                    chat=state.chat, presentation=state.presentation,
                    serializer=state.serializer, styles=new_styles,
                    sideband=state.sideband,
                )
            except (json.JSONDecodeError, TypeError):
                pass
    return state


def get_style_prop(selector: str, prop: str, state: State) -> str | None:
    if not state.styles:
        return None
    entry = state.styles.get(selector)
    if not entry:
        return None
    return entry.get(prop)


def apply_stylesheet(node: XmlElement, state: State) -> XmlElement:
    if not state.styles:
        return node
    tag = normalize_tag(node.tag)
    class_name = node.attrs.get("className") or node.attrs.get("class-name")

    merged: dict[str, str] = {}
    tag_entry = state.styles.get(tag)
    if tag_entry:
        merged.update(tag_entry)
    if class_name:
        class_entry = state.styles.get(f".{class_name}")
        if class_entry:
            merged.update(class_entry)

    if not merged:
        return node

    # Explicit attrs take precedence
    new_attrs = {**merged, **node.attrs}
    return XmlElement(tag=node.tag, attrs=new_attrs, children=node.children)


def apply_text_transform(text: str, transform: str | None = None) -> str:
    if transform == "upper":
        return text.upper()
    if transform == "lower":
        return text.lower()
    if transform == "capitalize":
        return text[0].upper() + text[1:] if text else text
    return text
