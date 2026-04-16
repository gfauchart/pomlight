# pomlight — Node.js

Lightweight Node.js library for parsing and rendering [POML](https://microsoft.github.io/poml/latest/) prompts.

Built from the Deno source using [dnt](https://github.com/denoland/dnt).

## Install

```sh
npm install @pomlight/pomlight
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
import OpenAI from "openai";
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

## Build

The Node.js package is generated from the Deno source:

```sh
cd packages/nodejs
deno run -A build.ts
```

This produces the npm package in the `npm/` directory, ready to publish.
