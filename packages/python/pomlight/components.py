from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from .xml_parser import XmlElement
from .types import Block, Paragraph, State
from .expr import eval_expr, interpolate
from .style import get_style_prop


class _IndentedListDumper(yaml.SafeDumper):
    """Custom YAML dumper that indents list items inside mappings (matching Deno @std/yaml)."""
    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        return super().increase_indent(flow, False)


# ---------------------------------------------------------------------------
# Document component
# ---------------------------------------------------------------------------

def process_document(node: XmlElement, state: State) -> list[Block]:
    raw_src = node.attrs.get("src")
    if not raw_src or not state.file_path:
        return []
    src = interpolate(raw_src, state.ctx)

    dir_path = state.file_path[: state.file_path.rfind("/") + 1]
    doc_path = dir_path + src
    try:
        content = Path(doc_path).read_text()
    except OSError:
        return []

    return [Paragraph(text=content)]


# ---------------------------------------------------------------------------
# Table component
# ---------------------------------------------------------------------------

def process_table(node: XmlElement, state: State) -> list[Block]:
    syntax = node.attrs.get("syntax") or get_style_prop("table", "syntax", state) or "markdown"

    records: list[dict[str, Any]] = []
    columns: list[str] = []

    records_expr = node.attrs.get("records")
    if records_expr:
        raw = records_expr.strip()
        if raw.startswith("{{") and raw.endswith("}}"):
            raw = raw[2:-2].strip()
        data = eval_expr(raw, state.ctx)
        if isinstance(data, list) and len(data) > 0:
            first = data[0]
            if isinstance(first, list):
                records = [
                    {f"Column {i}": val for i, val in enumerate(row)}
                    for row in data
                ]
                columns = list(records[0].keys())
            elif isinstance(first, dict):
                columns = list(first.keys())
                records = data
    else:
        raw_src = node.attrs.get("src")
        if not raw_src or not state.file_path:
            return []
        src = interpolate(raw_src, state.ctx)

        dir_path = state.file_path[: state.file_path.rfind("/") + 1]
        table_path = dir_path + src
        ext = src.rsplit(".", 1)[-1].lower() if "." in src else ""

        if ext == "csv":
            try:
                content = Path(table_path).read_text()
            except OSError:
                return []
            parsed = _parse_csv_table(content)
            records = parsed["records"]
            columns = parsed["columns"]
        elif ext == "json":
            try:
                content = Path(table_path).read_text()
            except OSError:
                return []
            data = json.loads(content)
            if isinstance(data, list) and len(data) > 0:
                columns = list(data[0].keys())
                records = data
        elif ext == "jsonl" or node.attrs.get("parser") == "jsonl":
            try:
                content = Path(table_path).read_text()
            except OSError:
                return []
            parsed = _parse_jsonl_table(content)
            records = parsed["records"]
            columns = parsed["columns"]
        else:
            return []

        records = _infer_column_types(records, columns)

    # Apply columns attribute
    columns_attr = node.attrs.get("columns")
    header_map: dict[str, str] = {}
    if columns_attr:
        raw = columns_attr.strip()
        if raw.startswith("{{") and raw.endswith("}}"):
            raw = raw[2:-2].strip()
        col_defs = eval_expr(raw, state.ctx)
        if isinstance(col_defs, list):
            fields = [d["field"] for d in col_defs]
            columns = fields
            for d in col_defs:
                if d.get("header"):
                    header_map[d["field"]] = d["header"]

    # Apply selectedRecords slice
    selected_records = node.attrs.get("selectedRecords")
    if selected_records:
        start, end = parse_python_style_slice(selected_records, len(records))
        records = records[start:end]

    # Apply selectedColumns
    selected_columns = node.attrs.get("selectedColumns")
    if selected_columns and not records_expr:
        cols = [c.strip() for c in selected_columns.split(",")]
        columns = [c for c in cols if c in columns]

    # Apply maxRecords
    max_records_str = node.attrs.get("maxRecords", "")
    try:
        max_records = int(max_records_str)
    except (ValueError, TypeError):
        max_records = 0
    if max_records > 0 and len(records) > max_records:
        first = records[: max_records - 1]
        last = records[-1]
        ellipsis_row: dict[str, Any] = {c: "..." for c in columns}
        records = [*first, ellipsis_row, last]

    if not columns or not records:
        return []

    def fmt_cell(v: Any) -> str:
        if isinstance(v, bool):
            return ""
        if v is None:
            return ""
        return str(v)

    # Writer options
    writer_options: dict[str, Any] = {}
    raw_wo = node.attrs.get("writerOptions")
    if raw_wo is None and state.styles and "table" in state.styles:
        table_style = state.styles["table"]
        if isinstance(table_style, dict):
            raw_wo = table_style.get("writerOptions")
    if raw_wo:
        if isinstance(raw_wo, str):
            try:
                writer_options = json.loads(raw_wo)
            except (json.JSONDecodeError, TypeError):
                pass
        elif isinstance(raw_wo, dict):
            writer_options = raw_wo

    if syntax == "csv":
        separator = writer_options.get("csvSeparator", ",")
        show_header = writer_options.get("csvHeader", True) is not False
        lines: list[str] = []
        if show_header:
            lines.append(separator.join(columns))
        for rec in records:
            lines.append(separator.join(fmt_cell(rec.get(c)) for c in columns))
        return [Paragraph(text="\n".join(lines))]

    if syntax == "tsv":
        header_line = "\t".join(columns)
        body_lines = ["\t".join(fmt_cell(rec.get(c)) for c in columns) for rec in records]
        table = "\n".join([header_line, *body_lines])
        return [Paragraph(text=table)]

    # Default: markdown table
    display_headers = [header_map.get(c, c) for c in columns]

    col_widths: list[int] = []
    for idx, col in enumerate(columns):
        max_w = len(display_headers[idx])
        for rec in records:
            val = fmt_cell(rec.get(col))
            if len(val) > max_w:
                max_w = len(val)
        col_widths.append(max(max_w, 3))

    def pad(s: str, w: int) -> str:
        return s + " " * max(0, w - len(s))

    header_line = "| " + " | ".join(pad(h, col_widths[i]) for i, h in enumerate(display_headers)) + " |"
    sep_line = "| " + " | ".join("-" * w for w in col_widths) + " |"
    body_lines = [
        "| " + " | ".join(pad(fmt_cell(rec.get(c)), col_widths[i]) for i, c in enumerate(columns)) + " |"
        for rec in records
    ]
    table = "\n".join([header_line, sep_line, *body_lines])
    return [Paragraph(text=table)]


# ---------------------------------------------------------------------------
# Object component
# ---------------------------------------------------------------------------

def process_object(node: XmlElement, state: State) -> list[Block]:
    data_expr = node.attrs.get("data")
    if not data_expr:
        return []
    raw = data_expr.strip()
    if raw.startswith("{{") and raw.endswith("}}"):
        raw = raw[2:-2].strip()
    data = eval_expr(raw, state.ctx)
    if data is None:
        return []

    syntax = node.attrs.get("syntax", "json")

    if syntax == "yaml":
        yaml_str = yaml.dump(data, default_flow_style=False, width=1000000, sort_keys=False, Dumper=_IndentedListDumper).rstrip()
        return [Paragraph(text="```yaml\n" + yaml_str + "\n```")]

    if syntax == "xml":
        xml_str = _object_to_xml(data)
        return [Paragraph(text="```xml\n" + xml_str + "\n```")]

    # Default: JSON
    json_str = json.dumps(data, indent=2)
    return [Paragraph(text="```json\n" + json_str + "\n```")]


# ---------------------------------------------------------------------------
# Tree component
# ---------------------------------------------------------------------------

def process_tree(node: XmlElement, state: State) -> list[Block]:
    from .types import Heading

    items_expr = node.attrs.get("items")
    if not items_expr:
        return []
    raw = items_expr.strip()
    if raw.startswith("{{") and raw.endswith("}}"):
        raw = raw[2:-2].strip()
    items = eval_expr(raw, state.ctx)
    if not isinstance(items, list):
        return []

    show_content = node.attrs.get("showContent") in ("true", True)
    blocks: list[Block] = []

    def walk_tree(nodes: list[dict[str, Any]], depth: int, path_prefix: str) -> None:
        for item in nodes:
            name = item.get("name", "")
            full_path = f"{path_prefix}/{name}" if path_prefix else name
            blocks.append(Heading(depth=depth, text=full_path))

            if show_content and "value" in item:
                ext = name.rsplit(".", 1)[-1] if "." in name else ""
                fence = f"```{ext}\n{item['value']}\n```"
                blocks.append(Paragraph(text=fence))

            if "children" in item:
                walk_tree(item["children"], depth + 1, full_path)

    walk_tree(items, state.depth, "")
    return blocks


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def parse_python_style_slice(slice_str: str, total_length: int) -> tuple[int, int]:
    if slice_str == ":":
        return (0, total_length)
    if slice_str.endswith(":"):
        return (int(slice_str[:-1]), total_length)
    if slice_str.startswith(":"):
        end = int(slice_str[1:])
        return (0, total_length + end if end < 0 else end)
    if ":" in slice_str:
        parts = slice_str.split(":")
        s, e = int(parts[0]), int(parts[1])
        return (s, total_length + e if e < 0 else e)
    index = int(slice_str)
    return (index, index + 1)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_csv_table(content: str) -> dict[str, Any]:
    lines = content.strip().split("\n")
    if not lines:
        return {"records": [], "columns": []}
    headers = [h.strip() for h in lines[0].split(",")]
    records = []
    for line in lines[1:]:
        vals = [v.strip() for v in line.split(",")]
        obj: dict[str, str] = {}
        for i, h in enumerate(headers):
            obj[h] = vals[i] if i < len(vals) else ""
        records.append(obj)
    return {"records": records, "columns": headers}


def _parse_jsonl_table(content: str) -> dict[str, Any]:
    lines = [l for l in content.strip().split("\n") if l.strip()]
    records = [json.loads(line) for line in lines]
    columns = list(records[0].keys()) if records else []
    return {"records": records, "columns": columns}


def _infer_column_types(
    records: list[dict[str, Any]], columns: list[str]
) -> list[dict[str, Any]]:
    if not records:
        return records

    col_types: dict[str, str] = {}
    for col in columns:
        col_type = "string"
        all_empty = True
        for rec in records:
            raw_val = rec.get(col, "")
            # Normalize to lowercase string (matches JS String() behavior)
            val = str(raw_val).strip() if not isinstance(raw_val, bool) else str(raw_val).lower()
            if val == "":
                continue
            all_empty = False
            if val in ("true", "false"):
                if col_type == "string":
                    col_type = "boolean"
            else:
                try:
                    num = float(val)
                    if col_type == "string":
                        col_type = "integer" if num == int(num) and "." not in val else "float"
                except ValueError:
                    col_type = "string"
                    break
        if all_empty:
            col_type = "string"
        col_types[col] = col_type

    result = []
    for rec in records:
        out: dict[str, Any] = {}
        for col in columns:
            raw_val = rec.get(col, "")
            # For booleans, use the native value directly
            if isinstance(raw_val, bool) and col_types[col] == "boolean":
                out[col] = raw_val
                continue
            raw = str(raw_val).strip() if not isinstance(raw_val, bool) else str(raw_val).lower()
            ct = col_types[col]
            if ct == "boolean":
                out[col] = raw == "true"
            elif ct == "integer":
                out[col] = int(raw) if raw else ""
            elif ct == "float":
                out[col] = float(raw) if raw else ""
            else:
                out[col] = raw
        result.append(out)
    return result


def _object_to_xml(data: Any, indent: str = "", wrap_in_item: bool = False) -> str:
    if isinstance(data, list):
        return "\n".join(_object_to_xml(item, indent, True) for item in data)
    if isinstance(data, dict):
        child_indent = indent + "  " if wrap_in_item else indent
        parts = []
        for k, val in data.items():
            if val is not None and isinstance(val, (dict, list)):
                inner = _object_to_xml(val, child_indent + "  ")
                parts.append(f"{child_indent}<{k}>\n{inner}\n{child_indent}</{k}>")
            else:
                str_val = _js_string(val)
                if str_val == "":
                    parts.append(f"{child_indent}<{k}/>")
                else:
                    parts.append(f"{child_indent}<{k}>{_escape_xml_content(str_val)}</{k}>")
        inner = "\n".join(parts)
        if wrap_in_item:
            return f"{indent}<item>\n{inner}\n{indent}</item>"
        return inner
    return indent + _escape_xml_content(_js_string(data))


def _escape_xml_content(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _js_string(val: Any) -> str:
    """Convert a value to string matching JavaScript's String() behavior."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)
