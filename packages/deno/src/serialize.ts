import type { XmlElement } from "./xml.ts";
import type { Block, SerializedNode, State } from "./types.ts";
import { evalCondition, evalExpr } from "./expr.ts";
import { renderInline } from "./inline.ts";
import { processLet } from "./directives.ts";

// ---------------------------------------------------------------------------
// Serialize mode — produces SerializedNode blocks for XML/JSON/YAML output
// ---------------------------------------------------------------------------

/** Default captionSerialized values for intention components. */
const SERIALIZED_NAMES: Record<string, string> = {
  "role": "role",
  "task": "task",
  "output-format": "outputFormat",
  "hint": "Hint",
  "introducer": "Introducer",
  "stepwise-instructions": "StepwiseInstructions",
  "qa": "Question",
  "examples": "Examples",
  "example": "Example",
};

/** Process children of <poml syntax="xml"> in serialize mode. */
export async function processSerialize(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const nodes: SerializedNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const result = await processSerializeElement(child, state);
    if (result) nodes.push(result);
  }
  if (nodes.length === 0) return [];
  return [{ type: "serialized", name: "_root", children: nodes }];
}

/** Process a single element in serialize mode → SerializedNode. */
async function processSerializeElement(
  node: XmlElement,
  state: State,
): Promise<SerializedNode | null> {
  // Handle conditionals
  if (node.attrs.if !== undefined) {
    if (!evalCondition(node.attrs.if, state.ctx)) return null;
  }

  // Handle loops
  if (node.attrs.for !== undefined) {
    const results = await expandForSerialize(node, state);
    if (results.length === 0) return null;
    if (results.length === 1) return results[0];
    return { type: "serialized", name: "_group", children: results };
  }

  switch (node.tag) {
    case "role":
    case "task":
    case "hint":
    case "introducer":
    case "stepwise-instructions": {
      const name = node.attrs.captionSerialized ?? SERIALIZED_NAMES[node.tag] ?? node.tag;
      const txt = renderInline(node.children, state).trim();
      if (!txt) return null;
      return { type: "serialized", name, value: txt };
    }

    case "output-format": {
      const name = node.attrs.captionSerialized ?? SERIALIZED_NAMES[node.tag] ?? "outputFormat";
      const listChildren = await collectSerializeChildren(node, state);
      if (listChildren.length > 0) {
        return { type: "serialized", name, children: listChildren };
      }
      const txt = renderInline(node.children, state).trim();
      if (!txt) return null;
      return { type: "serialized", name, value: txt };
    }

    case "cp": {
      const caption = node.attrs.caption ?? "";
      const name = node.attrs.captionSerialized ?? caption;
      const listChildren = await collectSerializeChildren(node, state);
      if (listChildren.length > 0) {
        return { type: "serialized", name, children: listChildren };
      }
      const txt = renderInline(node.children, state).trim();
      if (!txt) return null;
      return { type: "serialized", name, value: txt };
    }

    case "list": {
      const items: SerializedNode[] = [];
      for (const child of node.children) {
        if (typeof child === "string") continue;
        if (child.tag === "item") {
          const txt = renderInline(child.children, state).trim();
          items.push({ type: "serialized", name: "item", value: txt });
        }
      }
      return items.length > 0
        ? { type: "serialized", name: "_list", children: items }
        : null;
    }

    case "p": {
      const txt = renderInline(node.children, state).trim();
      return txt ? { type: "serialized", name: "_text", value: txt } : null;
    }

    case "section":
      return processSerializeSection(node, state);

    case "let":
      await processLet(node, state);
      return null;

    case "include":
      // Include in serialize mode isn't common — return null
      return null;

    case "qa": {
      const name = node.attrs.captionSerialized ?? SERIALIZED_NAMES["qa"] ?? "question";
      const txt = renderInline(node.children, state).trim();
      if (!txt) return null;
      return { type: "serialized", name, value: txt };
    }

    default:
      return null;
  }
}

/** Collect serialize children from block-level nodes inside an element. */
async function collectSerializeChildren(
  node: XmlElement,
  state: State,
): Promise<SerializedNode[]> {
  const results: SerializedNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const result = await processSerializeElement(child, state);
    if (result) {
      if (result.name === "_list" && result.children) {
        results.push(...result.children);
      } else {
        results.push(result);
      }
    }
  }
  return results;
}

async function processSerializeSection(
  node: XmlElement,
  state: State,
): Promise<SerializedNode | null> {
  const children: SerializedNode[] = [];
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const result = await processSerializeElement(child, {
      ...state,
      depth: state.depth + 1,
    });
    if (result) children.push(result);
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { type: "serialized", name: "_group", children };
}

async function expandForSerialize(
  node: XmlElement,
  state: State,
): Promise<SerializedNode[]> {
  const forAttr = node.attrs.for!;
  const m = forAttr.match(/^(\w+)\s+in\s+(.+)$/);
  if (!m) return [];
  const varName = m[1];
  const iterExpr = m[2].trim();
  const collection = evalExpr(iterExpr, state.ctx);
  if (!Array.isArray(collection)) return [];

  const results: SerializedNode[] = [];
  const clone = { ...node, attrs: { ...node.attrs } };
  delete clone.attrs.for;
  for (const item of collection) {
    const childState = { ...state, ctx: { ...state.ctx, [varName]: item } };
    const r = await processSerializeElement(clone, childState);
    if (r) results.push(r);
  }
  return results;
}
