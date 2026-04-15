import type { Block, ContentMultiMedia, ContentMultiMediaBinary, ListBlock, Message, OutputFormat, RichContent, Speaker, SerializedNode, ToolDefinition, WriteOptions } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function write(blocks: Block[], options?: WriteOptions): string | Message[] {
  if (options?.speaker) {
    return writeSpeaker(blocks);
  }
  return writeString(blocks);
}

// ---------------------------------------------------------------------------
// Format conversions
// ---------------------------------------------------------------------------

const SPEAKER_TO_OPENAI_ROLE: Record<Speaker, string> = {
  system: "system",
  human: "user",
  ai: "assistant",
  tool: "tool",
};

function isMultiMediaBinary(part: ContentMultiMedia): part is ContentMultiMediaBinary {
  return "base64" in part;
}

/** Flatten a multimedia part to a plain-text string (using alt text for images). */
function multimediaToText(part: ContentMultiMedia): string {
  if (isMultiMediaBinary(part)) {
    return part.alt ?? "";
  }
  return JSON.stringify(part);
}

function convertContentToOpenAI(content: RichContent): string | { type: string; text?: string; image_url?: { url: string } }[] {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    if (isMultiMediaBinary(part)) {
      return { type: "image_url", image_url: { url: `data:${part.type};base64,${part.base64}` } };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

function convertContentToLangchain(content: RichContent): string | { type: string; text?: string; source_type?: string; data?: string; mime_type?: string }[] {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    if (isMultiMediaBinary(part)) {
      return { type: "image", source_type: "base64", data: part.base64, mime_type: part.type };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

/** Convert camelCase to snake_case (e.g. maxTokens → max_tokens). */
function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

/** Optional sideband data to merge into format-aware outputs. */
export interface FormatSideband {
  tools?: ToolDefinition[];
  schema?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

export function formatMessages(messages: Message[], format: OutputFormat, sideband?: FormatSideband): unknown {
  switch (format) {
    case "message_dict":
      return messages;

    case "dict": {
      const result: Record<string, unknown> = {
        messages: messages.map((m) => ({ speaker: m.speaker, content: m.content })),
      };
      if (sideband?.schema) result.schema = sideband.schema;
      if (sideband?.tools && sideband.tools.length > 0) result.tools = sideband.tools;
      if (sideband?.runtime) result.runtime = sideband.runtime;
      return result;
    }

    case "openai_chat": {
      const result: Record<string, unknown> = {
        messages: messages.map((m) => ({
          role: SPEAKER_TO_OPENAI_ROLE[m.speaker] ?? m.speaker,
          content: convertContentToOpenAI(m.content),
        })),
      };
      if (sideband?.tools && sideband.tools.length > 0) {
        result.tools = sideband.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            parameters: t.parameters,
          },
        }));
      }
      if (sideband?.schema) {
        result.response_format = {
          type: "json_schema",
          json_schema: {
            name: "schema",
            schema: sideband.schema,
            strict: true,
          },
        };
      }
      if (sideband?.runtime) {
        for (const [key, value] of Object.entries(sideband.runtime)) {
          result[camelToSnakeCase(key)] = value;
        }
      }
      return result;
    }

    case "raw":
      return JSON.stringify({ messages });

    case "langchain":
      return {
        messages: messages.map((m) => ({
          type: m.speaker,
          data: { content: convertContentToLangchain(m.content) },
        })),
      };

    case "pydantic":
      return { messages };
  }
}

/** Flatten RichContent to a plain string for display. */
export function renderContent(content: RichContent): string {
  if (typeof content === "string") return content;
  const outputs = content.map((part) => {
    if (typeof part === "string") return part;
    return multimediaToText(part);
  });
  return outputs.join("\n\n");
}

/** Serialize an array of Messages into the canonical text format used by tests. */
export function renderMessages(messages: Message[]): string {
  return messages
    .map((m) => `===== ${m.speaker} =====\n\n${renderContent(m.content)}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function writeString(blocks: Block[]): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "multimedia") continue; // skip multimedia in plain-string mode
    if (b.type === "serialized") {
      parts.push(renderXmlRoot(b));
      continue;
    }
    const rendered = renderBlock(b, "");
    if (i > 0) {
      const sep = b.type === "paragraph" && b.blankLine === false ? "\n" : "\n\n";
      parts.push(sep);
    }
    parts.push(rendered);
  }
  return parts.join("");
}

function writeSpeaker(blocks: Block[]): Message[] {
  // Determine if any block has an explicit speaker
  const hasSpeaker = blocks.some((b) => b.speaker !== undefined);

  // Group consecutive blocks by speaker.
  // If speaker-tagged blocks exist, untagged prefix blocks become "system",
  // and untagged blocks after a speaker-tagged block inherit the previous speaker.
  const groups: { speaker: Speaker; blocks: Block[] }[] = [];
  let seenSpeaker = false;
  for (const b of blocks) {
    let sp: Speaker;
    if (b.speaker !== undefined) {
      sp = b.speaker;
      seenSpeaker = true;
    } else if (!hasSpeaker) {
      sp = "human";
    } else if (!seenSpeaker) {
      sp = "system"; // prefix before first speaker → system
    } else {
      sp = groups.length > 0 ? groups[groups.length - 1].speaker : "human";
    }
    if (groups.length > 0 && groups[groups.length - 1].speaker === sp) {
      groups[groups.length - 1].blocks.push(b);
    } else {
      groups.push({ speaker: sp, blocks: [b] });
    }
  }
  if (groups.length === 0) {
    return [{ speaker: "human", content: "" }];
  }
  const messages = groups.map((g): Message => {
    const hasMultimedia = g.blocks.some((b) => b.type === "multimedia");
    if (hasMultimedia) {
      // Build a RichContent array mixing text and multimedia parts
      const parts: (string | ContentMultiMedia)[] = [];
      const textBlocks: Block[] = [];
      const flushText = () => {
        if (textBlocks.length === 0) return;
        const text = writeString(textBlocks);
        if (text) parts.push(text);
        textBlocks.length = 0;
      };
      for (const b of g.blocks) {
        if (b.type === "multimedia") {
          flushText();
          parts.push(...b.content);
        } else {
          textBlocks.push(b);
        }
      }
      flushText();
      return { speaker: g.speaker, content: parts as RichContent };
    }
    return { speaker: g.speaker, content: writeString(g.blocks) };
  });

  // Drop trailing messages with empty content (matches pomljs behavior)
  while (messages.length > 1) {
    const last = messages[messages.length - 1];
    const isEmpty = Array.isArray(last.content) ? last.content.length === 0 : last.content === "";
    if (isEmpty) messages.pop();
    else break;
  }

  // When all remaining messages have empty content, collapse to a single
  // default human message (matches pomljs default speaker behaviour).
  const allEmpty = messages.every((m) =>
    Array.isArray(m.content) ? m.content.length === 0 : m.content === "",
  );
  if (allEmpty) {
    return [{ speaker: "human", content: [] }];
  }

  return messages;
}

function renderBlock(block: Block, indent: string): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.depth)} ${block.text}`;
    case "paragraph":
      return indent + block.text;
    case "list":
      return renderList(block, indent);
    case "serialized":
      return renderXmlRoot(block);
    case "multimedia":
      return ""; // multimedia blocks are handled in writeSpeaker, not in text mode
  }
}

function renderList(list: ListBlock, indent: string): string {
  const hasNested = list.items.some((it) => it.children.length > 0);
  const style = list.listStyle ?? (list.ordered ? "decimal" : "dash");

  const lines = list.items.map((item, i) => {
    let prefix: string;
    switch (style) {
      case "decimal": prefix = `${i + 1}. `; break;
      case "latin": prefix = `${String.fromCharCode(97 + i)}. `; break;
      case "star": prefix = "* "; break;
      case "plus": prefix = "+ "; break;
      default: prefix = "- "; break; // dash
    }
    const line = `${indent}${prefix}${item.text}`;

    if (item.children.length === 0) return line;

    const childIndent = indent + " ".repeat(prefix.length);
    const parts = item.children.map((b) => renderBlock(b, childIndent));
    return `${line}\n\n${parts.join("\n\n")}`;
  });

  return lines.join(hasNested ? "\n\n" : "\n");
}

// ---------------------------------------------------------------------------
// XML serialization
// ---------------------------------------------------------------------------

function renderXmlRoot(node: SerializedNode): string {
  if (node.name === "_root" && node.children) {
    // Root container — render children as top-level XML fragments
    return node.children.map((c) => renderXmlNode(c, "")).join("\n");
  }
  return renderXmlNode(node, "");
}

function renderXmlNode(node: SerializedNode, indent: string): string {
  // _group: inline expansion (flatten)
  if (node.name === "_group" && node.children) {
    return node.children.map((c) => renderXmlNode(c, indent)).join("\n");
  }
  // _text: bare text (no tag wrapper)
  if (node.name === "_text") {
    return indent + escapeXml(node.value ?? "");
  }

  const tag = node.name;
  if (node.value !== undefined && !node.children) {
    // Leaf: <tag>text</tag>
    return `${indent}<${tag}>${escapeXml(node.value)}</${tag}>`;
  }
  if (node.children && node.children.length > 0) {
    // Container: <tag>\n  children\n</tag>
    const childIndent = indent + "  ";
    const inner = node.children
      .map((c) => renderXmlNode(c, childIndent))
      .join("\n");
    return `${indent}<${tag}>\n${inner}\n${indent}</${tag}>`;
  }
  // Empty element
  return `${indent}<${tag}/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
