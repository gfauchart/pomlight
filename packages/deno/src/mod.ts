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

import { readFull } from "./read.ts";
import { write, formatMessages } from "./write.ts";
import type { Message, OutputFormat, ReadOptions, StyleSheet } from "./types.ts";

export interface PomlOptions {
  context?: Record<string, unknown>;
  readOptions?: ReadOptions;
  stylesheet?: StyleSheet;
  sourcePath?: string;
  format?: OutputFormat;
}

/** Convenience: read + write in one call, matching the official SDK's poml() API. */
export async function poml(
  element: string,
  options?: PomlOptions,
): Promise<unknown> {
  const result = await readFull(
    element,
    options?.readOptions,
    options?.context,
    options?.stylesheet,
    options?.sourcePath,
  );
  const format = options?.format ?? "message_dict";
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
