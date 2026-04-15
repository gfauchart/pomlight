export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export function parseXml(raw: string): XmlElement {
  // Strip XML comments
  const xml = raw.replace(/<!--[\s\S]*?-->/g, "");

  type Token =
    | { type: "open"; tag: string; attrs: Record<string, string> }
    | { type: "close"; tag: string }
    | { type: "text"; content: string };

  const tokens: Token[] = [];
  const tagRe =
    /<(\/?)([a-zA-Z_][\w-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(xml)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: "text", content: xml.slice(lastIndex, m.index) });
    }

    const [, isClose, tag, attrsStr, isSelfClose] = m;
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsStr)) !== null) {
      attrs[am[1]] = am[2];
    }

    if (isClose) {
      tokens.push({ type: "close", tag });
    } else {
      tokens.push({ type: "open", tag, attrs });
      if (isSelfClose) {
        tokens.push({ type: "close", tag });
      }
    }

    lastIndex = tagRe.lastIndex;
  }

  if (lastIndex < xml.length) {
    tokens.push({ type: "text", content: xml.slice(lastIndex) });
  }

  // Build tree from tokens
  let pos = 0;

  function buildElement(
    tag: string,
    attrs: Record<string, string>,
  ): XmlElement {
    const children: XmlNode[] = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === "close") {
        pos++;
        break;
      }
      if (tok.type === "text") {
        children.push(tok.content);
        pos++;
      } else {
        pos++;
        children.push(buildElement(tok.tag, tok.attrs));
      }
    }
    return { tag, attrs, children };
  }

  // Skip to first open tag
  while (pos < tokens.length && tokens[pos].type !== "open") pos++;
  if (pos >= tokens.length) {
    return { tag: "_root", attrs: {}, children: [] };
  }

  const first = tokens[pos] as Extract<Token, { type: "open" }>;
  pos++;
  return buildElement(first.tag, first.attrs);
}
