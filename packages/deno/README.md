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

const messages = await poml(`
  <poml>
    <system>You are a helpful assistant.</system>
    <user>What is 2 + 2?</user>
  </poml>
`);

console.log(messages[0].content); // "You are a helpful assistant."
console.log(messages[1].content); // "What is 2 + 2?"
```

### Use with OpenAI SDK

```ts
import OpenAI from "@openai/openai";
import { poml } from "@pomlight/pomlight";

const client = new OpenAI();

const params = await poml<OpenAI.ChatCompletionCreateParamsNonStreaming>(`
  <poml>
    <runtime model="gpt-4o-mini" />
    <system>You are a helpful assistant. Reply in one short sentence.</system>
    <user>What is the capital of France?</user>
  </poml>
`, { format: "openai_chat" });

const response = await client.chat.completions.create(params);
console.log(response.choices[0].message.content);
```


## Feature Coverage

See [FeatureCoverage.md](./FeatureCoverage.md) for supported components, template features, and what is not implemented.

## Development

```sh
deno task test             # run all tests
deno task test:unit        # unit tests (no network)
deno task test:integration # fixture-based tests
deno task test:e2e         # OpenAI e2e (requires OPENAI_API_KEY)
```
