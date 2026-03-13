---
title: "feat: CalcMark Lark Web Converter"
type: feat
status: active
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-calcmark-lark-brainstorm.md
---

# CalcMark Lark Web Converter

## Overview

A single Go binary that serves a web-based CalcMark document converter. Users paste CalcMark text, pick an output format (HTML, Markdown, plain text, JSON), click Convert, and get the result. Short documents can be shared via URL.

Part of the CalcMark GitHub org: `github.com/CalcMark/calcmark-lark`.

## Project Structure

```
calcmark-lark/
├── main.go              # Entry point, HTTP server, embed directive
├── handler.go           # /api/convert handler
├── ratelimit.go         # Per-IP in-memory rate limiter
├── static/
│   └── index.html       # Single-page frontend (inline CSS + JS)
├── Dockerfile           # Multi-stage: build Go, copy into alpine
├── fly.toml             # Fly.io config
├── go.mod
├── go.sum
└── docs/
    ├── brainstorms/
    └── plans/
```

## Go Service

### `main.go`

```go
package main

import (
    "embed"
    "io/fs"
    "log"
    "net/http"
    "os"
    "time"
)

//go:embed static
var staticFS embed.FS

func main() {
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }

    mux := http.NewServeMux()

    // API
    limiter := NewIPRateLimiter(60, 10) // 60 req/min, burst 10
    mux.Handle("/api/convert", limiter.Middleware(
        TimeoutHandler(http.HandlerFunc(handleConvert), 5*time.Second),
    ))

    // Static frontend
    sub, _ := fs.Sub(staticFS, "static")
    mux.Handle("/", http.FileServer(http.FS(sub)))

    log.Printf("listening on :%s", port)
    log.Fatal(http.ListenAndServe(":"+port, mux))
}
```

### `handler.go` — POST /api/convert

- Reads body via `http.MaxBytesReader` (1MB limit)
- Reads `?format=` query param (default: `html`)
- Calls `document.NewDocument(source)` then `implDoc.NewEvaluator().Evaluate(doc)`
- Renders to requested format
- Returns result with appropriate `Content-Type`

**Error response contract** (JSON for all errors):

| Status | Meaning | Body |
|---|---|---|
| 200 | Success | Converted output (text/html, text/markdown, text/plain, or application/json) |
| 400 | Empty input, invalid format, or CalcMark parse error | `{"error": "description"}` |
| 413 | Input exceeds 1MB | `{"error": "input too large (max 1MB)"}` |
| 429 | Rate limited | `{"error": "too many requests, try again shortly"}` |
| 500 | Unexpected server error | `{"error": "internal error"}` |
| 503 | Timeout (5s exceeded) | `{"error": "evaluation timed out"}` |

**Valid formats:** `html`, `markdown`, `text`, `json`. Unknown format → 400.

### `ratelimit.go` — Per-IP Token Bucket

- Uses `golang.org/x/time/rate`
- Map of IP → `*rate.Limiter`, protected by `sync.RWMutex`
- Stale entries cleaned up on a timer (every 5 min, drop entries not seen in 10 min)
- Returns 429 JSON error when limit exceeded

### Dependencies

```
github.com/CalcMark/go-calcmark  (latest)
golang.org/x/time                (for rate.Limiter)
```

No other dependencies. Standard library for HTTP, JSON, embed.

## Frontend — `static/index.html`

Single HTML file with inline `<style>` and `<script>`. No build tools, no external fetches (fonts loaded from CDN with fallback to system fonts).

### Layout

```
┌──────────────────────────────────────────┐
│  🐦 CalcMark Lark          [☀/🌙]       │  ← nav bar
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Paste CalcMark here...             │  │  ← textarea
│  │                                    │  │
│  │                                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [HTML ▾]  [Convert]  [Share]            │  ← controls
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Output appears here                │  │  ← output (pre/code block)
│  │                                    │  │
│  └──────────────────────── [Copy] ──┘  │
│                                          │
├──────────────────────────────────────────┤
│  CalcMark · calcmark.org                 │  ← footer
└──────────────────────────────────────────┘
```

### Design System (from brainstorm: calcmark.org site)

Inline the CalcMark CSS variables directly in the `<style>` block:

- **Brand purple:** `#7D56F4` / dark: `#a371f7`
- **Fonts:** Inter (Google Fonts CDN), JetBrains Mono (Google Fonts CDN), system fallbacks
- **Dark mode:** `[data-theme="dark"]` with localStorage persistence
- **Default theme:** Follow `prefers-color-scheme`, then localStorage override
- **Anti-FOUC:** Inline `<script>` in `<head>` sets `data-theme` before first paint (same pattern as calcmark.org's `theme.js`)
- **Favicon:** Inline the lark `favicon.svg` as a data URI in `<link rel="icon">`
- **Lark mascot:** Inline `lark-color.svg` in the nav bar

### Behavior

**Convert button:**
1. Disabled when textarea is empty (client-side check)
2. On click: disable button, show "Converting..." text
3. `fetch('/api/convert?format=' + selected, { method: 'POST', body: textarea.value })`
4. On success: show output in `<pre><code>` block, enable Copy button
5. On error: show error message from JSON response in output area (styled as error)
6. Re-enable button when done
7. **All output is displayed as source text** — HTML output is shown as raw HTML source, never rendered. No XSS risk.

**Share button:**
1. Disabled when textarea is empty
2. On click: compress textarea content via `CompressionStream('deflate')` → base64url encode
3. Format: `#0:<format>:<payload>` — version prefix `0`, selected format, then compressed data
4. If full URL length > 2000 chars: show inline message "Document too large to share via URL" (auto-dismiss after 3s)
5. If OK: `history.replaceState` to update URL hash (no history entry added), copy URL to clipboard
6. **Clipboard fallback:** If `navigator.clipboard` is unavailable or denied, show a readonly input with the URL and "Copy manually" label
7. Show "Copied!" confirmation (auto-dismiss after 2s)

**On page load (shared URL):**
1. If `location.hash` exists and starts with `#0:`
2. Decode: extract format and payload, base64url decode → `DecompressionStream('deflate')`
3. **Cap decompressed size at 1MB** — abort and show error if exceeded (decompression bomb guard)
4. If decode succeeds: populate textarea, set format selector, enable Convert button
5. If decode fails (malformed, truncated, not UTF-8): show toast "Could not decode shared document" and leave textarea empty
6. Does NOT auto-convert — user clicks Convert

**Format selector:**
- Dropdown: HTML (default), Markdown, Text, JSON
- Default format: `html` (unless overridden by shared URL)
- Not persisted to localStorage (not worth the complexity)

**Copy Output button:**
- Appears after successful conversion
- Copies output text to clipboard
- Same clipboard fallback as Share

**Output area:**
- Hidden before first conversion
- Shows `<pre><code>` with monospace font after conversion
- Error states shown with warning color border

### Accessibility

- Semantic HTML: `<main>`, `<nav>`, `<footer>`, `<label>` for textarea and select
- `aria-live="polite"` region for output area (announces results to screen readers)
- All buttons keyboard-accessible (native `<button>` elements)
- Focus moves to output area after conversion completes

## Deployment

### Dockerfile

```dockerfile
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /lark .

FROM alpine:3.21
COPY --from=build /lark /lark
EXPOSE 8080
CMD ["/lark"]
```

Alpine (not scratch) for DNS resolution and TLS certificates.

### fly.toml

```toml
app = "calcmark-lark"
primary_region = "ord"

[build]

[http_service]
  internal_port = 8080
  force_https = true

[[http_service.checks]]
  grace_period = "5s"
  interval = "30s"
  method = "GET"
  path = "/"
  timeout = "5s"
```

### Deploy Flow

1. `fly launch` (one-time setup — creates app, auto-detects Dockerfile)
2. Connect GitHub repo via Fly dashboard → auto-deploy on push to `main`
3. `fly certs add lark.calcmark.org`
4. Add DNS: `lark CNAME calcmark-lark.fly.dev` to calcmark.org DNS provider

Zero yak-shaving after initial setup. Push to main = deployed.

### Environment

Only `PORT` (set automatically by Fly.io). No other env vars needed.

## Acceptance Criteria

- [x] `go build .` produces a single binary with embedded frontend
- [x] `POST /api/convert` with CalcMark body returns converted output in requested format
- [x] `POST /api/convert` with empty body returns 400
- [x] `POST /api/convert` with unknown format returns 400
- [ ] `POST /api/convert` with body > 1MB returns 413
- [ ] Requests exceeding 60/min per IP return 429
- [ ] Requests exceeding 5s evaluation time return 503
- [ ] Frontend loads as a single page with no external JS/CSS dependencies (fonts are CDN but have system fallbacks)
- [ ] Light/dark theme toggle works and persists across reloads
- [ ] Share button produces a URL with encoded document in hash fragment
- [ ] Shared URLs decode and populate the textarea on page load
- [ ] Share button shows "too large" message for documents that compress to > 2000 char URLs
- [ ] Malformed shared URLs show an error message, not a blank page
- [ ] Copy Output button copies result to clipboard
- [ ] All output displayed as source text (HTML is never rendered/executed)
- [ ] Deploys on `git push` to main via Fly.io

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-12-calcmark-lark-brainstorm.md](../brainstorms/2026-03-12-calcmark-lark-brainstorm.md) — all architecture, deployment, theming, and UX decisions carried forward
- **CalcMark Go package:** `github.com/CalcMark/go-calcmark` — document-level API (`spec/document`, `impl/document`)
- **CalcMark site theming:** `github.com/CalcMark/go-calcmark/tree/main/site/assets/css/` — CSS variables, components, dark mode tokens
- **CalcMark assets:** `lark-color.svg`, `lark.svg`, `favicon.svg` from site assets
