/**
 * AOIRUSRA Data Spy — background.js
 * Handles: download triggers, storage relay, badge updates
 */
'use strict';

// ── Badge helper ──────────────────────────────────────────────
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text).slice(0, 4) });
  chrome.action.setBadgeBackgroundColor({ color: color || '#00cc55' });
}

// ── Message router ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  // Trigger file download from content.js
  if (msg.action === 'downloadFile') {
    const { content, filename } = msg;
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    chrome.downloads.download(
      { url: dataUrl, filename: filename || 'aoirusra_spy_data.txt', saveAs: false },
      (id) => { sendResponse({ ok: true, downloadId: id }); }
    );
    return true; // keep channel open for async
  }

  // Badge update
  if (msg.action === 'setBadge') {
    setBadge(msg.text, msg.color);
    sendResponse({ ok: true });
    return;
  }

  // Storage: append log chunk to persist across popup close
  if (msg.action === 'appendLog') {
    chrome.storage.local.get(['spyLog'], (res) => {
      const existing = res.spyLog || '';
      const updated  = existing + msg.chunk;
      // Cap at 5 MB to avoid quota errors
      const capped = updated.length > 5_000_000 ? updated.slice(-4_800_000) : updated;
      chrome.storage.local.set({ spyLog: capped }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // Storage: get full log
  if (msg.action === 'getLog') {
    chrome.storage.local.get(['spyLog', 'spyStats'], (res) => {
      sendResponse({ log: res.spyLog || '', stats: res.spyStats || {} });
    });
    return true;
  }

  // Storage: clear log
  if (msg.action === 'clearLog') {
    chrome.storage.local.set({ spyLog: '', spyStats: {} }, () => sendResponse({ ok: true }));
    return true;
  }

  // Storage: update stats
  if (msg.action === 'updateStats') {
    chrome.storage.local.set({ spyStats: msg.stats }, () => sendResponse({ ok: true }));
    return true;
  }
});
