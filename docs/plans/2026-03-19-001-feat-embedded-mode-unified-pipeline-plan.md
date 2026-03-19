---
title: "feat: Embedded mode & unified conversion pipeline"
type: feat
status: active
date: 2026-03-19
origin: docs/brainstorms/2026-03-19-embedded-mode-requirements.md
---

# Embedded Mode & Unified Conversion Pipeline

## Overview

Add embedded mode support to Lark and unify all CalcMark conversion pipelines behind a single go-calcmark library function. Embedded mode processes standard Markdown with ` ```cm ` / ` ```calcmark ` fenced code blocks — each block is evaluated independently and replaced with formatted output, while surrounding prose passes through unchanged.

This is a cross-repo feature: the primary work is in **go-calcmark** (library API + CLI updates), with **calcmark-lark** consuming the new API.

## Problem Statement / Motivation

1. Lark cannot process embedded CalcMark documents (`.md` files with cm blocks) — only pure `.cm` input works today.
2. Lark's `handleConvert` duplicates go-calcmark's parse → evaluate → format pipeline instead of calling a single library function.
3. The `cm convert --embedded` command only outputs Markdown — no HTML support, making it unusable for web preview or `cm watch`.
4. `cm watch` only supports `.cm` files.

Unifying the pipeline eliminates duplication across 4 call sites (`runConvert`, `runConvertEmbedded`, `handleConvert`, `renderFile`) and makes future format/mode additions trivial.

(see origin: `docs/brainstorms/2026-03-19-embedded-mode-requirements.md`)

## Proposed Solution

A new top-level `calcmark.Convert(input string, opts Options) (string, error)` function in go-calcmark that handles both cm and embedded pipelines, all output formats, locale configuration, and optional template wrapping. All consumers (CLI, watch server, Lark) call this single function.

### Architecture

```
                         calcmark.Convert(input, opts)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              opts.Mode == CM              opts.Mode == Embedded
                    │                               │
            NewDocument(input)              embedded.Scan(input)
            Evaluate(doc)                   for each CalcMarkBlock:
            GetFormatter(format)              NewDocument(block)
            formatter.Format(doc)             Evaluate(doc)
                    │                         MarkdownFormatter.Format(doc)
                    │                       reassemble markdown
                    │                               │
                    │                    ┌───────────┴──────────┐
                    │                    │                      │
                    │              format == "md"         format == "html"
                    │              return as-is           goldmark.Convert()
                    │                                          │
                    └──────────────────┬───────────────────────┘
                                       │
                              opts.Template set?
                           ┌────yes────┴────no────┐
                           │                      │
                    execute template          return fragment
                    return full doc
```

### Key Design Decisions Carried Forward

- **go-calcmark owns all conversion pipelines** — single library API with template injection. Lark is a thin display layer. (see origin)
- **HTML output returns fragments by default** — no `<html>`/`<head>`/`<body>`. An optional Go template wraps fragments into full documents with caller-supplied CSS/JS. (see origin)
- **Explicit mode toggle, not auto-detection** — no content sniffing. Mode set by toggle or example selection. (see origin)
- **Preview panel is mode-agnostic** — the iframe renders whatever HTML the backend produces. (see origin)
- **All existing CLI flags preserved** — `--output/-o`, `--to`, `--template`, `--locale`. No breaking changes. (see origin)
- **Blocks are evaluated independently** — each cm block in an embedded document gets a fresh evaluator. No shared variable scope across blocks. This matches the current `cm convert --embedded` behavior (see `cmd/calcmark/cmd/embedded.go:62-73`).

### Critical Decisions Resolved During Planning

**Template data contract for embedded mode:**
The current `lark.gohtml` expects structured data (`.Frontmatter`, `.Blocks`). Goldmark produces a flat HTML string. Resolution: add a `{{if .Content}}` path to the template. When the library renders embedded HTML with a template, it passes `{Content: "<goldmark html>"}`. The template renders it directly. When rendering cm HTML, the existing `.Blocks` path runs. This keeps one template file and lets the library control the data shape.

```gotemplate
{{if .Content}}
{{/* Embedded mode: goldmark-rendered HTML fragment */}}
<div class="embedded-content">{{.Content}}</div>
{{else}}
{{/* cm mode: structured block rendering */}}
{{if .Frontmatter}}...{{end}}
{{range .Blocks}}...{{end}}
{{end}}
```

**Partial evaluation failures return 200:**
When an embedded document has N blocks and some fail, the library returns the full output with inline error blockquotes (`> **CalcMark Error:** ...`) AND a non-nil error (for logging). Lark's handler returns HTTP 200 — the inline errors are part of the rendered document. Only total failures (e.g., empty input) return 4xx.

**URL hash format for embedded mode:**
`#0:<payload>` = cm mode (backwards-compatible). `#1:<payload>` = embedded mode. The version prefix becomes a mode discriminator. Old URLs continue to work.

**Auto-switch in both directions:**
Selecting a `.md` example auto-sets Embedded mode. Selecting a `.cm` example auto-sets CalcMark mode. This prevents the broken state of cm source with `embedded=true`.

**Render cache includes mode:**
The frontend's `lastRenderedSource` cache key must include the mode to prevent stale output when toggling.

**`cm` CLI button hidden in embedded mode:**
The `/d/<payload>` endpoint doesn't support embedded mode (explicitly out of scope), so the `cm remote` button is hidden to avoid confusion.

**Goldmark sanitization:**
Use goldmark's default behavior — raw HTML in Markdown is escaped. Safe for the sandboxed preview iframe.

## Technical Considerations

### Formatter result alignment gotcha
When iterating source lines alongside evaluation results, always use a separate `resultIdx` counter — blank lines in source cause index drift if using the loop index directly. (from `docs/solutions/ui-bugs/tui-mode-transitions-formatter-indexing-and-bracketed-paste-fixes.md`)

### Goldmark dependency promotion
Goldmark (`github.com/yuin/goldmark`) is currently test-only in go-calcmark. Promoting to runtime adds ~0 external dependencies (goldmark is pure Go, zero deps). Use `goldmark.WithExtensions(extension.GFM)` for GFM table support — embedded documents with CalcMark table output need this.

### Template string vs parsed template
The library accepts template content as a `string` (current pattern in `format.Options.Template`). The library parses the template on each call. For Lark (one template, many calls), the cost is negligible — Go template parsing is fast and the template is small. No caching needed.

### Embedded CSS for goldmark output
The `lark.gohtml` template's CSS styles elements inside `.text-block` and `.calc-block` wrappers. Goldmark output produces bare `<h1>`, `<p>`, `<table>`, `<blockquote>` elements. The embedded content wrapper (`<div class="embedded-content">`) needs CSS rules targeting these bare elements. Reuse the existing `.text-block` styles by duplicating selectors for `.embedded-content`.

## System-Wide Impact

- **Interaction graph**: `calcmark.Convert()` calls into `document.NewDocument()` → `document.NewEvaluator()` → `format.Formatter.Format()` (cm mode) OR `embedded.Scan()` → per-block eval → `goldmark.Convert()` (embedded mode). Template execution is the final optional step. No callbacks, middleware, or observers.
- **Error propagation**: Library returns `(string, error)`. Non-nil error with non-empty string = partial success (embedded mode inline errors). Non-nil error with empty string = total failure. Lark maps: partial → 200, total → 400.
- **State lifecycle risks**: No persistent state. All conversion is stateless — input in, output out.
- **API surface parity**: After this change, Lark, `cm convert`, `cm watch` all use `calcmark.Convert()`. The existing `format.Formatter` interface remains exported for direct use by third parties.
- **Integration test scenarios**: (1) Lark POST with `embedded=true` returns styled HTML; (2) `cm convert --embedded --to html` produces valid goldmark HTML; (3) `cm watch budget.md` serves live preview; (4) existing cm-mode Lark behavior unchanged.

## Acceptance Criteria

### Phase 1: go-calcmark library (primary work)

- [ ] `calcmark.Convert()` top-level function exists with `Options{Mode, Format, Template, Locale}` — **`convert.go` (new file at package root)**
- [ ] T1–T10 test scenarios from requirements doc all pass — **`convert_test.go`**
- [ ] `cm convert --embedded --to html` produces goldmark HTML fragment — **`cmd/calcmark/cmd/embedded.go`**
- [ ] `cm convert --embedded --to html --template x.gohtml` wraps fragment in template — **`cmd/calcmark/cmd/embedded.go`**
- [ ] `cm convert --embedded file.md` (no `--to`) still produces evaluated Markdown (no regression)
- [ ] `--output/-o` flag works with embedded HTML output
- [ ] `cm watch budget.md` detects `.md` and uses embedded pipeline with watch template — **`cmd/calcmark/cmd/watch.go`**
- [ ] `cm convert` and `cm watch` refactored to use `calcmark.Convert()` internally
- [ ] goldmark promoted from test-only to runtime dependency in `go.mod`
- [ ] Existing `cm convert` behavior for `.cm` files unchanged (regression tests pass)

### Phase 2: Lark backend

- [ ] `handleConvert` refactored to call `calcmark.Convert()` — **`handler.go`**
- [ ] `/api/convert?embedded=true` query parameter supported
- [ ] `lark.gohtml` template gains `{{if .Content}}` path for embedded HTML — **`lark.gohtml`**
- [ ] `.embedded-content` CSS styles added for goldmark HTML elements — **`lark.gohtml`**
- [ ] Existing cm-mode Lark behavior unchanged (regression test)
- [ ] Partial eval failures in embedded mode return HTTP 200 with inline errors

### Phase 3: Lark frontend

- [ ] Mode toggle ("CalcMark | Embedded") visible near editor — **`static/index.html`**
- [ ] Toggle sends `&embedded=true` on API calls when active
- [ ] `.md` examples added to dropdown with `<optgroup>` separation — **`static/index.html`**
- [ ] Selecting `.md` example auto-sets Embedded mode
- [ ] Selecting `.cm` example auto-sets CalcMark mode
- [ ] Text/JSON output modes hidden when in Embedded mode (auto-switch to Preview if active)
- [ ] Render cache key includes mode (prevents stale output on toggle)
- [ ] `cm` CLI button hidden in Embedded mode
- [ ] Shared URLs use `#1:<payload>` for embedded mode, `#0:` for cm mode (backwards-compatible)
- [ ] Loading a `#0:` URL sets CalcMark mode; loading `#1:` sets Embedded mode
- [ ] Mobile-responsive: toggle fits existing mobile layout

## Implementation Phases

### Phase 1: go-calcmark unified API + embedded HTML (primary work)

This is the bulk of the feature. TDD throughout — write tests first per project convention.

#### 1a. `calcmark.Convert()` function for cm mode

New file `convert.go` at package root. Start with cm mode only — wrapping the existing parse → evaluate → format pipeline.

```go
// convert.go — package calcmark (new file)
package calcmark

// Mode selects the conversion pipeline.
type Mode int

const (
    CM       Mode = iota // Pure CalcMark input
    Embedded             // Markdown with embedded cm blocks
)

// Options configures the conversion pipeline.
type Options struct {
    Mode     Mode   // CM or Embedded
    Format   string // "html", "md", "text", "json" (default: "html")
    Template string // Go template content for wrapping HTML output
    Locale   string // BCP 47 locale (default: "en-US")
}

// Convert processes CalcMark input and returns formatted output.
func Convert(input string, opts Options) (string, error) { ... }
```

**Test file: `convert_test.go`**
- T1: cm mode, markdown output
- T2: cm mode, html with template
- T3: cm mode, html without template (fragment)
- T10: locale option

#### 1b. Embedded mode Markdown output via `Convert()`

Wire the existing `embedded.Scan()` + `evalBlock()` logic into `Convert()` for embedded mode with `Format: "md"`.

**Tests:**
- T4: embedded mode, markdown output
- T8: embedded mode, block error → inline error blockquote
- T9: embedded mode, frontmatter preserved

#### 1c. Embedded mode HTML output via goldmark

Add goldmark as a runtime dependency. After reassembling the evaluated Markdown, convert to HTML via `goldmark.New(goldmark.WithExtensions(extension.GFM)).Convert()`.

**Tests:**
- T5: embedded mode, html fragment
- T6: embedded mode, html with template
- T7: embedded mode, no cm blocks → passthrough

#### 1d. Refactor CLI to use `calcmark.Convert()`

Refactor `runConvert` and `runConvertEmbedded` in `cmd/calcmark/cmd/` to call `calcmark.Convert()`. Update `--embedded --to html` to be valid (currently rejected). Preserve `--output/-o` and stdout behavior.

**Tests:**
- CLI integration tests: `cm convert --embedded --to html testdata/examples/embedded-datacenter-cost.md`
- Regression: all existing `cm convert` tests pass

#### 1e. `cm watch` embedded support

In `watch.go`, detect `.md` extension. Replace `renderFile()` with a call to `calcmark.Convert(source, Options{Mode: Embedded, Format: "html"})`. Wrap the HTML fragment in the existing `watchPageTemplate`.

**Tests:**
- `cm watch` with `.md` file serves goldmark HTML in live preview
- `cm watch` with `.cm` file unchanged (regression)

### Phase 2: Lark backend refactor

Depends on Phase 1 (go-calcmark bump).

#### 2a. `handleConvert` simplification

Replace the 12-line parse → evaluate → format pipeline in `handler.go` with a call to `calcmark.Convert()`. Pass `larkHTMLTemplate` for HTML format, `embedded=true` query param maps to `calcmark.Embedded` mode.

**Before (handler.go:70-105):**
```go
doc, err := document.NewDocument(source)
evaluator := impldoc.NewEvaluator()
evaluator.Evaluate(doc)
formatter := format.GetFormatter(internalFormat, "")
if internalFormat == "html" { opts.Template = larkHTMLTemplate }
formatter.Format(&buf, doc, opts)
```

**After:**
```go
mode := calcmark.CM
if r.URL.Query().Get("embedded") == "true" { mode = calcmark.Embedded }
result, err := calcmark.Convert(source, calcmark.Options{
    Mode:     mode,
    Format:   internalFormat,
    Template: larkHTMLTemplate, // only applied by library for html format
    Locale:   locale,
})
```

**Tests:**
- `POST /api/convert?format=html&embedded=true` with markdown input returns styled HTML
- `POST /api/convert?format=html` with cm input returns styled HTML (regression)
- `POST /api/convert?format=markdown&embedded=true` returns evaluated markdown
- Partial eval failure in embedded mode returns HTTP 200

#### 2b. Template update

Add `{{if .Content}}` path to `lark.gohtml`. Add `.embedded-content` CSS styles duplicating `.text-block` rules for bare HTML elements.

**Tests:**
- Embedded HTML output has proper styling (headings, tables, blockquotes, code blocks)
- cm HTML output unchanged (regression)

### Phase 3: Lark frontend

Depends on Phase 2 (backend embedded support).

#### 3a. Mode toggle

Add a segmented control near the editor textarea. JavaScript tracks mode state and appends `&embedded=true` to API calls.

#### 3b. Example list update

Add `.md` examples using `<optgroup label="Embedded">`. Each example entry includes its file extension. Example loading function detects extension and auto-sets mode toggle. Selecting `.cm` example auto-resets to CalcMark mode.

#### 3c. Output mode gating

When mode is Embedded, hide Text and JSON from the output dropdown. If the user was viewing Text/JSON, auto-switch to Preview. Restore previous selection when switching back to CalcMark.

#### 3d. Sharing with mode

Update hash format: `#0:` = cm (unchanged), `#1:` = embedded. On load, hash prefix determines mode. Hide `cm` CLI button in embedded mode.

#### 3e. Cache fix

Add mode to the render cache key so toggling modes with identical content triggers a fresh render.

## Success Metrics

- All T1–T10 library test scenarios pass
- Lark's `handleConvert` is reduced from ~40 lines of pipeline logic to ~10 lines
- `cm watch budget.md` renders embedded documents with live reload
- No regressions in existing cm-mode behavior across CLI and Lark
- Existing shared URLs (`#0:`) continue to work

## Dependencies & Prerequisites

- **go-calcmark v1.9.0** (or similar) — the go-calcmark changes must be released before Lark can consume them
- **goldmark** — promoted from test-only to runtime dep in go-calcmark. Pure Go, zero external deps.
- Phase ordering: Phase 1 (go-calcmark) → Phase 2 (Lark backend) → Phase 3 (Lark frontend)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `lark.gohtml` template dual-path introduces rendering bugs in cm mode | Medium | High | Regression tests for existing cm HTML output before and after template change |
| goldmark output styling doesn't match Lark design language | Medium | Medium | Reuse existing `.text-block` CSS rules for `.embedded-content` container |
| Performance regression with goldmark on large embedded docs | Low | Medium | The 5s backend timeout provides a natural ceiling; goldmark is fast (pure Go) |
| Breaking existing `cm convert --embedded` behavior | Low | High | TDD — existing embedded tests run first, new tests added incrementally |
| Stale render cache after mode toggle | Medium | Medium | Add mode to cache key (Phase 3e) |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-19-embedded-mode-requirements.md](docs/brainstorms/2026-03-19-embedded-mode-requirements.md) — Key decisions carried forward: unified go-calcmark API, fragment-by-default with optional template wrapping, explicit mode toggle, all CLI flags preserved.

### Internal References

- Existing embedded pipeline: `go-calcmark/cmd/calcmark/cmd/embedded.go` — `runConvertEmbedded()`, `evalBlock()`
- Embedded scanner: `go-calcmark/impl/embedded/scanner.go` — `Scan()`, `Segment` types
- Current Lark handler: `calcmark-lark/handler.go:38-114` — pipeline to simplify
- Lark template: `calcmark-lark/lark.gohtml` — structured `.Blocks`/`.Frontmatter` data model
- HTMLFormatter template data: `go-calcmark/format/html_formatter.go:59-101` — `TemplateBlock`, `TemplateFrontmatter`
- Watch server: `go-calcmark/cmd/calcmark/cmd/watch.go:252-273` — `renderFile()`
- Frontend examples/sharing: `calcmark-lark/static/index.html:376-396, 680-776`
- Embedded mode plan (completed): `go-calcmark/docs/plans/2026-03-18-002-feat-embedded-mode-convert-plan.md`

### Institutional Learnings

- Formatter result alignment: use separate `resultIdx` counter for blank line drift (`docs/solutions/ui-bugs/tui-mode-transitions-formatter-indexing-and-bracketed-paste-fixes.md`)
- Cross-layer type additions touch 8 layers (`docs/solutions/logic-errors/adding-new-type-fraction-cross-layer-checklist.md`)
- Viper `IsSet()` cannot distinguish embedded defaults from user config (`docs/solutions/logic-errors/viper-isset-embedded-defaults-deprecation.md`)

### External References

- goldmark: `github.com/yuin/goldmark` — CommonMark-compliant Go Markdown parser/renderer
