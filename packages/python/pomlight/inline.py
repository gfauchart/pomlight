from __future__ import annotations

import re
from .xml_parser import XmlNode, XmlElement
from .types import State
from .tags import normalize_tag
from .expr import interpolate, interpolate_pre, eval_condition, escapes


def render_inline(children: list[XmlNode], state: State) -> str:
    out = ""
    for c in children:
        if isinstance(c, str):
            t = interpolate(c, state.ctx)
            t = escapes(t)
            t = re.sub(r"\s+", " ", t)  # collapse whitespace
            out += t
        else:
            # if-directive on inline elements
            if_attr = c.attrs.get("if")
            if if_attr is not None:
                if not eval_condition(if_attr, state.ctx):
                    continue
            inner = render_inline(c.children, state).strip()
            tag = normalize_tag(c.tag)
            if tag == "b":
                out += f"**{inner}**"
            elif tag == "i":
                out += f"*{inner}*"
            elif tag == "u":
                out += f"__{inner}__"
            elif tag in ("s", "strike"):
                out += f"~~{inner}~~"
            elif tag == "code":
                out += f"`{inner}`"
            elif tag == "br":
                nl_count = int(c.attrs.get("newLineCount", "1"))
                out += "\n" * nl_count
            elif tag == "audio":
                pass
            elif tag == "img":
                img_syn = c.attrs.get("syntax")
                img_mm = img_syn == "multimedia" or (not img_syn and "alt" not in c.attrs)
                if not img_mm and "alt" in c.attrs:
                    out += interpolate(c.attrs["alt"], state.ctx)
            else:  # span or unknown
                ws = c.attrs.get("whiteSpace") or c.attrs.get("white-space")
                if ws == "trim":
                    pre = render_inline_pre(c.children, state).strip()
                    out += pre
                elif ws == "pre":
                    out += render_inline_pre(c.children, state)
                else:
                    out += inner
    return out


def render_inline_pre(children: list[XmlNode], state: State) -> str:
    out = ""
    for c in children:
        if isinstance(c, str):
            t = interpolate_pre(c, state.ctx)
            t = escapes(t)
            out += t
        else:
            if_attr = c.attrs.get("if")
            if if_attr is not None:
                if not eval_condition(if_attr, state.ctx):
                    continue
            inner = render_inline_pre(c.children, state)
            ws = c.attrs.get("whiteSpace") or c.attrs.get("white-space")
            tag = normalize_tag(c.tag)
            if tag == "b":
                out += f"**{inner}**"
            elif tag == "i":
                out += f"*{inner}*"
            elif tag == "code":
                out += f"`{inner}`"
            elif tag == "br":
                out += "\n"
            elif tag == "span":
                if ws == "trim":
                    out += inner.strip()
                else:
                    out += inner
            else:
                out += inner
    return out
