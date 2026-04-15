from __future__ import annotations

from typing import Union
from .xml_parser import XmlElement, XmlNode

TAG_ALIASES: dict[str, str] = {
    "Task": "task",
    "Role": "role",
    "OutputFormat": "output-format",
    "Code": "code",
    "List": "list",
    "ListItem": "item",
    "Hint": "hint",
    "Introducer": "introducer",
    "StepwiseInstructions": "stepwise-instructions",
    "QA": "qa",
    "Example": "example",
    "Examples": "examples",
    "Input": "input",
    "Output": "output",
    "Include": "include",
    "Paragraph": "p",
    "Header": "h",
    "Section": "section",
    "Bold": "b",
    "Italic": "i",
    "Span": "span",
    "Newline": "br",
    "Image": "img",
    "Conversation": "conversation",
    "CaptionedParagraph": "cp",
    "stylesheet": "stylesheet",
    "SystemMessage": "system-msg",
    "HumanMessage": "human-msg",
    "AIMessage": "ai-msg",
    "Table": "table",
    "Document": "document",
    "OutputSchema": "output-schema",
    "outputschema": "output-schema",
    "Text": "text",
    "Object": "object",
    "Tree": "tree",
    "ToolDefinition": "tool-definition",
    "tool-def": "tool-definition",
    "tooldef": "tool-definition",
    "tool": "tool-definition",
    "Runtime": "runtime",
}

BLOCK_TAGS: set[str] = {
    "p", "h", "section", "list", "cp", "role", "task",
    "include", "let", "hint", "introducer", "output-format",
    "qa", "stepwise-instructions", "example", "examples",
    "input", "output", "system-msg", "user-msg", "human-msg",
    "ai-msg", "conversation", "ToolRequest", "ToolResponse",
    "msg-content", "audio", "img", "document", "code",
    "stylesheet", "table", "text", "object", "tree",
    "output-schema", "tool-definition", "runtime",
}


def normalize_tag(tag: str) -> str:
    return TAG_ALIASES.get(tag, tag)


def is_block_node(c: XmlNode) -> bool:
    if isinstance(c, str):
        return False
    tag = normalize_tag(c.tag)
    if tag == "code":
        return c.attrs.get("inline") == "false"
    if tag == "br":
        return "newLineCount" in c.attrs
    if tag == "span":
        return "whiteSpace" in c.attrs or "white-space" in c.attrs
    return tag in BLOCK_TAGS
