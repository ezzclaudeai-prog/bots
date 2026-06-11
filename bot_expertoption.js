// ==UserScript==
// @name         🛰️ EXPERTOPTION_SPY — WS Interceptor + Protocol Decoder + Trade Engine + Spy Panel
// @namespace    expertoption-spy-tool
// @version      0.3.0
// @description  ExpertOption spy — intercepts the binary-JSON WebSocket protocol, decodes the real action set (candles/profile/assets/trade lifecycle/crowd sentiment), tracks ticks·balance·open-trades·active-asset, executes trades via the verified buyOption format, and exposes a spy panel + raw traffic export.
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
  if (W.__EO_SPY_V03) return;
  W.__EO_SPY_V03 = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  CONFIG  (مبني على traffic حقيقي مفكوك — v0.3)
  // ══════════════════════════════════════════════════════════════════════
  // البروتوكول المؤكد: WebSocket بإطارات ثنائية محتواها UTF-8 JSON (لا ضغط/لا
  // MsgPack). كل رسالة: { action, message:{...}, token, ns }. الإجراءات المتعددة
  // تُغلَّف بـ multipleAction. الأسعار الحيّة تصل عبر "candles" (tf:0 = tick، v[0]
  // = السعر؛ tf:5 = شمعة 5 ثوانٍ، v=[o,h,l,c]). assetId رقمي يُترجَم عبر "assets".
  const CFG = {
    DIAG_ENABLED      : true,
    DIAG_MAX_PACKETS  : 2500,
    CAPTURE_HEX_BYTES : 48,
    CAPTURE_B64_MAX   : 8192,
    CAPTURE_B64_HEAD  : 2048,

    // ضوضاء منخفضة القيمة — تُعدّ لكنها لا تُعرض في السجل
    LOG_MUTE_ACTIONS  : ['ping', 'candles', 'tradesStatus', 'openOptionsStat', 'expertOption', 'setConversionData'],

    UI_ENABLED        : true,
    DEFAULT_AMOUNT    : 1,
    DEFAULT_EXP_SHIFT : 5,           // ثوانٍ — مدة انتهاء الصفقة الافتراضية

    TRADE_HOST_HINTS  : ['expertoption.com', 'expertoption.finance'],
    INFLATE_FORMATS   : ['gzip', 'deflate', 'deflate-raw'],   // احتياطي فقط

    // أسماء الإجراءات الحقيقية (مؤكدة من العيّنة)
    A: {
      CANDLES        : 'candles',               // بث الأسعار الحيّة
      SUBSCRIBE      : 'subscribeCandles',      // يكشف الأصل النشط
      HISTORY        : 'assetHistoryCandles',
      PROFILE        : 'profile',               // الرصيد
      ASSETS         : 'assets',                // قائمة الأصول → ترجمة id↔symbol
      BUY_RESP       : 'buyOption',             // تأكيد {trade_id}
      OPEN_OK        : 'openTradeSuccessful',
      CLOSE_OK       : 'closeTradeSuccessful',
      TRADE_STATUS   : 'tradesStatus',          // حالة حيّة للصفقات المفتوحة
      CROWD_STAT     : 'openOptionsStat',        // إحصاء جماعي
      CROWD_FEED     : 'expertOption',           // صفقات المتداولين الآخرين (sentiment)
    },
    // خريطة النوع الرقمي في كائنات النتائج: 0=call (شراء/صعود)، 1=put (بيع/هبوط)
    TYPE_CALL: 0, TYPE_PUT: 1,
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 2  UTILITIES
  // ══════════════════════════════════════════════════════════════════════
  const _intervals = [];
  const setIntervalT = (fn, ms) => { const id = setInterval(fn, ms); _intervals.push(id); return id; };
  let _nsCounter = 1000;
  const nextNs = () => _nsCounter++;
  function nowMs() { return Date.now(); }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function fmtTime(ts) { const d = new Date(ts); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
  function safeJSONParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function tryUtf8(bytes) { try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); } catch (_) { return null; } }
  function bytesToHex(bytes, n) { const len = Math.min(n || bytes.length, bytes.length); let s = ''; for (let i = 0; i < len; i++) s += bytes[i].toString(16).padStart(2, '0') + (i % 2 ? ' ' : ''); return s.trim(); }
  function bufToBase64(bytes) { let bin = ''; const c = 0x8000; for (let i = 0; i < bytes.length; i += c) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + c)); return btoa(bin); }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  STATE
  // ══════════════════════════════════════════════════════════════════════
  let activeAssetId   = null;
  let wsConnected     = false;
  let totalFrames     = 0;
  let totalTicks      = 0;
  let balanceDemo     = null;
  let balanceReal     = null;
  let isDemo          = 1;
  let tradeAmount     = CFG.DEFAULT_AMOUNT;
  let expShift        = CFG.DEFAULT_EXP_SHIFT;
  let tradeWS         = null;
  let tradeWSOrig     = null;
  let lastToken       = null;
  let _decodeStats    = { json: 0, inflate: 0, msgpack: 0, fail: 0 };

  const _lastPrice    = new Map();   // assetId → آخر سعر
  const _assetsById   = new Map();   // assetId → { symbol, name, profit, digits, expStep, purchaseTime, active }
  const _openTrades   = new Map();   // tradeId → trade
  const _sentiment    = new Map();   // assetId → { call, put, ts }  (من CROWD_FEED)

  function symOf(id) { const a = _assetsById.get(id); return a ? a.symbol : ('#' + id); }
  function curBalance() { return isDemo ? balanceDemo : balanceReal; }

  // ══════════════════════════════════════════════════════════════════════
  // § 4  MSGPACK (احتياطي — منسوخ من أداة PocketOption)
  // ══════════════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off = buffer.byteOffset || 0, view = new DataView(buf), bytes = new Uint8Array(buf, off);
    let pos = 0;
    const rb = () => bytes[pos++], ru8 = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8 = () => { const v = view.getInt8(pos); pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false); pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false); pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos, false); pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos, false); pos += 8; return v; };
    const ri64 = () => { const h = view.getInt32(pos, false), l = view.getUint32(pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const ru64 = () => { const h = view.getUint32(pos, false), l = view.getUint32(pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const rStr = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return s; };
    const rBin = (n) => { const b = bytes.subarray(pos, pos + n); pos += n; return b; };
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b & 0xf0) === 0x80) { const n = b & 0xf, o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
      if ((b & 0xf0) === 0x90) { const n = b & 0xf, a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
      if ((b & 0xe0) === 0xa0) return rStr(b & 0x1f);
      if ((b & 0xe0) === 0xe0) return b - 256;
      switch (b) {
        case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8()); case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8(); case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8(); case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8()); case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n = ru16(), a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xdd: { const n = ru32(), a = []; for (let i = 0; i < n; i++) a.push(decode()); return a; }
        case 0xde: { const n = ru16(), o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        case 0xdf: { const n = ru32(), o = {}; for (let i = 0; i < n; i++) { const k = decode(); o[k] = decode(); } return o; }
        default: throw new Error('msgpack 0x' + b.toString(16));
      }
    }
    return decode();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 5  DECODE ENGINE (JSON-in-binary أولاً، مع احتياطي ضغط/MsgPack)
  // ══════════════════════════════════════════════════════════════════════
  function parsePlain(ab) {
    const bytes = new Uint8Array(ab);
    if (!bytes.length) return null;
    const c0 = bytes[0];
    if (c0 === 0x7b || c0 === 0x5b) { const j = safeJSONParse(tryUtf8(bytes)); if (j !== null) { _decodeStats.json++; return { method: 'json', value: j }; } }
    try { const v = msgpackDecode(ab); if (v && typeof v === 'object') { _decodeStats.msgpack++; return { method: 'msgpack', value: v }; } } catch (_) {}
    const txt = tryUtf8(bytes);
    if (txt) { const i = txt.search(/[{\[]/); if (i >= 0) { const j = safeJSONParse(txt.slice(i)); if (j) { _decodeStats.json++; return { method: 'json-embedded', value: j }; } } }
    return null;
  }
  async function tryInflate(ab, fmt) {
    if (typeof W.DecompressionStream !== 'function') return null;
    try { return await new Response(new Blob([ab]).stream().pipeThrough(new W.DecompressionStream(fmt))).arrayBuffer(); } catch (_) { return null; }
  }
  async function binDecode(ab) {
    const direct = parsePlain(ab);
    if (direct) return direct;
    const bytes = new Uint8Array(ab);
    if (!bytes.length) return null;
    let order = bytes[0] === 0x1f && bytes[1] === 0x8b ? ['gzip', 'deflate', 'deflate-raw']
              : bytes[0] === 0x78 ? ['deflate', 'gzip', 'deflate-raw'] : ['deflate-raw', 'deflate', 'gzip'];
    for (const fmt of order) { const out = await tryInflate(ab, fmt); if (out && out.byteLength) { const p = parsePlain(out); if (p) { _decodeStats.inflate++; return { method: 'inflate:' + fmt + '+' + p.method, value: p.value }; } } }
    _decodeStats.fail++;
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  PROTOCOL HANDLERS (مبنية على الصيغ الحقيقية)
  // ══════════════════════════════════════════════════════════════════════
  function flattenActions(msg) {
    if (!msg || typeof msg !== 'object') return [];
    if (msg.action === 'multipleAction' && msg.message && Array.isArray(msg.message.actions)) return msg.message.actions.filter(a => a && typeof a === 'object');
    if (msg.action) return [msg];
    return [];
  }

  function onCandles(m) {
    if (!m || !Array.isArray(m.candles)) return;
    const aid = m.assetId;
    if (activeAssetId == null) activeAssetId = aid;
    for (const c of m.candles) {
      let price = null;
      if (c.tf === 0 && Array.isArray(c.v) && c.v.length) price = c.v[0];           // tick
      else if (Array.isArray(c.v) && c.v.length >= 4) price = c.v[3];               // close شمعة
      if (price > 0) { totalTicks++; _lastPrice.set(aid, price); }
    }
  }

  function onSubscribe(m) {
    let id = null;
    if (Array.isArray(m?.assetsIds) && m.assetsIds.length) id = m.assetsIds[m.assetsIds.length - 1];
    else if (Array.isArray(m?.assets) && m.assets.length) id = m.assets[m.assets.length - 1]?.id;
    if (id != null) { activeAssetId = id; addLog('🎯 الأصل النشط: ' + symOf(id) + ' (' + id + ')', 'info'); }
  }

  function onProfile(m) {
    const p = m?.profile || m;
    if (!p) return;
    if (p.demo_balance != null) balanceDemo = +p.demo_balance;
    if (p.real_balance != null) balanceReal = +p.real_balance;
    if (p.is_demo != null) isDemo = +p.is_demo;
    addLog('💰 رصيد — تجريبي: ' + balanceDemo + ' | حقيقي: ' + balanceReal + ' | demo=' + isDemo, 'info');
  }

  function onAssets(m) {
    const list = m?.assets;
    if (!Array.isArray(list)) return;
    for (const a of list) _assetsById.set(a.id, { symbol: a.symbol, name: a.name, profit: a.profit, digits: a.digits, expStep: a.expiration_step, purchaseTime: a.purchase_time, active: a.is_active });
    addLog('📋 أصول مُحمّلة: ' + _assetsById.size, 'info');
  }

  function onOpenOk(m) {
    const t = m?.trade;
    if (!t) return;
    _openTrades.set(t.id, t);
    addLog('🟢 فُتحت صفقة #' + t.id + ' | ' + symOf(t.asset_id) + ' | ' + (t.type === CFG.TYPE_PUT ? 'PUT▼' : 'CALL▲') + ' | $' + t.amount + ' | دخول ' + t.open_rate + ' | ربح ' + t.profit + '%', 'signal');
  }

  function onCloseOk(m) {
    const trades = m?.trades || (m?.trade ? [m.trade] : []);
    for (const t of trades) {
      _openTrades.delete(t.id);
      const win = (t.result_amount || 0) > 0;
      addLog((win ? '✅ ربح' : '❌ خسارة') + ' #' + t.id + ' | ' + symOf(t.asset_id) + ' | خروج ' + t.close_rate + ' | نتيجة $' + t.result_amount, win ? 'signal' : 'error');
    }
  }

  function onCrowdFeed(m) {
    // صفقات متداولين آخرين — نجمّع call/put لكل أصل كمؤشر sentiment
    const opts = m?.options;
    if (!Array.isArray(opts)) return;
    for (const o of opts) {
      const s = _sentiment.get(o.asset_id) || { call: 0, put: 0, ts: nowMs() };
      if (o.type === CFG.TYPE_CALL) s.call++; else if (o.type === CFG.TYPE_PUT) s.put++;
      s.ts = nowMs();
      _sentiment.set(o.asset_id, s);
    }
  }

  function dispatch(action, message, fullMsg) {
    if (fullMsg && fullMsg.token) lastToken = fullMsg.token;
    switch (action) {
      case CFG.A.CANDLES:      onCandles(message); break;
      case CFG.A.SUBSCRIBE:    onSubscribe(message); break;
      case CFG.A.PROFILE:      onProfile(message); break;
      case CFG.A.ASSETS:       onAssets(message); break;
      case CFG.A.OPEN_OK:      onOpenOk(message); break;
      case CFG.A.CLOSE_OK:     onCloseOk(message); break;
      case CFG.A.CROWD_FEED:   onCrowdFeed(message); break;
      case CFG.A.BUY_RESP:     if (message?.trade_id) addLog('📨 تأكيد شراء — trade_id ' + message.trade_id, 'info'); break;
      default: break;
    }
  }

  function processDecoded(decoded) {
    if (!decoded || typeof decoded !== 'object') return;
    const actions = flattenActions(decoded);
    for (const a of actions) dispatch(a.action, a.message ?? a, a.token ? a : decoded);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  DIAGNOSTIC LOGGER
  // ══════════════════════════════════════════════════════════════════════
  const Diag = {
    packets: [], counts: { IN: 0, OUT: 0, byAction: {}, byMethod: {} },
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
        hex: isBin ? bytesToHex(bytes, CFG.CAPTURE_HEX_BYTES) : null,
        b64: null, decoded,
      };
      if (isBin && kind === 'binary') entry.b64 = bytes.length <= CFG.CAPTURE_B64_MAX ? bufToBase64(bytes) : bufToBase64(bytes.subarray(0, CFG.CAPTURE_B64_HEAD)) + '…(+' + (bytes.length - CFG.CAPTURE_B64_HEAD) + 'B)';
      this.packets.push(entry);
      if (this.packets.length > CFG.DIAG_MAX_PACKETS) this.packets.shift();
      if (!CFG.LOG_MUTE_ACTIONS.includes(action)) { try { renderRawLog(entry); } catch (_) {} }
      return entry;
    },
    export() { return JSON.stringify({ meta: { ua: navigator.userAgent, when: new Date().toISOString(), counts: this.counts, decodeStats: _decodeStats }, packets: this.packets }, null, 2); },
    clear() { this.packets.length = 0; this.counts = { IN: 0, OUT: 0, byAction: {}, byMethod: {} }; _decodeStats = { json: 0, inflate: 0, msgpack: 0, fail: 0 }; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 8  WEBSOCKET INTERCEPTION
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;
  function isTradeSocket(urlStr) { return CFG.TRADE_HOST_HINTS.some(h => urlStr.includes(h)); }

  async function handleBinary(ab, wsRef) {
    totalFrames++;
    const bytes = new Uint8Array(ab);
    if (bytes.length <= 2) return;
    const result = await binDecode(ab);
    Diag.record('IN', 'binary', bytes, result);
    if (result && result.value) processDecoded(result.value);
  }
  function handleText(raw, wsRef) {
    totalFrames++;
    const s = raw.trim();
    if (s.length <= 2) return;
    const j = safeJSONParse(s);
    Diag.record('IN', 'text', null, j ? { method: 'text-json', value: j } : { method: 'text', value: null }, raw.length);
    if (j) processDecoded(j);
  }

  function attachHooks(ws, urlStr) {
    if (_sockets.has(ws)) return;
    _sockets.add(ws);
    ws._eoUrl = urlStr;
    try { ws.binaryType = 'arraybuffer'; } catch (_) {}
    const origSend = ws.send.bind(ws);

    if (isTradeSocket(urlStr)) {
      if (!tradeWS || tradeWS.readyState !== 1) { tradeWS = ws; tradeWSOrig = origSend; }
      addLog('🔌 مقبس تداول: ' + urlStr.split('?')[0], 'info');
    }

    ws.send = function (data) {
      try {
        let bytes = null, txt = null;
        if (typeof data === 'string') { txt = data; }
        else if (data instanceof ArrayBuffer) { bytes = new Uint8Array(data); txt = tryUtf8(bytes); }
        else if (ArrayBuffer.isView(data)) { bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); txt = tryUtf8(bytes); }
        const d = txt ? safeJSONParse(txt) : null;
        if (d && d.token) lastToken = d.token;               // ← التقاط token (صادر ثنائي)
        if (bytes) Diag.record('OUT', 'binary', bytes, d ? { method: 'json', value: d } : null);
        else if (txt && (d || txt.length > 2)) Diag.record('OUT', 'text', null, d ? { method: 'text-json', value: d } : { method: 'text', value: null }, txt.length);
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
    ws.addEventListener('open', () => { wsConnected = true; addLog('✅ اتصال مفتوح', 'info'); });
    ws.addEventListener('close', () => { if (ws === tradeWS) tradeWS = null; _sockets.delete(ws); });
  }
  const _sockets = new Set();

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); try { attachHooks(ws, String(args[0] || '')); } catch (_) {} return ws; },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 9  TRADE ENGINE (صيغة buyOption المؤكدة)
  // ══════════════════════════════════════════════════════════════════════
  function buildOpenPayload(direction, assetId, amount, expSeconds) {
    return JSON.stringify({
      action: 'buyOption',
      message: {
        type            : direction === 'put' ? 'put' : 'call',
        amount          : amount,
        assetid         : assetId,                 // ← lowercase (مؤكد من العيّنة)
        strike_time     : nowSec(),
        is_demo         : isDemo,
        expiration_shift: expSeconds,
        ratePosition    : 0,
      },
      token: lastToken,
      ns   : nextNs(),
    });
  }

  // direction: 'call' (صعود) أو 'put' (هبوط)
  function executeTrade(direction, assetId, amount, expSeconds) {
    const aid = assetId != null ? assetId : activeAssetId;
    if (aid == null) { addLog('⚠️ لا أصل نشط', 'error'); return false; }
    if (!tradeWS || tradeWS.readyState !== 1 || !tradeWSOrig) { addLog('⚠️ لا مقبس تداول جاهز', 'error'); return false; }
    if (!lastToken) { addLog('⚠️ لا token مرصود بعد — تفاعل مع الصفحة أولاً', 'error'); return false; }
    const payload = buildOpenPayload(direction, aid, amount || tradeAmount, expSeconds || expShift);
    try {
      tradeWSOrig(new TextEncoder().encode(payload));        // إرسال ثنائي مطابقاً للمنصة
      addLog('⚡ تنفيذ: ' + (direction === 'put' ? 'PUT▼' : 'CALL▲') + ' | ' + symOf(aid) + ' | $' + (amount || tradeAmount) + ' | ' + (expSeconds || expShift) + 'ث', 'signal');
      return true;
    } catch (e) { addLog('❌ فشل التنفيذ: ' + e.message, 'error'); return false; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  UI — Spy Panel
  // ══════════════════════════════════════════════════════════════════════
  let _ui = null, _body = null, _logEl = null, _rawEl = null, _hudEl = null, _restoreBtn = null;
  const LS_KEY = 'eo_spy_ui_v1';
  let _uiState = { left: null, top: null, w: 520, h: null, collapsed: false, hidden: false, opacity: 1 };
  function loadUIState() { try { Object.assign(_uiState, JSON.parse(W.localStorage.getItem(LS_KEY)) || {}); } catch (_) {} }
  function saveUIState() { try { W.localStorage.setItem(LS_KEY, JSON.stringify(_uiState)); } catch (_) {} }
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
    const col = entry.dir === 'OUT' ? '#ffaa44' : (entry.action ? '#66ccff' : '#777');
    const row = document.createElement('div');
    row.style.cssText = 'padding:1px 4px;border-bottom:1px solid #16161e;font:10px monospace;color:' + col + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const body = entry.decoded ? JSON.stringify(entry.decoded.message ?? entry.decoded).slice(0, 260) : (entry.hex || '');
    row.textContent = entry.dir + ' ' + fmtTime(entry.t) + ' ' + entry.size + 'B [' + (entry.action || entry.method) + '] ' + body;
    row.title = (entry.decoded ? JSON.stringify(entry.decoded, null, 1).slice(0, 3000) : '') + (entry.hex ? '\n\nHEX: ' + entry.hex : '');
    _rawEl.insertBefore(row, _rawEl.firstChild);
    while (_rawEl.childNodes.length > 300) _rawEl.removeChild(_rawEl.lastChild);
  }
  function updateHud() {
    if (!_hudEl) return;
    const s = activeAssetId != null ? _sentiment.get(activeAssetId) : null;
    const sent = s ? ('▲' + s.call + ' / ▼' + s.put) : '—';
    const price = activeAssetId != null ? _lastPrice.get(activeAssetId) : null;
    const asset = activeAssetId != null ? _assetsById.get(activeAssetId) : null;
    _hudEl.innerHTML =
      '<b style="color:#33ddaa">EO-SPY v0.3</b> ' + (wsConnected ? '🟢' : '🔴') +
      ' | <b>' + (activeAssetId != null ? symOf(activeAssetId) : '—') + '</b>' +
      ' @ <b>' + (price != null ? price.toFixed(asset?.digits || 4) : '—') + '</b>' +
      ' | ربح ' + (asset?.profit ?? '—') + '%' +
      ' | جمهور ' + sent +
      '<br><span style="color:#9ab;font-size:10px">رصيد: <b>' + (curBalance() ?? '—') + '</b> (' + (isDemo ? 'تجريبي' : 'حقيقي') + ')' +
      ' | ticks ' + totalTicks + ' | إطارات ' + totalFrames + ' | مفتوحة ' + _openTrades.size + ' | أصول ' + _assetsById.size + '</span>';
  }
  function mkBtn(txt, fn, title) { const b = document.createElement('button'); b.textContent = txt; if (title) b.title = title; b.style.cssText = 'flex:0 0 auto;padding:3px 8px;font:11px sans-serif;background:#1a1a33;color:#cce;border:1px solid #33335a;border-radius:4px;cursor:pointer'; b.onclick = fn; return b; }
  function mkWinBtn(txt, fn, title) { const b = document.createElement('button'); b.textContent = txt; b.title = title || ''; b.style.cssText = 'width:22px;height:22px;padding:0;font:12px sans-serif;background:#23234a;color:#cce;border:1px solid #3a3a66;border-radius:4px;cursor:pointer;line-height:1'; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; }

  function applyUIState() {
    if (!_ui) return;
    const s = _uiState;
    if (s.left != null) { _ui.style.left = s.left + 'px'; _ui.style.top = s.top + 'px'; _ui.style.right = 'auto'; }
    if (s.w) _ui.style.width = s.w + 'px';
    _ui.style.height = (s.collapsed || !s.h) ? 'auto' : s.h + 'px';
    _ui.style.opacity = s.opacity;
    _body.style.display = s.collapsed ? 'none' : 'flex';
    _ui.style.display = s.hidden ? 'none' : 'flex';
    if (_restoreBtn) _restoreBtn.style.display = s.hidden ? 'block' : 'none';
  }
  function toggleCollapse() { _uiState.collapsed = !_uiState.collapsed; applyUIState(); saveUIState(); }
  function cycleOpacity() { const seq = [1, 0.7, 0.4]; _uiState.opacity = seq[(seq.indexOf(_uiState.opacity) + 1) % seq.length]; applyUIState(); saveUIState(); }
  function hidePanel() { _uiState.hidden = true; applyUIState(); saveUIState(); }
  function showPanel() { _uiState.hidden = false; applyUIState(); saveUIState(); }

  function makeDraggable(handle) {
    let sx, sy, ox, oy, drag = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = _ui.getBoundingClientRect(); ox = r.left; oy = r.top;
      _ui.style.right = 'auto'; _ui.style.left = ox + 'px'; _ui.style.top = oy + 'px';
      e.preventDefault();
    });
    W.addEventListener('mousemove', (e) => {
      if (!drag) return;
      let nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
      nx = Math.max(0, Math.min(nx, W.innerWidth - 60));
      ny = Math.max(0, Math.min(ny, W.innerHeight - 28));
      _ui.style.left = nx + 'px'; _ui.style.top = ny + 'px';
    });
    W.addEventListener('mouseup', () => {
      if (!drag) return; drag = false;
      const r = _ui.getBoundingClientRect(); _uiState.left = r.left; _uiState.top = r.top; saveUIState();
    });
  }

  function buildUI() {
    if (!CFG.UI_ENABLED || _ui) return;
    loadUIState();

    _ui = document.createElement('div');
    _ui.style.cssText = 'position:fixed;top:8px;right:8px;width:520px;min-width:280px;min-height:0;max-height:92vh;z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;resize:both;background:#0d0d18;border:1px solid #2a2a44;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.6);font-family:system-ui,sans-serif;color:#ccd';

    // ─── شريط العنوان (مقبض السحب + أزرار النافذة) ───
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:#1a1a3a;cursor:move;border-bottom:1px solid #2a2a44;user-select:none';
    const title = document.createElement('span'); title.innerHTML = '🛰️ <b>EO-SPY</b> <span style="color:#667;font-size:10px">v0.3</span>'; title.style.cssText = 'font:12px sans-serif;color:#cce';
    const ctrls = document.createElement('div'); ctrls.style.cssText = 'display:flex;gap:4px';
    ctrls.append(
      mkWinBtn('🌓', cycleOpacity, 'شفافية'),
      mkWinBtn('▁', toggleCollapse, 'تصغير/تكبير'),
      mkWinBtn('✕', hidePanel, 'إخفاء (Alt+S لإظهارها)'),
    );
    bar.append(title, ctrls);

    // ─── الجسم (يُخفى عند التصغير) ───
    _body = document.createElement('div');
    _body.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;min-height:0';
    _hudEl = document.createElement('div'); _hudEl.style.cssText = 'flex:0 0 auto;padding:6px 8px;font:11px monospace;border-bottom:1px solid #2a2a44;background:#11112a';
    const tabs = document.createElement('div'); tabs.style.cssText = 'flex:0 0 auto;display:flex;gap:4px;padding:4px 6px;border-bottom:1px solid #2a2a44;flex-wrap:wrap';
    _logEl = document.createElement('div'); _logEl.style.cssText = 'flex:1 1 35%;min-height:34px;overflow:auto;background:#0a0a14';
    _rawEl = document.createElement('div'); _rawEl.style.cssText = 'flex:1 1 45%;min-height:34px;overflow:auto;background:#08080f;border-top:1px solid #2a2a44';

    tabs.append(
      mkBtn('▲ CALL', () => executeTrade('call'), 'فتح صفقة صعود'),
      mkBtn('▼ PUT', () => executeTrade('put'), 'فتح صفقة هبوط'),
      mkBtn('📋 ملخص', () => { navigator.clipboard?.writeText(JSON.stringify({ byAction: Diag.counts.byAction, byMethod: Diag.counts.byMethod, decodeStats: _decodeStats }, null, 2)); addLog('📋 نُسخ الملخص', 'info'); }),
      mkBtn('⬇️ تصدير', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Diag.export()], { type: 'application/json' })); a.download = 'eo_traffic_' + Date.now() + '.json'; a.click(); addLog('⬇️ صُدّر ' + Diag.packets.length + ' حزمة', 'info'); }),
      mkBtn('🗑️ مسح', () => { Diag.clear(); if (_rawEl) _rawEl.innerHTML = ''; addLog('🗑️ مُسح', 'info'); }),
    );

    const rawHdr = document.createElement('div'); rawHdr.style.cssText = 'flex:0 0 auto;padding:3px 8px;font:10px monospace;color:#778;background:#11111e;border-top:1px solid #2a2a44';
    rawHdr.textContent = '── RAW WS LOG (candles/ping مكتومة — مرّر للتفاصيل) ──';

    _body.append(_hudEl, tabs, _logEl, rawHdr, _rawEl);
    _ui.append(bar, _body);
    document.documentElement.appendChild(_ui);

    // ─── زر عائم لإعادة الإظهار بعد الإخفاء ───
    _restoreBtn = document.createElement('div');
    _restoreBtn.textContent = '🛰️'; _restoreBtn.title = 'إظهار EO-SPY';
    _restoreBtn.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483647;width:36px;height:36px;border-radius:50%;background:#1a1a3a;border:1px solid #3a3a66;color:#cce;font-size:17px;line-height:36px;text-align:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.6);display:none';
    _restoreBtn.onclick = showPanel;
    document.documentElement.appendChild(_restoreBtn);

    // سحب + حفظ الحجم عند تغييره + اختصار Alt+S
    makeDraggable(bar);
    if (typeof W.ResizeObserver === 'function') {
      new W.ResizeObserver(() => { if (!_uiState.collapsed && _ui.style.display !== 'none') { _uiState.w = _ui.offsetWidth; _uiState.h = _ui.offsetHeight; saveUIState(); } }).observe(_ui);
    }
    W.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); _uiState.hidden ? showPanel() : hidePanel(); } });

    applyUIState();
    updateHud();
    addLog('🛰️ EO-SPY v0.3 جاهز — اسحب الشريط العلوي لنقلها، ✕ لإخفائها (Alt+S)', 'signal');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() { if (document.documentElement) buildUI(); else W.addEventListener('DOMContentLoaded', buildUI, { once: true }); }
  if (document.readyState === 'loading') W.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();

  W.__EO_SPY = {
    CFG, Diag, executeTrade, binDecode,
    state: () => ({ activeAsset: activeAssetId != null ? symOf(activeAssetId) : null, assetId: activeAssetId, wsConnected, totalTicks, totalFrames, balance: curBalance(), isDemo, openTrades: _openTrades.size, assets: _assetsById.size, lastToken: !!lastToken }),
    assets: () => _assetsById, trades: () => _openTrades, sentiment: () => _sentiment, price: (id) => _lastPrice.get(id ?? activeAssetId),
  };
  setIntervalT(updateHud, 1000);

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
