from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

from .xml_parser import XmlElement, parse_xml
from .types import Block, State
from .expr import eval_expr, interpolate


def process_let(node: XmlElement, state: State) -> None:
    name = node.attrs.get("name")
    value_attr = node.attrs.get("value")
    src_attr = node.attrs.get("src")
    type_attr = node.attrs.get("type")

    # Syntax 2 & 3: src attribute (file import)
    if src_attr is not None:
        if not state.file_path:
            return
        dir_path = str(Path(state.file_path).parent) + "/"
        file_path = dir_path + src_attr
        try:
            raw = Path(file_path).read_text()
        except OSError:
            return
        inferred_type = type_attr or _infer_file_type(src_attr)
        val = _parse_file_content(raw, inferred_type)
        if name:
            state.ctx[name] = val
        elif val is not None and isinstance(val, dict):
            state.ctx.update(val)
        return

    # Syntax 5: value attribute (expression)
    if value_attr is not None:
        expr = re.sub(r"^\{\{(.+)\}\}$", r"\1", value_attr).strip()
        val: Any = eval_expr(expr, state.ctx)
        if type_attr:
            val = _cast_type(val, type_attr)
        if name:
            state.ctx[name] = val
        elif val is not None and isinstance(val, dict):
            state.ctx.update(val)
        return

    # Get body text
    body = "".join(c for c in node.children if isinstance(c, str)).strip()
    if not name:
        return

    # Syntax 4: inline JSON (try to parse)
    if type_attr in ("json", "object") or body.startswith("{") or body.startswith("["):
        try:
            state.ctx[name] = _cast_type(json.loads(body), type_attr)
            return
        except (json.JSONDecodeError, TypeError):
            pass

    # Syntax 1 & 4 with type: literal string
    state.ctx[name] = _cast_type(body, type_attr) if type_attr else body


def process_include(
    node: XmlElement,
    state: State,
    process_element_fn: Callable[[XmlElement, State], list[Block]],
) -> list[Block]:
    raw_src = node.attrs.get("src")
    if not raw_src or not state.file_path:
        return []
    src = interpolate(raw_src, state.ctx)

    dir_path = str(Path(state.file_path).parent) + "/"
    include_path = dir_path + src

    try:
        content = Path(include_path).read_text()
    except OSError:
        return []

    if content.lstrip().startswith("<poml"):
        parsed = parse_xml(content)
    else:
        parsed = parse_xml(f"<_root>{content}</_root>")

    return process_element_fn(parsed, State(
        ctx=state.ctx, depth=state.depth, file_path=include_path,
        chat=state.chat, presentation=state.presentation,
        serializer=state.serializer, styles=state.styles,
        sideband=state.sideband,
    ))


def convert_runtime_value(value: str) -> Any:
    if value == "true":
        return True
    if value == "false":
        return False
    if re.match(r"^-?\d*\.?\d+$", value):
        num = float(value)
        if not (num != num):  # not NaN
            if num == int(num) and "." not in value:
                return int(num)
            return num
    if (value.startswith("[") and value.endswith("]")) or (value.startswith("{") and value.endswith("}")):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _cast_type(val: Any, type_attr: str | None) -> Any:
    if not type_attr:
        return val
    if type_attr in ("integer", "number"):
        try:
            n = float(val)
            return int(n) if type_attr == "integer" else n
        except (ValueError, TypeError):
            return val
    if type_attr == "boolean":
        return val == "true" or val is True or val == 1
    if type_attr in ("json", "object"):
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return val
        return val
    return val


def _infer_file_type(src: str) -> str:
    ext = src.rsplit(".", 1)[-1].lower() if "." in src else ""
    if ext == "json":
        return "json"
    if ext == "csv":
        return "csv"
    return "text"


def _parse_file_content(raw: str, file_type: str) -> Any:
    if file_type == "json":
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw
    if file_type == "csv":
        lines = raw.strip().split("\n")
        if not lines:
            return []
        headers = [h.strip() for h in lines[0].split(",")]
        return [
            {h: (vals[i].strip() if i < len(vals) else "") for i, h in enumerate(headers)}
            for line in lines[1:]
            for vals in [line.split(",")]
        ]
    return raw
