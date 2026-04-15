import { parseXml, type XmlElement, type XmlNode } from "./xml.ts";
import type { Block, ContentMultiMediaBinary, ContentMultiMediaJson, ListBlock, ListItem, ReadOptions, ReadResult, Sideband, Speaker, State, StyleSheet, ToolDefinition } from "./types.ts";
import { encodeBase64 } from "@std/encoding/base64";
import { normalizeTag, isBlockNode } from "./tags.ts";
import { evalExpr, evalCondition, interpolate } from "./expr.ts";
import { preParseStylesheet, applyStylesheet, getStyleProp, applyTextTransform } from "./style.ts";
import { renderInline, renderInlinePre } from "./inline.ts";
import { processDocument, processTable, processObject, processTree, parsePythonStyleSlice } from "./components.ts";
import { processLet, processInclude, convertRuntimeValue } from "./directives.ts";
import { processSerialize } from "./serialize.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function read(
  element: string,
  options?: ReadOptions,
  context?: Record<string, unknown>,
  stylesheet?: StyleSheet,
  sourcePath?: string,
): Promise<Block[]> {
  const result = await readFull(element, options, context, stylesheet, sourcePath);
  return result.blocks;
}

/** Extended read that also returns sideband data (output-schema, tools, runtime). */
export async function readFull(
  element: string,
  _options?: ReadOptions,
  context?: Record<string, unknown>,
  stylesheet?: StyleSheet,
  sourcePath?: string,
): Promise<ReadResult> {
  const root = parseXml(element);
  const initialStyles = stylesheet ? { ...stylesheet } : undefined;
  const sideband: Sideband = { tools: [] };
  const blocks = await processElement(root, { ctx: context ?? {}, depth: 1, filePath: sourcePath, styles: initialStyles, sideband });
  const result: ReadResult = { blocks };
  if (sideband.schema) result.schema = sideband.schema;
  if (sideband.tools.length > 0) result.tools = sideband.tools;
  if (sideband.runtime) result.runtime = sideband.runtime;
  return result;
}

// ---------------------------------------------------------------------------
// Element processing
// ---------------------------------------------------------------------------

async function processElement(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  if (node.attrs.if !== undefined) {
    if (!evalCondition(node.attrs.if, state.ctx)) return [];
  }

  if (node.attrs.for !== undefined) {
    return expandFor(node, state);
  }

  node = applyStylesheet(node, state);

  const blocks = await dispatchElement(node, state);

  const speakerAttr = node.attrs.speaker;
  if (speakerAttr && blocks.length > 0) {
    tagSpeaker(blocks, speakerAttr as Speaker);
  }

  return blocks;
}

async function dispatchElement(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const tag = normalizeTag(node.tag);
  switch (tag) {
    case "poml":
    case "_root": {
      const syntax = node.attrs.syntax;
      if (syntax === "xml" || syntax === "json" || syntax === "yaml") {
        return processSerialize(node, {
          ...state,
          presentation: "serialize",
          serializer: syntax,
        });
      }
      const stateWithStyles = preParseStylesheet(node, state);
      return processChildren(node.children, stateWithStyles);
    }

    case "p": {
      const syntax = node.attrs.syntax;
      if (syntax === "json" || syntax === "yaml" || syntax === "xml" || syntax === "text") {
        const txt = readWhitespace(node, state);
        if (!txt) return [];
        const serialized = syntax === "json" ? JSON.stringify(txt) : txt;
        const lang = syntax === "text" ? "" : syntax;
        const code = "```" + lang + "\n" + serialized + "\n```";
        return [{ type: "paragraph", text: code }];
      }
      const txt = readWhitespace(node, state);
      if (!txt) return [];
      return [{ type: "paragraph", text: txt }];
    }

    case "h":
      return [{ type: "heading", depth: state.depth, text: renderInline(node.children, state).trim() }];

    case "section":
      return processChildren(node.children, { ...state, depth: state.depth + 1 });

    case "list": {
      const listStyle = node.attrs.listStyle ?? getStyleProp("list", "listStyle", state) ?? "dash";
      const ordered = listStyle === "decimal" || listStyle === "latin";
      const items = await processListItems(node.children, state);
      if (items.length === 0) return [];
      return [{ type: "list", ordered, listStyle, items } as ListBlock];
    }

    case "include":
      return processInclude(node, state, processElement);

    // --- Intention components (unified) ---

    case "cp":
      return processCp(node, state);

    case "role": {
      const roleCaption = applyTextTransform("Role", getStyleProp("cp", "captionTextTransform", state));
      const txt = renderInline(node.children, state).trim();
      return [
        { type: "heading", depth: state.depth, text: roleCaption },
        { type: "paragraph", text: txt },
      ];
    }

    case "task": {
      const taskCaption = applyTextTransform("Task", getStyleProp("cp", "captionTextTransform", state));
      const blocks = node.children.some(c => isBlockNode(c))
        ? await processChildren(node.children, state)
        : [{ type: "paragraph" as const, text: renderInline(node.children, state).trim() }];
      return [{ type: "heading", depth: state.depth, text: taskCaption }, ...blocks];
    }

    case "hint":
      return processIntention(node, state, {
        defaultCaption: "Hint", defaultStyle: "bold",
        captionStyleFrom: "hint",
      });

    case "introducer": {
      const caption = node.attrs.caption ?? "Introducer";
      const captionStyle = node.attrs.captionStyle ?? "hidden";
      const txt = renderInline(node.children, state).trim();
      return renderCaptionedIntention(caption, captionStyle, txt, state);
    }

    case "output-format":
      return processIntention(node, state, {
        defaultCaption: "Output Format", defaultStyle: "header",
        captionStyleFrom: "output-format",
      });

    case "qa":
      return processQa(node, state);

    case "stepwise-instructions":
      return processIntention(node, state, {
        defaultCaption: "Stepwise Instructions", defaultStyle: "header",
        captionStyleFrom: "stepwise-instructions", blockOnly: true,
      });

    case "example": {
      const chat = node.attrs.chat !== "false" && state.chat !== false;
      const caption = interpolate(node.attrs.caption ?? "Example", state.ctx);
      const captionStyle = node.attrs.captionStyle ?? (chat ? "hidden" : "header");
      const captionEnding = node.attrs.captionEnding ?? getStyleProp("example", "captionEnding", state);
      const blocks = await processChildren(node.children, { ...state, chat });
      if (captionStyle === "hidden") return blocks;
      return [...renderCaptionBlock(caption, captionStyle, state, captionEnding), ...blocks];
    }

    case "examples": {
      const caption = node.attrs.caption ?? "Examples";
      const captionStyle = node.attrs.captionStyle ?? "header";
      const chat = node.attrs.chat !== "false";
      const captionEnding = node.attrs.captionEnding ?? getStyleProp("examples", "captionEnding", state);
      const blocks = await processChildren(node.children, { ...state, chat, depth: state.depth + 1 });
      const captionBlocks = renderCaptionBlock(caption, captionStyle, state, captionEnding);
      const introducer = node.attrs.introducer;
      if (introducer) {
        captionBlocks.push({ type: "paragraph", text: interpolate(introducer, state.ctx) });
      }
      if (blocks.some(b => b.speaker !== undefined)) {
        tagSpeaker(captionBlocks, "system");
      }
      return [...captionBlocks, ...blocks];
    }

    case "input": {
      const chat = state.chat !== false;
      const caption = node.attrs.caption ?? "Input";
      const captionStyle = node.attrs.captionStyle ?? getStyleProp("input", "captionStyle", state) ?? (chat ? "hidden" : "bold");
      const captionEnding = node.attrs.captionEnding ?? getStyleProp("input", "captionEnding", state);
      const blocks = await processInputOutput(node, caption, captionStyle, state, captionEnding);
      if (chat) tagSpeaker(blocks, "human");
      return blocks;
    }

    case "output": {
      const chat = state.chat !== false;
      const caption = node.attrs.caption ?? "Output";
      const captionStyle = node.attrs.captionStyle ?? getStyleProp("output", "captionStyle", state) ?? (chat ? "hidden" : "bold");
      const captionEnding = node.attrs.captionEnding ?? getStyleProp("output", "captionEnding", state);
      const blocks = await processInputOutput(node, caption, captionStyle, state, captionEnding);
      if (chat) tagSpeaker(blocks, "ai");
      return blocks;
    }

    // --- Message components (unified) ---

    case "system-msg":
      return processSpeakerMessage(node, state, "system");

    case "ai-msg":
      return processSpeakerMessage(node, state, "ai");

    case "user-msg":
    case "human-msg":
      return processSpeakerMessage(node, state, "human");

    case "conversation":
      return processConversation(node, state);

    case "ToolRequest":
      return processToolRequest(node, state);

    case "ToolResponse":
      return processToolResponse(node, state);

    case "msg-content":
      return processMsgContent(node, state);

    // --- Data components ---

    case "img":
      return processImg(node, state);

    case "document":
      return processDocument(node, state);

    case "table":
      return processTable(node, state);

    case "object":
      return processObject(node, state);

    case "tree":
      return processTree(node, state);

    // --- Code / text ---

    case "code": {
      if (node.attrs.inline === "false") {
        const lang = node.attrs.lang ?? "";
        const innerBlocks = await processChildren(node.children, state);
        const { write } = await import("./write.ts");
        const inner = (write(innerBlocks) as string).replace(/[ \t]+$/gm, "");
        const fence = "```" + lang + "\n" + inner + "\n```";
        return [{ type: "paragraph", text: fence }];
      }
      return [{ type: "paragraph", text: "`" + renderInline(node.children, state).trim() + "`" }];
    }

    case "text": {
      const syntax = node.attrs.syntax;
      if (syntax === "text") {
        const raw = renderInlinePre(node.children, state);
        return [{ type: "paragraph", text: "```\n" + raw + "\n```" }];
      }
      if (syntax) {
        const raw = renderInlinePre(node.children, state);
        return [{ type: "paragraph", text: "```" + syntax + "\n" + raw + "\n```" }];
      }
      const txt = renderInline(node.children, state).trim();
      return txt ? [{ type: "paragraph", text: txt }] : [];
    }

    // --- Whitespace / inline blocks ---

    case "br": {
      const count = parseInt(node.attrs.newLineCount ?? "1", 10);
      if (count <= 1) return [];
      return [{ type: "paragraph", text: "\n".repeat(count - 1), blankLine: false }];
    }

    case "span": {
      const ws = node.attrs.whiteSpace ?? node.attrs["white-space"];
      if (ws === "trim") {
        const txt = renderInlinePre(node.children, state).trim();
        if (!txt) return [];
        return [{ type: "paragraph", text: txt }];
      }
      if (ws === "pre") {
        const txt = renderInlinePre(node.children, state);
        if (!txt.trim()) return [];
        return [{ type: "paragraph", text: txt }];
      }
      const txt = renderInline(node.children, state).trim();
      if (!txt) return [];
      return [{ type: "paragraph", text: txt }];
    }

    // --- Meta / sideband ---

    case "output-schema":
      if (state.sideband) {
        const text = node.children.filter((c): c is string => typeof c === "string").join("").trim();
        if (text) {
          const processed = interpolate(text, state.ctx);
          try { state.sideband.schema = JSON.parse(processed); } catch { /* ignore */ }
        }
      }
      return [];

    case "tool-definition": {
      if (state.sideband) {
        const name = node.attrs.name ? interpolate(node.attrs.name, state.ctx) : undefined;
        if (name) {
          const description = node.attrs.description ? interpolate(node.attrs.description, state.ctx) : undefined;
          const text = node.children.filter((c): c is string => typeof c === "string").join("").trim();
          let parameters: Record<string, unknown> = {};
          if (text) {
            const processed = interpolate(text, state.ctx);
            try { parameters = JSON.parse(processed); } catch { /* ignore */ }
          }
          const tool: ToolDefinition = { name, parameters };
          if (description) tool.description = description;
          state.sideband.tools.push(tool);
        }
      }
      return [];
    }

    case "runtime":
      if (state.sideband) {
        const params: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(node.attrs)) {
          const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          params[camelKey] = convertRuntimeValue(interpolate(val, state.ctx));
        }
        state.sideband.runtime = params;
      }
      return [];

    case "audio":
    case "stylesheet":
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Whitespace helper (shared by <p> case)
// ---------------------------------------------------------------------------

function readWhitespace(node: XmlElement, state: State): string {
  const ws = node.attrs.whiteSpace ?? node.attrs["white-space"];
  if (ws === "pre") return renderInlinePre(node.children, state);
  if (ws === "trim") return renderInlinePre(node.children, state).trim();
  return renderInline(node.children, state).trim();
}

// ---------------------------------------------------------------------------
// Intention helpers (shared caption + body pattern)
// ---------------------------------------------------------------------------

interface IntentionOpts {
  defaultCaption: string;
  defaultStyle: string;
  captionStyleFrom: string;
  blockOnly?: boolean;
}

async function processIntention(
  node: XmlElement,
  state: State,
  opts: IntentionOpts,
): Promise<Block[]> {
  const caption = applyTextTransform(
    node.attrs.caption ?? opts.defaultCaption,
    getStyleProp("cp", "captionTextTransform", state),
  );
  const captionStyle = node.attrs.captionStyle ?? getStyleProp(opts.captionStyleFrom, "captionStyle", state) ?? opts.defaultStyle;
  const captionEnding = node.attrs.captionEnding ?? getStyleProp(opts.captionStyleFrom, "captionEnding", state);

  const hasBlockChild = opts.blockOnly || node.children.some(c => isBlockNode(c));
  if (hasBlockChild) {
    const blocks = await processChildren(node.children, state);
    if (blocks.length === 0) return renderCaptionBlock(caption, captionStyle, state, captionEnding);
    if ((captionEnding === "newline" || captionEnding === "colon-newline") && blocks[0].type === "paragraph") {
      blocks[0] = { ...blocks[0], blankLine: false };
    }
    return [...renderCaptionBlock(caption, captionStyle, state, captionEnding), ...blocks];
  }
  const txt = renderInline(node.children, state).trim();
  return renderCaptionedIntention(caption, captionStyle, txt, state, captionEnding);
}

async function processCp(node: XmlElement, state: State): Promise<Block[]> {
  const rawCaption = interpolate(node.attrs.caption ?? "", state.ctx);
  const caption = applyTextTransform(rawCaption, getStyleProp("cp", "captionTextTransform", state));
  const captionStyle = node.attrs.captionStyle ?? getStyleProp("cp", "captionStyle", state) ?? "header";
  const captionEnding = node.attrs.captionEnding ?? getStyleProp("cp", "captionEnding", state);
  if (captionStyle === "header" && !captionEnding) {
    const blocks = await processChildren(node.children, { ...state, depth: state.depth + 1 });
    return [{ type: "heading", depth: state.depth, text: caption }, ...blocks];
  }
  const hasBlockChild = node.children.some(c => isBlockNode(c));
  if (hasBlockChild) {
    const blocks = await processChildren(node.children, { ...state, depth: state.depth + 1 });
    if ((captionEnding === "newline" || captionEnding === "colon-newline") && blocks.length > 0 && blocks[0].type === "paragraph") {
      blocks[0] = { ...blocks[0], blankLine: false };
    }
    return [...renderCaptionBlock(caption, captionStyle, state, captionEnding), ...blocks];
  }
  const txt = renderInline(node.children, state).trim();
  return renderCaptionedIntention(caption, captionStyle, txt, state, captionEnding);
}

function processQa(node: XmlElement, state: State): Block[] {
  const qCaption = applyTextTransform(node.attrs.questionCaption ?? "Question", getStyleProp("cp", "captionTextTransform", state));
  const aCaption = node.attrs.answerCaption ?? "Answer";
  const captionStyle = node.attrs.captionStyle ?? getStyleProp("qa", "captionStyle", state) ?? "bold";
  const captionEnding = node.attrs.captionEnding ?? getStyleProp("qa", "captionEnding", state);
  const txt = renderInline(node.children, state).trim();
  const out = renderCaptionedIntention(qCaption, captionStyle, txt, state, captionEnding);
  if (captionStyle === "bold") {
    out.push({ type: "paragraph", text: `**${aCaption}:**` });
  } else if (captionStyle === "header") {
    out.push({ type: "heading", depth: state.depth, text: aCaption });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caption rendering
// ---------------------------------------------------------------------------

function renderCaptionBlock(
  caption: string,
  style: string,
  state: State,
  captionEnding?: string,
): Block[] {
  const ending = captionEnding ?? "default";
  switch (style) {
    case "header":
      return [{ type: "heading", depth: state.depth, text: caption }];
    case "bold": {
      if (ending === "newline" || ending === "colon-newline") {
        const suffix = ending === "colon-newline" ? ":" : "";
        return [{ type: "paragraph", text: `**${caption}${suffix}**` }];
      }
      return [{ type: "paragraph", text: `**${caption}:**` }];
    }
    case "plain": {
      if (ending === "newline" || ending === "colon-newline") {
        const suffix = ending === "colon-newline" ? ":" : "";
        return [{ type: "paragraph", text: `${caption}${suffix}` }];
      }
      return [{ type: "paragraph", text: `${caption}:` }];
    }
    case "hidden":
    default:
      return [];
  }
}

function renderCaptionedIntention(
  caption: string,
  style: string,
  text: string,
  state: State,
  captionEnding?: string,
): Block[] {
  const ending = captionEnding ?? "default";
  switch (style) {
    case "header":
      return [
        { type: "heading", depth: state.depth, text: caption },
        { type: "paragraph", text },
      ];
    case "bold": {
      if (ending === "colon-newline") {
        return [
          { type: "paragraph", text: `**${caption}:**` },
          { type: "paragraph", text, blankLine: false },
        ];
      }
      if (ending === "newline") {
        return [
          { type: "paragraph", text: `**${caption}**` },
          { type: "paragraph", text, blankLine: false },
        ];
      }
      if (ending === "none") {
        return [{ type: "paragraph", text: `**${caption}** ${text}` }];
      }
      return [{ type: "paragraph", text: `**${caption}:** ${text}` }];
    }
    case "plain": {
      if (ending === "colon-newline") {
        return [
          { type: "paragraph", text: `${caption}:` },
          { type: "paragraph", text, blankLine: false },
        ];
      }
      if (ending === "newline") {
        return [
          { type: "paragraph", text: caption },
          { type: "paragraph", text, blankLine: false },
        ];
      }
      if (ending === "none") {
        return [{ type: "paragraph", text: `${caption} ${text}` }];
      }
      return [{ type: "paragraph", text: `${caption}: ${text}` }];
    }
    case "hidden":
    default:
      return [{ type: "paragraph", text }];
  }
}

// ---------------------------------------------------------------------------
// Input/Output helper
// ---------------------------------------------------------------------------

async function processInputOutput(
  node: XmlElement,
  caption: string,
  captionStyle: string,
  state: State,
  captionEnding?: string,
): Promise<Block[]> {
  const hasBlockChild = node.children.some(c => isBlockNode(c));
  if (hasBlockChild) {
    const blocks = await processChildren(node.children, state);
    if (captionStyle === "hidden") return blocks;
    const captionBlocks = renderCaptionBlock(caption, captionStyle, state, captionEnding);
    if ((captionEnding === "colon-newline" || captionEnding === "newline") && blocks.length > 0 && blocks[0].type === "paragraph") {
      blocks[0] = { ...blocks[0], blankLine: false };
    }
    return [...captionBlocks, ...blocks];
  }
  const txt = renderInline(node.children, state).trim();
  return renderCaptionedIntention(caption, captionStyle, txt, state, captionEnding);
}

// ---------------------------------------------------------------------------
// Message components (unified handler)
// ---------------------------------------------------------------------------

async function processSpeakerMessage(
  node: XmlElement,
  state: State,
  speaker: Speaker,
): Promise<Block[]> {
  const hasBlockChild = node.children.some(c => isBlockNode(c));
  if (hasBlockChild) {
    const blocks = await processChildren(node.children, state);
    return tagSpeaker(blocks, speaker);
  }
  const txt = renderInline(node.children, state).trim();
  if (!txt) return [];
  return [{ type: "paragraph", text: txt, blankLine: false, speaker }];
}

function tagSpeaker(blocks: Block[], speaker: Speaker): Block[] {
  for (const b of blocks) b.speaker = speaker;
  return blocks;
}

function processConversation(
  node: XmlElement,
  state: State,
): Block[] {
  const msgsExpr = node.attrs.messages;
  if (!msgsExpr) return [];
  const raw = msgsExpr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
  let msgs = evalExpr(raw, state.ctx);
  if (!Array.isArray(msgs)) return [];

  const selectedMessages = node.attrs.selectedMessages;
  if (selectedMessages) {
    const [start, end] = parsePythonStyleSlice(selectedMessages, (msgs as unknown[]).length);
    msgs = (msgs as unknown[]).slice(start, end);
  }

  return (msgs as { speaker?: string; content?: string }[]).map((msg) => {
    const sp = msg.speaker === "system" ? "system" as const
      : msg.speaker === "ai" ? "ai" as const
      : "human" as const;
    return {
      type: "paragraph" as const,
      text: String(msg.content ?? ""),
      blankLine: false,
      speaker: sp,
    };
  });
}

function processToolRequest(
  node: XmlElement,
  state: State,
): Block[] {
  const id = node.attrs.id ?? "";
  const name = node.attrs.name ?? "";
  const paramsExpr = node.attrs.parameters;
  let content: unknown = {};
  if (paramsExpr) {
    const raw = paramsExpr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
    content = evalExpr(raw, state.ctx);
  }
  return [{
    type: "multimedia",
    content: [{
      type: "application/vnd.poml.toolrequest",
      content,
      id,
      name,
    } as unknown as ContentMultiMediaJson],
    speaker: "ai",
  }];
}

async function processToolResponse(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const id = node.attrs.id ?? "";
  const name = node.attrs.name ?? "";
  const { write } = await import("./write.ts");
  const innerBlocks = await processChildren(node.children, state);
  const textContent = write(innerBlocks) as string;
  return [{
    type: "multimedia",
    content: [{
      type: "application/vnd.poml.toolresponse",
      content: textContent,
      id,
      name,
    } as unknown as ContentMultiMediaJson],
    speaker: "tool",
  }];
}

function processMsgContent(
  node: XmlElement,
  state: State,
): Block[] {
  const rawContent = node.attrs.content;
  if (rawContent) {
    const exprMatch = rawContent.match(/^\{\{(.+)\}\}$/);
    const resolved = exprMatch ? evalExpr(exprMatch[1].trim(), state.ctx) : interpolate(rawContent, state.ctx);
    if (typeof resolved === "string") {
      return [{ type: "paragraph", text: resolved, blankLine: false }];
    }
    if (Array.isArray(resolved)) {
      const textParts = (resolved as unknown[]).map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "alt" in part) return (part as { alt: string }).alt;
        if (part && typeof part === "object" && "content" in part) return String((part as { content: unknown }).content);
        return String(part);
      });
      return [{ type: "paragraph", text: textParts.join("\n"), blankLine: false }];
    }
    return [{ type: "paragraph", text: String(resolved ?? ""), blankLine: false }];
  }
  return [{ type: "multimedia", content: [] }];
}

// ---------------------------------------------------------------------------
// Image component
// ---------------------------------------------------------------------------

async function processImg(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const imgSyntax = node.attrs.syntax;
  const isMultimedia = imgSyntax === "multimedia" || (!imgSyntax && !node.attrs.alt);
  if (isMultimedia) {
    const imgSrc = node.attrs.src;
    if (imgSrc && state.filePath) {
      const dir = state.filePath.substring(0, state.filePath.lastIndexOf("/") + 1);
      const imgPath = dir + imgSrc;
      try {
        const imgData = await Deno.readFile(imgPath);
        const b64 = encodeBase64(imgData);
        const mimeType = imgSrc.endsWith(".png") ? "image/png"
          : imgSrc.endsWith(".jpg") || imgSrc.endsWith(".jpeg") ? "image/jpeg"
          : imgSrc.endsWith(".gif") ? "image/gif"
          : imgSrc.endsWith(".webp") ? "image/webp"
          : "image/png";
        const media: ContentMultiMediaBinary = { type: mimeType, base64: b64 };
        if (node.attrs.alt) media.alt = interpolate(node.attrs.alt, state.ctx);
        return [{ type: "multimedia", content: [media] }];
      } catch {
        // File not found — fall through to alt text or empty
      }
    }
    const alt = node.attrs.alt;
    if (alt) return [{ type: "paragraph", text: interpolate(alt, state.ctx) }];
    return [];
  }
  const alt = node.attrs.alt;
  if (alt) return [{ type: "paragraph", text: interpolate(alt, state.ctx) }];
  return [];
}

// ---------------------------------------------------------------------------
// Children processing (block containers: poml, section, cp)
// ---------------------------------------------------------------------------

async function processChildren(
  children: XmlNode[],
  state: State,
): Promise<Block[]> {
  const blocks: Block[] = [];
  let inlineBuf: XmlNode[] = [];

  const flush = (beforeBlock = false) => {
    if (inlineBuf.length === 0) return;
    const raw = renderInline(inlineBuf, state);
    const firstHasContent =
      typeof inlineBuf[0] === "string" && inlineBuf[0].trim() !== "";
    let txt: string;
    if (!beforeBlock && blocks.length > 0 && firstHasContent) {
      txt = raw.replace(/\s+$/, "");
    } else if (beforeBlock) {
      txt = raw.trim();
    } else {
      txt = raw.trim();
    }
    if (txt.trim()) blocks.push({ type: "paragraph", text: txt });
    inlineBuf = [];
  };

  for (const child of children) {
    if (typeof child === "string") {
      inlineBuf.push(child);
    } else if (normalizeTag(child.tag) === "let") {
      flush(true);
      await processLet(child, state);
    } else if (isBlockNode(child)) {
      flush(true);
      blocks.push(...(await processElement(child, state)));
    } else {
      inlineBuf.push(child);
    }
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// For-loop expansion
// ---------------------------------------------------------------------------

async function expandFor(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const m = node.attrs.for!.match(/^(\w+)\s+in\s+(.+)$/);
  if (!m) return [];
  const [, varName, arrExpr] = m;
  const arr = evalExpr(arrExpr.trim(), state.ctx);
  if (!Array.isArray(arr)) return [];

  const { for: _, ...rest } = node.attrs;
  const out: Block[] = [];

  for (let i = 0; i < arr.length; i++) {
    const loopCtx = { ...state.ctx, [varName]: arr[i], loop: { index: i, length: arr.length, first: i === 0, last: i === arr.length - 1 } };
    out.push(
      ...(await processElement(
        { ...node, attrs: { ...rest } },
        { ...state, ctx: loopCtx },
      )),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// List items
// ---------------------------------------------------------------------------

async function processListItems(
  children: XmlNode[],
  state: State,
): Promise<ListItem[]> {
  const items: ListItem[] = [];

  for (const child of children) {
    if (typeof child === "string") continue;
    if (normalizeTag(child.tag) !== "item") continue;

    if (child.attrs.for !== undefined) {
      const m = child.attrs.for.match(/^(\w+)\s+in\s+(.+)$/);
      if (!m) continue;
      const [, varName, arrExpr] = m;
      const arr = evalExpr(arrExpr.trim(), state.ctx);
      if (!Array.isArray(arr)) continue;

      const { for: _, if: ifExpr, ...rest } = child.attrs;
      for (let i = 0; i < arr.length; i++) {
        const loopCtx = {
          ...state.ctx,
          [varName]: arr[i],
          loop: { index: i, length: arr.length, first: i === 0, last: i === arr.length - 1 },
        };
        if (ifExpr !== undefined && !evalCondition(ifExpr, loopCtx)) continue;
        items.push(
          await buildItem({ ...child, attrs: rest }, {
            ...state,
            ctx: loopCtx,
          }),
        );
      }
      continue;
    }

    if (child.attrs.if !== undefined) {
      if (!evalCondition(child.attrs.if, state.ctx)) continue;
    }

    items.push(await buildItem(child, state));
  }
  return items;
}

async function buildItem(
  node: XmlElement,
  state: State,
): Promise<ListItem> {
  const inlineNodes: XmlNode[] = [];
  const blockNodes: XmlElement[] = [];
  let seenBlock = false;

  for (const c of node.children) {
    if (typeof c === "string") {
      if (!seenBlock) inlineNodes.push(c);
    } else if (normalizeTag(c.tag) === "list") {
      seenBlock = true;
      blockNodes.push(c);
    } else {
      if (!seenBlock) inlineNodes.push(c);
    }
  }

  let text = renderInline(inlineNodes, state);
  if (blockNodes.length === 0) {
    text = text.trimEnd();
  }
  const subBlocks: Block[] = [];
  for (const b of blockNodes) {
    subBlocks.push(...(await processElement(b, state)));
  }
  return { text, children: subBlocks };
}
