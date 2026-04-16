import { build, emptyDir } from "jsr:@deno/dnt";

const denoJson = JSON.parse(Deno.readTextFileSync("../deno/deno.json"));

await emptyDir("./npm");

await build({
  entryPoints: ["../deno/src/mod.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  package: {
    name: "@pomlight/pomlight",
    version: denoJson.version,
    description: denoJson.description ?? "Lightweight library for parsing and rendering POML prompts",
    license: denoJson.license ?? "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/gfauchart/pomlight.git",
    },
    publishConfig: {
      access: "public",
    },
    keywords: ["poml", "prompt", "llm", "openai"],
  },
  postBuild() {
    Deno.copyFileSync("README.md", "npm/README.md");
    Deno.copyFileSync("../../LICENSE", "npm/LICENSE");
  },
});
