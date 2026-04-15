from __future__ import annotations

from .xml_parser import XmlElement
from .types import Block, SerializedNode, State
from .expr import eval_condition, eval_expr
from .inline import render_inline
from .directives import process_let


# Default captionSerialized values for intention components.
SERIALIZED_NAMES: dict[str, str] = {
    "role": "role",
    "task": "task",
    "output-format": "outputFormat",
    "hint": "Hint",
    "introducer": "Introducer",
    "stepwise-instructions": "StepwiseInstructions",
    "qa": "Question",
    "examples": "Examples",
    "example": "Example",
}


def process_serialize(node: XmlElement, state: State) -> list[Block]:
    """Process children of <poml syntax='xml'> in serialize mode."""
    nodes: list[SerializedNode] = []
    for child in node.children:
        if isinstance(child, str):
            continue
        result = _process_serialize_element(child, state)
        if result:
            nodes.append(result)
    if not nodes:
        return []
    return [SerializedNode(name="_root", children=nodes)]


def _process_serialize_element(node: XmlElement, state: State) -> SerializedNode | None:
    """Process a single element in serialize mode."""
    if_attr = node.attrs.get("if")
    if if_attr is not None:
        if not eval_condition(if_attr, state.ctx):
            return None

    for_attr = node.attrs.get("for")
    if for_attr is not None:
        results = _expand_for_serialize(node, state)
        if not results:
            return None
        if len(results) == 1:
            return results[0]
        return SerializedNode(name="_group", children=results)

    tag = node.tag

    if tag in ("role", "task", "hint", "introducer", "stepwise-instructions"):
        name = node.attrs.get("captionSerialized") or SERIALIZED_NAMES.get(tag, tag)
        txt = render_inline(node.children, state).strip()
        if not txt:
            return None
        return SerializedNode(name=name, value=txt)

    if tag == "output-format":
        name = node.attrs.get("captionSerialized") or SERIALIZED_NAMES.get(tag, "outputFormat")
        list_children = _collect_serialize_children(node, state)
        if list_children:
            return SerializedNode(name=name, children=list_children)
        txt = render_inline(node.children, state).strip()
        if not txt:
            return None
        return SerializedNode(name=name, value=txt)

    if tag == "cp":
        caption = node.attrs.get("caption", "")
        name = node.attrs.get("captionSerialized") or caption
        list_children = _collect_serialize_children(node, state)
        if list_children:
            return SerializedNode(name=name, children=list_children)
        txt = render_inline(node.children, state).strip()
        if not txt:
            return None
        return SerializedNode(name=name, value=txt)

    if tag == "list":
        items: list[SerializedNode] = []
        for child in node.children:
            if isinstance(child, str):
                continue
            if child.tag == "item":
                txt = render_inline(child.children, state).strip()
                items.append(SerializedNode(name="item", value=txt))
        return SerializedNode(name="_list", children=items) if items else None

    if tag == "p":
        txt = render_inline(node.children, state).strip()
        return SerializedNode(name="_text", value=txt) if txt else None

    if tag == "section":
        return _process_serialize_section(node, state)

    if tag == "let":
        process_let(node, state)
        return None

    if tag == "include":
        return None

    if tag == "qa":
        name = node.attrs.get("captionSerialized") or SERIALIZED_NAMES.get("qa", "question")
        txt = render_inline(node.children, state).strip()
        if not txt:
            return None
        return SerializedNode(name=name, value=txt)

    return None


def _collect_serialize_children(node: XmlElement, state: State) -> list[SerializedNode]:
    results: list[SerializedNode] = []
    for child in node.children:
        if isinstance(child, str):
            continue
        result = _process_serialize_element(child, state)
        if result:
            if result.name == "_list" and result.children:
                results.extend(result.children)
            else:
                results.append(result)
    return results


def _process_serialize_section(node: XmlElement, state: State) -> SerializedNode | None:
    children: list[SerializedNode] = []
    for child in node.children:
        if isinstance(child, str):
            continue
        child_state = State(
            ctx=state.ctx,
            depth=state.depth + 1,
            file_path=state.file_path,
            chat=state.chat,
            presentation=state.presentation,
            serializer=state.serializer,
            styles=state.styles,
            sideband=state.sideband,
        )
        result = _process_serialize_element(child, child_state)
        if result:
            children.append(result)
    if not children:
        return None
    if len(children) == 1:
        return children[0]
    return SerializedNode(name="_group", children=children)


def _expand_for_serialize(node: XmlElement, state: State) -> list[SerializedNode]:
    import re
    for_attr = node.attrs["for"]
    m = re.match(r"^(\w+)\s+in\s+(.+)$", for_attr)
    if not m:
        return []
    var_name = m.group(1)
    iter_expr = m.group(2).strip()
    collection = eval_expr(iter_expr, state.ctx)
    if not isinstance(collection, list):
        return []

    results: list[SerializedNode] = []
    clone_attrs = {k: v for k, v in node.attrs.items() if k != "for"}
    clone = XmlElement(tag=node.tag, attrs=clone_attrs, children=node.children)
    for item in collection:
        child_ctx = {**state.ctx, var_name: item}
        child_state = State(
            ctx=child_ctx,
            depth=state.depth,
            file_path=state.file_path,
            chat=state.chat,
            presentation=state.presentation,
            serializer=state.serializer,
            styles=state.styles,
            sideband=state.sideband,
        )
        r = _process_serialize_element(clone, child_state)
        if r:
            results.append(r)
    return results
