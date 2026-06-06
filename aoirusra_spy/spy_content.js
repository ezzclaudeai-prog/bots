/**
 * AOIRUSRA Data Spy — spy_content.js  (v2.0)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WORLD: ISOLATED (extension context).
 *
 * Receives BATCHED records from spy_injected.js via CustomEvent('__aoispy_data').
 * Each batch entry is one of:
 *    { k:'raw',  category, data, ts }            -> human-readable diagnostics log
 *    { k:'norm', rec:{ ts, type, asset, data } } -> clean structured bot feed
 *
 * Two independent pipelines, by design:
 *   1. HUMAN LOG  — verbose text, capped in memory, persisted as text (as before).
 *   2. STRUCTURED STREAM — flat NDJSON records (one JSON object per line) kept in
 *      a sliding window, persisted separately to chrome.storage, and exportable
 *      as a .ndjson file ready for Python/R ingestion. This stream survives WSS
 *      reconnects because it is append-only and never reset by socket lifecycle.
 */
'use strict';

if (window.__AOISPY_CONTENT) { /* already mounted */ }
else {
window.__AOISPY_CONTENT = true;

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════
const MAX_MEMORY_LINES   = 5000;     // human-log in-memory cap (HUD preview)
const STREAM_WINDOW      = 20000;    // structured records kept in RAM (sliding)
const AUTO_SAVE_INTERVAL = 10000;    // flush both pipelines to storage every 10s
const HUD_MAX_LINES      = 20;

// ════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════
let memoryLines    = [];     // recent human-log lines
let totalLineCount = 0;
let pendingChunk   = '';     // human-log text awaiting storage flush

let streamWindow   = [];     // sliding window of normalized records (objects)
let streamPending  = '';     // NDJSON text awaiting storage flush
let streamTotal    = 0;

let paused = false;
let stats = {
  wsTextCount: 0, wsBinaryCount: 0, domPollCount: 0,
  fetchCount: 0, xhrCount: 0,
  tickCount: 0, tradeOpenCount: 0, tradeCloseCount: 0, balanceCount: 0,
  sessionStart: new Date().toISOString(), lastSeen: {},
};

// ════════════════════════════════════════════════════════════════════════
// EXTENSION CONTEXT SAFETY
// ════════════════════════════════════════════════════════════════════════
function isAlive() { try { return !!chrome?.runtime?.id; } catch { return false; } }
function safeMsg(msg, cb) {
  if (!isAlive()) return;
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return;
      if (cb) cb(res);
    });
  } catch {}
}

function nowISO() { return new Date().toISOString(); }
function nowHMS() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':') +
         '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ════════════════════════════════════════════════════════════════════════
// HUMAN LOG WRITER
// ════════════════════════════════════════════════════════════════════════
function writeLines(lines) {
  if (paused || lines.length === 0) return;
  memoryLines.push(...lines);
  if (memoryLines.length > MAX_MEMORY_LINES) memoryLines = memoryLines.slice(-MAX_MEMORY_LINES);
  pendingChunk += lines.join('\n') + '\n';
  totalLineCount += lines.length;
}

// ════════════════════════════════════════════════════════════════════════
// STRUCTURED STREAM WRITER  (sliding window + NDJSON persistence)
// ════════════════════════════════════════════════════════════════════════
function writeStream(rec) {
  if (paused) return;
  streamWindow.push(rec);
  if (streamWindow.length > STREAM_WINDOW) {
    // Sliding-window purge: drop the oldest 10% in one O(n) splice to keep the
    // hot bot feed bounded without thrashing on every push.
    streamWindow.splice(0, Math.floor(STREAM_WINDOW * 0.1));
  }
  streamPending += JSON.stringify(rec) + '\n';
  streamTotal++;
}

// ════════════════════════════════════════════════════════════════════════
// HUMAN-LOG FORMATTERS  (raw diagnostics)
// ════════════════════════════════════════════════════════════════════════
function fmtWSText(d) {
  const dir = d.direction === 'sent' ? '▶ SENT' : '◀ RECV';
  if (d.isHeartbeat) return [`[${nowHMS()}] WS#${d.wsId} ${dir} HEARTBEAT raw="${d.raw}"`];
  const lines = [`[${nowHMS()}] WS#${d.wsId} ${dir} url=${d.wsUrl} bytes=${d.byteLength}`, `  RAW: ${d.raw}`];
  if (d.parsed) lines.push(`  PARSED (${d.parseMethod}): ${JSON.stringify(d.parsed)}`);
  return lines;
}
function fmtWSBinary(d) {
  const dir = d.direction === 'sent' ? '▶ SENT' : '◀ RECV';
  const lines = [`[${nowHMS()}] WS#${d.wsId} ${dir} BINARY event="${d.eventName}" bytes=${d.byteLength} method=${d.decodeMethod}`];
  if (d.hexRaw)  lines.push(`  HEX:  ${d.hexRaw}`);
  if (d.decoded !== undefined && d.decoded !== null) lines.push(`  DECODED: ${JSON.stringify(d.decoded)}`);
  else if (d.rawText) lines.push(`  TEXT: ${d.rawText}`);
  return lines;
}
function fmtDOM(d) {
  const f = [];
  const add = (l, v) => { if (v != null) f.push(`${l}=${v}`); };
  add('accountType', d.accountType); add('currency', d.currency); add('balance', d.balance);
  add('asset', d.asset); add('price', d.currentPrice); add('amount', d.tradeAmount);
  add('duration', d.tradeDuration); add('profitPct', d.profitPct != null ? d.profitPct + '%' : null);
  return f.length ? [`[${nowHMS()}] DOM_POLL ${f.join('  ')}`] : [];
}
function fmtFetchReq(d)  { const l = [`[${nowHMS()}] FETCH ▶ ${d.reqMethod} ${d.reqUrl}`]; if (d.reqBody) l.push(`  BODY: ${d.reqBody}`); return l; }
function fmtFetchResp(d) { const l = [`[${nowHMS()}] FETCH ◀ ${d.status} ${d.reqUrl}`]; if (d.rawBody) l.push(`  BODY: ${String(d.rawBody).slice(0, 4000)}`); return l; }
function fmtXHR(cat, d) {
  if (cat === 'xhr_open')     return [`[${nowHMS()}] XHR OPEN ${d.method} ${d.url}`];
  if (cat === 'xhr_send')     return [`[${nowHMS()}] XHR SEND ${d.url} body=${d.body || 'none'}`];
  if (cat === 'xhr_response') { const l = [`[${nowHMS()}] XHR RESP ${d.status} ${d.url}`]; if (d.rawBody) l.push(`  BODY: ${String(d.rawBody).slice(0, 4000)}`); return l; }
  if (cat === 'xhr_error')    return [`[${nowHMS()}] XHR ERROR ${d.url}`];
  return [];
}
function fmtConn(cat, d) {
  if (cat === 'ws_open')  return [`[${nowHMS()}] WS#${d.wsId} CONNECTED    ${d.wsUrl}`];
  if (cat === 'ws_close') return [`[${nowHMS()}] WS#${d.wsId} DISCONNECTED ${d.wsUrl} code=${d.code}`];
  if (cat === 'ws_error') return [`[${nowHMS()}] WS#${d.wsId} ERROR        ${d.wsUrl}`];
  return [];
}
function fmtInit(d) {
  return ['', '═'.repeat(60), '  AOIRUSRA DATA SPY — SESSION START', `  v${d.version}  ${d.timestamp}`, `  ${d.url}`, '═'.repeat(60), ''];
}

// Format a normalized record for the human log (compact, one line).
function fmtNorm(rec) {
  const a = rec.asset ? ` ${rec.asset}` : '';
  switch (rec.type) {
    case 'TICK': {
      const d = rec.data;
      return `[${nowHMS()}] TICK${a} px=${d.price} Δ=${d.priceDelta ?? '–'} dir=${d.direction} run=${d.runLength} dt=${d.interTickMs ?? '–'}ms vol=${d.realizedVol != null ? d.realizedVol.toExponential(2) : '–'} lat=${d.latencyMs ?? '–'}ms`;
    }
    case 'TRADE_OPEN':     return `[${nowHMS()}] TRADE_OPEN${a} ${rec.data.direction} amt=${rec.data.amount} px=${rec.data.openPrice} payout=${rec.data.percentProfit}% req=${rec.data.requestId}`;
    case 'TRADE_CLOSE':    return `[${nowHMS()}] TRADE_CLOSE${a} ${rec.data.direction} profit=${rec.data.profit} ${rec.data.won ? 'WIN' : 'LOSS'} open=${rec.data.openPrice} close=${rec.data.closePrice}`;
    case 'ORDER_PENDING':  return `[${nowHMS()}] ORDER_PENDING${a} ${rec.data.direction} amt=${rec.data.amount} req=${rec.data.requestId}`;
    case 'ORDER_REJECTED': return `[${nowHMS()}] ORDER_REJECTED${a} error=${rec.data.error} amt=${rec.data.amount}`;
    case 'BALANCE':        return `[${nowHMS()}] BALANCE bal=${rec.data.balance} ${rec.data.isDemo ? '(demo)' : '(real)'}`;
    case 'CANDLE_TIMING':  return `[${nowHMS()}] CANDLE_TIMING${a} ${rec.data.secondsRemaining}s left`;
    case 'HISTORY':        return `[${nowHMS()}] HISTORY${a} period=${rec.data.period} points=${rec.data.points}`;
    case 'LATENCY':        return `[${nowHMS()}] LATENCY ws#${rec.data.wsId} ping_gap=${rec.data.interPingMs ?? '–'}ms`;
    default:               return `[${nowHMS()}] ${rec.type}${a} ${JSON.stringify(rec.data)}`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// RAW RECORD ROUTER  (human log + counters)
// ════════════════════════════════════════════════════════════════════════
function handleRaw(category, data) {
  stats.lastSeen[category] = nowISO();
  let lines = [];
  switch (category) {
    case 'spy_init':        lines = fmtInit(data); break;
    case 'ws_text':         stats.wsTextCount++;   lines = fmtWSText(data); break;
    case 'ws_binary':       stats.wsBinaryCount++; lines = fmtWSBinary(data); break;
    case 'ws_open': case 'ws_close': case 'ws_error': lines = fmtConn(category, data); break;
    case 'dom_poll':        stats.domPollCount++;  lines = fmtDOM(data); break;
    case 'dom_error':       lines = [`[${nowHMS()}] DOM_ERROR: ${data.error}`]; break;
    case 'fetch_request':   stats.fetchCount++;    lines = fmtFetchReq(data); break;
    case 'fetch_response':  lines = fmtFetchResp(data); break;
    case 'fetch_error':     lines = [`[${nowHMS()}] FETCH_ERROR: ${data.error} ${data.reqUrl}`]; break;
    case 'xhr_open': case 'xhr_send': case 'xhr_response': case 'xhr_error':
      stats.xhrCount++; lines = fmtXHR(category, data); break;
    case 'worker_open':     lines = [`[${nowHMS()}] WORKER ${data.shared ? 'SHARED ' : ''}${data.scriptURL}`]; break;
    case 'worker_send': case 'worker_recv':
      lines = [`[${nowHMS()}] ${category === 'worker_send' ? 'WORKER ▶' : 'WORKER ◀'} ${data.label} ${JSON.stringify(data.preview).slice(0, 300)}`]; break;
    case 'norm_error':      lines = [`[${nowHMS()}] NORM_ERROR ${data.eventName}: ${data.error}`]; break;
    default:                lines = [`[${nowHMS()}] [${category}] ${JSON.stringify(data).slice(0, 500)}`]; break;
  }
  writeLines(lines);
}

// ════════════════════════════════════════════════════════════════════════
// NORMALIZED RECORD ROUTER  (structured stream + human-log echo + counters)
// ════════════════════════════════════════════════════════════════════════
function handleNorm(rec) {
  switch (rec.type) {
    case 'TICK':        stats.tickCount++; break;
    case 'TRADE_OPEN':  stats.tradeOpenCount++; break;
    case 'TRADE_CLOSE': stats.tradeCloseCount++; break;
    case 'BALANCE':     stats.balanceCount++; break;
  }
  writeStream(rec);
  // Echo non-tick events to the human log (ticks are too frequent to spam).
  if (rec.type !== 'TICK' && rec.type !== 'CANDLE_TIMING' && rec.type !== 'LATENCY') {
    writeLines([fmtNorm(rec)]);
  }
}

// ════════════════════════════════════════════════════════════════════════
// MAIN EVENT HANDLER — batched
// ════════════════════════════════════════════════════════════════════════
window.addEventListener('__aoispy_data', (e) => {
  const batch = e.detail?.batch;
  if (!Array.isArray(batch)) return;
  for (const item of batch) {
    if (item.k === 'norm') handleNorm(item.rec);
    else if (item.k === 'raw') handleRaw(item.category, item.data);
  }
  updateHUD();
  syncStats();
});

// ════════════════════════════════════════════════════════════════════════
// STORAGE FLUSH — both pipelines, append-only (reconnect-safe)
// ════════════════════════════════════════════════════════════════════════
function flushToStorage() {
  if (!isAlive()) return;
  if (pendingChunk)  { const c = pendingChunk;  pendingChunk  = ''; safeMsg({ action: 'appendLog', chunk: c }); }
  if (streamPending) { const s = streamPending; streamPending = ''; safeMsg({ action: 'appendStream', chunk: s }); }
}
setInterval(flushToStorage, AUTO_SAVE_INTERVAL);

function syncStats() {
  if (!isAlive()) return;
  safeMsg({ action: 'updateStats', stats: { ...stats, totalLines: totalLineCount, streamTotal } });
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════
function buildFullLog(cb) {
  flushToStorage();
  setTimeout(() => safeMsg({ action: 'getLog' }, (res) => cb((res?.log || '') + pendingChunk)), 600);
}
function buildFullStream(cb) {
  flushToStorage();
  setTimeout(() => safeMsg({ action: 'getStream' }, (res) => cb((res?.stream || '') + streamPending)), 600);
}
function triggerDownload(content, ext) {
  const filename = `aoirusra_spy_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext || 'txt'}`;
  safeMsg({ action: 'downloadFile', content, filename, mime: ext === 'ndjson' ? 'application/x-ndjson' : 'text/plain' });
}
function copyToClipboard(content, btn) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(content).then(() => flashBtn(btn));
    } else {
      const ta = document.createElement('textarea');
      ta.value = content; Object.assign(ta.style, { position: 'fixed', left: '-9999px' });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      flashBtn(btn);
    }
  } catch {}
}
function flashBtn(btn) { if (btn) { const o = btn.textContent; btn.textContent = '✅ تم!'; setTimeout(() => btn.textContent = o, 2000); } }

// ════════════════════════════════════════════════════════════════════════
// FLOATING HUD
// ════════════════════════════════════════════════════════════════════════
const HUD_STYLES = `
  #aoispy-hud{position:fixed!important;bottom:20px!important;left:16px!important;z-index:2147483647!important;width:400px;max-height:440px;font-family:'Courier New',monospace;font-size:10px;background:rgba(4,6,14,.97);border:1px solid rgba(0,200,120,.3);border-radius:14px;overflow:hidden;box-shadow:0 16px 60px rgba(0,0,0,.9);backdrop-filter:blur(20px);display:flex;flex-direction:column;user-select:none}
  #aoispy-hud *{box-sizing:border-box;margin:0;padding:0}
  #aoispy-hud.minimized{max-height:36px}
  #aoispy-hud.hidden{opacity:0;pointer-events:none}
  #aoispy-header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,200,120,.06);border-bottom:1px solid rgba(0,200,120,.1);cursor:grab;flex-shrink:0}
  #aoispy-title{font-size:11px;font-weight:700;color:#00c878;flex:1}
  #aoispy-stats{font-size:9px;color:rgba(0,200,120,.5)}
  .aoispy-hbtn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.35);border-radius:5px;padding:2px 7px;font-size:10px;cursor:pointer;font-family:inherit}
  .aoispy-hbtn:hover{border-color:rgba(0,200,120,.4);color:#00c878}
  .aoispy-hbtn.pause-on{border-color:rgba(255,200,0,.5);color:#ffc800}
  #aoispy-log-wrap{flex:1;overflow-y:auto;padding:6px 8px;min-height:80px}
  #aoispy-log-wrap::-webkit-scrollbar{width:3px}
  #aoispy-log-wrap::-webkit-scrollbar-thumb{background:rgba(0,200,120,.2)}
  .aoispy-line{font-size:9px;line-height:1.5;color:rgba(0,200,120,.65);word-break:break-all;white-space:pre-wrap}
  .aoispy-line.tick{color:#33d6ff}.aoispy-line.trade{color:#ffd24d;font-weight:700}
  .aoispy-line.ws-binary{color:#00aaff}.aoispy-line.dom{color:rgba(255,200,0,.7)}
  .aoispy-line.fetch{color:#cc88ff}.aoispy-line.conn{color:rgba(255,255,255,.35)}
  #aoispy-footer{display:flex;gap:4px;padding:6px 8px;border-top:1px solid rgba(255,255,255,.04);flex-shrink:0;flex-wrap:wrap}
  .aoispy-fbtn{flex:1;padding:5px 4px;border-radius:7px;font-family:inherit;font-size:9px;font-weight:600;cursor:pointer;text-align:center;border:1px solid;min-width:54px}
  .aoispy-fbtn.dl{background:rgba(0,200,120,.06);border-color:rgba(0,200,120,.25);color:rgba(0,200,120,.8)}
  .aoispy-fbtn.stream{background:rgba(51,214,255,.06);border-color:rgba(51,214,255,.25);color:#33d6ff}
  .aoispy-fbtn.copy{background:rgba(0,150,255,.06);border-color:rgba(0,150,255,.22);color:rgba(0,180,255,.75)}
  .aoispy-fbtn.clr{background:rgba(255,50,50,.04);border-color:rgba(255,50,50,.15);color:rgba(255,80,80,.5)}
  #aoispy-counter{padding:3px 10px;font-size:8px;color:rgba(0,200,120,.35);border-top:1px solid rgba(255,255,255,.03);display:flex;justify-content:space-between}
  #aoispy-rec-dot{width:5px;height:5px;border-radius:50%;background:#ff4040;box-shadow:0 0 4px #ff4040;display:inline-block;margin-right:4px;animation:aoispy-blink 1s ease-in-out infinite}
  #aoispy-rec-dot.paused{background:#888;box-shadow:none;animation:none}
  @keyframes aoispy-blink{0%,100%{opacity:1}50%{opacity:.3}}
`;

function buildHUD() {
  if (document.getElementById('aoispy-hud')) return;
  const style = document.createElement('style');
  style.textContent = HUD_STYLES;
  (document.head || document.documentElement).appendChild(style);

  const hud = document.createElement('div');
  hud.id = 'aoispy-hud';
  hud.innerHTML = `
    <div id="aoispy-header">
      <span id="aoispy-title">🔬 AOIRUSRA Spy v2</span>
      <span id="aoispy-stats">TICK:0</span>
      <button class="aoispy-hbtn" id="aoispy-pause-btn">⏸</button>
      <button class="aoispy-hbtn" id="aoispy-min-btn">−</button>
      <button class="aoispy-hbtn" id="aoispy-close-btn">✕</button>
    </div>
    <div id="aoispy-log-wrap"><div id="aoispy-log"></div></div>
    <div id="aoispy-footer">
      <button class="aoispy-fbtn dl"     id="aoispy-dl-btn">💾 .txt</button>
      <button class="aoispy-fbtn stream" id="aoispy-stream-btn">📊 .ndjson</button>
      <button class="aoispy-fbtn copy"   id="aoispy-copy-btn">📋 نسخ</button>
      <button class="aoispy-fbtn clr"    id="aoispy-clear-btn">🗑</button>
    </div>
    <div id="aoispy-counter">
      <span><span id="aoispy-rec-dot"></span><span id="aoispy-line-count">0</span> سطر</span>
      <span id="aoispy-stream-info">stream: 0</span>
    </div>`;
  (document.body || document.documentElement).appendChild(hud);

  // Drag
  let dragging = false, sx, sy, ox, oy;
  const header = document.getElementById('aoispy-header');
  header.addEventListener('mousedown', (e) => {
    if (!['aoispy-header', 'aoispy-title', 'aoispy-stats'].includes(e.target.id)) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const r = hud.getBoundingClientRect(); ox = r.left; oy = r.top; hud.style.transition = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    hud.style.left = Math.max(0, Math.min(innerWidth - hud.offsetWidth, ox + e.clientX - sx)) + 'px';
    hud.style.bottom = 'auto';
    hud.style.top = Math.max(0, Math.min(innerHeight - hud.offsetHeight, oy + e.clientY - sy)) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  document.getElementById('aoispy-min-btn').addEventListener('click', (e) => {
    e.stopPropagation(); hud.classList.toggle('minimized');
    e.target.textContent = hud.classList.contains('minimized') ? '+' : '−';
  });
  document.getElementById('aoispy-close-btn').addEventListener('click', (e) => {
    e.stopPropagation(); hud.classList.add('hidden'); setTimeout(() => hud.classList.remove('hidden'), 30000);
  });
  document.getElementById('aoispy-pause-btn').addEventListener('click', (e) => {
    e.stopPropagation(); paused = !paused;
    e.target.textContent = paused ? '▶' : '⏸';
    e.target.classList.toggle('pause-on', paused);
    document.getElementById('aoispy-rec-dot')?.classList.toggle('paused', paused);
  });
  document.getElementById('aoispy-dl-btn').addEventListener('click', (e) => {
    e.stopPropagation(); buildFullLog((c) => { triggerDownload(c, 'txt'); flashBtn(e.target); });
  });
  document.getElementById('aoispy-stream-btn').addEventListener('click', (e) => {
    e.stopPropagation(); buildFullStream((c) => { triggerDownload(c, 'ndjson'); flashBtn(e.target); });
  });
  document.getElementById('aoispy-copy-btn').addEventListener('click', (e) => {
    e.stopPropagation(); copyToClipboard(memoryLines.slice(-200).join('\n'), e.target);
  });
  document.getElementById('aoispy-clear-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('مسح جميع البيانات المسجلة؟')) return;
    memoryLines = []; pendingChunk = ''; totalLineCount = 0;
    streamWindow = []; streamPending = ''; streamTotal = 0;
    safeMsg({ action: 'clearLog' });
    updateHUD();
  });
}

function updateHUD() {
  const logEl = document.getElementById('aoispy-log');
  if (!logEl) return;
  logEl.innerHTML = memoryLines.slice(-HUD_MAX_LINES).map(line => {
    let cls = '';
    if (line.includes('TICK ') || line.includes('TICK')) cls = 'tick';
    else if (line.includes('TRADE_') || line.includes('ORDER_')) cls = 'trade';
    else if (line.includes('BINARY')) cls = 'ws-binary';
    else if (line.includes('DOM_POLL')) cls = 'dom';
    else if (line.includes('FETCH') || line.includes('XHR')) cls = 'fetch';
    else if (line.includes('CONNECTED') || line.includes('DISCONNECTED')) cls = 'conn';
    return `<div class="aoispy-line ${cls}">${escHtml(line)}</div>`;
  }).join('');
  const wrap = document.getElementById('aoispy-log-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;

  const cEl = document.getElementById('aoispy-line-count');
  if (cEl) cEl.textContent = totalLineCount.toLocaleString();
  const sEl = document.getElementById('aoispy-stats');
  if (sEl) sEl.textContent = `TICK:${stats.tickCount} TRD:${stats.tradeOpenCount}/${stats.tradeCloseCount} BIN:${stats.wsBinaryCount}`;
  const stEl = document.getElementById('aoispy-stream-info');
  if (stEl) stEl.textContent = `stream: ${streamTotal.toLocaleString()}`;
}
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ════════════════════════════════════════════════════════════════════════
// POPUP COMMANDS
// ════════════════════════════════════════════════════════════════════════
window.addEventListener('__aoispy_popup_cmd', (e) => {
  const cmd = e.detail?.cmd;
  if (cmd === 'download')       buildFullLog((c) => triggerDownload(c, 'txt'));
  else if (cmd === 'download_stream') buildFullStream((c) => triggerDownload(c, 'ndjson'));
  else if (cmd === 'copy')      buildFullLog((c) => copyToClipboard(c, null));
  else if (cmd === 'clear')     { memoryLines = []; pendingChunk = ''; totalLineCount = 0; streamWindow = []; streamPending = ''; streamTotal = 0; safeMsg({ action: 'clearLog' }); }
  else if (cmd === 'pause')     paused = !paused;
});

// ════════════════════════════════════════════════════════════════════════
// MOUNT
// ════════════════════════════════════════════════════════════════════════
function mount() {
  buildHUD();
  writeLines([`[${nowHMS()}] 🔬 AOIRUSRA Spy v2 جاهز — JSON decoder + microstructure + structured stream`]);
  safeMsg({ action: 'getLog' }, (res) => {
    if (res?.stats) Object.assign(stats, res.stats);
    if (res?.streamTotal) streamTotal = res.streamTotal;
    updateHUD();
  });
}
if (document.body) mount();
else document.addEventListener('DOMContentLoaded', mount, { once: true });

} // end guard
