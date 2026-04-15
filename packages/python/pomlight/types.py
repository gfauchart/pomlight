from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Union


Speaker = Literal["system", "human", "ai", "tool"]

OutputFormat = Literal["message_dict", "openai_chat", "dict", "raw", "langchain", "pydantic"]

StyleSheet = dict[str, dict[str, str]]

# ---------------------------------------------------------------------------
# Multimodal content types
# ---------------------------------------------------------------------------


class ContentMultiMediaBinary:
    __slots__ = ("type", "base64", "alt")

    def __init__(self, type: str, base64: str, alt: str | None = None):
        self.type = type
        self.base64 = base64
        self.alt = alt

    def __eq__(self, other: object) -> bool:
        if isinstance(other, dict):
            return self._to_dict() == other
        if isinstance(other, ContentMultiMediaBinary):
            return self.type == other.type and self.base64 == other.base64 and self.alt == other.alt
        return NotImplemented

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "base64": self.base64}
        if self.alt is not None:
            d["alt"] = self.alt
        return d


class ContentMultiMediaJson:
    __slots__ = ("type", "content", "id", "name")

    def __init__(self, content: Any, type: str = "application/json", id: str | None = None, name: str | None = None):
        self.type = type
        self.content = content
        self.id = id
        self.name = name

    def __eq__(self, other: object) -> bool:
        if isinstance(other, dict):
            return self._to_dict() == other
        if isinstance(other, ContentMultiMediaJson):
            return self.type == other.type and self.content == other.content and self.id == other.id and self.name == other.name
        return NotImplemented

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type, "content": self.content}
        if self.id is not None:
            d["id"] = self.id
        if self.name is not None:
            d["name"] = self.name
        return d


ContentMultiMedia = Union[ContentMultiMediaBinary, ContentMultiMediaJson]

RichContent = Union[str, list[Union[str, ContentMultiMedia]]]

# ---------------------------------------------------------------------------
# Block types (IR)
# ---------------------------------------------------------------------------


@dataclass
class Heading:
    type: str = field(default="heading", init=False)
    depth: int = 1
    text: str = ""
    speaker: Speaker | None = None


@dataclass
class Paragraph:
    type: str = field(default="paragraph", init=False)
    text: str = ""
    blank_line: bool | None = None
    speaker: Speaker | None = None


@dataclass
class ListItem:
    text: str = ""
    children: list[Block] = field(default_factory=list)


@dataclass
class ListBlock:
    type: str = field(default="list", init=False)
    ordered: bool = False
    list_style: str | None = None
    items: list[ListItem] = field(default_factory=list)
    speaker: Speaker | None = None


@dataclass
class SerializedNode:
    type: str = field(default="serialized", init=False)
    name: str = ""
    value: str | None = None
    children: list[SerializedNode] | None = None
    speaker: Speaker | None = None


@dataclass
class MultiMediaBlock:
    type: str = field(default="multimedia", init=False)
    content: list[ContentMultiMedia] = field(default_factory=list)
    speaker: Speaker | None = None


Block = Union[Heading, Paragraph, ListBlock, SerializedNode, MultiMediaBlock]

# ---------------------------------------------------------------------------
# Message types
# ---------------------------------------------------------------------------


@dataclass
class Message:
    speaker: Speaker = "human"
    content: RichContent = ""


# ---------------------------------------------------------------------------
# Sideband types
# ---------------------------------------------------------------------------


@dataclass
class ToolDefinition:
    name: str = ""
    parameters: dict[str, Any] = field(default_factory=dict)
    description: str | None = None


@dataclass
class RuntimeParameters:
    data: dict[str, Any] = field(default_factory=dict)

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def __contains__(self, key: str) -> bool:
        return key in self.data


@dataclass
class ReadResult:
    blocks: list[Block] = field(default_factory=list)
    schema: dict[str, Any] | None = None
    tools: list[ToolDefinition] | None = None
    runtime: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Options types
# ---------------------------------------------------------------------------


@dataclass
class ReadOptions:
    trim: bool | None = None


@dataclass
class WriteOptions:
    speaker: bool | None = None


# ---------------------------------------------------------------------------
# State (internal, used during read)
# ---------------------------------------------------------------------------


@dataclass
class Sideband:
    schema: dict[str, Any] | None = None
    tools: list[ToolDefinition] = field(default_factory=list)
    runtime: dict[str, Any] | None = None


@dataclass
class State:
    ctx: dict[str, Any] = field(default_factory=dict)
    depth: int = 1
    file_path: str | None = None
    chat: bool | None = None
    presentation: str | None = None
    serializer: str | None = None
    styles: StyleSheet | None = None
    sideband: Sideband | None = None


# ---------------------------------------------------------------------------
# Utility classes (Schema, ToolsSchema, PomlFile)
# ---------------------------------------------------------------------------


class Schema:
    def __init__(self, openapi_schema: dict[str, Any]):
        self._schema = openapi_schema

    @staticmethod
    def from_openapi(schema: dict[str, Any]) -> Schema:
        return Schema(schema)

    def to_openapi(self) -> dict[str, Any]:
        return self._schema

    @property
    def type(self) -> str | None:
        return self._schema.get("type")


class ToolsSchema:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def add_tool(self, name: str, description: str | None, input_schema: Schema) -> None:
        if name in self._tools:
            raise ValueError(f"Duplicate tool name: {name}")
        td = ToolDefinition(name=name, parameters=input_schema.to_openapi())
        if description is not None:
            td.description = description
        self._tools[name] = td

    def to_openai(self) -> list[dict[str, Any]]:
        result = []
        for td in self._tools.values():
            entry: dict[str, Any] = {
                "type": "function",
                "name": td.name,
                "parameters": td.parameters,
            }
            if td.description is not None:
                entry["description"] = td.description
            result.append(entry)
        return result

    def get_tool(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def get_tools(self) -> list[ToolDefinition]:
        return list(self._tools.values())

    def size(self) -> int:
        return len(self._tools)


class PomlFile:
    def __init__(self) -> None:
        self._result: ReadResult | None = None

    def _populate(self, result: ReadResult) -> None:
        self._result = result

    def get_response_schema(self) -> Schema | None:
        if self._result and self._result.schema:
            return Schema.from_openapi(self._result.schema)
        return None

    def get_tools_schema(self) -> ToolsSchema | None:
        if self._result and self._result.tools:
            ts = ToolsSchema()
            for t in self._result.tools:
                ts._tools[t.name] = t
            return ts
        return None

    def get_runtime_parameters(self) -> dict[str, Any] | None:
        if self._result:
            return self._result.runtime
        return None
