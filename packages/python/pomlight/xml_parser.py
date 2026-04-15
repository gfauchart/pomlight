from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Union


@dataclass
class XmlElement:
    tag: str
    attrs: dict[str, str]
    children: list[XmlNode]


XmlNode = Union[XmlElement, str]


def parse_xml(raw: str) -> XmlElement:
    # Strip XML comments
    xml = re.sub(r"<!--[\s\S]*?-->", "", raw)

    tokens: list[dict] = []
    tag_re = re.compile(
        r"<(/?)([a-zA-Z_][\w-]*)((?:\s+[\w:.\-]+\s*=\s*\"[^\"]*\")*)\s*(/?)>"
    )
    last_index = 0

    for m in tag_re.finditer(xml):
        if m.start() > last_index:
            tokens.append({"type": "text", "content": xml[last_index : m.start()]})

        is_close = m.group(1)
        tag = m.group(2)
        attrs_str = m.group(3)
        is_self_close = m.group(4)

        attrs: dict[str, str] = {}
        for am in re.finditer(r'([\w:.\-]+)\s*=\s*"([^"]*)"', attrs_str):
            attrs[am.group(1)] = am.group(2)

        if is_close:
            tokens.append({"type": "close", "tag": tag})
        else:
            tokens.append({"type": "open", "tag": tag, "attrs": attrs})
            if is_self_close:
                tokens.append({"type": "close", "tag": tag})

        last_index = m.end()

    if last_index < len(xml):
        tokens.append({"type": "text", "content": xml[last_index:]})

    pos = [0]  # mutable index

    def build_element(tag: str, attrs: dict[str, str]) -> XmlElement:
        children: list[XmlNode] = []
        while pos[0] < len(tokens):
            tok = tokens[pos[0]]
            if tok["type"] == "close":
                pos[0] += 1
                break
            if tok["type"] == "text":
                children.append(tok["content"])
                pos[0] += 1
            else:  # open
                pos[0] += 1
                children.append(build_element(tok["tag"], tok["attrs"]))
        return XmlElement(tag=tag, attrs=attrs, children=children)

    # Skip to first open tag
    while pos[0] < len(tokens) and tokens[pos[0]]["type"] != "open":
        pos[0] += 1
    if pos[0] >= len(tokens):
        return XmlElement(tag="_root", attrs={}, children=[])

    first = tokens[pos[0]]
    pos[0] += 1
    return build_element(first["tag"], first["attrs"])
