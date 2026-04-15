from __future__ import annotations

import re
from typing import Any


def _tokenize(src: str) -> list[dict]:
    out: list[dict] = []
    i = 0
    while i < len(src):
        ch = src[i]
        # whitespace
        if ch in " \t\r\n":
            i += 1
            continue
        # numbers
        if ch.isdigit():
            n = ""
            while i < len(src) and src[i] in "0123456789.":
                n += src[i]
                i += 1
            out.append({"t": "n", "v": float(n) if "." in n else int(n)})
            continue
        # strings
        if ch in ('"', "'"):
            q = ch
            i += 1
            s = ""
            while i < len(src) and src[i] != q:
                if src[i] == "\\":
                    i += 1
                    if i < len(src):
                        s += src[i]
                        i += 1
                    continue
                s += src[i]
                i += 1
            i += 1  # closing quote
            out.append({"t": "s", "v": s})
            continue
        # identifiers
        if ch.isalpha() or ch in "_$":
            ident = ""
            while i < len(src) and (src[i].isalnum() or src[i] in "_$"):
                ident += src[i]
                i += 1
            out.append({"t": "i", "v": ident})
            continue
        # regex literals: /pattern/flags — only after operator or at start
        if ch == "/" and (len(out) == 0 or out[-1]["t"] == "o"):
            start = i
            i += 1  # skip opening /
            pattern = ""
            while i < len(src) and src[i] != "/":
                if src[i] == "\\":
                    pattern += src[i]
                    i += 1
                    if i < len(src):
                        pattern += src[i]
                        i += 1
                    continue
                pattern += src[i]
                i += 1
            i += 1  # skip closing /
            flags = ""
            while i < len(src) and src[i] in "gimsuvy":
                flags += src[i]
                i += 1
            # Convert JS flags to Python: g → global (handled by re.sub), m → re.MULTILINE, i → re.IGNORECASE
            py_flags = 0
            is_global = False
            for f in flags:
                if f == "g":
                    is_global = True
                elif f == "i":
                    py_flags |= re.IGNORECASE
                elif f == "m":
                    py_flags |= re.MULTILINE
                elif f == "s":
                    py_flags |= re.DOTALL
            try:
                compiled = re.compile(pattern, py_flags)
                out.append({"t": "r", "v": _JsRegex(compiled, is_global)})
            except re.error:
                # Fallback: treat / as operator
                i = start
                out.append({"t": "o", "v": src[i]})
                i += 1
            continue
        # multi-char ops
        tri = src[i : i + 3]
        if tri in ("===", "!=="):
            out.append({"t": "o", "v": tri})
            i += 3
            continue
        bi = src[i : i + 2]
        if bi in ("==", "!=", ">=", "<="):
            out.append({"t": "o", "v": bi})
            i += 2
            continue
        # single-char op
        out.append({"t": "o", "v": ch})
        i += 1
    return out


class _JsRegex:
    """Wrapper for a compiled regex with JS global flag tracking."""
    __slots__ = ("pattern", "is_global")
    def __init__(self, pattern: re.Pattern, is_global: bool):
        self.pattern = pattern
        self.is_global = is_global
    def sub(self, repl: str, s: str) -> str:
        if self.is_global:
            return self.pattern.sub(repl, s)
        return self.pattern.sub(repl, s, count=1)


def _js_replace(s: str, pattern: Any, replacement: str, replace_all: bool) -> str:
    """Handle JS-style string replace with regex or string patterns."""
    if isinstance(pattern, _JsRegex):
        return pattern.sub(replacement, s)
    if hasattr(pattern, "sub"):
        # compiled re.Pattern object
        return pattern.sub(replacement, s)
    # String pattern
    if replace_all:
        return s.replace(str(pattern), replacement)
    return s.replace(str(pattern), replacement, 1)


def eval_expr(src: str, ctx: dict[str, Any]) -> Any:
    toks = _tokenize(src)
    pos = [0]

    def peek() -> dict | None:
        return toks[pos[0]] if pos[0] < len(toks) else None

    def adv() -> dict:
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def match_op(v: str) -> bool:
        p = peek()
        if p and p["t"] == "o" and p["v"] == v:
            pos[0] += 1
            return True
        return False

    def ternary() -> Any:
        lhs = addition()
        if match_op("?"):
            a = addition()
            match_op(":")
            b = addition()
            return a if lhs else b
        return lhs

    def addition() -> Any:
        left = comparison()
        while True:
            p = peek()
            if p and p["t"] == "o" and p["v"] == "+":
                adv()
                right = comparison()
                if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                    left = left + right
                else:
                    left = str(left if left is not None else "") + str(right if right is not None else "")
            else:
                break
        return left

    def comparison() -> Any:
        left = unary()
        p = peek()
        if p and p["t"] == "o" and p["v"] in ("===", "!==", "==", "!=", ">", "<", ">=", "<="):
            adv()
            right = unary()
            op = p["v"]
            if op in ("===", "=="):
                return left == right
            if op in ("!==", "!="):
                return left != right
            if op == ">":
                return left > right
            if op == "<":
                return left < right
            if op == ">=":
                return left >= right
            if op == "<=":
                return left <= right
        return left

    def unary() -> Any:
        if match_op("!"):
            return not unary()
        return postfix()

    # JS→Python method/property mapping for strings and lists
    _JS_STR_METHODS: dict[str, Any] = {
        "toUpperCase": lambda s: s.upper,
        "toLowerCase": lambda s: s.lower,
        "trim": lambda s: s.strip,
        "trimStart": lambda s: s.lstrip,
        "trimEnd": lambda s: s.rstrip,
        "startsWith": lambda s: s.startswith,
        "endsWith": lambda s: s.endswith,
        "includes": lambda s: lambda sub: sub in s,
        "indexOf": lambda s: lambda sub: s.find(sub),
        "slice": lambda s: lambda *a: s[int(a[0]):int(a[1])] if len(a) > 1 else s[int(a[0]):],
        "substring": lambda s: lambda *a: s[int(a[0]):int(a[1])] if len(a) > 1 else s[int(a[0]):],
        "replace": lambda s: lambda old, new: _js_replace(s, old, new, False),
        "replaceAll": lambda s: lambda old, new: _js_replace(s, old, new, True),
        "split": lambda s: lambda sep: s.split(sep),
        "charAt": lambda s: lambda i: s[int(i)] if 0 <= int(i) < len(s) else "",
        "repeat": lambda s: lambda n: s * int(n),
        "padStart": lambda s: lambda n, ch=" ": s.rjust(int(n), ch),
        "padEnd": lambda s: lambda n, ch=" ": s.ljust(int(n), ch),
    }
    _JS_LIST_METHODS: dict[str, Any] = {
        "join": lambda a: lambda sep: sep.join(str(x) for x in a),
        "includes": lambda a: lambda v: v in a,
        "indexOf": lambda a: lambda v: a.index(v) if v in a else -1,
        "slice": lambda a: lambda *args: a[int(args[0]):int(args[1])] if len(args) > 1 else a[int(args[0]):],
        "map": lambda a: lambda fn: [fn(x) for x in a],
        "filter": lambda a: lambda fn: [x for x in a if fn(x)],
        "find": lambda a: lambda fn: next((x for x in a if fn(x)), None),
        "reverse": lambda a: lambda: list(reversed(a)),
        "flat": lambda a: lambda *_: [item for sub in a for item in (sub if isinstance(sub, list) else [sub])],
        "concat": lambda a: lambda *args: a + [item for arg in args for item in (arg if isinstance(arg, list) else [arg])],
    }

    def postfix() -> Any:
        val = primary()
        while True:
            if match_op("."):
                ident = adv()
                if val is not None:
                    name = ident["v"]
                    # Handle .length for strings and lists
                    if name == "length" and isinstance(val, (str, list)):
                        val = len(val)
                    elif isinstance(val, str) and name in _JS_STR_METHODS:
                        val = _JS_STR_METHODS[name](val)
                    elif isinstance(val, list) and name in _JS_LIST_METHODS:
                        val = _JS_LIST_METHODS[name](val)
                    elif isinstance(val, dict):
                        val = val.get(name)
                    else:
                        prop = getattr(val, name, None)
                        val = prop
                else:
                    val = None
            elif match_op("["):
                idx = ternary()
                match_op("]")
                if val is not None:
                    if isinstance(val, (list, tuple)):
                        val = val[int(idx)] if isinstance(idx, (int, float)) else None
                    elif isinstance(val, dict):
                        val = val.get(str(idx))
                    else:
                        val = None
                else:
                    val = None
            elif match_op("("):
                args: list[Any] = []
                if not match_op(")"):
                    args.append(ternary())
                    while match_op(","):
                        args.append(ternary())
                    match_op(")")
                val = val(*args) if callable(val) else None
            else:
                break
        return val

    def primary() -> Any:
        t = peek()
        if t is None:
            return None
        if t["t"] == "n":
            adv()
            return t["v"]
        if t["t"] == "s":
            adv()
            return t["v"]
        if t["t"] == "r":
            adv()
            return t["v"]  # compiled regex
        if t["t"] == "i":
            adv()
            v = t["v"]
            if v == "true":
                return True
            if v == "false":
                return False
            if v == "null":
                return None
            if v == "undefined":
                return None
            return ctx.get(v)
        if t["t"] == "o" and t["v"] == "(":
            adv()
            v = ternary()
            match_op(")")
            return v
        # Array literal
        if t["t"] == "o" and t["v"] == "[":
            adv()
            arr: list[Any] = []
            if not match_op("]"):
                arr.append(ternary())
                while match_op(","):
                    arr.append(ternary())
                match_op("]")
            return arr
        # Object literal
        if t["t"] == "o" and t["v"] == "{":
            adv()
            obj: dict[str, Any] = {}
            if not match_op("}"):
                k = adv()
                match_op(":")
                obj[str(k["v"])] = ternary()
                while match_op(","):
                    k2 = adv()
                    match_op(":")
                    obj[str(k2["v"])] = ternary()
                match_op("}")
            return obj
        return None

    return ternary()


def interpolate(text: str, ctx: dict[str, Any]) -> str:
    if "{{" not in text:
        return text

    last_close = text.rfind("}}")
    trim_tail = last_close != -1 and text[last_close + 2 :].strip() == ""

    def replacer(m: re.Match) -> str:
        v = eval_expr(m.group(1).strip(), ctx)
        if v is None:
            return ""
        if isinstance(v, bool):
            return ""
        return str(v)

    out = re.sub(r"\{\{(.+?)\}\}", replacer, text)
    if trim_tail:
        out = out.rstrip()
    return out


def interpolate_pre(text: str, ctx: dict[str, Any]) -> str:
    if "{{" not in text:
        return text

    def replacer(m: re.Match) -> str:
        v = eval_expr(m.group(1).strip(), ctx)
        if v is None:
            return ""
        if isinstance(v, bool):
            return ""
        return str(v)

    return re.sub(r"\{\{(.+?)\}\}", replacer, text)


def eval_condition(expr: str, ctx: dict[str, Any]) -> bool:
    m = re.match(r"^\{\{(.+?)\}\}$", expr)
    if m:
        return bool(eval_expr(m.group(1).strip(), ctx))
    return bool(eval_expr(expr, ctx))


def escapes(text: str) -> str:
    text = text.replace("#quot;", '"')
    text = text.replace("#apos;", "'")
    text = text.replace("#lt;", "<")
    text = text.replace("#gt;", ">")
    text = text.replace("#lbrace;", "{")
    text = text.replace("#rbrace;", "}")
    text = text.replace("#amp;", "\x00")
    text = text.replace("#hash;", "#")
    # XML entities
    text = text.replace("&quot;", '"')
    text = text.replace("&apos;", "'")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&amp;", "")
    text = text.replace("\x00", "&")
    return text
