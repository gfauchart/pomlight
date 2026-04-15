# POML Feature Coverage

### Not Implemented

The following spec features are intentionally excluded from this lightweight implementation:

- **`<meta>` element** — Version control (`minVersion`/`maxVersion`) and component management.
- **Token/character limits** (`charLimit`, `tokenLimit`, `priority`) — Priority-based truncation and token counting require a tokenizer dependency (e.g., tiktoken).
- **Folder component** (`<folder>`) — Directory traversal with content display. Requires filesystem I/O beyond what this lightweight library targets.
- **Webpage component** (`<webpage>`) — HTML fetching, CSS selector parsing, and HTML-to-markdown conversion. Requires an HTML parser dependency.
- **Binary file parsing** — PDF, DOCX, XLSX, and other binary document formats supported by the official library. pomlight implementation only handles plain text file formats (TXT, CSV, JSON). 
- **Extended POML format** — Mixed text+POML file format (e.g., Markdown with embedded POML elements). The spec is still under development.
- **Image resizing** (`maxWidth`, `maxHeight`, `resize`) — Requires an image processing library (e.g., sharp).

Use the official [poml](https://github.com/microsoft/poml) package if you require these features.

---

### Components — Basic

| Component | Tag(s) | Supported | Tests | Notes |
|---|---|---|---|---|
| Text (root) | `<poml>`, `<text>` | ✅ | — | Root wrapper; used in all tests |
| Paragraph | `<p>` | ✅ | 01, 18 | |
| Header | `<h>` | ✅ | 03, 18 | Auto-depth via `<section>` nesting |
| SubContent | `<section>` | ✅ | 04, 24 | Increases heading depth |
| CaptionedParagraph | `<cp>` | ✅ | 07, 18 | `caption` attribute only |
| List | `<list>` | ✅ | 05, 06, 27 | `listStyle="decimal"` for numbered |
| ListItem | `<item>` | ✅ | 05, 06, 27 | Nested lists supported |
| Bold | `<b>` | ✅ | 08, 18 | |
| Inline | `<span>` | ✅ | 09 | |
| Code (inline) | `<code inline="true">` | ✅ | 10, 18, 21 | Inline only |
| Code (block) | `<code lang="...">` | ✅ | 113 | Fenced code block |
| Italic | `<i>` | ✅ | 36 | `*text*` |
| Underline | `<u>` | ✅ | 36 | `__text__` |
| Strikethrough | `<s>`, `<strike>` | ✅ | 36 | `~~text~~` |
| Newline | `<br>` | ✅ | 37 | Literal newline |
| Audio | `<audio>` | ✅ | 53 | No-op in markdown (multimedia only) |

### Components — Intentions

| Component | Tag(s) | Supported | Tests | Notes |
|---|---|---|---|---|
| Role | `<role>` | ✅ | 02, 18 | Renders as `# Role` heading |
| Task | `<task>` | ✅ | 18 | Renders as `# Task` heading |
| Example | `<example>` | ✅ | 43, 44, 159 | `chat`, `caption`, `captionStyle`; expression in caption during loop |
| ExampleSet | `<examples>` | ✅ | 45, 152 | `caption`, `captionStyle`, `introducer` |
| ExampleInput | `<input>` | ✅ | 43, 44 | Chat-aware caption |
| ExampleOutput | `<output>` | ✅ | 43, 44 | Chat-aware caption |
| Hint | `<hint>` | ✅ | 38 | `**Hint:** text` |
| Introducer | `<introducer>` | ✅ | 39 | Hidden caption by default |
| OutputFormat | `<output-format>` | ✅ | 40 | `# Output Format` heading |
| Question | `<qa>` | ✅ | 41 | `**Question:**` + `**Answer:**` |
| StepwiseInstructions | `<stepwise-instructions>` | ✅ | 42 | `# Stepwise Instructions` heading |

### Components — Data Displays

| Component | Tag(s) | Supported | Tests | Notes |
|---|---|---|---|---|
| Document | `<Document>` | ✅ | 55 | TXT files only (no PDF/DOCX) |
| Folder | `<folder>` | ❌ | — | Not implemented |
| Image | `<img>` | ✅ | 54 | Alt text rendered; base64 embedding for multimedia syntax |
| Object | `<obj>`, `<object>`, `<dataObj>` | ✅ | 62, 63, 138 | JSON, XML, YAML syntaxes |
| Table | `<table>` | ✅ | 67, 86-91, 122, 130-131, 139, 153-154 | CSV, JSON, JSONL files; records attr; columns; maxRecords; maxColumns; markdown/csv/tsv output |
| Tree | `<Tree>` | ✅ | 141 | Markdown syntax with showContent |
| Webpage | `<webpage>` | ❌ | — | Not implemented |

### Components — Utilities

| Component | Tag(s) | Supported | Tests | Notes |
|---|---|---|---|---|
| AiMessage | `<ai-msg>` | ✅ | 46, 47 | |
| HumanMessage | `<user-msg>` | ✅ | 46, 47 | Dropped in write() output |
| SystemMessage | `<system-msg>` | ✅ | 46, 47 | |
| Conversation | `<conversation>` | ✅ | 48 | |
| MessageContent | `<msg-content>` | ✅ | 51, 135, 145 | String and multimedia content (flattened to text) |
| ToolRequest | `<ToolRequest>` | ✅ | 49 | |
| ToolResponse | `<ToolResponse>` | ✅ | 50 | |

### Template Engine

| Feature | Supported | Tests | Notes |
|---|---|---|---|
| Variable interpolation `{{var}}` | ✅ | 11 | |
| Dot notation `{{obj.prop}}` | ✅ | 12 | |
| Arithmetic `{{a + b}}` | ✅ | 32 | |
| Array access `{{arr[0]}}` | ✅ | 28 | |
| Function calls `{{fn()}}` | ✅ | 28 | |
| Ternary `{{a ? b : c}}` | ✅ | 29 | |
| String concatenation `{{a + " " + b}}` | ✅ | 30 | |
| `<let>` body text (syntax 1) | ✅ | 31 | |
| `<let>` inline JSON (syntax 4) | ✅ | 33 | |
| `<let>` `value` attr + expression (syntax 5) | ✅ | 32 | |
| `<let>` `type` casting | ✅ | 33 | integer, float, boolean |
| `<let src="...">` data import (syntax 2/3) | ✅ | 35, 157 | JSON and text files; CSV basic support; nameless spread |
| `<let>` with directives | ✅ | 34 | `if` / `for` on `<let>` |
| Type-autocasting in attributes | ✅ | 101 | boolean, number, object via `castType()` |

### Directives

| Feature | Supported | Tests | Notes |
|---|---|---|---|
| `if="expr"` | ✅ | 13, 22 | On any element |
| `for="x in xs"` | ✅ | 14, 15 | On any element |
| `if` + `for` on same element | ✅ | 20, 23 | Filter during iteration |
| `for` on `<include>` | ✅ | 19 | Loop include |
| `for` on `<section>` | ✅ | 24 | |
| `loop.index` | ✅ | 14, 15, 158 | Nested scope tested |
| `loop.length` | ✅ | 15 | |
| `loop.first` | ✅ | 15 | |
| `loop.last` | ✅ | 15 | |

### Include

| Feature | Supported | Tests | Notes |
|---|---|---|---|
| `<include src="...">` | ✅ | 16 | |
| Include with `for` attribute | ✅ | 19 | |
| Include with `if` attribute | ✅ | 16 | |
| Fragment partials (no `<poml>` wrapper) | ✅ | 26 | |

### Escapes

| Escape | Output | Supported | Tests |
|---|---|---|---|
| `#amp;` | `&` | ✅ | 17, 52 |
| `#quot;` | `"` | ✅ | 52 |
| `#apos;` | `'` | ✅ | 52 |
| `#lt;` | `<` | ✅ | 52 |
| `#gt;` | `>` | ✅ | 52 |
| `#hash;` | `#` | ✅ | 52 |
| `#lbrace;` | `{` | ✅ | 52 |
| `#rbrace;` | `}` | ✅ | 52 |
| XML entities (`&amp;` etc.) | various | ✅ | 25 |

### Meta & Configuration

| Feature | Tag(s) | Supported | Tests | Notes |
|---|---|---|---|---|
| `<meta>` (version/component control) | `<meta>` | ❌ | — | Not implemented |
| Stylesheet | `<stylesheet>` | ✅ | 80, 93, 126, 140 | Class-based selectors, writerOptions |
| Response Schema | `<output-schema>` | ✅ | — | JSON parser only (no Zod/eval); via `readFull()`/`pomlFull()` |
| Tool Registration | `<tool-definition>`, `<tool>` | ✅ | — | JSON parser only; via `readFull()`/`pomlFull()` |
| Runtime Parameters | `<runtime>` | ✅ | — | Kebab→camelCase, auto-coercion; via `readFull()`/`pomlFull()` |

### Styling & Advanced

| Feature | Supported | Tests | Notes |
|---|---|---|---|
| `syntax` attribute | ✅ | 90-91, 95-96, 102, 138 | markdown, csv, tsv, json, xml, yaml, text |
| `speaker` attribute | ✅ | 136 | On any element |
| `blankLine` attribute | ✅ | 155 | On `<p>`, `<cp>`, `<h>`, `<code>` |
| `className` attribute | ✅ | 93, 140 | Stylesheet class-based selectors |
| `whiteSpace` control (`pre`/`filter`/`trim`) | ✅ | 70, 77, 78, 123, 156 | Non-cascading behavior tested |
| `charLimit` / `tokenLimit` / `priority` | ❌ | — | Not implemented |
| `captionStyle`, `captionTextTransform`, `captionEnding` | ✅ | 94, 98, 132, 133 | All styles and endings |
| Code blocks (`<code>` without `inline="true"`) | ✅ | 21, 113 | With lang attribute |

