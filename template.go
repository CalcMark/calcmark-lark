package main

import _ "embed"

// larkHTMLTemplate is a CalcMark-branded HTML template that replaces the
// default blue-themed template. It uses CalcMark design tokens (purple accent,
// Inter + JetBrains Mono fonts) and supports dark mode via prefers-color-scheme.
//
//go:embed lark.gohtml
var larkHTMLTemplate string
