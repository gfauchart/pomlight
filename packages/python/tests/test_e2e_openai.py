"""End-to-end test that calls the OpenAI API using pomlight."""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY not set",
)


def test_simple_chat_completion():
    from openai import OpenAI

    from pomlight import poml

    prompt = """\
<poml>
<system-msg>You are a helpful assistant. Reply in one short sentence.</system-msg>
<human-msg>What is the capital of France?</human-msg>
</poml>
"""
    result = poml(prompt, format="openai_chat")

    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        **result,
    )

    content = response.choices[0].message.content
    assert content
    assert "paris" in content.lower()
