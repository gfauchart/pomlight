"""Unit tests mirroring packages/deno/tests/unit.test.ts."""

from pomlight import poml, read_full
from pomlight.types import Schema, ToolsSchema
import pytest


# ---------------------------------------------------------------------------
# read_full tests (raw sideband)
# ---------------------------------------------------------------------------

def test_read_full_output_schema():
    markup = """<poml>
  <output-schema>{"type":"object","properties":{"name":{"type":"string"}}}</output-schema>
  <p>Hello</p>
</poml>"""
    result = read_full(markup)
    assert result.schema is not None
    assert result.schema["type"] == "object"


def test_read_full_tool_definition():
    markup = """<poml>
  <tool-definition name="search" description="Search the web">{"type":"object","properties":{"query":{"type":"string"}}}</tool-definition>
  <p>Use search</p>
</poml>"""
    result = read_full(markup)
    assert result.tools is not None
    assert len(result.tools) == 1
    assert result.tools[0].name == "search"


def test_read_full_runtime():
    markup = """<poml>
  <runtime temperature="0.7" max-tokens="100" />
  <p>Hello</p>
</poml>"""
    result = read_full(markup)
    assert result.runtime is not None
    assert result.runtime["temperature"] == 0.7
    assert result.runtime["maxTokens"] == 100


def test_read_full_tool_alias():
    markup = """<poml>
  <tool name="calc" description="Calculate">{"type":"object","properties":{"expr":{"type":"string"}}}</tool>
  <p>Calc</p>
</poml>"""
    result = read_full(markup)
    assert result.tools is not None
    assert result.tools[0].name == "calc"


# ---------------------------------------------------------------------------
# poml() with format "dict"
# ---------------------------------------------------------------------------

def test_poml_dict_no_sideband():
    result = poml("<poml><p>Hello</p></poml>", format="dict")
    assert "messages" in result
    assert result.get("schema") is None
    assert result.get("tools") is None
    assert result.get("runtime") is None


def test_poml_dict_with_schema():
    result = poml("""<poml>
  <output-schema>{"type":"object","properties":{"result":{"type":"number"}}}</output-schema>
  <p>Compute</p>
</poml>""", format="dict")
    assert result["schema"]["type"] == "object"


def test_poml_dict_with_tools():
    result = poml("""<poml>
  <tool name="get_weather" description="Get weather for a city">{"type":"object","properties":{"city":{"type":"string"}}}</tool>
  <tool name="get_time" description="Get current time">{"type":"object","properties":{"timezone":{"type":"string"}}}</tool>
  <p>Use tools</p>
</poml>""", format="dict")
    tools = result["tools"]
    assert len(tools) == 2
    assert tools[0].name == "get_weather"
    assert tools[1].name == "get_time"
    assert tools[0].description == "Get weather for a city"


def test_poml_dict_with_runtime():
    result = poml("""<poml>
  <runtime temperature="0.5" top-p="0.9" stop="END" />
  <p>Hello</p>
</poml>""", format="dict")
    runtime = result["runtime"]
    assert runtime["temperature"] == 0.5
    assert runtime["topP"] == 0.9
    assert runtime["stop"] == "END"


def test_poml_dict_combined_sideband():
    result = poml("""<poml>
  <output-schema>{"type":"string"}</output-schema>
  <tool name="lookup">{"type":"object","properties":{"id":{"type":"integer"}}}</tool>
  <runtime temperature="1" max-tokens="500" />
  <p>All together</p>
</poml>""", format="dict")
    assert result["schema"]["type"] == "string"
    assert len(result["tools"]) == 1
    assert result["runtime"]["temperature"] == 1
    assert result["runtime"]["maxTokens"] == 500


# ---------------------------------------------------------------------------
# poml() with format "openai_chat"
# ---------------------------------------------------------------------------

def test_poml_openai_chat_schema():
    result = poml("""<poml>
  <output-schema>{"type":"array","items":{"type":"string"}}</output-schema>
  <p>List items</p>
</poml>""", format="openai_chat")
    rf = result["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["name"] == "schema"
    assert rf["json_schema"]["schema"]["type"] == "array"
    assert rf["json_schema"]["strict"] is True


def test_poml_openai_chat_tools():
    result = poml("""<poml>
  <tool name="greet" description="Say hello">{"type":"object","properties":{"name":{"type":"string"}}}</tool>
  <p>Greet</p>
</poml>""", format="openai_chat")
    tools = result["tools"]
    assert len(tools) == 1
    assert tools[0]["type"] == "function"
    assert tools[0]["function"]["name"] == "greet"
    assert tools[0]["function"]["description"] == "Say hello"


def test_poml_openai_chat_runtime():
    result = poml("""<poml>
  <runtime model="gpt-4o" temperature="0.3" max-tokens="100" top-p="0.9" />
  <p>Hello</p>
</poml>""", format="openai_chat")
    assert result["model"] == "gpt-4o"
    assert result["temperature"] == 0.3
    assert result["max_tokens"] == 100
    assert result["top_p"] == 0.9


# ---------------------------------------------------------------------------
# Schema / ToolsSchema
# ---------------------------------------------------------------------------

def test_schema_roundtrip():
    raw = {"type": "object", "properties": {"x": {"type": "number"}}}
    schema = Schema.from_openapi(raw)
    assert schema.to_openapi() == raw


def test_tools_schema_basic():
    ts = ToolsSchema()
    assert ts.size() == 0
    ts.add_tool("a", "desc A", Schema.from_openapi({"type": "object"}))
    ts.add_tool("b", None, Schema.from_openapi({"type": "string"}))
    assert ts.size() == 2
    assert ts.get_tool("a").name == "a"
    assert ts.get_tool("a").description == "desc A"
    assert ts.get_tool("b").description is None
    assert len(ts.get_tools()) == 2


def test_tools_schema_duplicate_throws():
    ts = ToolsSchema()
    ts.add_tool("x", "x", Schema.from_openapi({"type": "object"}))
    with pytest.raises(ValueError):
        ts.add_tool("x", "x2", Schema.from_openapi({"type": "object"}))


def test_tools_schema_to_openai():
    ts = ToolsSchema()
    ts.add_tool("fn1", "Desc", Schema.from_openapi({"type": "object", "properties": {}}))
    result = ts.to_openai()
    assert len(result) == 1
    assert result[0]["type"] == "function"
    assert result[0]["name"] == "fn1"
    assert result[0]["description"] == "Desc"
    assert result[0]["parameters"]["type"] == "object"
