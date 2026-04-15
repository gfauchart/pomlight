export { read } from "./read.ts";
export { write, formatMessages, renderContent, renderMessages } from "./write.ts";
export type {
  Block,
  ContentMultiMedia,
  ContentMultiMediaBinary,
  ContentMultiMediaJson,
  Heading,
  ListBlock,
  ListItem,
  Message,
  OutputFormat,
  Paragraph,
  ReadOptions,
  ReadResult,
  RichContent,
  RuntimeParameters,
  SerializedNode,
  Speaker,
  StyleSheet,
  ToolDefinition,
  WriteOptions,
} from "./types.ts";

/** Result shape for `format: "dict"`. */
export interface DictResult {
  messages: { speaker: string; content: RichContent }[];
  schema?: Record<string, unknown>;
  tools?: ToolDefinition[];
  runtime?: Record<string, unknown>;
}

/** Base options without `format` (used in overload signatures). */
interface PomlBaseOptions {
  context?: Record<string, unknown> | string;
  stylesheet?: StyleSheet | string;
  chat?: boolean;
}

import { readFull } from "./read.ts";
import { write, formatMessages } from "./write.ts";
import type { Message, OutputFormat, RichContent, StyleSheet, ToolDefinition } from "./types.ts";

export interface PomlOptions extends PomlBaseOptions {
  format?: OutputFormat;
}

// -- Overloads: SDK-targeted formats use generic T for zero-cast ergonomics --
export function poml<T = Record<string, unknown>>(markup: string, options: PomlBaseOptions & { format: "openai_chat" }): Promise<T>;
export function poml<T = Record<string, unknown>>(markup: string, options: PomlBaseOptions & { format: "langchain" }): Promise<T>;
export function poml<T = Record<string, unknown>>(markup: string, options: PomlBaseOptions & { format: "pydantic" }): Promise<T>;
// -- Overloads: pomlight-owned formats with concrete return types --
export function poml(markup: string, options: PomlBaseOptions & { format: "message_dict" }): Promise<Message[]>;
export function poml(markup: string, options: PomlBaseOptions & { format: "dict" }): Promise<DictResult>;
export function poml(markup: string, options: PomlBaseOptions & { format: "raw" }): Promise<string>;
// -- Default (no format / no options) → message_dict --
export function poml(markup: string, options?: PomlOptions): Promise<Message[]>;
/**
 * Process POML markup and return the result in the specified format.
 *
 * @param markup - POML markup string or file path. If a string ending in `.poml`
 *   that exists on disk, it is read and includes are resolved relative to it.
 * @param options - Optional configuration.
 */
export async function poml(
  markup: string,
  options?: PomlOptions,
): Promise<unknown> {
  const chat = options?.chat ?? true;
  const format = options?.format ?? "message_dict";

  // Check if we have file system read permission
  const hasReadPermission = (await Deno.permissions.query({ name: "read" })).state === "granted";

  // Resolve markup: file path or inline string
  let sourcePath: string | undefined;
  let resolvedMarkup = markup;

  if (hasReadPermission) {
    try {
      const stat = await Deno.stat(markup);
      if (stat.isFile) {
        sourcePath = markup.startsWith("/") ? markup : `${Deno.cwd()}/${markup}`;
        resolvedMarkup = await Deno.readTextFile(markup);
      }
    } catch {
      // Not a file path — treat as inline markup
    }
  }

  // Resolve context: object, JSON string, or file path
  let resolvedContext: Record<string, unknown> | undefined;
  if (options?.context != null) {
    if (typeof options.context === "object") {
      resolvedContext = options.context;
    } else if (hasReadPermission) {
      // string — try file first, then JSON parse
      try {
        const stat = await Deno.stat(options.context);
        if (stat.isFile) {
          resolvedContext = JSON.parse(await Deno.readTextFile(options.context));
        }
      } catch {
        resolvedContext = JSON.parse(options.context);
      }
    } else {
      resolvedContext = JSON.parse(options.context);
    }
  }

  // Resolve stylesheet: object, JSON string, or file path
  let resolvedStylesheet: StyleSheet | undefined;
  if (options?.stylesheet != null) {
    if (typeof options.stylesheet === "object") {
      resolvedStylesheet = options.stylesheet;
    } else if (hasReadPermission) {
      try {
        const stat = await Deno.stat(options.stylesheet);
        if (stat.isFile) {
          resolvedStylesheet = JSON.parse(await Deno.readTextFile(options.stylesheet));
        }
      } catch {
        resolvedStylesheet = JSON.parse(options.stylesheet);
      }
    } else {
      resolvedStylesheet = JSON.parse(options.stylesheet);
    }
  }

  const result = await readFull(
    resolvedMarkup,
    undefined,
    resolvedContext,
    resolvedStylesheet,
    sourcePath,
  );

  if (!chat) {
    return write(result.blocks) as RichContent;
  }

  const messages = write(result.blocks, { speaker: true }) as Message[];

  // Build sideband for format-aware outputs (openai_chat, dict)
  const hasSideband = result.schema || (result.tools && result.tools.length > 0) || result.runtime;
  if (!hasSideband) {
    return formatMessages(messages, format);
  }
  return formatMessages(messages, format, {
    tools: result.tools,
    schema: result.schema,
    runtime: result.runtime,
  });
}
