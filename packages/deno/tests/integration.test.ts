import { assertEquals } from "@std/assert";
import { poml } from "../src/mod.ts";
import type { OutputFormat } from "../src/mod.ts";

const TESTS_DIR = new URL("../../../integration-tests/tests/", import.meta.url).pathname;

const entries: string[] = [];
for await (const entry of Deno.readDir(TESTS_DIR)) {
  if (entry.isDirectory) entries.push(entry.name);
}
entries.sort();

for (const folder of entries) {
  const dir = `${TESTS_DIR}${folder}`;

  // Skip directories without a fixture file (e.g. shared assets/)
  try {
    await Deno.stat(`${dir}/fixture.poml`);
  } catch {
    continue;
  }

  Deno.test(folder, async () => {
    const xml = await Deno.readTextFile(`${dir}/fixture.poml`);

    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(await Deno.readTextFile(`${dir}/parameter.json`));
    } catch {
      // no parameter file
    }
    const context = (params.context ?? {}) as Record<string, unknown>;
    const format = (params.format ?? "message_dict") as OutputFormat;

    const expected = JSON.parse(await Deno.readTextFile(`${dir}/expected.json`));
    const result = await poml(xml, {
      context,
      format,
      sourcePath: `${dir}/fixture.poml`,
    });

    assertEquals(result, expected);
  });
}
