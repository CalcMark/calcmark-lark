// ============================================================
// CalcMark Lark — main application script
// ============================================================

// ------------------------------------------------------------
// Theme
// ------------------------------------------------------------

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// ------------------------------------------------------------
// Info popover
// ------------------------------------------------------------

function toggleInfo() {
  document.getElementById('infoPopover').classList.toggle('visible');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.info-wrap')) {
    document.getElementById('infoPopover').classList.remove('visible');
  }
});

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
// Render state
// ------------------------------------------------------------

const DEBOUNCE_MS = 500;
const EXAMPLES_BASE = 'https://raw.githubusercontent.com/CalcMark/go-calcmark/main/testdata/examples/';

let debounceTimer = null;
let currentController = null;
let lastRenderedSource = '';
let lastRawSource = '';
let lastRawFormat = '';
let lastRawLocale = '';
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

  if (hash && hash.startsWith('#0:')) {
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
  if (!source.trim()) {
    history.replaceState(null, '', '/');
    cmBtn.style.display = 'none';
    canShareUrl = false;
    updateShareButton();
    return;
  }
  try {
    const encoded = await compressToBase64url(source);
    const fragment = `0:${encoded}`;
    const url = `${location.origin}/#${fragment}`;
    if (url.length > 2000) {
      history.replaceState(null, '', '/');
      cmBtn.style.display = 'none';
      canShareUrl = false;
    } else {
      history.replaceState(null, '', `/#${fragment}`);
      cmBtn.style.display = '';
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
    const url = `${location.origin}/#0:${encoded}`;
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
  if (!hash || !hash.startsWith('#0:')) {
    try {
      const encoded = await compressToBase64url(source);
      hash = `#0:${encoded}`;
    } catch {
      return;
    }
  }
  copyToClipboard(`${location.origin}/${hash}`);
  updateCliHint();
}

function copySource() {
  const source = inputEl.value;
  if (source.trim()) copyToClipboard(source);
}

function getCmCommand() {
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

  const maxScroll = doc.documentElement.scrollHeight - previewEl.clientHeight;
  if (maxScroll > 0) {
    doc.documentElement.scrollTop = Math.round(maxScroll * scrollPercent);
  }
}

function convertUrl(format) {
  let url = `/api/convert?format=${format}`;
  const locale = localeSel.value;
  if (locale) url += `&locale=${locale}`;
  return url;
}

function renderCurrent() {
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
  if (source === lastRenderedSource) { showPreviewMode(); return; }

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
  if (lastRawSource && source === lastRawSource && format === lastRawFormat && curLocale === lastRawLocale) {
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
    history.replaceState(null, '', location.pathname);
    cliHint.textContent = '';
    return;
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    renderCurrent();
    updateHash();
  }, DEBOUNCE_MS);
});

outputMode.addEventListener('change', () => renderCurrent());

localeSel.addEventListener('change', () => {
  lastRenderedSource = '';
  lastRawSource = '';
  renderCurrent();
});

// ------------------------------------------------------------
// Load document from URL hash
// ------------------------------------------------------------

async function loadFromHash() {
  const hash = location.hash.slice(1);
  if (!hash || !hash.startsWith('0:')) return;
  try {
    const text = await decompressFromBase64url(hash.slice(2));
    inputEl.value = text;
    inputEl.selectionStart = inputEl.selectionEnd = 0;
    shareBtn.disabled = false;
  } catch {
    showToast('Could not decode shared document', 'error', 3000);
  }
}

// ------------------------------------------------------------
// Load example document
// ------------------------------------------------------------

async function loadExample(name) {
  try {
    const res = await fetch(`${EXAMPLES_BASE}${name}.cm`);
    if (!res.ok) throw new Error();
    inputEl.value = await res.text();
    inputEl.selectionStart = inputEl.selectionEnd = 0;
    lastRenderedSource = '';
    lastRawSource = '';
    renderCurrent();
    history.replaceState(null, '', `/x/${name}`);
    cmBtn.style.display = 'none';
    cliHint.textContent = '';
  } catch {
    showToast('Could not load example', 'error', 3000);
  }
}

examplesSel.addEventListener('change', async () => {
  const name = examplesSel.value;
  if (!name) return;
  await loadExample(name);
  examplesSel.value = '';
});

// ------------------------------------------------------------
// Initialise
// ------------------------------------------------------------

(async () => {
  const xMatch = location.pathname.match(/^\/x\/(.+)$/);
  if (xMatch) {
    await loadExample(xMatch[1]);
  } else {
    await loadFromHash();
  }
  if (inputEl.value.trim()) {
    if (location.hash?.startsWith('#0:')) {
      cmBtn.style.display = '';
    }
    renderCurrent();
  }
})();
