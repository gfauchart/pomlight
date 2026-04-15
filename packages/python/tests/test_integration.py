"""Integration tests mirroring packages/deno/tests/integration.test.ts.

Runs tests from integration-tests/tests/ the same way as the Deno version:
reads fixture.poml, optional parameter.json, compares output with expected.json.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pomlight import poml, PomlOptions
from pomlight.types import Message, ContentMultiMediaBinary, ContentMultiMediaJson

TESTS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "integration-tests" / "tests"


def _collect_test_folders() -> list[str]:
    if not TESTS_DIR.is_dir():
        return []
    folders = sorted(
        d.name for d in TESTS_DIR.iterdir()
        if d.is_dir() and (d / "fixture.poml").exists()
    )
    return folders


def _serialize(obj):
    """Recursively convert Message objects and other custom types to plain dicts/lists."""
    if isinstance(obj, Message):
        return {"speaker": obj.speaker, "content": _serialize(obj.content)}
    if isinstance(obj, ContentMultiMediaBinary):
        d = {"type": obj.type, "base64": obj.base64}
        if obj.alt is not None:
            d["alt"] = obj.alt
        return d
    if isinstance(obj, ContentMultiMediaJson):
        d = {"type": obj.type, "content": _serialize(obj.content)}
        if obj.id is not None:
            d["id"] = obj.id
        if obj.name is not None:
            d["name"] = obj.name
        return d
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if hasattr(obj, "__dict__") and not isinstance(obj, (str, int, float, bool)):
        return {k: _serialize(v) for k, v in obj.__dict__.items()}
    return obj


@pytest.mark.parametrize("folder", _collect_test_folders())
def test_integration(folder: str):
    test_dir = TESTS_DIR / folder
    xml = (test_dir / "fixture.poml").read_text()

    params: dict = {}
    param_file = test_dir / "parameter.json"
    if param_file.exists():
        params = json.loads(param_file.read_text())

    context = params.get("context", {})
    fmt = params.get("format", "message_dict")

    expected = json.loads((test_dir / "expected.json").read_text())

    result = poml(xml, PomlOptions(
        context=context,
        format=fmt,
        source_path=str(test_dir / "fixture.poml"),
    ))

    result_serialized = _serialize(result)
    assert result_serialized == expected, f"Mismatch in {folder}"
