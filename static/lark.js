// ============================================================
// CalcMark Lark — main application script
// ============================================================

// ------------------------------------------------------------
// Theme
// ------------------------------------------------------------

function syncPreviewTheme() {
  try {
    const theme = document.documentElement.getAttribute('data-theme');
    const doc = document.getElementById('preview')?.contentDocument;
    if (doc?.documentElement) {
      doc.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    // cross-origin or detached document
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  syncPreviewTheme();
}

// ------------------------------------------------------------
// DOM references
// ------------------------------------------------------------

const inputEl     = document.getElementById('input');
const shareBtn    = document.getElementById('shareBtn');
const statusMsg   = document.getElementById('statusMsg');
const statusTime  = document.getElementById('statusTime');
const cliHint     = document.getElementById('cliHint');
const outputMode  = document.getElementById('outputMode');
const localeSel   = document.getElementById('locale');
const previewEl   = document.getElementById('preview');
const rawOutput   = document.getElementById('rawOutput');
const copyBtn     = document.getElementById('copyBtn');
const cmBtn       = document.getElementById('cmBtn');
const downloadBtn = document.getElementById('downloadBtn');
const toastEl     = document.getElementById('toast');
const examplesSel = document.getElementById('examples');

// ------------------------------------------------------------
// Mode auto-detection
// ------------------------------------------------------------

let currentMode = 'cm'; // 'cm' or 'embedded'

// Detect embedded mode from content: if the input contains a ```cm or ```calcmark
// fenced code block, it's embedded mode (Markdown with CalcMark blocks).
const embeddedPattern = /^[ ]{0,3}(`{3,}|~{3,})\s*(cm|calcmark)\b/m;

function detectMode(source) {
  return embeddedPattern.test(source) ? 'embedded' : 'cm';
}

function applyMode(mode) {
  currentMode = mode;

  // Update mode indicator in status bar
  const modeLabel = document.getElementById('modeLabel');
  if (modeLabel) {
    modeLabel.textContent = mode === 'embedded' ? 'mode: markdown' : 'mode: calcmark';
  }

  // In embedded mode, hide Text and JSON output options
  const textOpt = outputMode.querySelector('option[value="text"]');
  const jsonOpt = outputMode.querySelector('option[value="json"]');
  if (mode === 'embedded') {
    textOpt.disabled = true;
    jsonOpt.disabled = true;
    if (outputMode.value === 'text' || outputMode.value === 'json') {
      outputMode.value = 'preview';
    }
    cmBtn.style.display = 'none';
  } else {
    textOpt.disabled = false;
    jsonOpt.disabled = false;
  }
}

// ------------------------------------------------------------
// Render state
// ------------------------------------------------------------

const DEBOUNCE_MS = 500;
const EXAMPLES_BASE = 'https://raw.githubusercontent.com/CalcMark/go-calcmark/main/testdata/examples/';

let debounceTimer = null;
let currentController = null;
let lastRenderedSource = '';
let lastRenderedMode = '';
let lastRawSource = '';
let lastRawFormat = '';
let lastRawLocale = '';
let lastRawMode = '';
let canShareUrl = false;

// ------------------------------------------------------------
// Toast notifications
// ------------------------------------------------------------

function showToast(msg, type, duration) {
  toastEl.textContent = msg;
  toastEl.className = `toast toast-${type} visible`;
  setTimeout(() => toastEl.classList.remove('visible'), duration);
}

// ------------------------------------------------------------
// Clipboard
// ------------------------------------------------------------

function copyToClipboard(text) {
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const blob = new Blob([text], { type: 'text/plain' });
    const item = new ClipboardItem({ 'text/plain': blob });
    navigator.clipboard.write([item]).then(
      () => showToast('Copied!', 'success', 2000),
      () => fallbackCopy(text),
    );
    return;
  }
  if (execCopy(text)) {
    showToast('Copied!', 'success', 2000);
    return;
  }
  fallbackCopy(text);
}

function execCopy(text) {
  window.getSelection().removeAllRanges();
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

function fallbackCopy(text) {
  const fb = document.getElementById('clipboardFallback');
  const fbInput = document.getElementById('fallbackUrl');
  fbInput.value = text;
  fb.classList.add('visible');
  fbInput.select();
  setTimeout(() => fb.classList.remove('visible'), 10000);
}

// ------------------------------------------------------------
// Status bar
// ------------------------------------------------------------

function setStatus(msg, isError, durationMs) {
  statusMsg.textContent = msg || '';
  statusMsg.classList.toggle('status-bar-error', !!isError);

  if (durationMs != null && !isError) {
    statusTime.textContent = `${Math.round(durationMs)}ms`;
  } else if (isError || !msg) {
    statusTime.textContent = '';
  }

  if (durationMs != null && !isError) {
    updateCliHint();
  } else {
    cliHint.textContent = '';
  }
}

function updateCliHint() {
  const mode = outputMode.value;
  const hash = location.hash;
  let displayHint, fullCommand;

  if (currentMode === 'embedded') {
    const formatFlag = { preview: 'html', html: 'html', markdown: 'md' };
    const fmt = formatFlag[mode] || 'html';
    fullCommand = `cm convert --embedded --to ${fmt} [file.md]`;
    displayHint = fullCommand;
  } else if (hash && hash.startsWith('#0:')) {
    const payload = hash.slice(3);
    const url = `${location.origin}/d/${payload}`;
    fullCommand = `cm remote --http ${url}`;
    displayHint = 'cm remote --http \u2026';
  } else {
    const formatFlag = { preview: 'html', html: 'html', markdown: 'md', text: 'text', json: 'json' };
    fullCommand = `cm export --to ${formatFlag[mode] || 'html'} [file.cm]`;
    displayHint = fullCommand;
  }

  cliHint.textContent = displayHint;
  cliHint.title = `Click to copy: ${fullCommand.length > 80 ? fullCommand.slice(0, 77) + '\u2026' : fullCommand}`;
  cliHint.onclick = () => copyToClipboard(fullCommand);
}

// ------------------------------------------------------------
// Compression (deflate + base64url)
// ------------------------------------------------------------

async function compressToBase64url(text) {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const compressed = await new Response(stream).arrayBuffer();
  return arrayBufferToBase64url(compressed);
}

async function decompressFromBase64url(encoded) {
  const bytes = base64urlToArrayBuffer(encoded);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  let totalSize = 0;
  const MAX_SIZE = 1 << 20;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_SIZE) {
      reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function arrayBufferToBase64url(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToArrayBuffer(str) {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ------------------------------------------------------------
// URL hash & shareability
// ------------------------------------------------------------

async function updateHash() {
  const source = inputEl.value;
  const qs = location.search;
  if (!source.trim()) {
    history.replaceState(null, '', '/' + qs);
    cmBtn.style.display = 'none';
    canShareUrl = false;
    updateShareButton();
    return;
  }
  try {
    const encoded = await compressToBase64url(source);
    const prefix = currentMode === 'embedded' ? '1' : '0';
    const fragment = `${prefix}:${encoded}`;
    const url = `${location.origin}/${qs}#${fragment}`;
    if (url.length > 2000) {
      history.replaceState(null, '', '/' + qs);
      cmBtn.style.display = 'none';
      canShareUrl = false;
    } else {
      history.replaceState(null, '', `/${qs}#${fragment}`);
      // cm CLI button only for cm mode (embedded not supported by /d/ endpoint)
      cmBtn.style.display = currentMode === 'cm' ? '' : 'none';
      canShareUrl = true;
    }
    updateShareButton();
    updateCliHint();
  } catch {
    // ignore compression errors
  }
}

function updateShareButton() {
  shareBtn.disabled = !canShareUrl;
  shareBtn.title = canShareUrl ? '' : 'Too big to share. Use the copy button instead.';
}

async function checkShareability() {
  const source = inputEl.value;
  if (!source.trim()) {
    canShareUrl = false;
    updateShareButton();
    return;
  }
  try {
    const encoded = await compressToBase64url(source);
    const prefix = currentMode === 'embedded' ? '1' : '0';
    const url = `${location.origin}/#${prefix}:${encoded}`;
    canShareUrl = url.length <= 2000;
  } catch {
    canShareUrl = false;
  }
  updateShareButton();
}

// ------------------------------------------------------------
// Share, copy source, copy cm command
// ------------------------------------------------------------

async function share() {
  const source = inputEl.value;
  if (!source.trim() || !canShareUrl) return;

  let hash = location.hash;
  const prefix = currentMode === 'embedded' ? '1' : '0';
  if (!hash || (!hash.startsWith('#0:') && !hash.startsWith('#1:'))) {
    try {
      const encoded = await compressToBase64url(source);
      hash = `#${prefix}:${encoded}`;
    } catch {
      return;
    }
  }
  copyToClipboard(`${location.origin}/${hash}`);
}

function copySource() {
  const source = inputEl.value;
  if (source.trim()) copyToClipboard(source);
}

function getCmCommand() {
  if (currentMode === 'embedded') return null;
  const hash = location.hash;
  if (!hash || !hash.startsWith('#0:')) return null;
  const payload = hash.slice(3);
  return `cm remote --http ${location.origin}/d/${payload}`;
}

function copyCmCommand() {
  const cmd = getCmCommand();
  if (cmd) copyToClipboard(cmd);
}

// ------------------------------------------------------------
// Output mode switching
// ------------------------------------------------------------

function showPreviewMode() {
  previewEl.style.display = '';
  rawOutput.style.display = 'none';
  copyBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
}

function showRawMode() {
  previewEl.style.display = 'none';
  rawOutput.style.display = 'block';
  copyBtn.style.display = '';
  downloadBtn.style.display = '';
}

// ------------------------------------------------------------
// Preview scroll sync
//
// Uses the textarea's scroll position (as a 0–1 fraction) to
// scroll the preview iframe's content to a proportional position.
// This keeps the two panels roughly aligned as you scroll or type.
// ------------------------------------------------------------

function getScrollPercent() {
  const maxScroll = inputEl.scrollHeight - inputEl.clientHeight;
  if (maxScroll <= 0) return 0;
  return inputEl.scrollTop / maxScroll;
}

function syncPreviewScroll() {
  try {
    const doc = previewEl.contentDocument;
    if (!doc?.documentElement) return;
    const maxScroll = doc.documentElement.scrollHeight - previewEl.clientHeight;
    if (maxScroll > 0) {
      doc.documentElement.scrollTop = Math.round(maxScroll * getScrollPercent());
    }
  } catch {
    // cross-origin or detached document — ignore
  }
}

inputEl.addEventListener('scroll', syncPreviewScroll);

// ------------------------------------------------------------
// Preview rendering
//
// Writes HTML directly into the iframe via document.write() rather
// than setting srcdoc. This is synchronous and avoids Safari's
// unreliable srcdoc/onload behaviour.
// ------------------------------------------------------------

function writeToPreview(html, scrollPercent) {
  const doc = previewEl.contentDocument || previewEl.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  syncPreviewTheme();

  const maxScroll = doc.documentElement.scrollHeight - previewEl.clientHeight;
  if (maxScroll > 0) {
    doc.documentElement.scrollTop = Math.round(maxScroll * scrollPercent);
  }
}

function convertUrl(format) {
  let url = `/api/convert?format=${format}`;
  const locale = localeSel.value;
  if (locale) url += `&locale=${locale}`;
  if (currentMode === 'embedded') url += '&embedded=true';
  return url;
}

function renderCurrent() {
  // Auto-detect mode from content on each render
  applyMode(detectMode(inputEl.value));

  const mode = outputMode.value;
  if (mode === 'preview') {
    renderPreview();
  } else {
    renderRaw(mode);
  }
}

async function renderPreview() {
  const source = inputEl.value;
  if (!source.trim()) return;
  if (source === lastRenderedSource && currentMode === lastRenderedMode) { showPreviewMode(); return; }

  if (currentController) currentController.abort();
  currentController = new AbortController();

  const scrollPercent = getScrollPercent();
  setStatus('Rendering\u2026');
  const t0 = performance.now();

  try {
    const res = await fetch(convertUrl('html'), {
      method: 'POST',
      body: source,
      signal: currentController.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(err.error || 'Error', true);
      return;
    }
    const html = await res.text();
    lastRenderedSource = source;
    lastRenderedMode = currentMode;
    writeToPreview(html, scrollPercent);
    showPreviewMode();
    setStatus('', false, performance.now() - t0);
    checkShareability();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('Network error', true);
  } finally {
    currentController = null;
  }
}

// ------------------------------------------------------------
// Raw format output (HTML source, Markdown, Text, JSON)
// ------------------------------------------------------------

async function renderRaw(format) {
  const source = inputEl.value;
  if (!source.trim()) return;

  const curLocale = localeSel.value;
  if (lastRawSource && source === lastRawSource && format === lastRawFormat && curLocale === lastRawLocale && currentMode === lastRawMode) {
    showRawMode();
    return;
  }

  setStatus('Converting\u2026');
  const t0 = performance.now();

  try {
    const res = await fetch(convertUrl(format), {
      method: 'POST',
      body: source,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error || 'Error';
      rawOutput.textContent = errMsg;
      rawOutput.classList.add('raw-error');
      lastRawSource = '';
      lastRawFormat = '';
      lastRawLocale = '';
      showRawMode();
      setStatus(errMsg, true);
      return;
    }
    rawOutput.textContent = await res.text();
    rawOutput.classList.remove('raw-error');
    lastRawSource = source;
    lastRawFormat = format;
    lastRawLocale = curLocale;
    lastRawMode = currentMode;
    showRawMode();
    setStatus('', false, performance.now() - t0);
    checkShareability();
  } catch {
    setStatus('Network error', true);
  }
}

// ------------------------------------------------------------
// Copy & download output
// ------------------------------------------------------------

async function copyOutput() {
  await copyToClipboard(rawOutput.textContent);
}

function downloadOutput() {
  const format = outputMode.value;
  const extensions = { html: '.html', markdown: '.md', text: '.txt', json: '.json' };
  const mimeTypes = { html: 'text/html', markdown: 'text/markdown', text: 'text/plain', json: 'application/json' };
  const blob = new Blob([rawOutput.textContent], { type: mimeTypes[format] || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calcmark${extensions[format] || '.txt'}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Input event handling (debounced render + URL update)
// ------------------------------------------------------------

inputEl.addEventListener('input', () => {
  const hasContent = inputEl.value.trim().length > 0;

  if (!hasContent) {
    shareBtn.disabled = true;
    shareBtn.title = '';
    lastRenderedSource = '';
    lastRawSource = '';
    showPreviewMode();
    writeToPreview('', 0);
    history.replaceState(null, '', location.pathname + location.search);
    cliHint.textContent = '';
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    renderCurrent();
    updateHash();
  }, DEBOUNCE_MS);
});

// Sync format/locale into URL query string without replacing path or hash.
function syncQueryParams() {
  const params = new URLSearchParams(location.search);
  const fmt = outputMode.value;
  if (fmt && fmt !== 'preview') { params.set('format', fmt); } else { params.delete('format'); }
  const loc = localeSel.value;
  if (loc) { params.set('locale', loc); } else { params.delete('locale'); }
  const qs = params.toString();
  const url = location.pathname + (qs ? `?${qs}` : '') + location.hash;
  history.replaceState(null, '', url);
}

outputMode.addEventListener('change', () => {
  syncQueryParams();
  renderCurrent();
});

localeSel.addEventListener('change', () => {
  lastRenderedSource = '';
  lastRawSource = '';
  syncQueryParams();
  renderCurrent();
});

// ------------------------------------------------------------
// Load document from URL hash
// ------------------------------------------------------------

async function loadFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return;

  let mode, payload;
  if (hash.startsWith('1:')) {
    mode = 'embedded';
    payload = hash.slice(2);
  } else if (hash.startsWith('0:')) {
    mode = 'cm';
    payload = hash.slice(2);
  } else {
    return;
  }

  try {
    const text = await decompressFromBase64url(payload);
    inputEl.value = text;
    inputEl.selectionStart = inputEl.selectionEnd = 0;
    shareBtn.disabled = false;
    // Mode from hash prefix overrides auto-detection for shared URLs
    // (compressed content can't be scanned without decompressing)
    currentMode = mode;
  } catch {
    showToast('Could not decode shared document', 'error', 3000);
  }
}

// ------------------------------------------------------------
// Load example document
// ------------------------------------------------------------

async function loadExample(name, ext) {
  try {
    let res;
    if (ext) {
      res = await fetch(`${EXAMPLES_BASE}${name}.${ext}`);
    } else {
      // Try .cm first, fall back to .md for embedded examples.
      res = await fetch(`${EXAMPLES_BASE}${name}.cm`);
      if (!res.ok) {
        ext = 'md';
        res = await fetch(`${EXAMPLES_BASE}${name}.md`);
      }
    }
    if (!res.ok) throw new Error();
    inputEl.value = await res.text();
    inputEl.selectionStart = inputEl.selectionEnd = 0;
    lastRenderedSource = '';
    lastRenderedMode = '';
    lastRawSource = '';
    renderCurrent();
    history.replaceState(null, '', `/x/${name}${location.search}`);
    cmBtn.style.display = 'none';
    cliHint.textContent = '';
  } catch {
    showToast('Could not load example', 'error', 3000);
  }
}

examplesSel.addEventListener('change', async () => {
  const opt = examplesSel.selectedOptions[0];
  const name = opt?.value;
  if (!name) return;
  const ext = opt.dataset.ext || 'cm';
  await loadExample(name, ext);
  examplesSel.value = '';
});

// ------------------------------------------------------------
// Initialise
// ------------------------------------------------------------

(async () => {
  // Apply URL query parameters (?format=...&locale=...)
  const params = new URLSearchParams(location.search);
  const paramFormat = params.get('format');
  const paramLocale = params.get('locale');
  if (paramFormat && outputMode.querySelector(`option[value="${paramFormat}"]`)) {
    outputMode.value = paramFormat;
  }
  if (paramLocale && localeSel.querySelector(`option[value="${paramLocale}"]`)) {
    localeSel.value = paramLocale;
  }

  const xMatch = location.pathname.match(/^\/x\/(.+)$/);
  if (xMatch) {
    await loadExample(xMatch[1]);
  } else {
    await loadFromHash();
  }
  if (inputEl.value.trim()) {
    if (location.hash?.startsWith('#0:') && currentMode === 'cm') {
      cmBtn.style.display = '';
    }
    renderCurrent();
  }
})();
