import type { XmlElement } from "./xml.ts";
import type { State, StyleSheet } from "./types.ts";
import { normalizeTag } from "./tags.ts";

// ---------------------------------------------------------------------------
// Stylesheet helpers
// ---------------------------------------------------------------------------

export function preParseStylesheet(node: XmlElement, state: State): State {
  for (const child of node.children) {
    if (typeof child !== "string" && normalizeTag(child.tag) === "stylesheet") {
      const text = child.children.filter((c): c is string => typeof c === "string").join("").trim();
      if (!text) continue;
      try {
        const parsed = JSON.parse(text) as StyleSheet;
        return { ...state, styles: { ...(state.styles ?? {}), ...parsed } };
      } catch { /* ignore parse errors */ }
    }
  }
  return state;
}

export function getStyleProp(selector: string, prop: string, state: State): string | undefined {
  if (!state.styles) return undefined;
  const entry = state.styles[selector];
  if (!entry) return undefined;
  return entry[prop];
}

/**
 * Merge stylesheet attributes into an element's attrs.
 * Stylesheet selectors match by tag name or by className (`.className`).
 * Explicit node attributes take precedence over stylesheet values.
 */
export function applyStylesheet(node: XmlElement, state: State): XmlElement {
  if (!state.styles) return node;
  const tag = normalizeTag(node.tag);
  const className = node.attrs.className ?? node.attrs["class-name"];

  // Collect matching stylesheet entries (tag-based, then className-based)
  const merged: Record<string, string> = {};
  const tagEntry = state.styles[tag];
  if (tagEntry) Object.assign(merged, tagEntry);
  if (className) {
    const classEntry = state.styles[`.${className}`];
    if (classEntry) Object.assign(merged, classEntry);
  }

  if (Object.keys(merged).length === 0) return node;

  // Explicit attrs take precedence
  const newAttrs = { ...merged, ...node.attrs };
  return { ...node, attrs: newAttrs };
}

export function applyTextTransform(text: string, transform?: string): string {
  switch (transform) {
    case "upper": return text.toUpperCase();
    case "lower": return text.toLowerCase();
    case "capitalize": return text.charAt(0).toUpperCase() + text.slice(1);
    default: return text;
  }
}
