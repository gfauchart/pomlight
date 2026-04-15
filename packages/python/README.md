# Pomlight (Python)

Lightweight Python library for parsing and rendering POML prompts.

## Install

```bash
pip install pomlight
```

## Usage

```python
from pomlight import poml

messages = poml("""<poml>
  <system>You are a helpful assistant.</system>
  <user>What is 2 + 2?</user>
</poml>""")

print(messages[0]["content"])  # "You are a helpful assistant."
print(messages[1]["content"])  # "What is 2 + 2?"
```

### Use with OpenAI SDK

```python
from openai import OpenAI
from pomlight import poml

client = OpenAI()

params = poml("""<poml>
  <runtime model="gpt-4o-mini" />
  <system>You are a helpful assistant. Reply in one short sentence.</system>
  <user>What is the capital of France?</user>
</poml>""", format="openai_chat")

response = client.chat.completions.create(**params)
print(response.choices[0].message.content)
```

## Feature Coverage

See [FeatureCoverage.md](../../FeatureCoverage.md) for supported components, template features, and what is not implemented.

## Development

```bash
pip install -e .[dev]
pytest tests/
```
