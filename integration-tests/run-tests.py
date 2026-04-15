"""
Generates expected.json for each test folder using the `poml` Python package.

Each test lives in its own folder under tests/:
  tests/<name>/
    fixture.poml       — the POML source
    parameter.json     — test parameters: context, etc.
    partials/          — optional folder for <include> partials
    expected.json      — raw Message[] output (overwritten each run)
"""

import json
from pathlib import Path

from poml import poml
from poml.api import PomlFrame

TESTS_DIR = Path(__file__).parent / "tests"

folders = sorted(p for p in TESTS_DIR.iterdir() if p.is_dir())

for folder in folders:
    fixture_path = folder / "fixture.poml"
    param_path = folder / "parameter.json"
    expected_path = folder / "expected.json"

    if not fixture_path.exists():
        continue

    params = json.loads(param_path.read_text()) if param_path.exists() else {}
    context = params.get("context", {})
    fmt = params.get("format", "message_dict")

    try:
        result = poml(
            fixture_path,
            context=context if context else None,
            format=fmt,
        )
    except Exception as e:
        print(f"FAILED: {folder.name} — {e}")
        continue

    if isinstance(result, PomlFrame):
        result = result.model_dump(mode="json", exclude_none=True)
    elif isinstance(result, str):
        # raw format — store as-is in a JSON string
        pass

    expected_path.write_text(json.dumps(result, indent=2) + "\n")
    print(f"generated: {folder.name}")

print("\nDone.")
