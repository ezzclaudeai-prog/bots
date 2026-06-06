/**
 * AOIRUSRA Data Spy — background.js  (v2.0)
 * Handles: file downloads, and TWO append-only storage pipelines:
 *   • spyLog    — human-readable diagnostics text
 *   • spyStream — structured NDJSON bot feed (reconnect-safe, exportable)
 */
'use strict';

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text).slice(0, 4) });
  chrome.action.setBadgeBackgroundColor({ color: color || '#00cc55' });
}

const LOG_CAP    = 5_000_000;   // 5 MB text log cap
const STREAM_CAP = 8_000_000;   // 8 MB NDJSON stream cap

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  // ── Download a file (txt or ndjson) ────────────────────────────────────
  if (msg.action === 'downloadFile') {
    const mime    = msg.mime || 'text/plain';
    const dataUrl = `data:${mime};charset=utf-8,` + encodeURIComponent(msg.content || '');
    chrome.downloads.download(
      { url: dataUrl, filename: msg.filename || 'aoirusra_spy_data.txt', saveAs: false },
      (id) => sendResponse({ ok: true, downloadId: id })
    );
    return true;
  }

  if (msg.action === 'setBadge') { setBadge(msg.text, msg.color); sendResponse({ ok: true }); return; }

  // ── Human log: append (capped, append-only) ────────────────────────────
  if (msg.action === 'appendLog') {
    chrome.storage.local.get(['spyLog'], (res) => {
      let updated = (res.spyLog || '') + msg.chunk;
      if (updated.length > LOG_CAP) updated = updated.slice(-(LOG_CAP - 200_000));
      chrome.storage.local.set({ spyLog: updated }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // ── Structured stream: append NDJSON (capped on whole-line boundary) ────
  if (msg.action === 'appendStream') {
    chrome.storage.local.get(['spyStream'], (res) => {
      let updated = (res.spyStream || '') + msg.chunk;
      if (updated.length > STREAM_CAP) {
        // Trim to a clean newline boundary so we never emit a half record.
        const sliced = updated.slice(-(STREAM_CAP - 200_000));
        const nl = sliced.indexOf('\n');
        updated = nl >= 0 ? sliced.slice(nl + 1) : sliced;
      }
      chrome.storage.local.set({ spyStream: updated }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // ── Reads ──────────────────────────────────────────────────────────────
  if (msg.action === 'getLog') {
    chrome.storage.local.get(['spyLog', 'spyStats'], (res) =>
      sendResponse({ log: res.spyLog || '', stats: res.spyStats || {}, streamTotal: (res.spyStats || {}).streamTotal || 0 }));
    return true;
  }
  if (msg.action === 'getStream') {
    chrome.storage.local.get(['spyStream'], (res) => sendResponse({ stream: res.spyStream || '' }));
    return true;
  }

  // ── Clear both pipelines ────────────────────────────────────────────────
  if (msg.action === 'clearLog') {
    chrome.storage.local.set({ spyLog: '', spyStream: '', spyStats: {} }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'updateStats') {
    chrome.storage.local.set({ spyStats: msg.stats }, () => sendResponse({ ok: true }));
    return true;
  }
});
