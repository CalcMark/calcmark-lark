package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleConvert_CM_HTML(t *testing.T) {
	body := strings.NewReader("price = 100 USD\ntax = 8.5%\ntotal = price + tax")
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=html", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("expected text/html content type, got %q", ct)
	}
	result := w.Body.String()
	if !strings.Contains(result, "<!DOCTYPE html>") {
		t.Error("expected full HTML document (lark template)")
	}
	if !strings.Contains(result, "price") {
		t.Error("expected 'price' in output")
	}
}

func TestHandleConvert_CM_Markdown(t *testing.T) {
	body := strings.NewReader("x = 42")
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=markdown", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "42") {
		t.Error("expected '42' in markdown output")
	}
}

func TestHandleConvert_Embedded_HTML(t *testing.T) {
	input := "# Budget\n\n```cm\nprice = 100 USD\n```\n\nSome prose.\n"
	body := strings.NewReader(input)
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=html&embedded=true", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	result := w.Body.String()
	// Should be a full HTML document with the lark template
	if !strings.Contains(result, "<!DOCTYPE html>") {
		t.Error("expected full HTML document")
	}
	// Should use the embedded-content wrapper
	if !strings.Contains(result, "embedded-content") {
		t.Error("expected embedded-content wrapper in output")
	}
	// Goldmark should render the heading
	if !strings.Contains(result, "<h1") {
		t.Error("expected <h1> heading from goldmark")
	}
	// Prose should be present
	if !strings.Contains(result, "Some prose.") {
		t.Error("expected prose content")
	}
	// CalcMark block should be evaluated (price appears in a table)
	if !strings.Contains(result, "price") {
		t.Error("expected evaluated CalcMark content")
	}
}

func TestHandleConvert_Embedded_Markdown(t *testing.T) {
	input := "# Test\n\n```cm\nx = 42\n```\n\nDone.\n"
	body := strings.NewReader(input)
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=markdown&embedded=true", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	result := w.Body.String()
	// Heading preserved
	if !strings.Contains(result, "# Test") {
		t.Error("expected heading preserved in markdown output")
	}
	// cm fence replaced with evaluated output
	if strings.Contains(result, "```cm") {
		t.Error("expected cm fence to be replaced")
	}
	// Prose preserved
	if !strings.Contains(result, "Done.") {
		t.Error("expected prose preserved")
	}
}

func TestHandleConvert_EmptyBody(t *testing.T) {
	body := strings.NewReader("")
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=html", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleConvert_InvalidFormat(t *testing.T) {
	body := strings.NewReader("x = 1")
	req := httptest.NewRequest(http.MethodPost, "/api/convert?format=xml", body)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleConvert_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/convert", nil)
	w := httptest.NewRecorder()

	handleConvert(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}
