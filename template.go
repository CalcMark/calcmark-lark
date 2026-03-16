package main

// larkHTMLTemplate is a CalcMark-branded HTML template that replaces the
// default blue-themed template. It uses CalcMark design tokens (purple accent,
// Inter + JetBrains Mono fonts) and supports dark mode via prefers-color-scheme.
const larkHTMLTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CalcMark Document</title>
<style>
:root {
  --color-primary: #7D56F4;
  --color-text: #1a1a1a;
  --color-text-muted: #555;
  --color-bg: #ffffff;
  --color-bg-subtle: #f6f8fa;
  --color-bg-inset: #f0f2f5;
  --color-border: #d1d5db;
  --color-code-bg: #f3f4f6;
  --color-code-text: #1a1a1a;
  --color-error: #cf222e;
  --color-error-bg: #ffeef0;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Monaco, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #a371f7;
    --color-text: #e5e5e5;
    --color-text-muted: #8b949e;
    --color-bg: #0d1117;
    --color-bg-subtle: #161b22;
    --color-bg-inset: #1c2128;
    --color-border: #30363d;
    --color-code-bg: #161b22;
    --color-code-text: #e5e5e5;
    --color-error: #f85149;
    --color-error-bg: #3d1417;
  }
}
body {
  font-family: var(--font-sans);
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
}
.calc-block {
  margin: 1.5em 0;
  padding: 1em;
  background: var(--color-bg-subtle);
  border-left: 4px solid var(--color-primary);
  border-radius: 4px;
}
.calc-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0.25em 0;
}
.calc-source {
  font-family: var(--font-mono);
  font-size: 0.95em;
  color: var(--color-code-text);
  flex: 1;
}
.calc-inline-result {
  font-weight: 600;
  color: var(--color-primary);
  margin-left: 2em;
  font-size: 0.9em;
}
.calc-inline-result::before {
  content: "= ";
}
.calc-result {
  font-weight: 600;
  color: var(--color-primary);
  margin-top: 0.5em;
  padding: 0.5em;
  background: var(--color-bg);
  border-radius: 3px;
}
.calc-error {
  color: var(--color-error);
  background: var(--color-error-bg);
  padding: 0.5em;
  border-radius: 3px;
  border-left: 3px solid var(--color-error);
  margin-top: 0.5em;
}
.text-block {
  margin: 1.5em 0;
}
.text-block p {
  margin: 0.75em 0;
}
.cm-interpolated {
  font-weight: 600;
}
.text-block h1, .text-block h2, .text-block h3 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
.text-block code {
  background: var(--color-code-bg);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.text-block pre {
  background: var(--color-code-bg);
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
}
.text-block pre code {
  background: none;
  padding: 0;
}
.text-block blockquote {
  border-left: 3px solid var(--color-primary);
  padding-left: 1em;
  margin: 1em 0;
  color: var(--color-text-muted);
}
.text-block blockquote p {
  margin: 0.5em 0;
}
.frontmatter {
  margin-bottom: 2em;
  padding: 1em 1.5em;
  background: var(--color-bg-inset);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}
.frontmatter h3 {
  margin: 0 0 0.75em 0;
  font-size: 0.9em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.frontmatter dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25em 1em;
}
.frontmatter dt {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--color-primary);
}
.frontmatter dt::before {
  content: "@";
  color: var(--color-text-muted);
}
.frontmatter dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--color-code-text);
}
.frontmatter .exchange dt::before {
  content: "";
}
.frontmatter .exchange dt {
  color: var(--color-text-muted);
}
.frontmatter hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0.75em 0;
}
.frontmatter-value {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--color-code-text);
}
.frontmatter .extra dt::before {
  content: "";
}
.frontmatter .extra dt {
  color: var(--color-text-muted);
}
</style>
</head>
<body>
{{if .Frontmatter}}
<div class="frontmatter">
  {{if .Frontmatter.Globals}}
  <h3>Globals</h3>
  <dl>
    {{range .Frontmatter.Globals}}
    <dt>{{.Name}}</dt>
    <dd>{{.Value}}</dd>
    {{end}}
  </dl>
  {{end}}
  {{if and .Frontmatter.Globals .Frontmatter.Exchange}}<hr>{{end}}
  {{if .Frontmatter.Exchange}}
  <h3>Exchange Rates</h3>
  <dl class="exchange">
    {{range .Frontmatter.Exchange}}
    <dt>{{.From}} → {{.To}}</dt>
    <dd>{{.Rate}}</dd>
    {{end}}
  </dl>
  {{end}}
  {{if .Frontmatter.Scale}}
  <h3>Scale</h3>
  <p class="frontmatter-value">{{.Frontmatter.Scale}}</p>
  {{end}}
  {{if .Frontmatter.ConvertTo}}
  <h3>Convert To</h3>
  <p class="frontmatter-value">{{.Frontmatter.ConvertTo}}</p>
  {{end}}
  {{if .Frontmatter.Extra}}
  <hr>
  <dl class="extra">
    {{range .Frontmatter.Extra}}
    <dt>{{.Key}}</dt>
    <dd>{{.Value}}</dd>
    {{end}}
  </dl>
  {{end}}
</div>
{{end}}
{{range .Blocks}}
{{if eq .Type "calculation"}}
<div class="calc-block">
  {{range $i, $line := .SourceLines}}
  <div class="calc-line">
    <code class="calc-source">{{$line.Source}}</code>
    {{if $line.Result}}
    <span class="calc-inline-result">{{$line.Result}}</span>
    {{end}}
  </div>
  {{end}}
  {{if .Error}}
  <div class="calc-error"><strong>Error:</strong> {{.Error}}</div>
  {{end}}
</div>
{{else}}
<div class="text-block">{{.HTML}}</div>
{{end}}
{{end}}
</body>
</html>`
