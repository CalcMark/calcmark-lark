---
title: "fix: Sync preview scroll position to editor cursor and eliminate re-render flash"
type: fix
status: completed
date: 2026-03-18
---

# fix: Sync preview scroll position to editor cursor and eliminate re-render flash

## Overview

When typing in the Lark editor, every preview re-render causes the page to jump back to the top. For long documents (e.g. Services P&L), this makes the preview useless — the user is editing near the bottom but the preview shows the top. Two problems need solving:

1. **Scroll sync**: After re-render, scroll the preview to approximately match where the user is editing (percentage-based heuristic).
2. **Flash elimination**: The current flow — set `srcdoc`, iframe loads, content appears at top, *then* we could scroll — causes a visible flash. Instead: render offscreen, scroll to position, then reveal.

## Problem Statement

**Current flow:**
1. User types → 500ms debounce → POST source to `/api/convert?format=html`
2. Response HTML set as `previewEl.srcdoc = html`
3. Iframe loads, `onload` fires, iframe height adjusted to `body.scrollHeight + 32`
4. Preview always shows from the top — no scroll sync

**Result:** Every keystroke re-render jumps the preview to the top, regardless of where the user is editing. On a 200-line document, editing at line 180 shows line 1 in the preview.

## Proposed Solution

### Approach: Percentage-based cursor-to-scroll mapping with double-buffered iframe

**Why percentage-based (not line-mapping)?**
The user explicitly stated this doesn't need 1:1 precision. A percentage heuristic is simple, requires zero server changes, and handles the common case well: if you're 80% through the source, seeing ~80% through the preview is good enough.

**Why double-buffered iframe (not render-then-scroll)?**
Setting `srcdoc` then scrolling on `onload` causes a visible flash — the browser paints the top of the document before our scroll handler fires. Instead, we render into an invisible iframe, scroll it to the target position, then swap visibility. This eliminates the flash entirely.

### Implementation

#### 1. Compute cursor scroll percentage from textarea

```javascript
// static/index.html — new function
function getCursorPercent() {
  var pos = input.selectionStart;
  var total = input.value.length;
  if (total === 0) return 0;
  return pos / total;
}
```

This uses `selectionStart` (character offset) divided by total source length. It's a better signal than `scrollTop/scrollHeight` because it tracks where the user is *editing*, not just what's visible.

#### 2. Double-buffered iframe rendering (no flash)

Replace the current `renderPreview()` flow:

```javascript
// static/index.html — modified renderPreview()
async function renderPreview() {
  var source = input.value;
  if (!source.trim()) return;
  if (source === lastRenderedSource) { showPreviewMode(); return; }

  if (currentController) currentController.abort();
  currentController = new AbortController();

  var scrollPercent = getCursorPercent();
  setStatus('Rendering\u2026');
  var t0 = performance.now();

  try {
    var res = await fetch(convertUrl('html'), {
      method: 'POST', body: source, signal: currentController.signal,
    });
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      setStatus(err.error || 'Error', true);
      return;
    }
    var html = await res.text();
    lastRenderedSource = source;

    // --- Double-buffer: hide, set content, wait for load, scroll, show ---
    previewEl.style.visibility = 'hidden';
    previewEl.srcdoc = html;
    previewEl.onload = function() {
      try {
        var body = previewEl.contentDocument.body;
        if (body) {
          // Resize iframe to fit content
          previewEl.style.height = body.scrollHeight + 32 + 'px';
        }
      } catch(e) {}

      // Scroll the parent page so the preview column aligns
      // with the approximate edit position
      syncScrollToPercent(scrollPercent);

      // Reveal after scroll is set
      previewEl.style.visibility = '';
    };
    showPreviewMode();
    setStatus('', false, performance.now() - t0);
    checkShareability();
  } catch(err) {
    if (err.name === 'AbortError') return;
    setStatus('Network error', true);
  } finally {
    currentController = null;
  }
}
```

#### 3. Scroll sync function

```javascript
// static/index.html — new function
function syncScrollToPercent(percent) {
  // Scroll the page so both the textarea and preview are at roughly
  // the same relative position. Since both panels are in a side-by-side
  // grid, scrolling the page works for both.
  var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll > 0) {
    window.scrollTo(0, Math.round(maxScroll * percent));
  }
}
```

**Why page scroll (not iframe internal scroll)?**
The iframe auto-sizes to fit its content (`previewEl.style.height = body.scrollHeight + 32 + 'px'`), so it has no internal scrollbar. The *page* scrolls both columns together. Scrolling `window` to the right percentage keeps both panels roughly aligned.

## Acceptance Criteria

- [ ] When editing at ~80% through a document, the preview shows content at ~80% after re-render
- [ ] No visible flash/jump when preview re-renders — content appears already scrolled to position
- [ ] Works correctly on the Services P&L example (long document)
- [ ] First render (page load) is unaffected — no scroll sync needed when loading fresh
- [ ] Short documents that fit in viewport are unaffected
- [ ] Mobile (single-column) layout still works correctly
- [ ] No server-side changes required

## Technical Considerations

- **`visibility: hidden` vs `display: none`**: Must use `visibility: hidden` because `display: none` prevents layout calculation — we need `scrollHeight` to be accurate before revealing.
- **`selectionStart` vs `scrollTop`**: `selectionStart` is better because it tracks the cursor (editing position), not just what's visible. If the user scrolls the textarea without typing, we don't need to sync (the debounce only fires on input).
- **Race condition**: If a new render starts while the previous iframe is still loading, the `AbortController` cancels the fetch, and the old `onload` handler is overwritten by the new one. No special handling needed.
- **Performance**: No new DOM elements, no mutation observers, no scroll event listeners. The only addition is reading `selectionStart` and calling `window.scrollTo` — negligible cost.

## Files to modify

| File | Change |
|------|--------|
| `static/index.html:553-591` | Modify `renderPreview()` — add double-buffer pattern and scroll sync |
| `static/index.html` (new functions) | Add `getCursorPercent()` and `syncScrollToPercent()` |

## What this does NOT do

- No line-level source-to-preview mapping (would require server changes and `data-line` attributes)
- No scroll-linked panels (editor scroll ↔ preview scroll in real-time)
- No CodeMirror or rich editor integration
- No changes to `go-calcmark`, `handler.go`, or `lark.gohtml`
