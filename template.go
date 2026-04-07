package main

import (
	"bytes"
	"embed"
	"html/template"
	"log"
)

// larkHTMLTemplate is a CalcMark-branded HTML template that replaces the
// default blue-themed template. It uses CalcMark design tokens (purple accent,
// Inter + JetBrains Mono fonts) and supports dark mode via prefers-color-scheme.
//
//go:embed lark.gohtml
var larkHTMLTemplate string

//go:embed templates
var templateFS embed.FS

// pageData is the data passed to page templates.
type pageData struct {
	CalcMarkVersion string
}

// pageTemplates holds pre-rendered page HTML keyed by page name.
var pageTemplates = map[string]string{}

func init() {
	layout := template.Must(template.ParseFS(templateFS, "templates/layout.gohtml"))

	data := pageData{CalcMarkVersion: calcmarkVersion()}

	pages := []string{"index", "about"}
	for _, page := range pages {
		// Clone layout and parse the page-specific blocks into it.
		t := template.Must(template.Must(layout.Clone()).ParseFS(templateFS, "templates/"+page+".gohtml"))

		var buf bytes.Buffer
		if err := t.ExecuteTemplate(&buf, "layout", data); err != nil {
			log.Fatalf("render %s: %v", page, err)
		}
		pageTemplates[page] = buf.String()
	}
}

// getPage returns the pre-rendered HTML for a page.
func getPage(name string) string {
	return pageTemplates[name]
}
