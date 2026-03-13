# CalcMark Lark — Brainstorm

**Date:** 2026-03-12
**Status:** Complete

## What We're Building

A thin Go web service + single-page frontend that lets users paste CalcMark documents and convert them to HTML, Markdown, plain text, or JSON. Shareable URLs can encode short documents in the hash fragment.

## Key Decisions

### Architecture
- **Single Go binary** serving both the API and embedded static frontend (`embed.FS`, no separate build step)
- **POST /api/convert** — accepts CalcMark text body, `?format=html|markdown|json|text`, returns converted output
- **GET /** — serves the frontend (single `index.html`)
- Uses `github.com/CalcMark/go-calcmark` document-level API (`document.NewDocument` + `implDoc.NewEvaluator().Evaluate`)
- Server evaluates entire CalcMark docs each time — nothing fancy, no progressive rendering

### Frontend
- **Single HTML file** with inline CSS and JS — no build tools, no frameworks
- **Button click to evaluate** (not auto-evaluate)
- Textarea for input, format selector (dropdown or tabs), output panel
- **Theming:** Reuse CalcMark's existing design tokens (variables.css) — brand purple `#7D56F4`, Inter + JetBrains Mono fonts, light/dark mode with `data-theme` attribute and localStorage persistence
- **Lark mascot SVG** inline from existing `lark-color.svg` asset
- **Favicon** from existing `favicon.svg`
- Share button that generates a URL or shows "too large" if doc exceeds URL limit

### URL-Encoded Documents
- **Deflate + base64url** in the hash fragment (e.g., `lark.calcmark.org/#compressed-data`)
- Client-side only using browser-native `CompressionStream`/`DecompressionStream` API
- Supports docs up to ~2-3KB of source text
- **Optional** — users can always paste up to 1MB via the normal POST flow without sharing
- On page load: if hash exists, decompress and populate textarea
- Share button: compress → base64url → update hash → copy URL to clipboard. If compressed result > ~2000 chars, show "too large to share via URL"

### Abuse Protections
- **1MB input size limit** via `http.MaxBytesReader`
- **5-second per-request timeout** via `context.WithTimeout`
- **Rate limiting** per IP (simple in-memory token bucket, e.g., `golang.org/x/time/rate`)
- No auth required

### Deployment
- **Fly.io** with `fly.toml` + Dockerfile (multi-stage: build Go binary, copy into scratch/alpine)
- **Deploy on git push** via Fly's GitHub integration (zero config after initial `fly launch`)
- **Domain:** `lark.calcmark.org` — CNAME to `<app>.fly.dev`, TLS auto-provisioned via `fly certs add`
- DNS: add `lark CNAME <app-name>.fly.dev` to calcmark.org DNS (doesn't conflict with GitHub Pages on apex)

### Design System (from calcmark.org)
- **Brand purple:** `#7D56F4` (dark mode: `#a371f7`)
- **Fonts:** Inter (sans), JetBrains Mono (mono)
- **Dark mode:** `[data-theme="dark"]` with full token set
- **Radius:** 4/6/12px
- **Shadows:** subtle (`0 1px 3px`) and medium (`0 4px 12px`)
- **Components to reuse:** `.btn`, `.btn-primary`, `.btn-secondary`, theme toggle, container pattern
- **Lark mascot:** pixel-art bird SVG available in color and monochrome

### What We're NOT Building
- No user accounts or auth
- No database or persistence
- No saved/stored documents (stateless)
- No auto-evaluate/debounce
- No build toolchain for frontend
- No progressive rendering

## Open Questions

None — all resolved through brainstorming.

## Next Steps

Run `/ce:plan` to produce implementation plan.
