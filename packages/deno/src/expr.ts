// ---------------------------------------------------------------------------
// Expression evaluator — supports dot access, bracket access, function calls,
// ternary, string concatenation, comparisons, and unary !.
// ---------------------------------------------------------------------------

type Tok =
  | { t: "n"; v: number }
  | { t: "s"; v: string }
  | { t: "i"; v: string }
  | { t: "o"; v: string }
  | { t: "r"; v: RegExp };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    // numbers
    if (/\d/.test(src[i])) {
      let n = "";
      while (i < src.length && /[\d.]/.test(src[i])) n += src[i++];
      out.push({ t: "n", v: Number(n) });
      continue;
    }
    // strings
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      let s = "";
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { i++; s += src[i++]; continue; }
        s += src[i++];
      }
      i++; // closing quote
      out.push({ t: "s", v: s });
      continue;
    }
    // regex literals: /pattern/flags — only after operator or at start
    if (src[i] === '/' && (out.length === 0 || out[out.length - 1].t === "o" || (out[out.length - 1].t === "o" && out[out.length - 1].v === ","))) {
      const start = i;
      i++; // skip opening /
      let pattern = "";
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\') { pattern += src[i++]; if (i < src.length) pattern += src[i++]; continue; }
        pattern += src[i++];
      }
      i++; // skip closing /
      let flags = "";
      while (i < src.length && /[gimsuvy]/.test(src[i])) flags += src[i++];
      try {
        out.push({ t: "r", v: new RegExp(pattern, flags) });
      } catch {
        // Fall back to treating / as operator
        i = start;
        out.push({ t: "o", v: src[i++] });
      }
      continue;
    }
    // identifiers
    if (/[a-zA-Z_$]/.test(src[i])) {
      let id = "";
      while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) id += src[i++];
      out.push({ t: "i", v: id });
      continue;
    }
    // multi-char ops
    const tri = src.substring(i, i + 3);
    if (tri === "===" || tri === "!==") { out.push({ t: "o", v: tri }); i += 3; continue; }
    const bi = src.substring(i, i + 2);
    if (bi === "==" || bi === "!=" || bi === ">=" || bi === "<=") {
      out.push({ t: "o", v: bi }); i += 2; continue;
    }
    // single-char op
    out.push({ t: "o", v: src[i++] });
  }
  return out;
}

export function evalExpr(src: string, ctx: Record<string, unknown>): unknown {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const adv = (): Tok => toks[pos++];
  const matchOp = (v: string): boolean => {
    if (peek()?.t === "o" && peek()?.v === v) { pos++; return true; }
    return false;
  };

  function ternary(): unknown {
    const lhs = addition();
    if (matchOp("?")) { const a = addition(); matchOp(":"); const b = addition(); return lhs ? a : b; }
    return lhs;
  }

  function addition(): unknown {
    let left = comparison();
    while (peek()?.t === "o" && peek()?.v === "+") {
      adv();
      const right = comparison();
      if (typeof left === "number" && typeof right === "number") left = left + right;
      else left = String(left ?? "") + String(right ?? "");
    }
    return left;
  }

  function comparison(): unknown {
    const left = unary();
    const t = peek();
    if (t?.t === "o" && ["===", "!==", "==", "!=", ">", "<", ">=", "<="].includes(t.v)) {
      adv();
      const right = unary();
      switch (t.v) {
        case "===": return left === right;
        case "!==": return left !== right;
        case "==":  return left == right;
        case "!=":  return left != right;
        case ">":   return (left as number) > (right as number);
        case "<":   return (left as number) < (right as number);
        case ">=":  return (left as number) >= (right as number);
        case "<=":  return (left as number) <= (right as number);
      }
    }
    return left;
  }

  function unary(): unknown {
    if (matchOp("!")) return !unary();
    return postfix();
  }

  function postfix(): unknown {
    let val = primary();
    while (true) {
      if (matchOp(".")) {
        const id = adv();
        if (val != null) {
          const prop = (val as Record<string, unknown>)[id.v as string];
          // Bind methods to their owner so that e.g. "str".endsWith('.pdf') works
          val = typeof prop === "function" ? (prop as CallableFunction).bind(val) : prop;
        } else {
          val = undefined;
        }
      } else if (matchOp("[")) {
        const idx = ternary();
        matchOp("]");
        val = val != null ? (val as Record<string, unknown>)[String(idx)] : undefined;
      } else if (matchOp("(")) {
        const args: unknown[] = [];
        if (!matchOp(")")) {
          args.push(ternary());
          while (matchOp(",")) args.push(ternary());
          matchOp(")");
        }
        val = typeof val === "function" ? val(...args) : undefined;
      } else break;
    }
    return val;
  }

  function primary(): unknown {
    const t = peek();
    if (!t) return undefined;
    if (t.t === "n") { adv(); return t.v; }
    if (t.t === "s") { adv(); return t.v; }
    if (t.t === "r") { adv(); return t.v; }
    if (t.t === "i") {
      adv();
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "null") return null;
      if (t.v === "undefined") return undefined;
      return ctx[t.v];
    }
    if (t.t === "o" && t.v === "(") { adv(); const v = ternary(); matchOp(")"); return v; }
    // Array literal: [expr, expr, ...]
    if (t.t === "o" && t.v === "[") {
      adv();
      const arr: unknown[] = [];
      if (!matchOp("]")) {
        arr.push(ternary());
        while (matchOp(",")) arr.push(ternary());
        matchOp("]");
      }
      return arr;
    }
    // Object literal: {key: value, ...}
    if (t.t === "o" && t.v === "{") {
      adv();
      const obj: Record<string, unknown> = {};
      if (!matchOp("}")) {
        const k = adv();
        matchOp(":");
        obj[String(k.v)] = ternary();
        while (matchOp(",")) {
          const k2 = adv();
          matchOp(":");
          obj[String(k2.v)] = ternary();
        }
        matchOp("}");
      }
      return obj;
    }
    return undefined;
  }

  return ternary();
}

export function interpolate(text: string, ctx: Record<string, unknown>): string {
  if (!text.includes("{{")) return text;

  // Detect if trailing content after last {{ }} is whitespace-only
  const lastClose = text.lastIndexOf("}}");
  const trimTail =
    lastClose !== -1 && /^\s*$/.test(text.substring(lastClose + 2));

  let out = text.replace(/\{\{(.+?)\}\}/g, (_, e: string) => {
    const v = evalExpr(e.trim(), ctx);
    if (v == null) return "";
    // Booleans render as empty (matching React behavior)
    if (typeof v === "boolean") return "";
    return String(v);
  });

  if (trimTail) out = out.replace(/\s+$/, "");
  return out;
}

/** Interpolation without trailing whitespace trimming — for pre mode. */
export function interpolatePre(text: string, ctx: Record<string, unknown>): string {
  if (!text.includes("{{")) return text;
  return text.replace(/\{\{(.+?)\}\}/g, (_, e: string) => {
    const v = evalExpr(e.trim(), ctx);
    if (v == null) return "";
    if (typeof v === "boolean") return "";
    return String(v);
  });
}

export function evalCondition(expr: string, ctx: Record<string, unknown>): boolean {
  const m = expr.match(/^\{\{(.+?)\}\}$/);
  if (m) return !!evalExpr(m[1].trim(), ctx);
  return !!evalExpr(expr, ctx);
}

export function escapes(text: string): string {
  return text
    // POML escape sequences
    .replace(/#quot;/g, '"')
    .replace(/#apos;/g, "'")
    .replace(/#lt;/g, "<")
    .replace(/#gt;/g, ">")
    .replace(/#lbrace;/g, "{")
    .replace(/#rbrace;/g, "}")
    .replace(/#amp;/g, "\x00")
    .replace(/#hash;/g, "#")
    // XML entities
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "")
    // deno-lint-ignore no-control-regex
    .replace(/\x00/g, "&");
}
