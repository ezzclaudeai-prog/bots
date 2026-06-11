// ==UserScript==
// @name         🛰️ EXPERTOPTION_SPY — WebSocket Interceptor + Binary Protocol Decoder + Spy Panel
// @namespace    expertoption-spy-tool
// @version      0.2.0
// @description  ExpertOption spy — WebSocket interception, multi-stage BINARY decoder (inflate/gzip/raw-deflate → MsgPack/JSON), raw byte capture (hex+base64) for protocol analysis, best-estimate tick/balance/assets extractors, and a spy panel with export.
// @author       aoirusra
// @match        *://expertoption.com/*
// @match        *://*.expertoption.com/*
// @match        *://expertoption.finance/*
// @match        *://*.expertoption.finance/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function (W) {
  'use strict';
  if (W.__EO_SPY_V02) return;
  W.__EO_SPY_V02 = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  CONFIG
  // ══════════════════════════════════════════════════════════════════════
  // ⚠️ اكتشاف v0.2: ExpertOption يستخدم WebSocket ثنائياً (وليس JSON نصّياً).
  // الإطارات تصل كـ ArrayBuffer/Blob. المحرك أدناه يجرّب — بالترتيب —
  // فكّ الضغط (gzip/zlib/raw-deflate) ثم MsgPack ثم نص UTF-8/JSON. وفي كل
  // الحالات يُحفظ خام البايتات (hex + base64) في RAW LOG لتحليل التنسيق.
  //
  // أنماط مرصودة من العيّنة الأولى:
  //   • إطارات 190/196 بايت تتناوب كل ~0.5s → أسعار حيّة (ticks) أو heartbeat
  //   • إطارات ضخمة (217KB/24KB/10KB) عند الإقلاع → أصول/شموع تاريخية
  //
  // أسماء الـ actions أدناه best-estimate — ستُضبط بعد رؤية محتوى مفكوك فعلي.
  const CFG = {
    DIAG_ENABLED        : true,
    DIAG_MAX_PACKETS    : 2500,
    LOG_HEARTBEAT       : false,    // إخفاء إطارات ping/pong القصيرة من السجل

    // التقاط الخام للتحليل دون اتصال
    CAPTURE_HEX_BYTES   : 64,       // عدد البايتات الأولى المحفوظة كـ hex لكل إطار
    CAPTURE_B64_MAX     : 8192,     // احفظ base64 الكامل للإطارات حتى هذا الحجم (بايت)
    CAPTURE_B64_HEAD    : 2048,     // للإطارات الأكبر: احفظ base64 لأول هذا القدر فقط

    UI_ENABLED          : true,
    DEFAULT_AMOUNT      : 1,

    TRADE_HOST_HINTS    : ['expertoption.com', 'expertoption.finance'],

    // ترتيب محاولات فكّ الضغط (تُختصر تلقائياً حسب magic bytes)
    INFLATE_FORMATS     : ['gzip', 'deflate', 'deflate-raw'],

    // ─── خريطة الإجراءات (best-estimate — عدّلها بعد التحقق من المحتوى) ───
    ACTIONS: {
      TICK            : ['tick', 'ticks', 'subscribeAsset', 'assetQuote', 'assetPrice'],
      CANDLES         : ['assetHistoryCandles', 'candles', 'getCandles', 'assetHistory'],
      BALANCE         : ['profile', 'userBalance', 'balance', 'setContext', 'userGroup'],
      OPEN_RESULT     : ['buyOption', 'openOption', 'optionOpened', 'openOptionResult'],
      CLOSE_RESULT    : ['expertOption', 'closeOption', 'optionFinished', 'optionsClosed'],
      ASSETS          : ['assets', 'getCurrencies', 'environment', 'defaultSubscribeCandles'],
      OPEN_OPTION_OUT : 'buyOption',
      SUBSCRIBE_OUT   : 'subscribeAsset',
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 2  UTILITIES
  // ══════════════════════════════════════════════════════════════════════
  const _intervals = [];
  const setIntervalT = (fn, ms) => { const id = setInterval(fn, ms); _intervals.push(id); return id; };
  let _nsCounter = 1;
  const nextNs = () => _nsCounter++;

  function normalizeAsset(a) { return String(a == null ? '' : a).toUpperCase().trim(); }
  function nowMs() { return Date.now(); }
  function fmtTime(ts) { const d = new Date(ts); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
  function safeJSONParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function inArr(name, list) { return Array.isArray(list) ? list.includes(name) : list === name; }
  function matchAction(name) {
    if (!name) return null;
    for (const key of Object.keys(CFG.ACTIONS)) {
      if (key.endsWith('_OUT')) continue;
      if (inArr(name, CFG.ACTIONS[key])) return key;
    }
    return null;
  }

  function bytesToHex(bytes, n) {
    const len = Math.min(n || bytes.length, bytes.length);
    let s = '';
    for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, '0') + (i % 2 ? ' ' : '');
    return s.trim();
  }
  function bufToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  STATE
  // ══════════════════════════════════════════════════════════════════════
  let activeAsset    = '';
  let wsConnected    = false;
  let totalFrames    = 0;
  let totalTicks     = 0;
  let currentBalance = null;
  let isDemo         = 1;
  let tradeAmount    = CFG.DEFAULT_AMOUNT;
  let tradeWS        = null;
  let tradeWSOrig    = null;
  let lastToken      = null;
  let autoTrade      = false;
  let _decodeStats   = { inflate: 0, msgpack: 0, json: 0, fail: 0 }; // كيف تُفكّ الإطارات

  const _lastPrice   = new Map();
  const _assets      = new Map();
  const _sockets     = new Set();

  // ══════════════════════════════════════════════════════════════════════
  // § 4  MSGPACK DECODER (منسوخ ومُختبر من أداة PocketOption)
  // ══════════════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const buf  = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off  = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf, off);
    let pos = 0;
    const rb   = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos, false);pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos, false);pos += 8; return v; };
    const ri64 = () => { const h = view.getInt32(pos, false), l = view.getUint32(pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const ru64 = () => { const h = view.getUint32(pos, false), l = view.getUint32(pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const ru8  = () => bytes[pos++];
    const rStr = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return s; };
    const rBin = (n) => { const b = bytes.subarray(pos, pos + n); pos += n; return b; };
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b & 0xf0) === 0x80) { const n = b & 0xf; const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
      if ((b & 0xf0) === 0x90) { const n = b & 0xf; const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
      if ((b & 0xe0) === 0xa0) return rStr(b & 0x1f);
      if ((b & 0xe0) === 0xe0) return b - 256;
      switch (b) {
        case 0xc0: return null;  case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8()); case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8();  case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();  case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8()); case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n = ru16(); const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xdd: { const n = ru32(); const a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xde: { const n = ru16(); const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        case 0xdf: { const n = ru32(); const o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        default: throw new Error('msgpack 0x' + b.toString(16));
      }
    }
    return decode();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 5  BINARY DECODE ENGINE (multi-stage)
  // ══════════════════════════════════════════════════════════════════════
  async function tryInflate(ab, format) {
    if (typeof W.DecompressionStream !== 'function') return null;
    try {
      const ds = new W.DecompressionStream(format);
      const stream = new Blob([ab]).stream().pipeThrough(ds);
      return await new Response(stream).arrayBuffer();
    } catch (_) { return null; }
  }

  function parsePlain(ab) {
    // يحاول تفسير ArrayBuffer (مفكوك الضغط أو خام) كـ JSON نصّي ثم MsgPack
    const bytes = new Uint8Array(ab);
    if (bytes.length === 0) return null;
    const c0 = bytes[0];
    if (c0 === 0x7b || c0 === 0x5b) { // { أو [
      const txt = new TextDecoder().decode(bytes);
      const j = safeJSONParse(txt);
      if (j !== null) { _decodeStats.json++; return { method: 'json', value: j }; }
    }
    try { const v = msgpackDecode(ab); if (v && typeof v === 'object') { _decodeStats.msgpack++; return { method: 'msgpack', value: v }; } } catch (_) {}
    // نص عادي (قد يكون JSON بدون قوس بادئ، أو رسالة بروتوكول)
    try {
      const txt = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (/[{}\[\]":]/.test(txt)) { const j = safeJSONParse(txt.slice(txt.search(/[{\[]/))); if (j) { _decodeStats.json++; return { method: 'json-embedded', value: j }; } }
    } catch (_) {}
    return null;
  }

  async function binDecode(ab) {
    const bytes = new Uint8Array(ab);
    if (bytes.length === 0) return null;

    // 1) نص/JSON مباشر بدون ضغط
    const direct = parsePlain(ab);
    if (direct) return direct;

    // 2) فكّ الضغط — رتّب المحاولات حسب magic bytes
    const b0 = bytes[0], b1 = bytes[1];
    let order = CFG.INFLATE_FORMATS.slice();
    if (b0 === 0x1f && b1 === 0x8b) order = ['gzip', 'deflate', 'deflate-raw'];
    else if (b0 === 0x78) order = ['deflate', 'gzip', 'deflate-raw'];   // zlib header
    else order = ['deflate-raw', 'deflate', 'gzip'];                    // الأرجح raw-deflate

    for (const fmt of order) {
      const out = await tryInflate(ab, fmt);
      if (out && out.byteLength) {
        const parsed = parsePlain(out);
        if (parsed) { _decodeStats.inflate++; return { method: 'inflate:' + fmt + '+' + parsed.method, value: parsed.value, inflated: out }; }
        // فُكّ الضغط لكن لم نفهم المحتوى — أعِد النص الخام للفحص
        const txt = (() => { try { return new TextDecoder().decode(new Uint8Array(out)); } catch (_) { return null; } })();
        _decodeStats.inflate++;
        return { method: 'inflate:' + fmt + '+raw', value: null, inflatedText: txt, inflated: out };
      }
    }

    _decodeStats.fail++;
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  EXTRACTORS (best-estimate)
  // ══════════════════════════════════════════════════════════════════════
  function flattenActions(msg) {
    if (!msg || typeof msg !== 'object') return [];
    if (msg.action === 'multipleAction' && msg.message && Array.isArray(msg.message.actions)) {
      return msg.message.actions.filter(a => a && typeof a === 'object');
    }
    if (msg.action) return [msg];
    return [];
  }

  function extractTicks(message) {
    const out = [];
    if (!message) return out;
    const push = (asset, price, ts) => { if (price > 0 && asset != null) out.push({ asset: normalizeAsset(asset), price: +price, ts: ts || nowMs() }); };
    if (message.tick && typeof message.tick === 'object') { const t = message.tick; push(t.asset || t.asset_id || t.symbol, t.price ?? t.value, t.time || t.timestamp); }
    if (Array.isArray(message.ticks)) for (const t of message.ticks) {
      if (Array.isArray(t) && t.length >= 3) push(t[0], t[2], t[1]);
      else if (t && typeof t === 'object') push(t.asset || t.asset_id, t.price ?? t.value, t.time);
    }
    if (message.price != null && (message.asset != null || message.asset_id != null)) push(message.asset || message.asset_id, message.price, message.time);
    return out;
  }

  function extractBalance(message) {
    if (!message || typeof message !== 'object') return null;
    const m = message.profile || message.user || message;
    if (m.demo_balance != null && m.real_balance != null) return { demo: +m.demo_balance, real: +m.real_balance };
    if (m.balance != null) return { balance: +m.balance, isDemo: m.is_demo ?? m.demo };
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  EVENT HANDLERS
  // ══════════════════════════════════════════════════════════════════════
  function onTick(asset, price) { totalTicks++; _lastPrice.set(asset, price); if (!activeAsset) activeAsset = asset; }
  function onBalance(b) {
    if (!b) return;
    if (b.balance != null) currentBalance = b.balance;
    else if (b.demo != null) currentBalance = isDemo ? b.demo : b.real;
    addLog('💰 رصيد: ' + JSON.stringify(b), 'info');
  }
  function onAssets(message) {
    const list = message?.assets || message?.currencies || (Array.isArray(message) ? message : null);
    if (!Array.isArray(list)) return;
    for (const a of list) { const id = a.id ?? a.asset_id, name = a.symbol || a.name; if (name) _assets.set(normalizeAsset(name), { id, payout: a.profit ?? a.payout, open: a.is_open }); }
    addLog('📋 أصول: ' + _assets.size, 'info');
  }

  function dispatch(action, message, fullMsg) {
    if (fullMsg && fullMsg.token) lastToken = fullMsg.token;
    switch (matchAction(action)) {
      case 'TICK':        { const ticks = extractTicks(message); for (const t of ticks) onTick(t.asset, t.price); break; }
      case 'BALANCE':     onBalance(extractBalance(message)); break;
      case 'ASSETS':      onAssets(message); break;
      case 'OPEN_RESULT': addLog('🟢 فتح صفقة: ' + JSON.stringify(message).slice(0, 200), 'signal'); break;
      case 'CLOSE_RESULT':addLog('🔴 إغلاق صفقة: ' + JSON.stringify(message).slice(0, 200), 'signal'); break;
      default: break;
    }
  }

  function processDecoded(decoded) {
    if (!decoded || typeof decoded !== 'object') return;
    const actions = flattenActions(decoded);
    if (actions.length) for (const a of actions) dispatch(a.action, a.message ?? a, decoded);
    else if (Array.isArray(decoded)) { const ticks = extractTicks({ ticks: decoded }); for (const t of ticks) onTick(t.asset, t.price); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  DIAGNOSTIC LOGGER
  // ══════════════════════════════════════════════════════════════════════
  const Diag = {
    packets: [],
    counts : { IN: 0, OUT: 0, byAction: {}, byMethod: {} },

    record(dir, kind, bytes, decodeResult, sizeOverride) {
      if (!CFG.DIAG_ENABLED) return null;
      const isBin = bytes instanceof Uint8Array;
      const method = decodeResult ? decodeResult.method : (kind === 'text' ? 'text' : 'undecoded');
      const decoded = decodeResult ? decodeResult.value : null;
      const action = decoded && typeof decoded === 'object' ? (decoded.action || null) : null;

      this.counts[dir] = (this.counts[dir] || 0) + 1;
      this.counts.byMethod[method] = (this.counts.byMethod[method] || 0) + 1;
      if (action) this.counts.byAction[action] = (this.counts.byAction[action] || 0) + 1;

      const entry = {
        dir, t: nowMs(), kind, action, method,
        size: isBin ? bytes.length : (sizeOverride || 0),
        hex : isBin ? bytesToHex(bytes, CFG.CAPTURE_HEX_BYTES) : null,
        b64 : null,
        decoded,
        inflatedText: decodeResult && decodeResult.inflatedText ? decodeResult.inflatedText.slice(0, 4000) : null,
      };
      // التقاط base64 للتحليل دون اتصال (محدود الحجم)
      if (isBin && kind === 'binary') {
        entry.b64 = bytes.length <= CFG.CAPTURE_B64_MAX
          ? bufToBase64(bytes)
          : bufToBase64(bytes.subarray(0, CFG.CAPTURE_B64_HEAD)) + '…(+' + (bytes.length - CFG.CAPTURE_B64_HEAD) + 'B)';
      }
      this.packets.push(entry);
      if (this.packets.length > CFG.DIAG_MAX_PACKETS) this.packets.shift();
      try { renderRawLog(entry); } catch (_) {}
      return entry;
    },

    export() { return JSON.stringify({ meta: { ua: navigator.userAgent, when: new Date().toISOString(), counts: this.counts, decodeStats: _decodeStats }, packets: this.packets }, null, 2); },
    clear() { this.packets.length = 0; this.counts = { IN: 0, OUT: 0, byAction: {}, byMethod: {} }; _decodeStats = { inflate: 0, msgpack: 0, json: 0, fail: 0 }; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 9  WEBSOCKET INTERCEPTION
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;
  function isTradeSocket(urlStr) { return CFG.TRADE_HOST_HINTS.some(h => urlStr.includes(h)); }
  function isHeartbeat(bytes) { return bytes && bytes.length <= 2; }

  async function handleBinary(ab, wsRef) {
    totalFrames++;
    const bytes = new Uint8Array(ab);
    if (isHeartbeat(bytes) && !CFG.LOG_HEARTBEAT) return;
    const result = await binDecode(ab);
    Diag.record('IN', 'binary', bytes, result);
    if (result && result.value) processDecoded(result.value);
  }

  function handleText(raw, wsRef) {
    totalFrames++;
    const s = raw.trim();
    if ((s === '2' || s === '3' || s.length <= 2) && !CFG.LOG_HEARTBEAT) return;
    const j = safeJSONParse(s);
    Diag.record('IN', 'text', null, j ? { method: 'text-json', value: j } : { method: 'text', value: null }, raw.length);
    if (j) processDecoded(j);
  }

  function attachHooks(ws, urlStr) {
    if (_sockets.has(ws)) return;
    _sockets.add(ws);
    ws._eoUrl = urlStr;
    ws.binaryType = ws.binaryType || 'arraybuffer';
    const origSend = ws.send.bind(ws);

    if (isTradeSocket(urlStr)) {
      if (!tradeWS || tradeWS.readyState !== 1) { tradeWS = ws; tradeWSOrig = origSend; }
      addLog('🔌 مقبس تداول: ' + urlStr.split('?')[0], 'info');
    }

    ws.send = function (data) {
      try {
        if (typeof data === 'string') {
          const d = safeJSONParse(data);
          if (d) { if (d.token) lastToken = d.token; Diag.record('OUT', 'text', null, { method: 'text-json', value: d }, data.length); }
          else if (data.length > 2 || CFG.LOG_HEARTBEAT) Diag.record('OUT', 'text', null, { method: 'text', value: null }, data.length);
        } else if (data instanceof ArrayBuffer) {
          Diag.record('OUT', 'binary', new Uint8Array(data), null);
        } else if (ArrayBuffer.isView(data)) {
          Diag.record('OUT', 'binary', new Uint8Array(data.buffer, data.byteOffset, data.byteLength), null);
        }
      } catch (_) {}
      return origSend(data);
    };

    ws.addEventListener('message', (ev) => {
      try {
        const d = ev.data;
        if (typeof d === 'string') handleText(d, ws);
        else if (d instanceof ArrayBuffer) handleBinary(d, ws);
        else if (d instanceof Blob) d.arrayBuffer().then(ab => handleBinary(ab, ws)).catch(() => {});
        else if (ArrayBuffer.isView(d)) handleBinary(d.buffer, ws);
      } catch (_) {}
    });
    ws.addEventListener('open',  () => { wsConnected = true; addLog('✅ اتصال مفتوح', 'info'); });
    ws.addEventListener('close', () => { if (ws === tradeWS) tradeWS = null; _sockets.delete(ws); });
  }

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); try { attachHooks(ws, String(args[0] || '')); } catch (_) {} return ws; },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 10  TRADE EXECUTION (scaffold — صيغة payload تحتاج تأكيد بعد رؤية المحتوى)
  // ══════════════════════════════════════════════════════════════════════
  function buildOpenPayload(direction, asset, amount, expSeconds) {
    const assetInfo = _assets.get(normalizeAsset(asset)) || {};
    return JSON.stringify({
      action : CFG.ACTIONS.OPEN_OPTION_OUT,
      message: { type: 'binary', asset_id: assetInfo.id, direction: direction === 'put' ? 'put' : 'call', amount, exp_time: expSeconds, is_demo: isDemo },
      token  : lastToken, ns: nextNs(),
    });
  }
  function executeTrade(direction, asset, amount, expSeconds) {
    if (!tradeWS || tradeWS.readyState !== 1 || !tradeWSOrig) { addLog('⚠️ لا مقبس تداول جاهز', 'error'); return false; }
    try { tradeWSOrig(buildOpenPayload(direction, asset || activeAsset, amount || tradeAmount, expSeconds || 60)); addLog('⚡ تنفيذ: ' + direction + ' | ' + (asset || activeAsset), 'signal'); return true; }
    catch (e) { addLog('❌ فشل التنفيذ: ' + e.message, 'error'); return false; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  UI — Spy Panel
  // ══════════════════════════════════════════════════════════════════════
  let _ui = null, _logEl = null, _rawEl = null, _hudEl = null;

  function addLog(msg, type) {
    if (!_logEl) { try { console.log('[EO-SPY]', msg); } catch (_) {} return; }
    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 4px;border-bottom:1px solid #1a1a2e;font:11px monospace;color:' + (type === 'error' ? '#ff5577' : type === 'signal' ? '#33ddaa' : '#aab');
    row.textContent = fmtTime(nowMs()) + '  ' + msg;
    _logEl.insertBefore(row, _logEl.firstChild);
    while (_logEl.childNodes.length > 200) _logEl.removeChild(_logEl.lastChild);
  }

  function renderRawLog(entry) {
    if (!_rawEl) return;
    const known = entry.action || (entry.method && entry.method.indexOf('raw') === -1 && entry.method !== 'undecoded' && entry.method !== 'text');
    const col = entry.dir === 'OUT' ? '#ffaa44' : (entry.action ? '#66ccff' : (known ? '#88dd99' : '#777'));
    const row = document.createElement('div');
    row.style.cssText = 'padding:1px 4px;border-bottom:1px solid #16161e;font:10px monospace;color:' + col + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const label = entry.action || entry.method || entry.kind;
    const body = entry.decoded ? JSON.stringify(entry.decoded).slice(0, 280) : (entry.inflatedText ? entry.inflatedText.slice(0, 280) : (entry.hex || ''));
    row.textContent = entry.dir + ' ' + fmtTime(entry.t) + ' ' + entry.size + 'B [' + label + '] ' + body;
    row.title = (entry.decoded ? JSON.stringify(entry.decoded, null, 1) : '') + '\n\nHEX: ' + (entry.hex || '') + (entry.b64 ? '\n\nB64: ' + entry.b64.slice(0, 2000) : '');
    _rawEl.insertBefore(row, _rawEl.firstChild);
    while (_rawEl.childNodes.length > 300) _rawEl.removeChild(_rawEl.lastChild);
  }

  function updateHud() {
    if (!_hudEl) return;
    const methods = Object.entries(Diag.counts.byMethod).map(([k, v]) => k + ':' + v).join(' ') || '—';
    _hudEl.innerHTML =
      '<b style="color:#33ddaa">EO-SPY v0.2</b> ' + (wsConnected ? '🟢' : '🔴') +
      ' | أصل: <b>' + (activeAsset || '—') + '</b>' +
      ' | سعر: <b>' + (_lastPrice.get(activeAsset)?.toFixed(5) ?? '—') + '</b>' +
      ' | ticks: ' + totalTicks + ' | إطارات: ' + totalFrames +
      ' | رصيد: ' + (currentBalance ?? '—') +
      '<br><span style="color:#778;font-size:10px">فكّ: ' + methods + '</span>';
  }

  function mkBtn(txt, fn) { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'flex:0 0 auto;padding:3px 8px;font:11px sans-serif;background:#1a1a33;color:#cce;border:1px solid #33335a;border-radius:4px;cursor:pointer'; b.onclick = fn; return b; }

  function buildUI() {
    if (!CFG.UI_ENABLED || _ui) return;
    _ui = document.createElement('div');
    _ui.style.cssText = 'position:fixed;top:8px;right:8px;width:500px;z-index:2147483647;background:#0d0d18;border:1px solid #2a2a44;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.6);font-family:system-ui,sans-serif;color:#ccd';
    _hudEl = document.createElement('div');
    _hudEl.style.cssText = 'padding:6px 8px;font:11px monospace;border-bottom:1px solid #2a2a44;background:#11112a';
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:4px;padding:4px 6px;border-bottom:1px solid #2a2a44;flex-wrap:wrap';
    _logEl = document.createElement('div'); _logEl.style.cssText = 'height:120px;overflow:auto;background:#0a0a14';
    _rawEl = document.createElement('div'); _rawEl.style.cssText = 'height:220px;overflow:auto;background:#08080f;border-top:1px solid #2a2a44';

    tabs.appendChild(mkBtn('📋 طرق الفكّ', () => { const s = JSON.stringify({ byMethod: Diag.counts.byMethod, byAction: Diag.counts.byAction, decodeStats: _decodeStats }, null, 2); navigator.clipboard?.writeText(s); addLog('📋 نُسخ ملخص الفكّ', 'info'); }));
    tabs.appendChild(mkBtn('⬇️ تصدير traffic', () => { const blob = new Blob([Diag.export()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'eo_traffic_' + Date.now() + '.json'; a.click(); addLog('⬇️ صُدّر ' + Diag.packets.length + ' حزمة', 'info'); }));
    tabs.appendChild(mkBtn('🗑️ مسح', () => { Diag.clear(); if (_rawEl) _rawEl.innerHTML = ''; addLog('🗑️ مُسح', 'info'); }));
    tabs.appendChild(mkBtn('▁ إخفاء', () => { const h = _logEl.style.display === 'none'; _logEl.style.display = _rawEl.style.display = h ? 'block' : 'none'; }));

    const rawHdr = document.createElement('div');
    rawHdr.style.cssText = 'padding:3px 8px;font:10px monospace;color:#778;background:#11111e;border-top:1px solid #2a2a44';
    rawHdr.textContent = '── RAW WS LOG (مرّر الفأرة لرؤية HEX/B64) — أزرق=action معروف, أخضر=مفكوك, رمادي=غير مفكوك ──';

    _ui.append(_hudEl, tabs, _logEl, rawHdr, _rawEl);
    document.documentElement.appendChild(_ui);
    updateHud();
    addLog('🛰️ EO-SPY v0.2 جاهز — اعتراض ثنائي + محرك فكّ متعدد المراحل نشط', 'signal');
    if (typeof W.DecompressionStream !== 'function') addLog('⚠️ DecompressionStream غير مدعوم — فكّ الضغط معطّل', 'error');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 12  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() { if (document.documentElement) buildUI(); else W.addEventListener('DOMContentLoaded', buildUI, { once: true }); }
  if (document.readyState === 'loading') W.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  W.__EO_SPY = { CFG, Diag, decodeStats: () => _decodeStats, state: () => ({ activeAsset, wsConnected, totalTicks, totalFrames, currentBalance, assets: _assets.size, lastToken: !!lastToken }), executeTrade, binDecode };
  setIntervalT(updateHud, 1000);

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
