# pomlight

[![CI](https://github.com/gfauchart/pomlight/actions/workflows/ci.yml/badge.svg)](https://github.com/gfauchart/pomlight/actions/workflows/ci.yml)
[![JSR version](https://jsr.io/badges/@pomlight/pomlight)](https://jsr.io/@pomlight/pomlight)
[![npm version](https://img.shields.io/npm/v/@pomlight/pomlight.svg)](https://www.npmjs.com/package/@pomlight/pomlight)
[![PyPI version](https://img.shields.io/pypi/v/pomlight.svg)](https://pypi.org/project/pomlight/)

Lightweight multi-runtime implementations of [POML](https://microsoft.github.io/poml/latest/) — a structured markup language for LLM prompt engineering.

## Packages

| Package | Runtime | Registry |
|---|---|---|
| [packages/deno](packages/deno/README.md) | Deno / Node | `jsr:@pomlight/pomlight` |
| [packages/python](packages/python/README.md) | Python | `pomlight` on PyPI |

## Features

Most features are covered; advanced use cases from the official POML spec are intentionally excluded. See [FeatureCoverage](FeatureCoverage.md) for details. Notable exclusions include binary file parsing (PDF, DOCX, XLSX), webpage fetching, image resizing, and token/character limits.

## License

[MIT](LICENSE)

