# pomlight — Deno

Lightweight Deno/JSR library for parsing and rendering [POML](https://microsoft.github.io/poml/latest/) prompts.

## Install

```ts
import { poml } from "jsr:@pomlight/pomlight";
```

## Usage

```ts
import { poml } from "jsr:@pomlight/pomlight";

// Render to message array (default)
const messages = await poml(`
  <poml>
    <system>You are a helpful assistant.</system>
    <user>What is 2 + 2?</user>
  </poml>
`);

// Render directly to OpenAI chat params
const params = await poml(`
  <poml>
    <runtime model="gpt-4o-mini" temperature="0" />
    <system>You are a helpful assistant.</system>
    <user>What is 2 + 2?</user>
  </poml>
`, { format: "openai_chat" });

await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(params),
});
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
