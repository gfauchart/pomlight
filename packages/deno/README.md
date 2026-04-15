# pomlight — Deno

Lightweight Deno/JSR library for parsing and rendering [POML](https://microsoft.github.io/poml/latest/) prompts.

## Install

```sh
deno add jsr:@pomlight/pomlight
```

```ts
import { poml } from "@pomlight/pomlight";
```

## Usage

```ts
import { poml } from "@pomlight/pomlight";

// Render to message array (default)
const messages = await poml(`
  <poml>
    <system-msg>You are a helpful assistant.</system-msg>
    <human-msg>What is 2 + 2?</human-msg>
  </poml>
`);

// Render directly to OpenAI chat format
const params = await poml(`
  <poml>
    <system-msg>You are a helpful assistant.</system-msg>
    <human-msg>What is 2 + 2?</human-msg>
  </poml>
`, { format: "openai_chat" });
```

### Use with OpenAI SDK

```ts
import OpenAI from "@openai/openai";
import { poml } from "@pomlight/pomlight";

const client = new OpenAI();

const params = await poml(`
  <poml>
    <system-msg>You are a helpful assistant. Reply in one short sentence.</system-msg>
    <human-msg>What is the capital of France?</human-msg>
  </poml>
`, { format: "openai_chat" }) as { messages: OpenAI.ChatCompletionMessageParam[] };

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  ...params,
});

console.log(response.choices[0].message.content);
```

## Output Formats

| `format` | Returns |
|---|---|
| `"message_dict"` (default) | `{ role, content }[]` |
| `"dict"` | `{ messages, schema?, tools?, runtime? }` |
| `"openai_chat"` | OpenAI-ready request body |

## Feature Coverage

See [FeatureCoverage.md](./FeatureCoverage.md) for supported components, template features, and what is not implemented.

## Development

```sh
deno task test             # run all tests
deno task test:unit        # unit tests (no network)
deno task test:integration # fixture-based tests
deno task test:e2e         # OpenAI e2e (requires OPENAI_API_KEY)
```
