/**
 * AOIRUSRA Data Spy — popup.js
 * Live data viewer + download/copy controls
 */
'use strict';

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
let currentFilter = 'all';
let lastLogLength = 0;
let isPaused      = false;
let lastSnap      = null;  // latest DOM snapshot from storage

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function isAlive() {
  try { return !!chrome?.runtime?.id; } catch { return false; }
}
function safeGet(keys, cb) {
  if (!isAlive()) { cb({}); return; }
  try { chrome.storage.local.get(keys, r => { if (chrome.runtime.lastError) cb({}); else cb(r || {}); }); }
  catch { cb({}); }
}
function safeMsg(msg, cb) {
  if (!isAlive()) return;
  try { chrome.runtime.sendMessage(msg, r => { if (chrome.runtime.lastError) return; if (cb) cb(r); }); }
  catch {}
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ════════════════════════════════════════════════════════════════
// FILTER LOG LINES
// ════════════════════════════════════════════════════════════════
function filterLines(lines, filter) {
  if (filter === 'all') return lines;
  return lines.filter(line => {
    switch(filter) {
      case 'ws':     return line.includes('WS#') && !line.includes('BINARY') && (line.includes('RECV') || line.includes('SENT'));
      case 'binary': return line.includes('BINARY') || line.includes('HEX:') || line.includes('DECODED:');
      case 'dom':    return line.includes('DOM_POLL');
      case 'http':   return line.includes('FETCH') || line.includes('XHR');
      case 'conn':   return line.includes('CONNECTED') || line.includes('DISCONNECTED') || line.includes('OPEN') || line.includes('CLOSE');
      default:       return true;
    }
  });
}

// ════════════════════════════════════════════════════════════════
// RENDER LOG PREVIEW
// ════════════════════════════════════════════════════════════════
function renderLog(log, stats) {
  const logBox  = document.getElementById('log-box');
  const sizeEl  = document.getElementById('log-size');
  if (!logBox) return;

  const allLines = log.split('\n').filter(l => l.trim());
  const filtered = filterLines(allLines, currentFilter);
  const preview  = filtered.slice(-50); // last 50 matching lines

  logBox.innerHTML = preview.map(line => {
    let cls = '';
    if (line.includes('WS#') && line.includes('BINARY')) cls = 'bin';
    else if (line.includes('WS#') && (line.includes('RECV') || line.includes('SENT'))) cls = 'ws';
    else if (line.includes('DOM_POLL')) cls = 'dom';
    else if (line.includes('FETCH') || line.includes('XHR')) cls = 'http';
    else if (line.includes('CONNECTED') || line.includes('DISCONNECTED')) cls = 'conn';
    return `<div class="log-line ${cls}">${escHtml(line)}</div>`;
  }).join('');

  logBox.scrollTop = logBox.scrollHeight;

  if (sizeEl) {
    const kb = Math.round(log.length / 1024);
    sizeEl.textContent = `${allLines.length.toLocaleString()} سطر · ${kb} KB`;
    lastLogLength = allLines.length;
  }
}

// ════════════════════════════════════════════════════════════════
// RENDER STATS BAR
// ════════════════════════════════════════════════════════════════
function renderStats(stats) {
  if (!stats) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-ws',   stats.wsTextCount   || 0);
  set('stat-bin',  stats.wsBinaryCount || 0);
  set('stat-dom',  stats.domPollCount  || 0);
  set('stat-http', (stats.fetchCount || 0) + (stats.xhrCount || 0));

  const statusEl = document.getElementById('status-left');
  const lines    = stats.totalLines || 0;
  if (statusEl) {
    statusEl.textContent = `⏺ ${lines.toLocaleString()} سطر مُسجَّل`;
  }
}

// ════════════════════════════════════════════════════════════════
// RENDER LIVE SNAPSHOT (from dom_poll lines in log)
// Parses the most recent DOM_POLL line to extract field values
// ════════════════════════════════════════════════════════════════
function renderSnapshot(log) {
  // Find last DOM_POLL line
  const lines   = log.split('\n').reverse();
  const domLine = lines.find(l => l.includes('DOM_POLL'));
  if (!domLine) return;

  // Parse key=value pairs from the line
  const snap = {};
  const pairs = domLine.matchAll(/(\w+)=([\S]+)/g);
  for (const m of pairs) { snap[m[1]] = m[2]; }

  const set = (id, val, suffix = '') => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== undefined && val !== 'null' ? val + suffix : '–';
  };

  set('snap-acct',       snap.accountLabel || snap.accountType);
  set('snap-balance',    snap.balance, snap.currency ? ' ' + snap.currency : '');
  set('snap-asset',      snap.asset);
  set('snap-price',      snap.price);
  set('snap-amount',     snap.tradeAmount, ' $');
  set('snap-duration',   snap.duration || snap.durationSecs);
  set('snap-profit-pct', snap.profitPct);
  set('snap-payout',     snap.payout ? '$' + snap.payout + ' / $' + (snap.profit || '–') : '–');
}

// ════════════════════════════════════════════════════════════════
// FULL REFRESH — pulls latest log from storage and re-renders
// ════════════════════════════════════════════════════════════════
function refresh() {
  safeGet(['spyLog', 'spyStats'], (res) => {
    const log   = res.spyLog   || '';
    const stats = res.spyStats || {};
    renderLog(log, stats);
    renderStats(stats);
    renderSnapshot(log);
  });
}

// ════════════════════════════════════════════════════════════════
// DOWNLOAD / COPY
// ════════════════════════════════════════════════════════════════
function download() {
  safeGet(['spyLog'], (res) => {
    const content  = res.spyLog || '';
    const filename = `aoirusra_spy_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.txt`;
    safeMsg({ action: 'downloadFile', content, filename }, () => {
      setStatus('✅ جاري التحميل…', 2000);
    });
  });
}

function copyAll() {
  safeGet(['spyLog'], (res) => {
    const content = res.spyLog || '';
    copyText(content, '📋 نسخ الكل');
  });
}

function copyRecent(n) {
  safeGet(['spyLog'], (res) => {
    const lines   = (res.spyLog || '').split('\n').slice(-n);
    copyText(lines.join('\n'), `📋 نسخ آخر ${n}`);
  });
}

function copyText(text, btnLabel) {
  const btn = document.getElementById('btn-copy-all');
  try {
    navigator.clipboard.writeText(text).then(() => {
      setStatus('✅ تم النسخ! — ' + Math.round(text.length/1024) + ' KB', 2500);
    }).catch(() => fallbackCopy(text));
  } catch { fallbackCopy(text); }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, { position: 'fixed', left: '-9999px', top: '0' });
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); setStatus('✅ تم النسخ (fallback)', 2000); }
  catch { setStatus('❌ فشل النسخ', 2000); }
  document.body.removeChild(ta);
}

function setStatus(msg, duration = 0) {
  const el = document.getElementById('status-left');
  if (!el) return;
  const old = el.textContent;
  el.textContent = msg;
  if (duration) setTimeout(() => { el.textContent = old; }, duration);
}

// ════════════════════════════════════════════════════════════════
// PAUSE / RESUME — tells content script via storage flag
// ════════════════════════════════════════════════════════════════
function togglePause() {
  isPaused = !isPaused;
  chrome.storage.local.set({ spyPaused: isPaused });
  const btn   = document.getElementById('btn-pause');
  const dot   = document.getElementById('rec-dot');
  const left  = document.getElementById('status-left');
  if (btn)  btn.textContent  = isPaused ? '▶ استئناف التسجيل' : '⏸ إيقاف التسجيل';
  if (dot)  dot.classList.toggle('paused', isPaused);
  if (left) left.textContent = isPaused ? '⏸ التسجيل متوقف' : '⏺ جاري التسجيل…';
}

// ════════════════════════════════════════════════════════════════
// CLEAR
// ════════════════════════════════════════════════════════════════
function clearAll() {
  if (!confirm('مسح جميع البيانات المُسجَّلة؟ لا يمكن التراجع.')) return;
  safeMsg({ action: 'clearLog' }, () => {
    setStatus('🗑 تم مسح البيانات', 2000);
    refresh();
  });
}

// ════════════════════════════════════════════════════════════════
// FILTER BUTTONS
// ════════════════════════════════════════════════════════════════
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refresh();
    });
  });
}

// ════════════════════════════════════════════════════════════════
// WIRE UP BUTTONS
// ════════════════════════════════════════════════════════════════
document.getElementById('btn-dl')?.addEventListener('click', download);
document.getElementById('btn-copy-all')?.addEventListener('click', copyAll);
document.getElementById('btn-copy-recent')?.addEventListener('click', () => copyRecent(200));
document.getElementById('btn-pause')?.addEventListener('click', togglePause);
document.getElementById('btn-clear')?.addEventListener('click', clearAll);
setupFilters();

// ════════════════════════════════════════════════════════════════
// AUTO-REFRESH every 2 seconds while popup is open
// ════════════════════════════════════════════════════════════════
refresh();
setInterval(refresh, 2000);
