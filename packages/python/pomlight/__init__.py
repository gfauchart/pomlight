"""Pomlight — a lightweight POML parser."""

from __future__ import annotations

import json
import os
import re
import warnings
from pathlib import Path
from typing import Any

from .read import read, read_full
from .write import write, format_messages, render_content, render_messages, FormatSideband
from .types import (
    Block,
    ContentMultiMedia,
    ContentMultiMediaBinary,
    ContentMultiMediaJson,
    Heading,
    ListBlock,
    ListItem,
    Message,
    MultiMediaBlock,
    OutputFormat,
    Paragraph,
    ReadOptions,
    ReadResult,
    RichContent,
    SerializedNode,
    Speaker,
    StyleSheet,
    ToolDefinition,
    WriteOptions,
)

__all__ = [
    "read",
    "read_full",
    "write",
    "format_messages",
    "render_content",
    "render_messages",
    "poml",
    # types
    "Block",
    "ContentMultiMedia",
    "ContentMultiMediaBinary",
    "ContentMultiMediaJson",
    "Heading",
    "ListBlock",
    "ListItem",
    "Message",
    "MultiMediaBlock",
    "OutputFormat",
    "Paragraph",
    "ReadOptions",
    "ReadResult",
    "RichContent",
    "SerializedNode",
    "Speaker",
    "StyleSheet",
    "ToolDefinition",
    "WriteOptions",
    "FormatSideband",
]


def poml(
    markup: str | Path,
    context: dict[str, Any] | str | Path | None = None,
    stylesheet: StyleSheet | str | Path | None = None,
    chat: bool = True,
    output_file: str | Path | None = None,
    format: OutputFormat = "message_dict",
) -> Any:
    """Process POML markup and return the result in the specified format.

    Args:
        markup: POML markup content as a string, or path to a POML file.
            If a string that looks like a file path but doesn't exist,
            a warning is issued and it's treated as markup content.
        context: Optional context data. Can be a dict, JSON string, or path to a JSON file.
        stylesheet: Optional stylesheet. Can be a dict, JSON string, or path to a JSON file.
        chat: If True, process as a chat conversation (default).
            If False, process as a single prompt.
        output_file: Optional path to save the output (not yet implemented).
        format: Output format for the result.
    """
    source_path: str | None = None

    # Resolve markup: file path or inline string
    if isinstance(markup, Path):
        if not markup.exists():
            raise FileNotFoundError(f"File not found: {markup}")
        source_path = str(markup)
        markup = markup.read_text()
    else:
        if os.path.exists(markup):
            source_path = str(Path(markup).resolve())
            markup = Path(markup).read_text()
        elif re.match(r"^[\w\-./\\]+\.poml$", markup):
            warnings.warn(
                f"The markup '{markup}' looks like a file path, but it does not exist. "
                "Assuming it is a POML string."
            )

    # Resolve context: dict, JSON string, or file path
    resolved_context: dict[str, Any] | None = None
    if isinstance(context, dict):
        resolved_context = context
    elif isinstance(context, (str, Path)):
        ctx_path = Path(context)
        if ctx_path.exists():
            resolved_context = json.loads(ctx_path.read_text())
        elif isinstance(context, str):
            resolved_context = json.loads(context)
        else:
            raise FileNotFoundError(f"File not found: {context}")

    # Resolve stylesheet: dict, JSON string, or file path
    resolved_stylesheet: StyleSheet | None = None
    if isinstance(stylesheet, dict):
        resolved_stylesheet = stylesheet
    elif isinstance(stylesheet, (str, Path)):
        ss_path = Path(stylesheet)
        if ss_path.exists():
            resolved_stylesheet = json.loads(ss_path.read_text())
        elif isinstance(stylesheet, str):
            resolved_stylesheet = json.loads(stylesheet)
        else:
            raise FileNotFoundError(f"File not found: {stylesheet}")

    result = read_full(
        markup,
        None,
        resolved_context,
        resolved_stylesheet,
        source_path,
    )
    fmt: OutputFormat = format
    if not chat:
        # non-chat mode: return plain string
        messages = write(result.blocks)
        assert isinstance(messages, str)
        return messages
    messages = write(result.blocks, {"speaker": True})
    assert isinstance(messages, list)

    has_sideband = result.schema or (result.tools and len(result.tools) > 0) or result.runtime
    if not has_sideband:
        return format_messages(messages, fmt)
    return format_messages(messages, fmt, FormatSideband(
        tools=result.tools,
        schema=result.schema,
        runtime=result.runtime,
    ))
