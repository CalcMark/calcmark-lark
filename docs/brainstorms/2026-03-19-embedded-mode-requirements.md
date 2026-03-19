---
date: 2026-03-19
topic: embedded-mode
---

# Embedded Mode & Unified Conversion Pipeline

## Problem Frame

CalcMark's embedded mode lets users write standard Markdown with ```` ```cm ```` / ```` ```calcmark ```` fenced code blocks that get evaluated inline. The go-calcmark CLI already supports this (`calcmark convert --embedded`), and the `testdata/examples/` directory now includes `.md` files. Lark currently only handles pure CalcMark (`.cm`) input — it cannot process embedded documents.

Additionally, Lark's backend currently duplicates go-calcmark's conversion pipeline (parse → evaluate → format) rather than calling a single library function. This work is an opportunity to unify both the cm and embedded pipelines behind a single go-calcmark API, making Lark a thin display layer.

## Requirements

### go-calcmark library (primary work)

- R1. **Unified conversion API** — go-calcmark exposes a library-level function that handles both cm and embedded conversion pipelines. It accepts input text, mode (cm or embedded), output format (html, md, text, json), and options (including an optional Go template for wrapping HTML output). By default, HTML output returns a **fragment** (no `<html>`/`<head>`/`<body>` wrapper). When a template is provided, the fragment is wrapped into a full document — this is how callers inject their own CSS and JS. Lark, `cm convert`, and `cm watch` all use this function.
- R2. **Embedded HTML output via goldmark** — The embedded pipeline gains HTML output support (currently Markdown-only). Goldmark converts the reassembled Markdown (passthrough prose + evaluated CalcMark block results) to an HTML fragment. goldmark becomes a runtime dependency in go-calcmark (currently test-only). The existing `--template` pattern for cm → HTML extends to embedded → HTML.
- R3. **`cm convert --embedded` gains `--to html`** — `cm convert --embedded file.md --to html` produces an HTML fragment. `cm convert --embedded file.md --to html --template x.gohtml` wraps it. `cm convert --embedded file.md` continues to produce evaluated Markdown (current behavior). `--output/-o` for writing to a file and stdout as default are preserved — no changes to existing flag behavior.
- R4. **`cm watch` supports `.md` files** — `cm watch budget.md` detects the `.md` extension and uses the embedded pipeline for live preview. The watch server's built-in template wraps the goldmark HTML fragment. No new flags needed — extension-based detection is sufficient for the CLI.

### go-calcmark library test expectations

The library API should be testable with straightforward Go calls. These test scenarios define the expected behavior:

```go
// T1. cm mode, markdown output (existing behavior, must not regress)
result, err := calcmark.Convert("price = 100 USD\ntax = 8.5%\ntotal = price + tax", calcmark.Options{
    Format: "md",
})
// result contains evaluated markdown with results annotations

// T2. cm mode, html output with template (existing behavior via library)
result, err := calcmark.Convert("price = 100 USD", calcmark.Options{
    Format:   "html",
    Template: larkTemplate, // *template.Template or template string
})
// result contains full HTML document wrapped in template

// T3. cm mode, html output without template → fragment
result, err := calcmark.Convert("price = 100 USD", calcmark.Options{
    Format: "html",
})
// result contains HTML fragment (<table>...</table>), no <html>/<body>

// T4. embedded mode, markdown output (current --embedded behavior)
input := "# Budget\n\n```cm\nprice = 100 USD\n```\n\nSome prose."
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:   calcmark.Embedded,
    Format: "md",
})
// result: "# Budget\n\n| Variable | Value |\n|...|...|\n\nSome prose."
// CalcMark blocks replaced with evaluated output, prose unchanged

// T5. embedded mode, html fragment (new)
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:   calcmark.Embedded,
    Format: "html",
})
// result: "<h1>Budget</h1><table>...</table><p>Some prose.</p>"
// Goldmark-rendered HTML fragment, no wrapper

// T6. embedded mode, html with template (new — what Lark uses)
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:     calcmark.Embedded,
    Format:   "html",
    Template: larkTemplate,
})
// result: full HTML document with CSS/JS from template, goldmark content inside

// T7. embedded mode, no calcmark blocks → passthrough
input := "# Just Markdown\n\nNo calcmark here."
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:   calcmark.Embedded,
    Format: "html",
})
// result: "<h1>Just Markdown</h1><p>No calcmark here.</p>"

// T8. embedded mode, block with evaluation error → inline error
input := "```cm\nx = 1/0\n```"
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:   calcmark.Embedded,
    Format: "md",
})
// result contains "> **CalcMark Error:**" blockquote, err is non-nil

// T9. embedded mode preserves frontmatter passthrough
input := "---\ntitle: Test\n---\n\n# Doc\n\n```cm\nx = 42\n```"
result, err := calcmark.Convert(input, calcmark.Options{
    Mode:   calcmark.Embedded,
    Format: "md",
})
// result starts with "---\ntitle: Test\n---" (frontmatter preserved)

// T10. locale option works in both modes
result, err := calcmark.Convert("price = 1234.56 EUR", calcmark.Options{
    Format: "md",
    Locale: "de-DE",
})
// result uses German formatting: "1.234,56 €"
```

### Lark backend

- R5. **Simplified handler with embedded support** — Lark's `handleConvert` is refactored to call the unified go-calcmark conversion function instead of orchestrating parse → evaluate → format itself. It becomes a thin wrapper: read input, call library with template + mode + format, write response. `/api/convert` accepts a new `embedded=true` query parameter to select embedded mode. All existing behavior (Content-Type headers, error responses, rate limiting) applies unchanged.

### Lark frontend

- R6. **Mode toggle in UI** — A visible toggle near the editor (e.g., "CalcMark | Embedded") lets users switch between pure CalcMark and embedded mode. The toggle controls which mode is sent to `/api/convert`. The selected mode persists for the session.
- R7. **Example list includes `.md` files with auto-switch** — The example dropdown includes embedded examples (`.md` files from `testdata/examples/`), visually distinguishable from pure CalcMark examples. Each entry specifies its file type. Selecting an `.md` example automatically sets the mode to Embedded.
- R8. **Output modes in embedded mode** — Preview and Markdown output modes work in embedded mode. Preview shows the rendered HTML. Markdown shows the evaluated Markdown (passthrough prose + formatted CalcMark results). HTML mode shows the rendered HTML source. Text and JSON are disabled or hidden when embedded mode is active.
- R9. **Sharing works with embedded mode** — Shared URLs (hash-based compression) preserve the embedded mode flag so recipients see the document in the correct mode.

## Success Criteria

- A user can paste a Markdown document with ```` ```cm ```` blocks, toggle to Embedded mode, and see a fully rendered preview with evaluated calculations inline.
- Selecting an `.md` example auto-switches to embedded mode and renders correctly in Preview.
- Switching back to CalcMark mode and selecting a `.cm` example works as before — no regressions.
- Lark's `handleConvert` is materially simpler after the refactor — pipeline logic lives in go-calcmark.
- `cm watch budget.md` renders a live HTML preview of an embedded document.
- All test scenarios T1–T10 pass, confirming the library API works for both modes.

## Scope Boundaries

- **Not building**: A WYSIWYG markdown editor. The textarea stays as-is.
- **Not building**: Mixed-mode auto-detection from content. Mode is explicit (toggle or example-driven).
- **Not building**: Embedded mode support for the `/d/<payload>` endpoint (can be added later).
- **Not building**: Custom goldmark extensions beyond standard CommonMark rendering.
- **Preserving**: All existing CLI flags (`--output/-o`, `--to`, `--template`, `--locale`). No breaking changes to `cm convert` behavior.

## Key Decisions

- **go-calcmark owns all conversion pipelines**: Both cm and embedded pipelines are exposed as a single library API. HTML output returns fragments by default; an optional Go template wraps fragments into full documents with caller-supplied CSS/JS. Lark, `cm convert`, `cm watch` all use the same function.
- **Explicit mode toggle, not auto-detection**: Users explicitly choose embedded mode via toggle or it's set automatically by example selection. No content sniffing.
- **Preview panel is mode-agnostic**: The iframe just renders whatever HTML the backend produces. Zero frontend preview changes.

## Dependencies / Assumptions

- go-calcmark exposes a unified library-level conversion function. This needs to be added as part of this work.
- goldmark is promoted from test-only to runtime dependency in go-calcmark.
- The existing `--template` flag and `--output/-o` flag in `cm convert` extend naturally to embedded mode.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] What should the unified API signature look like? A single `calcmark.Convert(input string, opts Options) (string, error)` at the package level, or a method on a new `Converter` type? The test scenarios above assume the former.
- [Affects R2][Needs research] Does the existing `lark.gohtml` template work for goldmark HTML output, or does embedded output need its own template for styling prose + calculations together?
- [Affects R8][Technical] Should Text/JSON modes show an inline message ("not available in embedded mode") or simply be hidden from the dropdown?
- [Affects R7][Technical] How to distinguish embedded examples in the dropdown — label suffix like "(Embedded)", a separator, or grouped sections?

## Next Steps

→ `/ce:plan` for structured implementation planning
