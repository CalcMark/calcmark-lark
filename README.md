# CalcMark Lark

A web-based [CalcMark](https://calcmark.org) playground. Paste a CalcMark document, see a live preview, and export to HTML, Markdown, plain text, or JSON.

Try it at [lark.calcmark.org](https://lark.calcmark.org).

## Features

- Live preview with debounced rendering
- Export to HTML, Markdown, Text, JSON
- Shareable URLs — documents are compressed into the URL hash
- Dark mode with system preference detection
- Prebaked examples from the CalcMark test suite
- `cm` CLI integration via `/d/<payload>` endpoint
- Single binary with embedded frontend — no external dependencies at runtime

## Run locally

Requires [Go 1.25+](https://go.dev/dl/) and [Task](https://taskfile.dev).

```sh
git clone https://github.com/CalcMark/calcmark-lark.git
cd calcmark-lark
task run
```

Open [localhost:8080](http://localhost:8080).

### Available tasks

```
task build       # Build the binary
task run         # Build and run with --debug
task dev         # Watch mode — rebuild and restart on file changes
task test        # Run tests
task lint        # Run all linters (vet, staticcheck, modernize)
task release     # Full check — tidy, lint, test, build
task clean       # Remove build artifacts
```

## API

### POST /api/convert

Convert a CalcMark document to the specified format.

```sh
curl -X POST 'http://localhost:8080/api/convert?format=html' \
  -d 'price = 100 USD
tax = 8.5%
total = price + tax'
```

**Query parameters:**

| Parameter | Default | Values |
|-----------|---------|--------|
| `format`  | `html`  | `html`, `markdown`, `text`, `json` |

**Responses:**

| Status | Meaning |
|--------|---------|
| 200 | Converted output |
| 400 | Empty input, invalid format, or parse error |
| 413 | Input exceeds 1 MB |
| 429 | Rate limited |
| 405 | Method not allowed |

### GET /d/\<payload\>

Decode a shared document URL and return the raw CalcMark source as plain text. The payload is deflate-compressed, base64url-encoded CalcMark text — the same encoding used in the URL hash fragment.

```sh
# From the cm CLI:
cm remote --http https://lark.calcmark.org/d/<payload>
```

## Deploy

CalcMark Lark is designed for zero-config deployment. A multi-stage Dockerfile builds a static Go binary with the frontend embedded.

### Fly.io

```sh
fly launch        # One-time setup
fly deploy        # Or connect GitHub for auto-deploy on push
fly certs add lark.calcmark.org
```

Add a DNS CNAME: `lark → calcmark-lark.fly.dev`

### Docker

```sh
docker build -t calcmark-lark .
docker run -p 8080:8080 calcmark-lark
```

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8080`  | Listen port |

### Flags

| Flag      | Description |
|-----------|-------------|
| `--port`  | Listen port (overrides `$PORT`) |
| `--debug` | Enable debug logging |

## Architecture

```
main.go         HTTP server, embed directive, flags
handler.go      /api/convert + /d/<payload> handlers
ratelimit.go    Per-IP token bucket rate limiter
template.go     CalcMark-branded HTML template
static/
  index.html    Single-page frontend (inline CSS + JS)
  og.png        Open Graph image
```

Single Go binary. Two runtime dependencies: [go-calcmark](https://github.com/CalcMark/go-calcmark) for document evaluation and [x/time/rate](https://pkg.go.dev/golang.org/x/time/rate) for rate limiting.

## License

MIT
