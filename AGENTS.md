# Project Notes

## Lint & format

Ultracite (Biome) enforces the code standards; config lives in `biome.json`.

- `bunx ultracite fix`: run before committing. No pre-commit hook runs it for you.
- `bunx ultracite check` / `bunx ultracite doctor`

## Design Source

- **Figma (Betro App UI)**: https://www.figma.com/design/MiS0r5xYKVht3Pc7YXMXpP/Betro-App-UI
  - Pages: `Foundations` (color/dimension/transit variables), `Components`, `iOS`, `Android`
  - App UI must follow this file: reuse its variables (Color modes Dark/Light, Dimension, Transit) and components instead of hardcoding values.
