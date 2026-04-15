import type { XmlNode } from "./xml.ts";

// ---------------------------------------------------------------------------
// Tag normalisation – maps PascalCase component names to canonical lowercase.
// ---------------------------------------------------------------------------

const TAG_ALIASES: Record<string, string> = {
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
};

export function normalizeTag(tag: string): string {
  return TAG_ALIASES[tag] ?? tag;
}

// ---------------------------------------------------------------------------
// Block-level element detection
// ---------------------------------------------------------------------------

const BLOCK_TAGS = new Set([
  "p",
  "h",
  "section",
  "list",
  "cp",
  "role",
  "task",
  "include",
  "let",
  "hint",
  "introducer",
  "output-format",
  "qa",
  "stepwise-instructions",
  "example",
  "examples",
  "input",
  "output",
  "system-msg",
  "user-msg",
  "human-msg",
  "ai-msg",
  "conversation",
  "ToolRequest",
  "ToolResponse",
  "msg-content",
  "audio",
  "img",
  "document",
  "code",
  "stylesheet",
  "table",
  "text",
  "object",
  "tree",
  "output-schema",
  "tool-definition",
  "runtime",
]);

/** Check if a child node is a block-level element. */
export function isBlockNode(c: XmlNode): boolean {
  if (typeof c === "string") return false;
  const tag = normalizeTag(c.tag);
  if (tag === "code") return c.attrs.inline === "false";
  if (tag === "br") return c.attrs.newLineCount !== undefined;
  if (tag === "span") return c.attrs.whiteSpace !== undefined || c.attrs["white-space"] !== undefined;
  return BLOCK_TAGS.has(tag);
}
