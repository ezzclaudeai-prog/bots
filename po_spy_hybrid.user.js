// ==UserScript==
// @name         🕵️ PO SPY HYBRID — Dual-WSS Diagnostic & Reverse Inspector
// @namespace    po-spy-hybrid-diagnostic
// @version      1.0.0
// @description  أداة تشخيص هجينة: تعترض كل مقابس WSS (أوراكل/منفّذ/شات/أحداث)، تفك تشفير الإطارات (socket.io + msgpack)، وتلتقط السعر/التوكن/الكوكي/الصفقة/عمر الشمعة/التيكات/النقاط/الزوج — مع واجهة عائمة وتصدير كامل. مراقبة سلبية فقط (لا تنفّذ صفقات).
// @match        *://*.po.market/*
// @match        *://*.pocketoption.com/*
// @match        *://pocketoption.com/*
// @match        *://*.po.trade/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const W = unsafeWindow || window;

  // ══════════════════════════════════════════════════════════════════════
  // § 0  الإعدادات + تصنيف الخوادم
  // ══════════════════════════════════════════════════════════════════════
  const CFG = {
    MAX_LOG          : 600,     // سقف سطور السجل الخام
    MAX_TICKS        : 400,     // سقف التيكات المخزّنة لكل مصدر
    UI_REFRESH_MS    : 700,     // تحديث الواجهة
    LEADLAG_WINDOW   : 60,      // عدد التيكات لمقارنة السبق بين A و B
    PIP_FACTOR       : 100000,  // 1 نقطة = فرق السعر × 10^5 (يناسب 5 منازل)
    SHOW_TICK_LOG    : false,   // طباعة كل تيك في السجل الخام (ضجيج عالٍ — مغلق افتراضياً)
  };

  // أنماط الخوادم المعروفة من فكرة Dual-WSS
  const SERVER_MAP = [
    { re: /events-po/i,            role: 'ORACLE',   tag: '🔮 أوراكل (سريع)' },
    { re: /demo-api-eu|try-demo/i, role: 'EXEC-DEMO',tag: '⚡ منفّذ ديمو' },
    { re: /api-msk/i,              role: 'EXEC-REAL',tag: '💼 منفّذ حقيقي' },
    { re: /api-eu|api-l/i,         role: 'DATA',     tag: '📊 بيانات حقيقية' },
    { re: /chat-po/i,              role: 'CHAT',     tag: '💬 شات' },
    { re: /po\.market|pocketoption|po\.trade/i, role: 'PLATFORM', tag: '🌐 منصة' },
  ];
  function classify(url) {
    for (const s of SERVER_MAP) if (s.re.test(url)) return s;
    return { role: 'UNKNOWN', tag: '❔ غير معروف' };
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 1  مخازن البيانات
  // ══════════════════════════════════════════════════════════════════════
  const STORE = {
    sockets   : new Map(),   // ws -> {id,url,role,tag,opened,inCount,outCount,lastIn,lastOut,events:{},bytesIn,bytesOut,readyState}
    rawLog    : [],          // [{ts,dir,sid,role,ev,preview}]
    ticks     : { },         // role -> [{asset,price,ts}]
    lastPrice : { },         // asset -> {ORACLE:{p,t}, others:{p,t}}
    candles   : { },         // asset -> {open,high,low,prices,startTime,period}
    trades    : [],          // [{id,asset,dir,amount,dur,openPrice,openTs,closePrice,result,profit,pips}]
    session   : { token:null, ssid:null, uid:null, balance:null, isDemo:null, cookies:'', storage:{} },
    leadlag   : { samples: [], emaMs: null }, // قياس سبق الأوراكل مقابل المنفّذ
    counters  : { framesText:0, framesBin:0, decoded:0, decodeErr:0 },
    startTs   : Date.now(),
  };
  let _sidSeq = 0;
  const _pendingEvent = new WeakMap(); // ws -> {name, ts}  (اسم الحدث قبل الإطار الثنائي)

  function pushLog(dir, sid, role, ev, preview) {
    STORE.rawLog.push({ ts: Date.now(), dir, sid, role, ev, preview: String(preview).slice(0, 160) });
    if (STORE.rawLog.length > CFG.MAX_LOG) STORE.rawLog.shift();
  }
  function pushTick(role, asset, price, ts) {
    const arr = STORE.ticks[role] || (STORE.ticks[role] = []);
    arr.push({ asset, price, ts });
    if (arr.length > CFG.MAX_TICKS) arr.shift();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 2  فكّ تشفير msgpack (مدمج)
  // ══════════════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf, off);
    let pos = 0;
    const u8 = () => bytes[pos++];
    const u16 = () => { const v = view.getUint16(off + pos, false); pos += 2; return v; };
    const u32 = () => { const v = view.getUint32(off + pos, false); pos += 4; return v; };
    const i8 = () => { const v = view.getInt8(off + pos); pos += 1; return v; };
    const i16 = () => { const v = view.getInt16(off + pos, false); pos += 2; return v; };
    const i32 = () => { const v = view.getInt32(off + pos, false); pos += 4; return v; };
    const f32 = () => { const v = view.getFloat32(off + pos, false); pos += 4; return v; };
    const f64 = () => { const v = view.getFloat64(off + pos, false); pos += 8; return v; };
    const u64 = () => { const h = view.getUint32(off + pos, false), l = view.getUint32(off + pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const i64 = () => { const h = view.getInt32(off + pos, false), l = view.getUint32(off + pos + 4, false); pos += 8; return h * 4294967296 + l; };
    const str = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos + n)); pos += n; return s; };
    function dec() {
      const b = u8();
      if (b <= 0x7f) return b;                 // positive fixint
      if (b >= 0xe0) return b - 256;            // negative fixint
      if (b >= 0x80 && b <= 0x8f) { const n = b & 0x0f; const o = {}; for (let i = 0; i < n; i++) { const k = dec(); o[k] = dec(); } return o; }
      if (b >= 0x90 && b <= 0x9f) { const n = b & 0x0f; const a = []; for (let i = 0; i < n; i++) a.push(dec()); return a; }
      if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f); // fixstr
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xcc: return u8();
        case 0xcd: return u16();
        case 0xce: return u32();
        case 0xcf: return u64();
        case 0xd0: return i8();
        case 0xd1: return i16();
        case 0xd2: return i32();
        case 0xd3: return i64();
        case 0xca: return f32();
        case 0xcb: return f64();
        case 0xd9: return str(u8());
        case 0xda: return str(u16());
        case 0xdb: return str(u32());
        case 0xdc: { const n = u16(); const a = []; for (let i = 0; i < n; i++) a.push(dec()); return a; }
        case 0xdd: { const n = u32(); const a = []; for (let i = 0; i < n; i++) a.push(dec()); return a; }
        case 0xde: { const n = u16(); const o = {}; for (let i = 0; i < n; i++) { const k = dec(); o[k] = dec(); } return o; }
        case 0xdf: { const n = u32(); const o = {}; for (let i = 0; i < n; i++) { const k = dec(); o[k] = dec(); } return o; }
        default: return null;
      }
    }
    try { return dec(); } catch (_) { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  مستخرجات: تيك / صفقة / توكن
  // ══════════════════════════════════════════════════════════════════════
  // صيغة تيك PO: ["#AAPL_otc", [[1,1]], 185.189]  أو  {asset, price}
  function extractTick(arr) {
    try {
      if (Array.isArray(arr)) {
        // [[ "#ASSET", [...], price ], ...]  أو  ["#ASSET", [...], price]
        if (Array.isArray(arr[0]) && typeof arr[0][0] === 'string') arr = arr[0];
        if (typeof arr[0] === 'string' && arr[0].length >= 3) {
          const asset = arr[0].replace(/^#/, '');
          // ابحث عن أول رقم منطقي كسعر
          let price = null;
          for (let i = arr.length - 1; i >= 1; i--) {
            if (typeof arr[i] === 'number' && arr[i] > 0) { price = arr[i]; break; }
          }
          if (price != null) return { asset, price, ts: Date.now() };
        }
      } else if (arr && typeof arr === 'object') {
        const asset = arr.asset || arr.symbol || arr.active;
        const price = arr.price || arr.close || arr.rate || arr.value;
        if (asset && typeof price === 'number') return { asset: String(asset).replace(/^#/, ''), price, ts: Date.now() };
      }
    } catch (_) {}
    return null;
  }

  function buildCandle(asset, price) {
    const a = asset;
    let c = STORE.candles[a];
    const now = Date.now();
    if (!c) { STORE.candles[a] = { open: price, high: price, low: price, close: price, prices: [price], startTime: now, period: 0, ticks: 1 }; return; }
    c.close = price; c.ticks = (c.ticks || 0) + 1;
    c.prices.push(price); if (c.prices.length > 300) c.prices.shift();
    if (price > c.high) c.high = price;
    if (price < c.low) c.low = price;
  }

  function captureSessionFrom(obj) {
    try {
      const flat = JSON.stringify(obj);
      // التقاط التوكن/الجلسة بأنماط شائعة
      const m1 = flat.match(/"(session|token|ssid|auth_token|access_token)"\s*:\s*"([^"]{8,})"/i);
      if (m1) { STORE.session.token = STORE.session.token || m1[2]; STORE.session.ssid = STORE.session.ssid || m1[2]; }
      if (obj && typeof obj === 'object') {
        if (obj.uid != null) STORE.session.uid = obj.uid;
        if (obj.id != null && STORE.session.uid == null && String(obj.id).length < 12) STORE.session.uid = obj.id;
        if (obj.balance != null) STORE.session.balance = obj.balance;
        if (obj.isDemo != null) STORE.session.isDemo = obj.isDemo;
        if (obj.demo != null) STORE.session.isDemo = obj.demo;
      }
    } catch (_) {}
  }

  function refreshClientSession() {
    try { STORE.session.cookies = document.cookie || ''; } catch (_) {}
    try {
      const st = {};
      for (let i = 0; i < W.localStorage.length; i++) {
        const k = W.localStorage.key(i);
        if (/token|session|ssid|uid|auth|user|balance|demo/i.test(k)) st[k] = String(W.localStorage.getItem(k)).slice(0, 200);
      }
      STORE.session.storage = st;
      // التقاط التوكن من الكوكي إن وُجد
      const ck = (document.cookie || '').match(/(ci_session|session|token|ssid)=([^;]+)/i);
      if (ck && !STORE.session.token) STORE.session.token = decodeURIComponent(ck[2]);
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 4  قياس سبق الأوراكل مقابل المنفّذ (Lead/Lag)
  // ══════════════════════════════════════════════════════════════════════
  function recordLeadLag(asset, price, role) {
    const lp = STORE.lastPrice[asset] || (STORE.lastPrice[asset] = {});
    lp[role] = { p: price, t: Date.now() };
    // عند توفر سعر من الأوراكل والمنفّذ لنفس الزوج، قِس فرق الوصول لنفس مستوى السعر
    const oracle = lp.ORACLE;
    const exec = lp['EXEC-DEMO'] || lp['EXEC-REAL'] || lp.DATA;
    if (oracle && exec) {
      const dPrice = Math.abs(oracle.p - exec.p);
      const dT = oracle.t - exec.t; // سالب = الأوراكل وصل أولاً (سبق)
      STORE.leadlag.samples.push({ dT, dPrice, t: Date.now() });
      if (STORE.leadlag.samples.length > 200) STORE.leadlag.samples.shift();
      STORE.leadlag.emaMs = STORE.leadlag.emaMs == null ? dT : STORE.leadlag.emaMs * 0.9 + dT * 0.1;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 5  معالجة الأحداث المفكوكة
  // ══════════════════════════════════════════════════════════════════════
  function handleEvent(meta, ev, data, dir) {
    const sock = STORE.sockets.get(meta.ws);
    if (sock) { sock.events[ev] = (sock.events[ev] || 0) + 1; }

    // التقاط الجلسة من أحداث المصادقة
    if (/auth|success|profile|user|balance|environment/i.test(ev)) captureSessionFrom(data);

    // signals = مصدر الأوراكل (سعر حي)
    if (ev === 'signals') {
      const t = extractTick(data);
      if (t) {
        pushTick(meta.role, t.asset, t.price, t.ts);
        recordLeadLag(t.asset, t.price, meta.role);
        if (meta.role === 'ORACLE') buildCandle(t.asset, t.price);
      }
    }
    // تيكات التدفق
    if (['updateStream', 'tick', 'quote', 'stream'].includes(ev)) {
      const t = extractTick(data);
      if (t) {
        pushTick(meta.role, t.asset, t.price, t.ts);
        recordLeadLag(t.asset, t.price, meta.role);
        buildCandle(t.asset, t.price);
      }
    }
    // تاريخ → استخراج الفريم (period) للزوج
    if (ev === 'updateHistoryNewFast' && data && data.asset && Array.isArray(data.history)) {
      const a = String(data.asset).replace(/^#/, '');
      const c = STORE.candles[a] || (STORE.candles[a] = { prices: [], ticks: 0, startTime: Date.now() });
      if (data.period) c.period = data.period;
    }
    // الزوج النشط
    if (ev === 'changeSymbol' && data) {
      const a = data.asset || (Array.isArray(data) ? data[0] : null);
      if (a) STORE.session.activeAsset = String(a).replace(/^#/, '');
    }
    // فتح صفقة
    if (ev === 'successopenOrder' && data && data.id) {
      STORE.trades.push({
        id: data.id, asset: (data.asset || data.active || '').replace(/^#/, ''),
        dir: data.command === 0 || data.action === 'call' ? 'BUY' : (data.command === 1 || data.action === 'put' ? 'SELL' : '?'),
        amount: data.amount, dur: data.duration || data.timeframe, openPrice: data.openPrice || data.openRate,
        openTs: Date.now(), result: 'pending', profit: null, pips: null,
      });
      if (STORE.trades.length > 80) STORE.trades.shift();
    }
    // إغلاق صفقة / نتيجة
    if (ev === 'successcloseOrder' && data) {
      const deals = data.deals || (Array.isArray(data) ? data : [data]);
      for (const d of deals) {
        const tr = STORE.trades.find(x => x.id === d.id);
        if (tr) {
          tr.closePrice = d.closePrice || d.closeRate;
          tr.profit = d.profit;
          tr.result = (d.profit > 0) ? 'WIN' : (d.profit < 0 ? 'LOSS' : 'TIE');
          if (tr.openPrice && tr.closePrice) tr.pips = ((tr.closePrice - tr.openPrice) * CFG.PIP_FACTOR).toFixed(1);
        }
      }
    }
    if (ev === 'successupdateBalance' && data && data.balance != null) STORE.session.balance = data.balance;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  معالجة الإطارات الواردة/الصادرة (socket.io)
  // ══════════════════════════════════════════════════════════════════════
  function onText(meta, raw, dir) {
    STORE.counters.framesText++;
    if (raw === '2' || raw === '3' || raw === '40') { pushLog(dir, meta.sid, meta.role, raw === '2' ? 'ping' : raw === '3' ? 'pong' : 'open', ''); return; }
    // 45N-["event",bin]  → اسم حدث يسبق إطاراً ثنائياً
    if (raw.startsWith('45')) {
      const d = raw.indexOf('-');
      if (d !== -1) {
        try { const arr = JSON.parse(raw.slice(d + 1)); if (Array.isArray(arr) && typeof arr[0] === 'string') { _pendingEvent.set(meta.ws, { name: arr[0], ts: Date.now() }); } } catch (_) {}
      }
      return;
    }
    if (!raw.startsWith('42') && !raw.startsWith('43')) {
      pushLog(dir, meta.sid, meta.role, 'sys', raw);
      return;
    }
    let payload; try { payload = JSON.parse(raw.slice(2)); } catch (_) { return; }
    if (!Array.isArray(payload)) return;
    const ev = payload[0], data = payload[1];
    handleEvent(meta, ev, data, dir);
    if (ev !== 'updateStream' || CFG.SHOW_TICK_LOG) {
      pushLog(dir, meta.sid, meta.role, ev, JSON.stringify(data));
    }
  }

  function onBinary(meta, buf, dir) {
    STORE.counters.framesBin++;
    let evName = 'binary';
    const pe = _pendingEvent.get(meta.ws);
    if (pe && (Date.now() - pe.ts) < 500) { evName = pe.name; _pendingEvent.delete(meta.ws); }
    const decoded = msgpackDecode(buf);
    if (decoded === null) { STORE.counters.decodeErr++; return; }
    STORE.counters.decoded++;
    handleEvent(meta, evName, decoded, dir);
    if (evName !== 'updateStream' || CFG.SHOW_TICK_LOG) {
      pushLog(dir, meta.sid, meta.role, evName + '·bin', JSON.stringify(decoded));
    }
  }

  function dispatchIncoming(meta, data, dir) {
    const sock = STORE.sockets.get(meta.ws);
    if (sock) { sock[dir === 'in' ? 'inCount' : 'outCount']++; sock[dir === 'in' ? 'lastIn' : 'lastOut'] = Date.now(); }
    try {
      if (typeof data === 'string') {
        if (sock) sock.bytesIn += data.length;
        onText(meta, data, dir);
      } else if (data instanceof ArrayBuffer) {
        if (sock) sock.bytesIn += data.byteLength;
        onBinary(meta, data, dir);
      } else if (data instanceof Blob) {
        data.arrayBuffer().then(b => onBinary(meta, b, dir)).catch(() => {});
      }
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  اعتراض WebSocket (حقن في المنصة)
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;
  function HookedWS(url, protocols) {
    const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
    const urlStr = String(url);
    const cls = classify(urlStr);
    const sid = ++_sidSeq;
    ws._spySid = sid;
    const meta = { ws, sid, url: urlStr, role: cls.role, tag: cls.tag };

    STORE.sockets.set(ws, {
      id: sid, url: urlStr, role: cls.role, tag: cls.tag, opened: Date.now(),
      inCount: 0, outCount: 0, lastIn: 0, lastOut: 0, bytesIn: 0, bytesOut: 0,
      events: {}, get readyState() { return ws.readyState; },
    });
    pushLog('sys', sid, cls.role, 'CONNECT', urlStr.split('?')[0]);

    // اعتراض الإرسال (نلتقط التوكن في إطارات الإرسال أيضاً)
    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      try {
        const s = STORE.sockets.get(ws); if (s) { s.outCount++; s.lastOut = Date.now(); }
        if (typeof data === 'string') {
          if (s) s.bytesOut += data.length;
          if (data.startsWith('42') || data.startsWith('40')) {
            try { const p = JSON.parse(data.replace(/^4[02]/, '') || 'null'); if (p) { captureSessionFrom(p); } } catch (_) {}
          }
          onText(meta, data, 'out');
        }
      } catch (_) {}
      return origSend(data);
    };

    ws.addEventListener('message', (e) => dispatchIncoming(meta, e.data, 'in'));
    ws.addEventListener('close', () => { pushLog('sys', sid, cls.role, 'CLOSE', urlStr.split('?')[0]); });
    ws.addEventListener('error', () => { pushLog('sys', sid, cls.role, 'ERROR', urlStr.split('?')[0]); });
    return ws;
  }
  HookedWS.prototype = NativeWS.prototype;
  HookedWS.CONNECTING = NativeWS.CONNECTING; HookedWS.OPEN = NativeWS.OPEN;
  HookedWS.CLOSING = NativeWS.CLOSING; HookedWS.CLOSED = NativeWS.CLOSED;
  try { W.WebSocket = HookedWS; } catch (_) {}

  // ══════════════════════════════════════════════════════════════════════
  // § 8  الواجهة العائمة
  // ══════════════════════════════════════════════════════════════════════
  const TABS = ['servers', 'ticks', 'oracle', 'candles', 'trades', 'session', 'raw'];
  const TAB_LABEL = { servers: '📡 السيرفرات', ticks: '💹 التيكات', oracle: '🔮 الأوراكل', candles: '🕯️ الشموع', trades: '💰 الصفقات', session: '🔑 الجلسة', raw: '📜 الخام' };
  let _activeTab = 'servers';

  function injectUI() {
    if (W.document.getElementById('poSpyRoot')) return;
    const css = W.document.createElement('style');
    css.textContent = `
      #poSpyRoot{position:fixed;bottom:14px;right:14px;width:430px;max-width:96vw;z-index:2147483647;
        font-family:'Segoe UI','Noto Sans Arabic',sans-serif;direction:rtl;}
      #poSpyHead{background:linear-gradient(135deg,#0f2027,#2c5364);color:#fff;padding:9px 12px;border-radius:12px 12px 0 0;
        display:flex;align-items:center;justify-content:space-between;cursor:grab;user-select:none;}
      #poSpyHead b{font-size:13px;} #poSpyHead .st{font-size:10px;opacity:.85;}
      #poSpyBody{background:#0b1220;color:#cbd5e1;border:1px solid #1e293b;border-top:none;border-radius:0 0 12px 12px;
        max-height:62vh;display:flex;flex-direction:column;}
      #poSpyTabs{display:flex;flex-wrap:wrap;gap:3px;padding:6px;background:#0e1626;border-bottom:1px solid #1e293b;}
      .poSpyTab{font-size:10.5px;padding:4px 8px;border-radius:7px;background:#1e293b;color:#94a3b8;cursor:pointer;border:1px solid transparent;}
      .poSpyTab.on{background:#2563eb;color:#fff;}
      #poSpyContent{padding:8px;overflow:auto;font-size:11px;line-height:1.55;}
      #poSpyFoot{display:flex;gap:6px;padding:7px;border-top:1px solid #1e293b;background:#0e1626;border-radius:0 0 12px 12px;}
      .poSpyBtn{flex:1;font-size:11px;padding:6px;border-radius:8px;border:none;cursor:pointer;color:#fff;}
      .bCopy{background:#16a34a;} .bJSON{background:#7c3aed;} .bClear{background:#475569;} .bMin{background:#334155;color:#cbd5e1;}
      .poSpyTbl{width:100%;border-collapse:collapse;}
      .poSpyTbl td,.poSpyTbl th{border-bottom:1px solid #1e293b;padding:4px 5px;text-align:right;font-size:10.5px;}
      .poSpyTbl th{color:#7dd3fc;}
      .mono{font-family:'Consolas',monospace;direction:ltr;unicode-bidi:embed;}
      .rIn{color:#86efac;} .rOut{color:#fca5a5;} .rSys{color:#fbbf24;}
      .pill{display:inline-block;padding:1px 6px;border-radius:6px;font-size:9.5px;margin-left:3px;}
      .pOracle{background:#7c3aed;color:#fff;} .pExec{background:#16a34a;color:#fff;} .pData{background:#2563eb;color:#fff;}
      .pChat{background:#475569;color:#fff;} .pUnk{background:#b91c1c;color:#fff;} .pPlat{background:#0891b2;color:#fff;}
      .kv{display:flex;justify-content:space-between;border-bottom:1px solid #16203400;padding:2px 0;}
      .kv b{color:#7dd3fc;font-weight:600;} .kv span{color:#e2e8f0;}
      .big{font-size:15px;font-weight:700;color:#fff;} .grn{color:#4ade80;} .red{color:#f87171;} .yel{color:#facc15;}
      #poSpyRoot.min #poSpyBody{display:none;}
    `;
    W.document.head.appendChild(css);

    const root = W.document.createElement('div');
    root.id = 'poSpyRoot';
    root.innerHTML = `
      <div id="poSpyHead">
        <b>🕵️ PO SPY HYBRID</b>
        <span class="st" id="poSpySt">—</span>
      </div>
      <div id="poSpyBody">
        <div id="poSpyTabs"></div>
        <div id="poSpyContent">…</div>
        <div id="poSpyFoot">
          <button class="poSpyBtn bCopy">📋 نسخ التقرير</button>
          <button class="poSpyBtn bJSON">⬇️ JSON</button>
          <button class="poSpyBtn bClear">🗑️</button>
          <button class="poSpyBtn bMin">_</button>
        </div>
      </div>`;
    W.document.body.appendChild(root);

    const tabsEl = root.querySelector('#poSpyTabs');
    TABS.forEach(t => {
      const b = W.document.createElement('div');
      b.className = 'poSpyTab' + (t === _activeTab ? ' on' : '');
      b.textContent = TAB_LABEL[t];
      b.onclick = () => { _activeTab = t; tabsEl.querySelectorAll('.poSpyTab').forEach(x => x.classList.remove('on')); b.classList.add('on'); render(); };
      tabsEl.appendChild(b);
    });

    root.querySelector('.bCopy').onclick = () => copyText(buildTextReport());
    root.querySelector('.bJSON').onclick = () => downloadJSON();
    root.querySelector('.bClear').onclick = () => { STORE.rawLog.length = 0; STORE.trades.length = 0; for (const k in STORE.ticks) STORE.ticks[k].length = 0; render(); };
    root.querySelector('.bMin').onclick = () => root.classList.toggle('min');

    // سحب الواجهة
    let drag = null;
    root.querySelector('#poSpyHead').addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, r: root.getBoundingClientRect() }; });
    W.addEventListener('mousemove', (e) => { if (!drag) return; root.style.left = (drag.r.left + e.clientX - drag.x) + 'px'; root.style.top = (drag.r.top + e.clientY - drag.y) + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; });
    W.addEventListener('mouseup', () => drag = null);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 9  العرض
  // ══════════════════════════════════════════════════════════════════════
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const ago = t => t ? ((Date.now() - t) / 1000).toFixed(1) + 'ث' : '—';
  function pillCls(role) { return role === 'ORACLE' ? 'pOracle' : /EXEC/.test(role) ? 'pExec' : role === 'DATA' ? 'pData' : role === 'CHAT' ? 'pChat' : role === 'PLATFORM' ? 'pPlat' : 'pUnk'; }

  function render() {
    const el = W.document.getElementById('poSpyContent'); if (!el) return;
    const st = W.document.getElementById('poSpySt');
    const oracleTicks = (STORE.ticks.ORACLE || []).length;
    const upMs = ((Date.now() - STORE.startTs) / 1000).toFixed(0);
    if (st) st.textContent = `سوكِت:${STORE.sockets.size} · أوراكل:${oracleTicks} تيك · ${upMs}ث`;

    let h = '';
    if (_activeTab === 'servers') {
      h += `<table class="poSpyTbl"><tr><th>#</th><th>الدور</th><th>وارد</th><th>صادر</th><th>آخر</th><th>أحداث</th></tr>`;
      for (const [, s] of STORE.sockets) {
        const evN = Object.keys(s.events).length;
        h += `<tr><td>${s.id}</td><td><span class="pill ${pillCls(s.role)}">${s.tag}</span></td>
          <td>${s.inCount}</td><td>${s.outCount}</td><td class="mono">${ago(s.lastIn)}</td><td>${evN}</td></tr>`;
      }
      h += `</table><div style="margin-top:6px" class="mono">إطارات: نص ${STORE.counters.framesText} · ثنائي ${STORE.counters.framesBin} · مفكوك ${STORE.counters.decoded} · أخطاء ${STORE.counters.decodeErr}</div>`;
    }
    else if (_activeTab === 'ticks') {
      h += `<div class="kv"><b>مصادر التيك:</b><span></span></div>`;
      for (const role of Object.keys(STORE.ticks)) {
        const arr = STORE.ticks[role]; const last = arr[arr.length - 1];
        h += `<div class="kv"><b><span class="pill ${pillCls(role)}">${role}</span></b><span class="mono">${arr.length} تيك · آخر: ${last ? last.price + ' (' + last.asset + ')' : '—'}</span></div>`;
      }
      h += `<table class="poSpyTbl" style="margin-top:6px"><tr><th>الدور</th><th>الزوج</th><th>السعر</th><th>منذ</th></tr>`;
      const merged = [];
      for (const role of Object.keys(STORE.ticks)) for (const t of STORE.ticks[role].slice(-12)) merged.push({ role, ...t });
      merged.sort((a, b) => b.ts - a.ts);
      for (const t of merged.slice(0, 16)) h += `<tr><td><span class="pill ${pillCls(t.role)}">${t.role}</span></td><td class="mono">${esc(t.asset)}</td><td class="mono">${t.price}</td><td class="mono">${ago(t.ts)}</td></tr>`;
      h += `</table>`;
    }
    else if (_activeTab === 'oracle') {
      const o = STORE.ticks.ORACLE || [];
      const ll = STORE.leadlag;
      h += `<div class="kv"><b>تيكات الأوراكل (events-po):</b><span class="big ${o.length ? 'grn' : 'red'}">${o.length}</span></div>`;
      if (!o.length) {
        h += `<div style="color:#fbbf24;margin:6px 0">⚠️ لا توجد تيكات من الأوراكل بعد. إمّا أن events-po لا يبثّ <span class="mono">signals</span> لهذا الزوج، أو لم يُفتح اتصال الأوراكل. هذا هو سبب خمول فلتر الأوراكل في البوت.</div>`;
      } else {
        const last = o[o.length - 1];
        h += `<div class="kv"><b>آخر سعر أوراكل:</b><span class="mono big">${last.price}</span></div>`;
        h += `<div class="kv"><b>الزوج:</b><span class="mono">${esc(last.asset)}</span></div>`;
      }
      h += `<div class="kv"><b>سبق الأوراكل (Lead/Lag):</b><span class="mono ${ll.emaMs < 0 ? 'grn' : 'yel'}">${ll.emaMs == null ? '— لا مقارنة' : ll.emaMs.toFixed(0) + ' ms'}</span></div>`;
      h += `<div class="mono" style="font-size:10px;color:#64748b;margin-top:4px">سالب = الأوراكل يصل قبل المنفّذ (سبق إيجابي للمراجحة). موجب = المنفّذ أسرع (لا سبق).</div>`;
      h += `<div class="kv" style="margin-top:6px"><b>عيّنات المقارنة:</b><span class="mono">${ll.samples.length}</span></div>`;
    }
    else if (_activeTab === 'candles') {
      h += `<table class="poSpyTbl"><tr><th>الزوج</th><th>السعر</th><th>قمة/قاع</th><th>تيكات</th><th>عمر</th><th>فريم</th></tr>`;
      for (const a of Object.keys(STORE.candles)) {
        const c = STORE.candles[a];
        h += `<tr><td class="mono">${esc(a)}</td><td class="mono">${(c.close || 0)}</td>
          <td class="mono">${(c.high || 0)}/${(c.low || 0)}</td><td>${c.ticks || 0}</td>
          <td class="mono">${ago(c.startTime)}</td><td class="mono">${c.period || '?'}ث</td></tr>`;
      }
      h += `</table>`;
    }
    else if (_activeTab === 'trades') {
      h += `<table class="poSpyTbl"><tr><th>الزوج</th><th>اتجاه</th><th>مبلغ</th><th>مدة</th><th>دخول</th><th>نقاط</th><th>نتيجة</th></tr>`;
      for (const t of STORE.trades.slice(-14).reverse()) {
        const rc = t.result === 'WIN' ? 'grn' : t.result === 'LOSS' ? 'red' : 'yel';
        h += `<tr><td class="mono">${esc(t.asset)}</td><td>${t.dir}</td><td class="mono">${t.amount ?? '?'}</td>
          <td class="mono">${t.dur ?? '?'}ث</td><td class="mono">${t.openPrice ?? '?'}</td>
          <td class="mono ${rc}">${t.pips ?? '—'}</td><td class="${rc}">${t.result}</td></tr>`;
      }
      h += `</table>`;
      if (!STORE.trades.length) h += `<div style="color:#64748b">لا صفقات ملتقطة بعد.</div>`;
    }
    else if (_activeTab === 'session') {
      refreshClientSession();
      const s = STORE.session;
      const row = (k, v) => `<div class="kv"><b>${k}</b><span class="mono">${esc(v == null ? '—' : String(v).slice(0, 60))}</span></div>`;
      h += row('الزوج النشط', s.activeAsset);
      h += row('isDemo', s.isDemo);
      h += row('UID', s.uid);
      h += row('الرصيد', s.balance);
      h += row('التوكن/الجلسة', s.token);
      h += row('SSID', s.ssid);
      h += `<div class="kv"><b>الكوكي</b><span class="mono" style="max-width:60%;overflow:hidden;text-overflow:ellipsis">${esc((s.cookies || '').slice(0, 80))}…</span></div>`;
      h += `<div style="margin-top:4px;color:#7dd3fc">localStorage:</div>`;
      for (const k of Object.keys(s.storage || {})) h += row(k, s.storage[k]);
    }
    else if (_activeTab === 'raw') {
      const rows = STORE.rawLog.slice(-60).reverse();
      h += `<div class="mono" style="font-size:10px">`;
      for (const r of rows) {
        const cls = r.dir === 'in' ? 'rIn' : r.dir === 'out' ? 'rOut' : 'rSys';
        const tm = new Date(r.ts).toLocaleTimeString('en-GB', { hour12: false });
        h += `<div class="${cls}">[${tm}] #${r.sid} ${r.dir.toUpperCase()} <b>${esc(r.ev)}</b> ${esc(r.preview)}</div>`;
      }
      h += `</div>`;
    }
    el.innerHTML = h;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  تصدير / نسخ
  // ══════════════════════════════════════════════════════════════════════
  function buildTextReport() {
    const L = [];
    L.push('════════ PO SPY HYBRID — تقرير تشخيصي ════════');
    L.push('الوقت: ' + new Date().toLocaleString());
    L.push('مدة التشغيل: ' + ((Date.now() - STORE.startTs) / 1000).toFixed(0) + 'ث');
    L.push('');
    L.push('── السيرفرات (' + STORE.sockets.size + ') ──');
    for (const [, s] of STORE.sockets) {
      L.push(`#${s.id} [${s.role}] ${s.url.split('?')[0]}`);
      L.push(`   وارد:${s.inCount} صادر:${s.outCount} bytesIn:${s.bytesIn} آخر_وارد:${ago(s.lastIn)}`);
      L.push(`   أحداث: ${Object.entries(s.events).map(([k, v]) => k + '×' + v).join(', ') || '—'}`);
    }
    L.push('');
    L.push('── التيكات لكل مصدر ──');
    for (const role of Object.keys(STORE.ticks)) {
      const arr = STORE.ticks[role]; const last = arr[arr.length - 1];
      L.push(`${role}: ${arr.length} تيك | آخر: ${last ? last.asset + ' @ ' + last.price : '—'}`);
    }
    L.push('');
    L.push('── الأوراكل (التشخيص الحاسم) ──');
    const o = STORE.ticks.ORACLE || [];
    L.push('تيكات الأوراكل: ' + o.length + (o.length ? '' : '  ⚠️ لا يبثّ — هذا سبب خمول فلتر الأوراكل'));
    L.push('سبق Lead/Lag (EMA): ' + (STORE.leadlag.emaMs == null ? '—' : STORE.leadlag.emaMs.toFixed(0) + ' ms') + '  (سالب=سبق أوراكل)');
    L.push('عيّنات المقارنة: ' + STORE.leadlag.samples.length);
    L.push('');
    L.push('── الشموع ──');
    for (const a of Object.keys(STORE.candles)) {
      const c = STORE.candles[a];
      L.push(`${a}: سعر ${c.close} | قمة ${c.high} قاع ${c.low} | تيكات ${c.ticks} | عمر ${ago(c.startTime)} | فريم ${c.period || '?'}ث`);
    }
    L.push('');
    L.push('── الصفقات ──');
    for (const t of STORE.trades) L.push(`${t.asset} ${t.dir} $${t.amount} ${t.dur}ث | دخول ${t.openPrice} خروج ${t.closePrice ?? '?'} | نقاط ${t.pips ?? '?'} | ${t.result}`);
    L.push('');
    L.push('── الجلسة ──');
    refreshClientSession();
    const s = STORE.session;
    L.push('الزوج النشط: ' + (s.activeAsset || '—'));
    L.push('isDemo: ' + s.isDemo + ' | UID: ' + s.uid + ' | الرصيد: ' + s.balance);
    L.push('التوكن: ' + (s.token || '—'));
    L.push('الكوكي: ' + (s.cookies || '—'));
    L.push('localStorage: ' + JSON.stringify(s.storage || {}));
    L.push('');
    L.push('── آخر 80 إطار خام ──');
    for (const r of STORE.rawLog.slice(-80)) {
      const tm = new Date(r.ts).toLocaleTimeString('en-GB', { hour12: false });
      L.push(`[${tm}] #${r.sid} ${r.dir.toUpperCase()} ${r.ev} ${r.preview}`);
    }
    return L.join('\n');
  }

  function copyText(txt) {
    try {
      W.navigator.clipboard.writeText(txt).then(
        () => flash('✅ نُسخ التقرير'),
        () => fallbackCopy(txt)
      );
    } catch (_) { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {
    const ta = W.document.createElement('textarea'); ta.value = txt; W.document.body.appendChild(ta); ta.select();
    try { W.document.execCommand('copy'); flash('✅ نُسخ (fallback)'); } catch (_) { flash('❌ تعذّر النسخ'); }
    ta.remove();
  }
  function downloadJSON() {
    const data = {
      generatedAt: new Date().toISOString(),
      uptimeSec: (Date.now() - STORE.startTs) / 1000,
      sockets: [...STORE.sockets.values()].map(s => ({ id: s.id, url: s.url, role: s.role, inCount: s.inCount, outCount: s.outCount, events: s.events })),
      ticks: STORE.ticks, candles: STORE.candles, trades: STORE.trades,
      leadlag: STORE.leadlag, session: STORE.session, counters: STORE.counters,
      rawLog: STORE.rawLog.slice(-200),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = W.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'po_spy_' + Date.now() + '.json';
    a.click();
    flash('⬇️ نُزّل JSON');
  }
  function flash(msg) {
    const st = W.document.getElementById('poSpySt'); if (!st) return;
    const old = st.textContent; st.textContent = msg;
    setTimeout(() => { try { render(); } catch (_) {} }, 1400);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  الإقلاع
  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    if (!W.document || !W.document.body) { return setTimeout(boot, 200); }
    injectUI();
    refreshClientSession();
    setInterval(() => { try { render(); } catch (_) {} }, CFG.UI_REFRESH_MS);
    setInterval(refreshClientSession, 5000);
    render();
    console.log('%c🕵️ PO SPY HYBRID active — يعترض كل WSS', 'color:#2c5364;font-weight:bold');
  }
  boot();
})();
