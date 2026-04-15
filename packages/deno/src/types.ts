export type Speaker = "system" | "human" | "ai" | "tool";

// ---------------------------------------------------------------------------
// Options types
// ---------------------------------------------------------------------------

export interface ReadOptions {
  trim?: boolean;
}

export interface WriteOptions {
  speaker?: boolean;
}

export type OutputFormat = "message_dict" | "openai_chat" | "dict" | "raw" | "langchain" | "pydantic";

export type StyleSheet = Record<string, Record<string, string>>;

// ---------------------------------------------------------------------------
// Multimodal content types
// ---------------------------------------------------------------------------

export interface ContentMultiMediaBinary {
  type: string;       // e.g. "image/png", "image/jpeg"
  base64: string;
  alt?: string;
}

export interface ContentMultiMediaJson {
  type: "application/json";
  content: unknown;
}

export type ContentMultiMedia = ContentMultiMediaBinary | ContentMultiMediaJson;

/** Rich content: plain string or mixed array of text and multimedia. */
export type RichContent = string | (string | ContentMultiMedia)[];

// ---------------------------------------------------------------------------
// Block types (IR)
// ---------------------------------------------------------------------------

export interface Heading {
  type: "heading";
  depth: number;
  text: string;
  speaker?: Speaker;
}

export interface Paragraph {
  type: "paragraph";
  text: string;
  blankLine?: boolean;
  speaker?: Speaker;
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  listStyle?: string;
  items: ListItem[];
  speaker?: Speaker;
}

export interface ListItem {
  text: string;
  children: Block[];
}

/** Node for XML/JSON/YAML serialization modes. */
export interface SerializedNode {
  type: "serialized";
  name: string;
  value?: string;           // leaf text
  children?: SerializedNode[];     // child elements
  speaker?: Speaker;
}

/** Block carrying structured multimodal content (tool requests/responses, msg-content). */
export interface MultiMediaBlock {
  type: "multimedia";
  content: ContentMultiMedia[];
  speaker?: Speaker;
}

export type Block = Heading | Paragraph | ListBlock | SerializedNode | MultiMediaBlock;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface Message {
  speaker: Speaker;
  content: RichContent;
}

// ---------------------------------------------------------------------------
// Sideband types (meta-like components)
// ---------------------------------------------------------------------------

/** A tool definition extracted from <tool-definition> or <tool> elements. */
export interface ToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;  // OpenAPI JSON Schema
}

/** Runtime parameters extracted from <runtime> element. */
export type RuntimeParameters = Record<string, unknown>;

/** Extended result from readFull() including sideband data. */
export interface ReadResult {
  blocks: Block[];
  schema?: Record<string, unknown>;       // OpenAPI JSON Schema from <output-schema>
  tools?: ToolDefinition[];                // Tool definitions from <tool-definition>
  runtime?: RuntimeParameters;             // Runtime parameters from <runtime>
}

// ---------------------------------------------------------------------------
// Internal reader state (shared across modules)
// ---------------------------------------------------------------------------

export interface State {
  ctx: Record<string, unknown>;
  depth: number;
  filePath?: string;
  chat?: boolean;  // inside <example> with chat mode
  presentation?: "markup" | "serialize";
  serializer?: "xml" | "json" | "yaml";
  styles?: StyleSheet;
  // Sideband data collectors (shared across the parse tree)
  sideband?: Sideband;
}

export interface Sideband {
  schema?: Record<string, unknown>;
  tools: ToolDefinition[];
  runtime?: RuntimeParameters;
}

// ---------------------------------------------------------------------------
// Sideband classes (matching official PomlFile API)
// ---------------------------------------------------------------------------

/** Wraps a JSON Schema object. Matches the official Schema class API. */
export class Schema {
  private constructor(private openApiSchema: Record<string, unknown>) {}

  public static fromOpenAPI(schema: Record<string, unknown>): Schema {
    if (typeof schema !== "object" || schema === null) {
      throw new Error("Invalid OpenAPI schema provided");
    }
    return new Schema(schema);
  }

  /** Return the schema as an OpenAPI JSON Schema object. */
  public toOpenAPI(): Record<string, unknown> {
    return this.openApiSchema;
  }
}

/** Collection of tool definitions. Matches the official ToolsSchema class API. */
export class ToolsSchema {
  private tools: Map<string, ToolDefinition> = new Map();

  public addTool(name: string, description: string | undefined, inputSchema: Schema): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool with name "${name}" already exists`);
    }
    this.tools.set(name, { name, description, parameters: inputSchema.toOpenAPI() });
  }

  /** Return tools in OpenAI function-calling format. */
  public toOpenAI(): { type: "function"; name: string; description?: string; parameters: Record<string, unknown> }[] {
    return Array.from(this.tools.values()).map(t => ({
      type: "function" as const,
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.parameters,
    }));
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public size(): number {
    return this.tools.size;
  }
}

/** Holds sideband data collected during POML parsing. Matches the official PomlFile getter API. */
export class PomlFile {
  private responseSchema: Schema | undefined;
  private toolsSchema: ToolsSchema | undefined;
  private runtimeParameters: RuntimeParameters | undefined;

  /** @internal — called by readFull to populate sideband data. */
  _populate(result: ReadResult): void {
    if (result.schema) {
      this.responseSchema = Schema.fromOpenAPI(result.schema);
    }
    if (result.tools && result.tools.length > 0) {
      this.toolsSchema = new ToolsSchema();
      for (const t of result.tools) {
        this.toolsSchema.addTool(t.name, t.description, Schema.fromOpenAPI(t.parameters));
      }
    }
    if (result.runtime) {
      this.runtimeParameters = result.runtime;
    }
  }

  public getResponseSchema(): Schema | undefined {
    return this.responseSchema;
  }

  public getToolsSchema(): ToolsSchema | undefined {
    return this.toolsSchema;
  }

  public getRuntimeParameters(): RuntimeParameters | undefined {
    return this.runtimeParameters;
  }
}
