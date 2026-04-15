import type { XmlElement } from "./xml.ts";
import type { Block, State } from "./types.ts";
import { evalExpr, interpolate } from "./expr.ts";
import { getStyleProp } from "./style.ts";
import { stringify as yamlStringify } from "@std/yaml";

// ---------------------------------------------------------------------------
// Document component
// ---------------------------------------------------------------------------

export async function processDocument(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const rawSrc = node.attrs.src;
  if (!rawSrc || !state.filePath) return [];
  const src = interpolate(rawSrc, state.ctx);

  const dir = state.filePath.substring(0, state.filePath.lastIndexOf("/") + 1);
  const docPath = dir + src;
  let content: string;
  try {
    content = await Deno.readTextFile(docPath);
  } catch {
    return [];
  }

  return [{ type: "paragraph", text: content }];
}

// ---------------------------------------------------------------------------
// Table component
// ---------------------------------------------------------------------------

export async function processTable(
  node: XmlElement,
  state: State,
): Promise<Block[]> {
  const syntax = node.attrs.syntax ?? getStyleProp("table", "syntax", state) ?? "markdown";

  let records: Record<string, unknown>[] = [];
  let columns: string[] = [];

  // Check for inline records attribute first
  const recordsExpr = node.attrs.records;
  if (recordsExpr) {
    const raw = recordsExpr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
    const data = evalExpr(raw, state.ctx);
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (Array.isArray(first)) {
        // Array of arrays — generate "Column N" headers
        records = data.map((row: unknown[]) => {
          const obj: Record<string, unknown> = {};
          row.forEach((val, i) => { obj[`Column ${i}`] = val; });
          return obj;
        });
        columns = Object.keys(records[0]);
      } else if (first !== null && typeof first === "object") {
        columns = Object.keys(first as Record<string, unknown>);
        records = data as Record<string, unknown>[];
      }
    }
  } else {
    // File-based source
    const rawSrc = node.attrs.src;
    if (!rawSrc || !state.filePath) return [];
    const src = interpolate(rawSrc, state.ctx);

    const dir = state.filePath.substring(0, state.filePath.lastIndexOf("/") + 1);
    const tablePath = dir + src;
    const ext = src.substring(src.lastIndexOf(".") + 1).toLowerCase();

    if (ext === "csv") {
      const content = await Deno.readTextFile(tablePath);
      const parsed = parseCsvTable(content);
      records = parsed.records;
      columns = parsed.columns;
    } else if (ext === "json") {
      const content = await Deno.readTextFile(tablePath);
      const data = JSON.parse(content);
      if (Array.isArray(data) && data.length > 0) {
        columns = Object.keys(data[0]);
        records = data;
      }
    } else if (ext === "jsonl" || (node.attrs.parser === "jsonl")) {
      const content = await Deno.readTextFile(tablePath);
      const parsed = parseJsonlTable(content);
      records = parsed.records;
      columns = parsed.columns;
    } else {
      return [];
    }

    // Apply type inference to CSV records
    records = inferColumnTypes(records, columns);
  }

  // Apply columns attribute (field/header definitions)
  const columnsAttr = node.attrs.columns;
  const headerMap: Record<string, string> = {};
  if (columnsAttr) {
    const raw = columnsAttr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
    const colDefs = evalExpr(raw, state.ctx);
    if (Array.isArray(colDefs)) {
      const fields = colDefs.map((d: { field: string }) => d.field);
      columns = fields;
      for (const d of colDefs) {
        if (d.header) headerMap[d.field] = d.header;
      }
    }
  }

  // Apply selectedRecords slice
  const selectedRecords = node.attrs.selectedRecords;
  if (selectedRecords) {
    const [start, end] = parsePythonStyleSlice(selectedRecords, records.length);
    records = records.slice(start, end);
  }

  // Apply selectedColumns (only for file-based sources, not records attribute)
  const selectedColumns = node.attrs.selectedColumns;
  if (selectedColumns && !recordsExpr) {
    const cols = selectedColumns.split(",").map((c: string) => c.trim());
    columns = cols.filter((c: string) => columns.includes(c));
  }

  // Apply maxRecords — show first + "..." + last when truncating
  const maxRecords = parseInt(node.attrs.maxRecords ?? "");
  if (!isNaN(maxRecords) && maxRecords > 0 && records.length > maxRecords) {
    const first = records.slice(0, maxRecords - 1);
    const last = records[records.length - 1];
    const ellipsisRow: Record<string, unknown> = {};
    for (const c of columns) ellipsisRow[c] = "...";
    records = [...first, ellipsisRow, last];
  }

  if (columns.length === 0 || records.length === 0) return [];

  // Format cell: booleans → empty (React drops booleans); numbers → string
  const fmtCell = (v: unknown): string => {
    if (typeof v === "boolean") return "";
    if (v == null) return "";
    return String(v);
  };

  // Get writerOptions from node attrs (merged by applyStylesheet) or stylesheet
  // deno-lint-ignore no-explicit-any
  let writerOptions: Record<string, any> = {};
  // deno-lint-ignore no-explicit-any
  const rawWO = node.attrs.writerOptions ?? (state.styles?.["table"] as any)?.["writerOptions"];
  if (rawWO) {
    if (typeof rawWO === "string") {
      try { writerOptions = JSON.parse(rawWO); } catch { /* ignore */ }
    } else if (typeof rawWO === "object") {
      writerOptions = rawWO;
    }
  }

  if (syntax === "csv") {
    const separator = writerOptions.csvSeparator ?? ",";
    const showHeader = writerOptions.csvHeader !== false;
    const lines: string[] = [];
    if (showHeader) {
      lines.push(columns.join(separator));
    }
    for (const rec of records) {
      lines.push(columns.map((c) => fmtCell(rec[c])).join(separator));
    }
    return [{ type: "paragraph", text: lines.join("\n") }];
  }

  if (syntax === "tsv") {
    const headerLine = columns.join("\t");
    const bodyLines = records.map(
      (rec) => columns.map((c) => fmtCell(rec[c])).join("\t"),
    );
    const table = [headerLine, ...bodyLines].join("\n");
    return [{ type: "paragraph", text: table }];
  }

  // Default: markdown table
  const displayHeaders = columns.map((c) => headerMap[c] ?? c);

  const colWidths = columns.map((col, idx) => {
    let max = displayHeaders[idx].length;
    for (const rec of records) {
      const val = fmtCell(rec[col]);
      if (val.length > max) max = val.length;
    }
    return Math.max(max, 3);
  });

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const headerLine = "| " + displayHeaders.map((h, i) => pad(h, colWidths[i])).join(" | ") + " |";
  const sepLine = "| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |";
  const bodyLines = records.map(
    (rec) => "| " + columns.map((c, i) => pad(fmtCell(rec[c]), colWidths[i])).join(" | ") + " |",
  );
  const table = [headerLine, sepLine, ...bodyLines].join("\n");
  return [{ type: "paragraph", text: table }];
}

// ---------------------------------------------------------------------------
// Object component — serializes data as XML or JSON in a code fence
// ---------------------------------------------------------------------------

export function processObject(
  node: XmlElement,
  state: State,
): Block[] {
  const dataExpr = node.attrs.data;
  if (!dataExpr) return [];
  const raw = dataExpr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
  const data = evalExpr(raw, state.ctx);
  if (data == null) return [];

  const syntax = node.attrs.syntax ?? "json";

  if (syntax === "yaml") {
    const yaml = yamlStringify(data as Record<string, unknown>, { lineWidth: -1 }).trimEnd();
    return [{ type: "paragraph", text: "```yaml\n" + yaml + "\n```" }];
  }

  if (syntax === "xml") {
    const xml = objectToXml(data);
    return [{ type: "paragraph", text: "```xml\n" + xml + "\n```" }];
  }
  // Default: JSON
  const json = JSON.stringify(data, null, 2);
  return [{ type: "paragraph", text: "```json\n" + json + "\n```" }];
}

// ---------------------------------------------------------------------------
// Tree component — renders a tree structure as markdown headings
// ---------------------------------------------------------------------------

interface TreeItemData {
  name: string;
  children?: TreeItemData[];
  value?: string;
}

export function processTree(
  node: XmlElement,
  state: State,
): Block[] {
  const itemsExpr = node.attrs.items;
  if (!itemsExpr) return [];
  const raw = itemsExpr.replace(/^\{\{(.+)\}\}$/, "$1").trim();
  const items = evalExpr(raw, state.ctx) as TreeItemData[];
  if (!Array.isArray(items)) return [];

  const showContent = node.attrs.showContent === "true" || node.attrs.showContent as unknown === true;
  const blocks: Block[] = [];

  function walkTree(nodes: TreeItemData[], depth: number, pathPrefix: string): void {
    for (const item of nodes) {
      const fullPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;
      blocks.push({ type: "heading", depth, text: fullPath });

      if (showContent && item.value !== undefined) {
        const ext = item.name.includes(".") ? item.name.substring(item.name.lastIndexOf(".") + 1) : "";
        const fence = "```" + ext + "\n" + item.value + "\n```";
        blocks.push({ type: "paragraph", text: fence });
      }

      if (item.children) {
        walkTree(item.children, depth + 1, fullPath);
      }
    }
  }

  walkTree(items, state.depth, "");
  return blocks;
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by read.ts for <conversation>)
// ---------------------------------------------------------------------------

export function parsePythonStyleSlice(slice: string, totalLength: number): [number, number] {
  if (slice === ":") return [0, totalLength];
  if (slice.endsWith(":")) return [parseInt(slice.slice(0, -1)), totalLength];
  if (slice.startsWith(":")) {
    const end = parseInt(slice.slice(1));
    return [0, end < 0 ? totalLength + end : end];
  }
  if (slice.includes(":")) {
    const [s, e] = slice.split(":").map(Number);
    return [s, e < 0 ? totalLength + e : e];
  }
  const index = parseInt(slice);
  return [index, index + 1];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseCsvTable(content: string): { records: Record<string, string>[]; columns: string[] } {
  const lines = content.trim().split("\n");
  if (lines.length === 0) return { records: [], columns: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const records = lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  return { records, columns: headers };
}

function parseJsonlTable(content: string): { records: Record<string, unknown>[]; columns: string[] } {
  const lines = content.trim().split("\n").filter((l) => l.trim());
  const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  return { records, columns };
}

function inferColumnTypes(
  records: Record<string, unknown>[],
  columns: string[],
): Record<string, unknown>[] {
  if (records.length === 0) return records;

  const colTypes: Record<string, string> = {};
  for (const col of columns) {
    let type = "string";
    let allEmpty = true;
    for (const rec of records) {
      const val = String(rec[col] ?? "").trim();
      if (val === "") continue;
      allEmpty = true;
      allEmpty = false;
      if (val === "true" || val === "false") {
        if (type === "string") type = "boolean";
      } else if (!isNaN(Number(val)) && val !== "") {
        if (type === "string") {
          type = parseFloat(val) === parseInt(val) ? "integer" : "float";
        }
      } else {
        type = "string";
        break;
      }
    }
    if (allEmpty) type = "string";
    colTypes[col] = type;
  }

  return records.map((rec) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = String(rec[col] ?? "").trim();
      switch (colTypes[col]) {
        case "boolean":
          out[col] = raw === "true";
          break;
        case "integer":
          out[col] = raw === "" ? "" : parseInt(raw);
          break;
        case "float":
          out[col] = raw === "" ? "" : parseFloat(raw);
          break;
        default:
          out[col] = raw;
      }
    }
    return out;
  });
}

/** Convert a JS value to XML string (mimics React-like serialization). */
function objectToXml(data: unknown, indent = "", wrapInItem = false): string {
  if (Array.isArray(data)) {
    return data.map((item) => objectToXml(item, indent, true)).join("\n");
  }
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    const childIndent = wrapInItem ? indent + "  " : indent;
    const inner = keys.map((k) => {
      const val = obj[k];
      if (val !== null && typeof val === "object") {
        return `${childIndent}<${k}>\n${objectToXml(val, childIndent + "  ")}\n${childIndent}</${k}>`;
      }
      const strVal = String(val ?? "");
      if (strVal === "") {
        return `${childIndent}<${k}/>`;
      }
      return `${childIndent}<${k}>${escapeXmlContent(strVal)}</${k}>`;
    }).join("\n");
    if (wrapInItem) {
      return `${indent}<item>\n${inner}\n${indent}</item>`;
    }
    return inner;
  }
  return indent + escapeXmlContent(String(data ?? ""));
}

function escapeXmlContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
