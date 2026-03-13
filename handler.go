package main

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/CalcMark/go-calcmark/format"
	impldoc "github.com/CalcMark/go-calcmark/impl/document"
	"github.com/CalcMark/go-calcmark/spec/document"
)

const maxBodySize = 1 << 20 // 1MB

// formatMapping maps user-facing format names to internal format registry names.
var formatMapping = map[string]string{
	"html":     "html",
	"markdown": "md",
	"text":     "text",
	"json":     "json",
}

// contentTypes maps internal format names to Content-Type headers.
var contentTypes = map[string]string{
	"html": "text/html; charset=utf-8",
	"md":   "text/markdown; charset=utf-8",
	"text": "text/plain; charset=utf-8",
	"json": "application/json; charset=utf-8",
}

func handleConvert(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Read body with size limit
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodySize))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "input too large (max 1MB)")
		return
	}

	source := string(body)
	if len(bytes.TrimSpace(body)) == 0 {
		writeError(w, http.StatusBadRequest, "empty input")
		return
	}

	// Validate format
	userFormat := r.URL.Query().Get("format")
	if userFormat == "" {
		userFormat = "html"
	}
	internalFormat, ok := formatMapping[userFormat]
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid format: must be html, markdown, text, or json")
		return
	}

	// Parse document
	doc, err := document.NewDocument(source)
	if err != nil {
		writeError(w, http.StatusBadRequest, "parse error: "+err.Error())
		return
	}

	// Evaluate
	evaluator := impldoc.NewEvaluator()
	if err := evaluator.Evaluate(doc); err != nil {
		writeError(w, http.StatusBadRequest, "evaluation error: "+err.Error())
		return
	}

	// Format output
	formatter := format.GetFormatter(internalFormat, "")
	opts := format.Options{}
	if internalFormat == "html" {
		opts.Template = larkHTMLTemplate
	}
	var buf bytes.Buffer
	if err := formatter.Format(&buf, doc, opts); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Content-Type", contentTypes[internalFormat])
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())

	if debug {
		log.Printf("convert format=%s size=%d duration=%s", userFormat, len(body), time.Since(start))
	}
}

// handleDocument serves GET /d/<payload> — decodes a deflate+base64url compressed
// CalcMark document and returns the raw source as plain text. This allows the cm CLI
// to fetch shared documents directly: cm remote --http https://lark.calcmark.org/d/<payload>
func handleDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	payload := strings.TrimPrefix(r.URL.Path, "/d/")
	if payload == "" {
		writeError(w, http.StatusBadRequest, "missing document payload")
		return
	}

	// base64url decode
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid encoding")
		return
	}

	// zlib decompress (browser CompressionStream('deflate') produces zlib-wrapped data)
	reader, err := zlib.NewReader(bytes.NewReader(decoded))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid compression")
		return
	}
	defer reader.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, io.LimitReader(reader, maxBodySize+1)); err != nil {
		writeError(w, http.StatusBadRequest, "invalid compression")
		return
	}
	if buf.Len() > maxBodySize {
		writeError(w, http.StatusRequestEntityTooLarge, "document too large")
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(buf.Bytes())

	if debug {
		log.Printf("document payload=%d decompressed=%d", len(decoded), buf.Len())
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	if debug {
		log.Printf("error status=%d msg=%q", status, msg)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
