import { assertEquals, assertExists } from "@std/assert";
import { poml } from "../src/mod.ts";

const apiKey = Deno.env.get("OPENAI_API_KEY");

Deno.test({
  name: "e2e: poml renders prompt and calls OpenAI chat completions",
  ignore: !apiKey,
  async fn() {
    const params = await poml(`<poml>
  <runtime model="gpt-4o-mini" temperature="0" max-tokens="64" />
  <system>You are a helpful assistant. Reply in one short sentence.</system>
  <user>What is 2+2?</user>
</poml>`, { format: "openai_chat" }) as Record<string, unknown>;

    console.log("params:", JSON.stringify(params, null, 2));
    assertEquals(params.model, "gpt-4o-mini");
    assertEquals(params.temperature, 0);
    assertEquals(params.max_tokens, 64);
    assertExists(params.messages);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
    });

    const json = await response.json();
    assertEquals(response.ok, true, `OpenAI returned ${response.status}: ${JSON.stringify(json)}`);
    const answer: string = json.choices[0].message.content;
    console.log("OpenAI answer:", answer);
    assertEquals(answer.toLowerCase().includes("4"), true, `Expected "4" in answer: ${answer}`);
  },
});

Deno.test({
  name: "e2e: poml with tool definitions calls OpenAI",
  ignore: !apiKey,
  async fn() {
    const params = await poml(`<poml>
  <runtime model="gpt-4o-mini" temperature="0" max-tokens="128" />
  <tool name="get_weather" description="Get the current weather for a city">
    {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
  </tool>
  <system>You are a helpful assistant. Use tools when appropriate.</system>
  <user>What's the weather in Paris?</user>
</poml>`, { format: "openai_chat" }) as Record<string, unknown>;

    console.log("params:", JSON.stringify(params, null, 2));
    assertExists(params.tools);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
    });

    const json = await response.json();
    assertEquals(response.ok, true, `OpenAI returned ${response.status}: ${JSON.stringify(json)}`);
    const choice = json.choices[0];
    console.log("OpenAI finish_reason:", choice.finish_reason);
    console.log("OpenAI tool_calls:", JSON.stringify(choice.message.tool_calls));
    assertEquals(choice.finish_reason, "tool_calls");
    assertEquals(choice.message.tool_calls[0].function.name, "get_weather");
  },
});

Deno.test({
  name: "e2e: poml with output-schema calls OpenAI structured output",
  ignore: !apiKey,
  async fn() {
    const params = await poml(`<poml>
  <runtime model="gpt-4o-mini" temperature="0" max-tokens="128" />
  <output-schema>
    {"type": "object", "properties": {"answer": {"type": "number"}, "explanation": {"type": "string"}}, "required": ["answer", "explanation"], "additionalProperties": false}
  </output-schema>
  <system>You are a math tutor. Always respond using the provided JSON schema.</system>
  <user>What is 7 * 8?</user>
</poml>`, { format: "openai_chat" }) as Record<string, unknown>;

    console.log("params:", JSON.stringify(params, null, 2));
    assertExists(params.response_format);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
    });

    const json = await response.json();
    assertEquals(response.ok, true, `OpenAI returned ${response.status}: ${JSON.stringify(json)}`);
    const parsed = JSON.parse(json.choices[0].message.content);
    console.log("OpenAI structured output:", parsed);
    assertEquals(parsed.answer, 56);
    assertEquals(typeof parsed.explanation, "string");
  },
});
