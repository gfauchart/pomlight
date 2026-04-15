import { assertEquals, assertExists } from "@std/assert";
import { poml } from "../src/mod.ts";
import { readFull } from "../src/read.ts";
import { Schema, ToolsSchema } from "../src/types.ts";

// ---------------------------------------------------------------------------
// readFull tests (raw sideband — internal API)
// ---------------------------------------------------------------------------

Deno.test("readFull: output-schema returns schema object", async () => {
  const poml = `<poml>
  <output-schema>{"type":"object","properties":{"name":{"type":"string"}}}</output-schema>
  <p>Hello</p>
</poml>`;
  const result = await readFull(poml);
  assertExists(result.schema);
  assertEquals(result.schema!.type, "object");
});

Deno.test("readFull: tool-definition returns tool list", async () => {
  const poml = `<poml>
  <tool-definition name="search" description="Search the web">{"type":"object","properties":{"query":{"type":"string"}}}</tool-definition>
  <p>Use search</p>
</poml>`;
  const result = await readFull(poml);
  assertExists(result.tools);
  assertEquals(result.tools!.length, 1);
  assertEquals(result.tools![0].name, "search");
});

Deno.test("readFull: runtime returns parameters", async () => {
  const poml = `<poml>
  <runtime temperature="0.7" max-tokens="100" />
  <p>Hello</p>
</poml>`;
  const result = await readFull(poml);
  assertExists(result.runtime);
  assertEquals(result.runtime!.temperature, 0.7);
  assertEquals(result.runtime!.maxTokens, 100);
});

Deno.test("readFull: tool alias <tool> works", async () => {
  const poml = `<poml>
  <tool name="calc" description="Calculate">{"type":"object","properties":{"expr":{"type":"string"}}}</tool>
  <p>Calc</p>
</poml>`;
  const result = await readFull(poml);
  assertExists(result.tools);
  assertEquals(result.tools![0].name, "calc");
});

// ---------------------------------------------------------------------------
// poml() with format "dict" tests (replaces _readWithFile / pomlFull)
// ---------------------------------------------------------------------------

Deno.test("poml dict: no sideband returns messages only", async () => {
  const result = await poml(`<poml><p>Hello</p></poml>`, { format: "dict" });
  assertExists(result.messages);
  assertEquals(result.schema, undefined);
  assertEquals(result.tools, undefined);
  assertEquals(result.runtime, undefined);
});

Deno.test("poml dict: with schema returns schema", async () => {
  const result = await poml(`<poml>
  <output-schema>{"type":"object","properties":{"result":{"type":"number"}}}</output-schema>
  <p>Compute</p>
</poml>`, { format: "dict" });
  assertExists(result.schema);
  assertEquals(result.schema!.type, "object");
});

Deno.test("poml dict: with tools returns tools", async () => {
  const result = await poml(`<poml>
  <tool name="get_weather" description="Get weather for a city">{"type":"object","properties":{"city":{"type":"string"}}}</tool>
  <tool name="get_time" description="Get current time">{"type":"object","properties":{"timezone":{"type":"string"}}}</tool>
  <p>Use tools</p>
</poml>`, { format: "dict" });
  assertExists(result.tools);
  assertEquals(result.tools!.length, 2);
  assertEquals(result.tools![0].name, "get_weather");
  assertEquals(result.tools![1].name, "get_time");
  assertEquals(result.tools![0].description, "Get weather for a city");
});

Deno.test("poml dict: with runtime returns runtime", async () => {
  const result = await poml(`<poml>
  <runtime temperature="0.5" top-p="0.9" stop="END" />
  <p>Hello</p>
</poml>`, { format: "dict" });
  assertExists(result.runtime);
  assertEquals(result.runtime!.temperature, 0.5);
  assertEquals(result.runtime!.topP, 0.9);
  assertEquals(result.runtime!.stop, "END");
});

Deno.test("poml dict: combined sideband data", async () => {
  const result = await poml(`<poml>
  <output-schema>{"type":"string"}</output-schema>
  <tool name="lookup">{"type":"object","properties":{"id":{"type":"integer"}}}</tool>
  <runtime temperature="1" max-tokens="500" />
  <p>All together</p>
</poml>`, { format: "dict" });
  assertExists(result.schema);
  assertEquals(result.schema!.type, "string");
  assertEquals(result.tools!.length, 1);
  assertEquals(result.runtime!.temperature, 1);
  assertEquals(result.runtime!.maxTokens, 500);
});

// ---------------------------------------------------------------------------
// poml() with format "openai_chat" tests (sideband merging)
// ---------------------------------------------------------------------------

Deno.test("poml openai_chat: returns schema as response_format", async () => {
  const result = await poml(`<poml>
  <output-schema>{"type":"array","items":{"type":"string"}}</output-schema>
  <p>List items</p>
</poml>`, { format: "openai_chat" });
  assertExists(result.response_format);
  const rf = result.response_format as { type: string; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } };
  assertEquals(rf.type, "json_schema");
  assertEquals(rf.json_schema.name, "schema");
  assertEquals(rf.json_schema.schema.type, "array");
  assertEquals(rf.json_schema.strict, true);
});

Deno.test("poml openai_chat: returns tools in OpenAI format", async () => {
  const result = await poml(`<poml>
  <tool name="greet" description="Say hello">{"type":"object","properties":{"name":{"type":"string"}}}</tool>
  <p>Greet</p>
</poml>`, { format: "openai_chat" });
  assertExists(result.tools);
  const tools = result.tools as { type: string; function: { name: string; description: string } }[];
  assertEquals(tools.length, 1);
  assertEquals(tools[0].type, "function");
  assertEquals(tools[0].function.name, "greet");
  assertEquals(tools[0].function.description, "Say hello");
});

Deno.test("poml openai_chat: runtime merged as snake_case keys", async () => {
  const result = await poml(`<poml>
  <runtime model="gpt-4o" temperature="0.3" max-tokens="100" top-p="0.9" />
  <p>Hello</p>
</poml>`, { format: "openai_chat" });
  assertEquals(result.model, "gpt-4o");
  assertEquals(result.temperature, 0.3);
  assertEquals(result.max_tokens, 100);
  assertEquals(result.top_p, 0.9);
});

// ---------------------------------------------------------------------------
// Schema / ToolsSchema class unit tests
// ---------------------------------------------------------------------------

Deno.test("Schema.fromOpenAPI + toOpenAPI roundtrip", () => {
  const raw = { type: "object", properties: { x: { type: "number" } } };
  const schema = Schema.fromOpenAPI(raw);
  assertEquals(schema.toOpenAPI(), raw);
});

Deno.test("ToolsSchema: addTool, getTool, getTools, size", () => {
  const ts = new ToolsSchema();
  assertEquals(ts.size(), 0);
  ts.addTool("a", "desc A", Schema.fromOpenAPI({ type: "object" }));
  ts.addTool("b", undefined, Schema.fromOpenAPI({ type: "string" }));
  assertEquals(ts.size(), 2);
  assertEquals(ts.getTool("a")!.name, "a");
  assertEquals(ts.getTool("a")!.description, "desc A");
  assertEquals(ts.getTool("b")!.description, undefined);
  assertEquals(ts.getTools().length, 2);
});

Deno.test("ToolsSchema: duplicate tool name throws", () => {
  const ts = new ToolsSchema();
  ts.addTool("x", "x", Schema.fromOpenAPI({ type: "object" }));
  let threw = false;
  try {
    ts.addTool("x", "x2", Schema.fromOpenAPI({ type: "object" }));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("ToolsSchema.toOpenAI format", () => {
  const ts = new ToolsSchema();
  ts.addTool("fn1", "Desc", Schema.fromOpenAPI({ type: "object", properties: {} }));
  const result = ts.toOpenAI();
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "function");
  assertEquals(result[0].name, "fn1");
  assertEquals(result[0].description, "Desc");
  assertEquals(result[0].parameters.type, "object");
});
