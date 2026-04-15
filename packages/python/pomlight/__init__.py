"""Pomlight — a lightweight POML parser."""

from __future__ import annotations

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
    "PomlOptions",
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


class PomlOptions:
    def __init__(
        self,
        context: dict[str, Any] | None = None,
        read_options: ReadOptions | None = None,
        stylesheet: StyleSheet | None = None,
        source_path: str | None = None,
        format: OutputFormat | None = None,
    ):
        self.context = context
        self.read_options = read_options
        self.stylesheet = stylesheet
        self.source_path = source_path
        self.format = format


def poml(element: str, options: PomlOptions | None = None) -> Any:
    """Convenience: read + write in one call, matching the official SDK's poml() API."""
    opts = options or PomlOptions()
    result = read_full(
        element,
        opts.read_options,
        opts.context,
        opts.stylesheet,
        opts.source_path,
    )
    fmt: OutputFormat = opts.format or "message_dict"
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
