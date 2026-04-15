import { parseXml, type XmlElement } from "./xml.ts";
import type { Block, State } from "./types.ts";
import { evalExpr, interpolate } from "./expr.ts";

// ---------------------------------------------------------------------------
// <let> variable definitions
// ---------------------------------------------------------------------------

export async function processLet(node: XmlElement, state: State): Promise<void> {
  const name = node.attrs.name;
  const valueAttr = node.attrs.value;
  const srcAttr = node.attrs.src;
  const type = node.attrs.type;

  // Syntax 2 & 3: src attribute (file import)
  if (srcAttr !== undefined) {
    if (!state.filePath) return;
    const dir = state.filePath.substring(0, state.filePath.lastIndexOf("/") + 1);
    const filePath = dir + srcAttr;
    let raw: string;
    try {
      raw = await Deno.readTextFile(filePath);
    } catch {
      return;
    }
    const inferredType = type ?? inferFileType(srcAttr);
    const val = parseFileContent(raw, inferredType);
    if (name) {
      state.ctx[name] = val;
    } else if (val != null && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(state.ctx, val as Record<string, unknown>);
    }
    return;
  }

  // Syntax 5: value attribute (expression)
  if (valueAttr !== undefined) {
    let val = evalExpr(
      valueAttr.replace(/^\{\{(.+)\}\}$/, "$1").trim(),
      state.ctx,
    );
    if (type) val = castType(val, type);
    if (name) {
      state.ctx[name] = val;
    } else if (val != null && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(state.ctx, val);
    }
    return;
  }

  // Get body text
  const body = node.children
    .filter((c): c is string => typeof c === "string")
    .join("")
    .trim();

  if (!name) return;

  // Syntax 4: inline JSON (try to parse)
  if (type === "json" || type === "object" || (body.startsWith("{") || body.startsWith("["))) {
    try {
      state.ctx[name] = castType(JSON.parse(body), type);
      return;
    } catch {
      // not valid JSON, fall through to literal string
    }
  }

  // Syntax 1 & 4 with type: literal string (with optional type cast)
  state.ctx[name] = type ? castType(body, type) : body;
}

// ---------------------------------------------------------------------------
// <include> file inclusion
// ---------------------------------------------------------------------------

/**
 * Process an <include> element. Requires a `processElementFn` callback to avoid
 * circular dependency with read.ts.
 */
export async function processInclude(
  node: XmlElement,
  state: State,
  processElementFn: (node: XmlElement, state: State) => Promise<Block[]>,
): Promise<Block[]> {
  const rawSrc = node.attrs.src;
  if (!rawSrc || !state.filePath) return [];
  const src = interpolate(rawSrc, state.ctx);

  const dir = state.filePath.substring(
    0,
    state.filePath.lastIndexOf("/") + 1,
  );
  const includePath = dir + src;

  let content: string;
  try {
    content = await Deno.readTextFile(includePath);
  } catch {
    return [];
  }

  const parsed = content.trimStart().startsWith("<poml")
    ? parseXml(content)
    : parseXml(`<_root>${content}</_root>`);

  return processElementFn(parsed, { ...state, filePath: includePath });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function castType(val: unknown, type: string | undefined): unknown {
  if (!type) return val;
  switch (type) {
    case "integer":
    case "number":
      return Number(val);
    case "boolean":
      return val === "true" || val === true || val === 1;
    case "json":
    case "object":
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    default:
      return val;
  }
}

/** Convert a runtime attribute value string to its appropriate JS type. */
export function convertRuntimeValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d*\.?\d+$/.test(value)) {
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
  }
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function inferFileType(src: string): string {
  const ext = src.substring(src.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "json": return "json";
    case "csv": return "csv";
    case "txt": return "text";
    default: return "text";
  }
}

function parseFileContent(raw: string, type: string): unknown {
  switch (type) {
    case "json":
      try { return JSON.parse(raw); } catch { return raw; }
    case "csv": {
      const lines = raw.trim().split("\n");
      if (lines.length === 0) return [];
      const headers = lines[0].split(",").map((h) => h.trim());
      return lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim());
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return obj;
      });
    }
    default:
      return raw;
  }
}
