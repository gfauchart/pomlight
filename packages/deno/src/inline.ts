import type { XmlNode } from "./xml.ts";
import type { State } from "./types.ts";
import { normalizeTag } from "./tags.ts";
import { interpolate, interpolatePre, evalCondition, escapes } from "./expr.ts";

// ---------------------------------------------------------------------------
// Inline rendering  (text, <b>, <code>, <span>)
// ---------------------------------------------------------------------------

export function renderInline(children: XmlNode[], state: State): string {
  let out = "";
  for (const c of children) {
    if (typeof c === "string") {
      let t = interpolate(c, state.ctx);
      t = escapes(t);
      t = t.replace(/\s+/g, " "); // collapse whitespace
      out += t;
    } else {
      // if-directive on inline elements
      if (c.attrs.if !== undefined) {
        if (!evalCondition(c.attrs.if, state.ctx)) continue;
      }
      const inner = renderInline(c.children, state).trim();
      switch (normalizeTag(c.tag)) {
        case "b":
          out += `**${inner}**`;
          break;
        case "i":
          out += `*${inner}*`;
          break;
        case "u":
          out += `__${inner}__`;
          break;
        case "s":
        case "strike":
          out += `~~${inner}~~`;
          break;
        case "code":
          out += `\`${inner}\``;
          break;
        case "br": {
          const nlCount = parseInt(c.attrs.newLineCount ?? "1", 10);
          out += "\n".repeat(nlCount);
          break;
        }
        case "audio":
          break;
        case "img": {
          const imgSyn = c.attrs.syntax;
          const imgMm = imgSyn === "multimedia" || (!imgSyn && !c.attrs.alt);
          if (!imgMm && c.attrs.alt) out += interpolate(c.attrs.alt, state.ctx);
          break;
        }
        default: { // span or unknown → pass through
          const ws = c.attrs.whiteSpace ?? c.attrs["white-space"];
          if (ws === "trim") {
            const pre = renderInlinePre(c.children, state).trim();
            out += pre;
          } else if (ws === "pre") {
            out += renderInlinePre(c.children, state);
          } else {
            out += inner;
          }
          break;
        }
      }
    }
  }
  return out;
}

/** Render inline children preserving whitespace (pre mode) — no collapsing. */
export function renderInlinePre(children: XmlNode[], state: State): string {
  let out = "";
  for (const c of children) {
    if (typeof c === "string") {
      let t = interpolatePre(c, state.ctx);
      t = escapes(t);
      // No whitespace collapsing in pre mode
      out += t;
    } else {
      if (c.attrs.if !== undefined) {
        if (!evalCondition(c.attrs.if, state.ctx)) continue;
      }
      const inner = renderInlinePre(c.children, state);
      const ws = c.attrs.whiteSpace ?? c.attrs["white-space"];
      switch (normalizeTag(c.tag)) {
        case "b": out += `**${inner}**`; break;
        case "i": out += `*${inner}*`; break;
        case "code": out += `\`${inner}\``; break;
        case "br": out += "\n"; break;
        case "span":
          if (ws === "trim") out += inner.trim();
          else out += inner;
          break;
        default: out += inner; break;
      }
    }
  }
  return out;
}
