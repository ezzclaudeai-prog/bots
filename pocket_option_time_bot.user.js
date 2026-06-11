// ==UserScript==
// @name         ⏱️ PO TIME-CLICK BOT — M1 Timed Strategy + Predictive Momentum + DOM Click Execution
// @namespace    pocket-option-time-click-bot
// @version      1.2.0
// @description  بوت تداول ذاتي لمنصة بوكيت أوبشن: استخراج تلقائي للأزرار وعمر الصفقة وعمر شمعة M1، استراتيجية زمنية (ث36/26/11)، فلتر زخم تنبّئي من مقابس ORACLE/MAIN، نظام تجميد زمني لحماية رأس المال، والتنفيذ حصراً عبر محاكاة النقر الفيزيائي على أزرار الشراء/البيع. يعمل بالكامل بدون كونسول (Kiwi Browser + Violentmonkey).
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function (W) {
  'use strict';
  if (W.__PO_TIME_CLICK_BOT) return;
  W.__PO_TIME_CLICK_BOT = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  CONFIG — كل المعايير قابلة للضبط من الواجهة العائمة
  // ══════════════════════════════════════════════════════════════════════
  const CFG = {
    CANDLE_SEC          : 60,        // شمعة M1
    FIRE_SECONDS_TREND  : [36, 26],  // الثواني التي تُفتح فيها صفقة مع اتجاه الشمعة
    FIRE_SECONDS_COUNTER: [11],      // الثانية التي تُفتح فيها صفقة معاكسة
    FIRE_TOLERANCE_MS   : 350,       // نافذة السماح حول الثانية المستهدفة

    // ─── فلتر الزخم التنبّئي ─────────────────────────────────────────
    MOM_ENABLED         : true,
    MOM_WINDOW_MS       : 10000,     // نافذة تحليل الزخم (آخر 10 ثوانٍ)
    MOM_RECENT_MS       : 2500,      // نافذة الزخم اللحظي (آخر ~2.5ث)
    MOM_MIN_TICKS       : 4,         // أقل عدد تيكات مطلوب في النافذة وإلا حجب
    MOM_NET_NOISE_MULT  : 1.2,       // صافي الحركة في الاتجاه يجب أن يتجاوز K×ضجيج التيك
    MOM_RECENT_NOISE_MULT: 0.8,      // الزخم اللحظي يجب أن يتجاوز K×ضجيج التيك
    MOM_REQUIRE_COVER   : true,      // يشترط أن يغطّي الزخم المتوقّع زمناً > عمر الصفقة

    // ─── نظام التجميد الزمني (حماية رأس المال) ────────────────────────
    RISK_ENABLED        : true,
    REVERSAL_NOISE_MULT : 2.0,       // انعكاس عنيف = حركة معاكسة تتجاوز K×ضجيج التيك
    COOLDOWN_MS         : 90000,     // مدة التجميد بعد انعكاس عنيف (90ث)
    STREAK_COOLDOWN     : 2,         // عدد الانعكاسات المتتالية قبل تجميد مُطوّل
    STREAK_COOLDOWN_MS  : 240000,    // تجميد مُطوّل (4 دقائق) بعد سلسلة انعكاسات

    // ─── التنفيذ ────────────────────────────────────────────────────
    MIN_INTER_TRADE_MS  : 1500,      // أقل فاصل بين أي نقرتين تنفيذيتين
    DEFAULT_TRADE_SEC   : 5,         // عمر صفقة افتراضي إذا تعذّر استخراجه

    RESCAN_DOM_MS       : 4000,      // إعادة مسح عناصر الواجهة دورياً
    LOG_MAX             : 220,
    AUTOSTART           : false,     // لا يتداول حتى يضغط المستخدم تشغيل
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 2  STATE
  // ══════════════════════════════════════════════════════════════════════
  let autoTrade        = CFG.AUTOSTART;
  let activeAsset      = '';
  let _tradeDurationSec= 0;          // عمر الصفقة المستخرج (ث)
  let fastCloseAt      = 0;          // وقت إغلاق الشمعة من الـ WSS (ms محلي تقريبي)
  let _serverOffsetMs  = 0;          // فرق توقيت الخادم - المحلي (يُحدّث من التيكات)
  let _serverOffsetSet = false;

  // عناصر الواجهة المستخرجة
  const DOM = { buyBtn: null, sellBtn: null, durInput: null, countdownEl: null };

  // مخزن التيكات لكل دور (oracle / main) للأصل الفعّال
  const ticks = { oracle: [], main: [], merged: [] };

  // حالة الشمعة الحالية
  let curCandleIdx     = -1;
  let candleOpenPrice  = 0;
  let lastPrice        = 0;
  const firedThisCandle= new Set();  // مفاتيح "idx:sec" التي نُفّذت

  // نظام التجميد
  let cooldownUntil    = 0;
  let reversalStreak   = 0;

  // مراقبة الصفقة المفتوحة (لرصد الانعكاس العنيف)
  let openTradeWatch   = null;       // { dir, entryPrice, untilMs, noise }

  let lastClickMs      = 0;

  const stats = { entries: 0, blocked: 0, reversals: 0, cooldowns: 0 };

  // ══════════════════════════════════════════════════════════════════════
  // § 3  UTIL
  // ══════════════════════════════════════════════════════════════════════
  function now() { return Date.now(); }
  function serverNow() { return Date.now() + _serverOffsetMs; }
  function normalizeAsset(a) { return String(a || '').toUpperCase().replace(/_OTC$/i, '_OTC').trim(); }

  // ══════════════════════════════════════════════════════════════════════
  // § 4  WEBSOCKET INTERCEPTION (ORACLE = events-po | MAIN = po.market/api)
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;

  function _socketRole(urlStr) {
    if (urlStr.includes('events-po')) return 'oracle';
    if (urlStr.includes('po.market')) return 'main';
    if (urlStr.includes('socket.io') && urlStr.includes('api')) return 'main';
    return null;
  }

  // ── فك الإطارات: نص JSON أولاً ثم msgpack احتياطياً (يطابق سلوك المنصة) ──
  function msgpackDecode(buffer) {
    const buf  = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off  = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes= new Uint8Array(buf, off);
    let pos = 0;
    const rb=()=>bytes[pos++], ru8=()=>bytes[pos++];
    const ru16=()=>{const v=view.getUint16(pos,false);pos+=2;return v;};
    const ru32=()=>{const v=view.getUint32(pos,false);pos+=4;return v;};
    const ri8=()=>{const v=view.getInt8(pos);pos+=1;return v;};
    const ri16=()=>{const v=view.getInt16(pos,false);pos+=2;return v;};
    const ri32=()=>{const v=view.getInt32(pos,false);pos+=4;return v;};
    const rf32=()=>{const v=view.getFloat32(pos,false);pos+=4;return v;};
    const rf64=()=>{const v=view.getFloat64(pos,false);pos+=8;return v;};
    const ri64=()=>{const h=view.getInt32(pos,false),l=view.getUint32(pos+4,false);pos+=8;return h*4294967296+l;};
    const ru64=()=>{const h=view.getUint32(pos,false),l=view.getUint32(pos+4,false);pos+=8;return h*4294967296+l;};
    const rStr=(n)=>{const s=new TextDecoder().decode(bytes.subarray(pos,pos+n));pos+=n;return s;};
    const rBin=(n)=>{const b=bytes.subarray(pos,pos+n);pos+=n;return b;};
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b&0xf0)===0x80){const n=b&0xf;const o={};for(let i=0;i<n;i++){const k=decode();o[k]=decode();}return o;}
      if ((b&0xf0)===0x90){const n=b&0xf;const a=[];for(let i=0;i<n;i++)a.push(decode());return a;}
      if ((b&0xe0)===0xa0) return rStr(b&0x1f);
      if ((b&0xe0)===0xe0) return b-256;
      switch (b) {
        case 0xc0:return null; case 0xc2:return false; case 0xc3:return true;
        case 0xc4:return rBin(ru8()); case 0xc5:return rBin(ru16()); case 0xc6:return rBin(ru32());
        case 0xca:return rf32(); case 0xcb:return rf64();
        case 0xcc:return ru8(); case 0xcd:return ru16(); case 0xce:return ru32(); case 0xcf:return ru64();
        case 0xd0:return ri8(); case 0xd1:return ri16(); case 0xd2:return ri32(); case 0xd3:return ri64();
        case 0xd9:return rStr(ru8()); case 0xda:return rStr(ru16()); case 0xdb:return rStr(ru32());
        case 0xdc:{const n=ru16();const a=[];for(let i=0;i<n;i++)a.push(decode());return a;}
        case 0xdd:{const n=ru32();const a=[];for(let i=0;i<n;i++)a.push(decode());return a;}
        case 0xde:{const n=ru16();const o={};for(let i=0;i<n;i++){const k=decode();o[k]=decode();}return o;}
        case 0xdf:{const n=ru32();const o={};for(let i=0;i<n;i++){const k=decode();o[k]=decode();}return o;}
        default: throw new Error('mp 0x'+b.toString(16));
      }
    }
    return decode();
  }

  function decodeFrame(buffer) {
    const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off= buffer.byteOffset || 0;
    const bytes = new Uint8Array(ab, off);
    const b0 = bytes[0];
    if (b0===0x5b || b0===0x7b || b0===0x22) {           // [ { "  → JSON نصي
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (_) {}
    }
    try { return msgpackDecode(buffer); } catch (_) {}
    return null;
  }

  function extractTickFromArray(arr) {
    if (!Array.isArray(arr)) return null;
    if (Array.isArray(arr[0]) && arr[0].length>=3 && typeof arr[0][0]==='string' && typeof arr[0][2]==='number') {
      const price = arr[0][2]; if (price>0) return { asset: normalizeAsset(arr[0][0]), price, ts: arr[0][1] };
    }
    if (arr.length>=3 && typeof arr[0]==='string' && typeof arr[2]==='number') {
      const price = arr[2]; if (price>0) return { asset: normalizeAsset(arr[0]), price, ts: arr[1] };
    }
    return null;
  }

  // ── استخراج عمر الصفقة (fastTimeframe) ووقت إغلاق الشمعة (fastCloseAt) ──
  function ingestSettings(s, full) {
    if (!s) return;
    try {
      const ft = parseInt(s.fastTimeframe, 10);
      if (Number.isFinite(ft) && ft >= 1) _tradeDurationSec = ft;
      const fca = parseInt((s.fastCloseAt!=null ? s.fastCloseAt : (full && full.fastCloseAt)) || 0, 10);
      if (Number.isFinite(fca) && fca > 0) {
        // fastCloseAt بتوقيت الخادم (ثوانٍ) → ms محلي عبر الإزاحة
        fastCloseAt = fca * 1000 - _serverOffsetMs;
      }
      if (s.symbol && String(s.symbol).length >= 3) setActiveAsset(s.symbol);
    } catch (_) {}
  }

  function handleDecodedEvent(evName, payload) {
    try {
      if (evName === 'changeSymbol' && payload && payload.asset) setActiveAsset(payload.asset);
      if (evName === 'saveCharts') {
        const s = (payload && payload.settings) || payload || {};
        ingestSettings(s, payload);
      }
      if (evName === 'updateCharts' && Array.isArray(payload)) {
        for (const chart of payload) {
          if (!chart) continue;
          if (typeof chart.asset === 'string' && chart.asset.length >= 3) setActiveAsset(chart.asset);
          let s = chart.settings;
          if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { s = {}; } }
          ingestSettings(s || {}, chart);
        }
      }
    } catch (_) {}
  }

  function onMessage(role, raw) {
    try {
      if (typeof raw === 'string') {
        if (raw === '2' || raw === '3') return;
        // إطار socket.io: 42["event",payload]
        if (raw.startsWith('42')) {
          let arr; try { arr = JSON.parse(raw.slice(2)); } catch (_) { arr = null; }
          if (Array.isArray(arr)) {
            const evName = arr[0], payload = arr[1];
            handleDecodedEvent(evName, payload);
            const tick = extractTickFromArray(arr[1]);
            if (tick) onTick(role, tick.asset, tick.price, tick.ts);
          }
          return;
        }
        // محاولة JSON خام
        if (raw[0] === '[' || raw[0] === '{') {
          let d; try { d = JSON.parse(raw); } catch (_) { d = null; }
          if (d) {
            const tick = extractTickFromArray(d);
            if (tick) onTick(role, tick.asset, tick.price, tick.ts);
          }
        }
        return;
      }
      // إطارات ثنائية
      let buf = null;
      if (raw instanceof ArrayBuffer) buf = raw;
      else if (raw && raw.buffer instanceof ArrayBuffer) buf = raw.buffer;
      if (buf) {
        const d = decodeFrame(buf);
        if (d) {
          const tick = extractTickFromArray(d);
          if (tick) { onTick(role, tick.asset, tick.price, tick.ts); return; }
          if (Array.isArray(d) && Array.isArray(d[0])) {
            for (const it of d) { const t = extractTickFromArray(Array.isArray(it)?it:[it]); if (t) onTick(role, t.asset, t.price, t.ts); }
          }
        }
      } else if (raw instanceof Blob) {
        raw.arrayBuffer().then((ab) => onMessage(role, ab)).catch(()=>{});
      }
    } catch (_) {}
  }

  function attachWS(ws, urlStr) {
    const role = _socketRole(urlStr);
    if (!role) return;
    ws._role = role;
    log((role==='oracle'?'🔮':'🔌') + ' مقبس ' + (role==='oracle'?'ORACLE':'MAIN') + ': ' + urlStr.split('?')[0], 'info');
    ws.addEventListener('message', (e) => onMessage(role, e.data));
  }

  try {
    W.WebSocket = new Proxy(NativeWS, {
      construct(target, args) {
        const ws = new target(...args);
        try { attachWS(ws, String(args[0] || '')); } catch (_) {}
        return ws;
      }
    });
  } catch (_) {
    // متصفحات قديمة: التفاف مباشر
    W.WebSocket = function (...a) { const ws = new NativeWS(...a); try { attachWS(ws, String(a[0]||'')); } catch(_){} return ws; };
    W.WebSocket.prototype = NativeWS.prototype;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 5  TICK STORE + CANDLE CLOCK
  // ══════════════════════════════════════════════════════════════════════
  function setActiveAsset(a) {
    const na = normalizeAsset(a);
    if (!na || na === activeAsset) return;
    activeAsset = na;
    ticks.oracle.length = 0; ticks.main.length = 0; ticks.merged.length = 0;
    candleOpenPrice = 0; curCandleIdx = -1; firedThisCandle.clear();
    log('🎯 الأصل الفعّال: ' + na, 'info');
    updateHUD();
  }

  function onTick(role, asset, price, serverTsSec) {
    // مزامنة إزاحة الخادم من طابع زمن التيك (ثوانٍ)
    if (typeof serverTsSec === 'number' && serverTsSec > 1e9) {
      const off = serverTsSec * 1000 - now();
      if (!_serverOffsetSet || Math.abs(off) < 60000) { _serverOffsetMs = off; _serverOffsetSet = true; }
    }
    if (!activeAsset) setActiveAsset(asset);
    if (normalizeAsset(asset) !== activeAsset) return;

    const t = now();
    const rec = { p: price, t };
    if (role === 'oracle') ticks.oracle.push(rec);
    else ticks.main.push(rec);
    ticks.merged.push(rec);
    lastPrice = price;

    const cutoff = t - Math.max(CFG.MOM_WINDOW_MS, 20000);
    trimOld(ticks.oracle, cutoff); trimOld(ticks.main, cutoff); trimOld(ticks.merged, cutoff);

    updateCandle(price);
    if (openTradeWatch) watchReversal(price);
  }

  function trimOld(arr, cutoff) { while (arr.length && arr[0].t < cutoff) arr.shift(); }

  // مرساة العداد التنازلي من الواجهة (M1 00:24): أدق مصدر لعمر الشمعة.
  // تُحدَّث عند كل «قفزة ثانية» للعداد — لحظة القفزة = رأس ثانية مضبوطة.
  let _domAnchor = null;   // { elapsedMs0, t0 }
  function _candleMs() {
    const P = CFG.CANDLE_SEC * 1000;
    if (_domAnchor && (now() - _domAnchor.t0) < 130000) {
      return (((_domAnchor.elapsedMs0 + (now() - _domAnchor.t0)) % P) + P) % P;
    }
    return ((serverNow() % P) + P) % P;
  }
  function candleIndex() {
    const P = CFG.CANDLE_SEC * 1000;
    if (_domAnchor && (now() - _domAnchor.t0) < 130000) {
      const elapsed = _domAnchor.elapsedMs0 + (now() - _domAnchor.t0);
      return Math.floor((_domAnchor.t0 - _domAnchor.elapsedMs0) / P) + Math.floor(elapsed / P);
    }
    return Math.floor(serverNow() / P);
  }
  function secInCandle() { return Math.floor(_candleMs() / 1000); }
  function msInCandle()  { return _candleMs(); }

  function updateCandle(price) {
    const idx = candleIndex();
    if (idx !== curCandleIdx) {
      curCandleIdx = idx;
      candleOpenPrice = price;          // أول سعر بعد حدود الدقيقة = افتتاح الشمعة
      firedThisCandle.clear();
    }
  }

  // اتجاه الشمعة الحالية: صعود (+1) إذا السعر فوق الافتتاح، هبوط (-1) إذا تحته
  function candleDirection() {
    if (!candleOpenPrice || !lastPrice) return 0;
    if (lastPrice > candleOpenPrice) return +1;
    if (lastPrice < candleOpenPrice) return -1;
    return 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  MOMENTUM ENGINE (تنبّؤ استمرار الزخم من التيكات الخام)
  // ══════════════════════════════════════════════════════════════════════
  // ضجيج التيك = متوسط القيمة المطلقة لفروق الأسعار المتتالية (وحدة الحركة)
  function tickNoise(arr) {
    if (arr.length < 3) return 0;
    let sum = 0, n = 0;
    for (let i = 1; i < arr.length; i++) { sum += Math.abs(arr[i].p - arr[i-1].p); n++; }
    return n ? sum / n : 0;
  }

  // ميل خطي (انحدار) السعر مقابل الزمن داخل نافذة → سرعة بالـ سعر/مللي ثانية
  function slope(arr, sinceMs) {
    const t0 = now() - sinceMs;
    const w = arr.filter(r => r.t >= t0);
    if (w.length < 2) return { v: 0, n: w.length, net: 0 };
    let sx=0, sy=0, sxx=0, sxy=0; const n = w.length;
    const base = w[0].t;
    for (const r of w) { const x = r.t - base; sx+=x; sy+=r.p; sxx+=x*x; sxy+=x*r.p; }
    const denom = n*sxx - sx*sx;
    const v = denom ? (n*sxy - sx*sy) / denom : 0;   // سعر لكل مللي ثانية
    const net = w[w.length-1].p - w[0].p;
    return { v, n, net };
  }

  // تقييم الزخم لاتجاه مقصود dir (+1 شراء / -1 بيع). يُرجع {ok, reason, ...}
  function evaluateMomentum(dir) {
    if (!CFG.MOM_ENABLED) return { ok: true, reason: 'mom-off' };
    const arr = ticks.merged;
    const win = arr.filter(r => r.t >= now() - CFG.MOM_WINDOW_MS);
    if (win.length < CFG.MOM_MIN_TICKS) return { ok: false, reason: 'ticks<' + CFG.MOM_MIN_TICKS + ' (' + win.length + ')' };

    const noise = tickNoise(win) || 1e-9;
    const full   = slope(arr, CFG.MOM_WINDOW_MS);   // اتجاه عام (آخر 10ث)
    const recent = slope(arr, CFG.MOM_RECENT_MS);   // زخم لحظي (آخر ~2.5ث)

    const netDir   = Math.sign(full.net);
    const recDir   = Math.sign(recent.v);

    // 1) الاتجاه العام يجب أن يوافق الاتجاه المقصود وأن يتجاوز الضجيج
    if (netDir !== dir) return { ok:false, reason:'trend≠dir' };
    if (Math.abs(full.net) < noise * CFG.MOM_NET_NOISE_MULT)
      return { ok:false, reason:'net<noise' };

    // 2) الزخم اللحظي يجب ألا يكون معاكساً وأن يكون قوياً بما يكفي
    if (recDir !== 0 && recDir !== dir) return { ok:false, reason:'recent-reversal' };
    const recentMove = Math.abs(recent.v) * CFG.MOM_RECENT_MS;
    if (recentMove < noise * CFG.MOM_RECENT_NOISE_MULT)
      return { ok:false, reason:'recent-weak' };

    // 3) تغطية عمر الصفقة: هل سيستمر الزخم > عمر الصفقة بناءً على السرعة الحالية؟
    if (CFG.MOM_REQUIRE_COVER) {
      const durMs = (tradeDurSec()) * 1000;
      const projected = Math.abs(recent.v) * durMs;     // الحركة المتوقعة خلال عمر الصفقة
      if (projected < noise * 1.0)                       // أقل من تيك واحد متوقع = زخم لا يكفي
        return { ok:false, reason:'no-cover' };
    }
    return { ok:true, reason:'strong', net: full.net, v: recent.v, noise };
  }

  function tradeDurSec() {
    return _tradeDurationSec >= 1 ? _tradeDurationSec : (domTradeDur() || CFG.DEFAULT_TRADE_SEC);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  AUTONOMOUS DOM SCANNER
  // ══════════════════════════════════════════════════════════════════════
  function scanDOM() {
    try {
      DOM.buyBtn  = findTradeButton('buy');
      DOM.sellBtn = findTradeButton('sell');
      DOM.durInput= findDurationInput();
      // DOM.countdownEl يديره countdownPoll (تحقّق سلوكي: عداد يتناقص فعلاً)
    } catch (_) {}
    updateHUD();
  }

  // مسار CSS مختصر للعنصر — للتقرير التشخيصي
  function cssPath(el) {
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && parts.length < 8) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + e.id); break; }
      const cls = (e.className && e.className.toString ? e.className.toString() : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const p = e.parentElement;
      if (p) s += ':nth-child(' + (Array.prototype.indexOf.call(p.children, e) + 1) + ')';
      parts.unshift(s);
      e = p;
    }
    return parts.join('>');
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function findTradeButton(kind) {
    // kind: 'buy' (شراء/أخضر/call/up) | 'sell' (بيع/أحمر/put/down)
    // ✅ محددات مؤكدة من HTML بوكيت أوبشن (m.pocketoption.com 2026):
    //    شراء = a.btn.btn-call داخل .button-call-wrap | بيع = a.btn.btn-put
    const exactSel = kind === 'buy'
      ? ['a.btn-call', '.btn-call', '.button-call-wrap a', '.action-high-low.button-call-wrap']
      : ['a.btn-put',  '.btn-put',  '.button-put-wrap a',  '.action-high-low.button-put-wrap'];
    for (const sel of exactSel) {
      for (const el of document.querySelectorAll(sel)) {
        if (visible(el)) return el;
      }
    }

    // fallback: heuristic (نص + لون) — لو تغيّرت بنية المنصة
    // الكلمات والأسهم مأخوذة من نسخ البوتات القديمة في الريبو (_animatePlatformButton)
    const buyWords  = ['شراء','call','buy','up','higher','أعلى','↑'];
    const sellWords = ['بيع','put','sell','down','lower','أدنى','↓'];
    const words = kind === 'buy' ? buyWords : sellWords;
    const antiWords = kind === 'buy' ? sellWords : buyWords;

    const cands = Array.from(document.querySelectorAll(
      'button, a[role="button"], div[role="button"], [class*="btn"], [class*="button"], [class*="deal"], [class*="trade"]'
    ));
    let best = null, bestScore = -1;
    for (const el of cands) {
      if (!visible(el)) continue;
      const txt = (el.textContent || '').trim().toLowerCase();
      const cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase();
      const hay = txt + ' ' + cls + ' ' + (el.getAttribute('data-test')||'') + ' ' + (el.id||'');

      let score = 0;
      for (const w of words)     if (hay.includes(w.toLowerCase())) score += 5;
      for (const w of antiWords) if (hay.includes(w.toLowerCase())) score -= 6;

      // إشارة اللون (أخضر للشراء / أحمر للبيع)
      const col = buttonColor(el);
      if (col) {
        if (kind === 'buy'  && col === 'green') score += 4;
        if (kind === 'sell' && col === 'red')   score += 4;
        if (kind === 'buy'  && col === 'red')   score -= 4;
        if (kind === 'sell' && col === 'green')  score -= 4;
      }
      // أزرار الصفقة عادة كبيرة وأسفل الشاشة
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.55) score += 1;
      if (r.width > 90) score += 1;

      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore >= 5 ? best : null;
  }

  function buttonColor(el) {
    const probe = (e) => {
      const st = getComputedStyle(e);
      const c = st.backgroundColor || '';
      const m = c.match(/rgba?\(([0-9]+),\s*([0-9]+),\s*([0-9]+)/i);
      if (!m) return null;
      const r = +m[1], g = +m[2], b = +m[3];
      if (g > 110 && g > r + 25 && g > b + 10) return 'green';
      if (r > 130 && r > g + 30 && r > b + 10) return 'red';
      return null;
    };
    let c = probe(el); if (c) return c;
    // افحص الأبناء (بعض المنصات تلوّن طبقة داخلية)
    for (const child of el.querySelectorAll('*')) { c = probe(child); if (c) return c; }
    return null;
  }

  // هل القيمة hh:mm:ss تطابق ساعة حائطية (محلية/UTC/UTC+3)؟ — لاستبعاد ساعات المنصة
  function _looksLikeWallClock(h, mi) {
    const d = new Date();
    const checks = [
      [d.getHours(), d.getMinutes()],
      [d.getUTCHours(), d.getUTCMinutes()],
      [(d.getUTCHours() + 3) % 24, d.getUTCMinutes()],
    ];
    return checks.some(([hh, mm]) => hh === h && Math.abs(mm - mi) <= 2);
  }

  function _parseDurStr(val) {
    const m = String(val || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return 0;
    const secs = m[3] != null ? (+m[1])*3600 + (+m[2])*60 + (+m[3]) : (+m[1])*60 + (+m[2]);
    if (secs < 1 || secs > 3600) return 0;
    if (m[3] != null && _looksLikeWallClock(+m[1], +m[2])) return 0;   // استبعاد «00:55:34» (ساعة UTC)
    return secs;
  }

  function findDurationInput() {
    // ✅ محدد مؤكد من HTML: كتلة «الزمن» = .block--expiration-inputs .value__val (نص 00:00:05)
    const exact = ['.block--expiration-inputs .value__val',
                   '.block--expiration-inputs .value__val',
                   '.block--deadline-inputs .value__val'];
    for (const sel of exact) {
      for (const el of document.querySelectorAll(sel)) {
        if (visible(el) && _parseDurStr((el.textContent || '').trim()) > 0) return el;
      }
    }
    // fallback: حقول إدخال فقط، مع استبعاد ساعة المنصة (.current-time__time)
    const pools = [
      Array.from(document.querySelectorAll('input')),
      Array.from(document.querySelectorAll('[contenteditable="true"], .value__val')),
    ];
    for (const pool of pools) {
      for (const el of pool) {
        if (!visible(el)) continue;
        if (el.closest && el.closest('.current-time')) continue;
        const val = (el.value != null && el.value !== '' ? el.value : el.textContent || '').trim();
        if (_parseDurStr(val) > 0) return el;
      }
    }
    return null;
  }

  // يقرأ عمر الصفقة من الواجهة (بالثواني) — كتأكيد لـ WSS
  function domTradeDur() {
    const el = DOM.durInput; if (!el) return 0;
    const val = (el.value != null && el.value !== '' ? el.value : el.textContent || '').trim();
    return _parseDurStr(val);
  }

  // ── متتبّع العداد التنازلي للشمعة (تحقّق سلوكي) ──────────────────────
  //   بدل التخمين بالنص فقط: نراقب كل عناصر mm:ss الورقية ونرفع نقاط العنصر
  //   الذي «يتناقص ثانية كل ثانية» فعلاً. لحظة قفزة قيمته = مرساة طور دقيقة.
  const _cdCands = new Map();   // path → { el, lastVal, lastT, decScore }
  function countdownPoll() {
    try {
      const re = /^([0-5]?\d):([0-5]\d)$/;
      const els = document.querySelectorAll('span, div, p, time, b, strong');
      for (const el of els) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        const m = t.match(re); if (!m) continue;
        if (!visible(el)) continue;
        if (hudEl && hudEl.contains(el)) continue;
        if (el.closest && el.closest('.current-time, .chat_time, #cbRoot, #cbTradeOrb')) continue;  // استبعاد ساعة المنصة والشات وواجهة البوت
        const val = (+m[1]) * 60 + (+m[2]);
        const path = cssPath(el);
        let c = _cdCands.get(path);
        if (!c) { _cdCands.set(path, { el, lastVal: val, lastT: now(), decScore: 0 }); continue; }
        c.el = el;
        if (val !== c.lastVal) {
          const dt = now() - c.lastT;
          const dv = c.lastVal - val;
          if (dv >= 1 && dv <= 3 && dt > 350 && dt < 4000) c.decScore = Math.min(c.decScore + dv, 50);          // تناقص طبيعي
          else if (val > c.lastVal && c.lastVal <= 2)      c.decScore = Math.min(c.decScore + 1, 50);          // إعادة دورة 00→59 (شمعة جديدة)
          else                                              c.decScore = Math.max(c.decScore - 2, 0);
          if (c.decScore >= 3 && val < CFG.CANDLE_SEC) {
            // عداد مؤكد — لحظة القفزة = رأس الثانية: المتبقي = val ⇐ المنقضي = 60-val
            if (DOM.countdownEl !== el) { DOM.countdownEl = el; log('⏲️ عداد الشمعة مؤكد: ' + path, 'signal'); }
            _domAnchor = { elapsedMs0: (CFG.CANDLE_SEC - val) * 1000, t0: now() };
          }
          c.lastVal = val; c.lastT = now();
        }
      }
      for (const [p, c] of _cdCands) if (now() - c.lastT > 180000) _cdCands.delete(p);
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  PHYSICAL CLICK EXECUTION (محاكاة نقر فعلي — لا WS/API)
  // ══════════════════════════════════════════════════════════════════════
  function physicalClick(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      // استهدف أعمق عنصر عند مركز الزر — أُطر الواجهة تربط المستمعات بعناصر داخلية
      let tgt = null;
      try { tgt = document.elementFromPoint(cx, cy); } catch (_) {}
      if (!tgt || !(el === tgt || el.contains(tgt))) tgt = el;

      const base = { bubbles: true, cancelable: true, composed: true, view: W,
                     clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0 };
      const fire = (type, Ctor, extra) => {
        try { tgt.dispatchEvent(new Ctor(type, Object.assign({}, base, extra || {}))); }
        catch (_) { try { tgt.dispatchEvent(new MouseEvent(type, base)); } catch (__) {} }
      };

      // 1) لمس حقيقي بكائنات Touch فعلية — المسار الأساسي على الهاتف
      try {
        const touch = new Touch({
          identifier: Date.now() % 100000, target: tgt,
          clientX: cx, clientY: cy, screenX: cx, screenY: cy,
          pageX: cx + (W.scrollX || 0), pageY: cy + (W.scrollY || 0),
          radiusX: 11, radiusY: 11, force: 1,
        });
        const tBase = { bubbles: true, cancelable: true, composed: true, view: W };
        tgt.dispatchEvent(new TouchEvent('touchstart', Object.assign({ touches: [touch], targetTouches: [touch], changedTouches: [touch] }, tBase)));
        tgt.dispatchEvent(new TouchEvent('touchend',   Object.assign({ touches: [],      targetTouches: [],      changedTouches: [touch] }, tBase)));
      } catch (_) {}

      // 2) سلسلة pointer/mouse كاملة على العنصر العميق
      const pExtra = { pointerId: 1, pointerType: 'touch', isPrimary: true, width: 22, height: 22, pressure: 1 };
      fire('pointerover',  PointerEvent, pExtra);
      fire('pointerenter', PointerEvent, pExtra);
      fire('pointerdown',  PointerEvent, Object.assign({ buttons: 1 }, pExtra));
      fire('mouseover', MouseEvent);
      fire('mousemove', MouseEvent);
      fire('mousedown', MouseEvent, { buttons: 1 });
      try { if (tgt.focus) tgt.focus(); } catch (_) {}
      fire('pointerup', PointerEvent, pExtra);
      fire('mouseup', MouseEvent);
      fire('click', MouseEvent, { detail: 1 });

      // 3) احتياط: click مباشر على الزر الأصلي أيضاً
      if (tgt !== el) { try { el.dispatchEvent(new MouseEvent('click', base)); } catch (_) {} }
      if (typeof el.click === 'function') { try { el.click(); } catch (_) {} }
      return true;
    } catch (_) { return false; }
  }

  // تنفيذ صفقة باتجاه dir (+1 شراء / -1 بيع) عبر نقر الزر
  function executeTrade(dir, label) {
    const t = now();
    if (t - lastClickMs < CFG.MIN_INTER_TRADE_MS) { log('⏭️ تخطٍّ — فاصل التنفيذ', 'warn'); return false; }
    const btn = dir > 0 ? DOM.buyBtn : DOM.sellBtn;
    if (!btn) { log('⛔ زر ' + (dir>0?'الشراء':'البيع') + ' غير موجود — أعد المسح', 'error'); scanDOM(); return false; }
    const okClick = physicalClick(btn);
    if (!okClick) { log('⛔ فشل النقر الفيزيائي', 'error'); return false; }
    lastClickMs = t;
    stats.entries++;
    log('🟢 تنفيذ نقر: ' + (dir>0?'شراء/CALL':'بيع/PUT') + ' | ' + label + ' | سعر ' + lastPrice, 'trade');

    // تفعيل مراقبة الانعكاس العنيف خلال عمر الصفقة
    const dur = tradeDurSec();
    openTradeWatch = {
      dir, entryPrice: lastPrice, untilMs: t + dur * 1000,
      noise: tickNoise(ticks.merged.filter(r => r.t >= now() - CFG.MOM_WINDOW_MS)) || 1e-9,
      flagged: false,
    };
    updateHUD();
    return true;
  }

  // مراقبة الانعكاس العنيف بعد دخول الصفقة → نظام التجميد الزمني
  function watchReversal(price) {
    const w = openTradeWatch; if (!w) return;
    if (now() > w.untilMs) { openTradeWatch = null; return; }
    const adverse = (w.entryPrice - price) * w.dir;   // موجب = حركة معاكسة للاتجاه
    if (!w.flagged && adverse > w.noise * CFG.REVERSAL_NOISE_MULT) {
      w.flagged = true;
      stats.reversals++;
      reversalStreak++;
      const ms = reversalStreak >= CFG.STREAK_COOLDOWN ? CFG.STREAK_COOLDOWN_MS : CFG.COOLDOWN_MS;
      cooldownUntil = now() + ms;
      stats.cooldowns++;
      log('🧊 انعكاس عنيف — تجميد ' + Math.round(ms/1000) + 'ث (سلسلة ' + reversalStreak + ')', 'risk');
      updateHUD();
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 9  STRATEGY SCHEDULER — الثواني 36 / 26 (مع الاتجاه) و 11 (معاكس)
  // ══════════════════════════════════════════════════════════════════════
  function tryFireAtSecond(sec, mode) {
    // mode: 'trend' | 'counter'
    if (!autoTrade) return;
    const idx = candleIndex();
    const key = idx + ':' + sec;
    if (firedThisCandle.has(key)) return;

    // تجميد فعّال؟
    if (CFG.RISK_ENABLED && now() < cooldownUntil) {
      firedThisCandle.add(key);
      log('🧊 محجوب (تجميد) — ث' + sec, 'risk');
      return;
    }

    const cdir = candleDirection();
    if (cdir === 0) { firedThisCandle.add(key); log('• اتجاه شمعة غير محدد — ث' + sec, 'warn'); return; }

    // الاتجاه المقصود
    const dir = mode === 'trend' ? cdir : -cdir;

    // فلتر الزخم التنبّئي
    const mom = evaluateMomentum(dir);
    firedThisCandle.add(key);   // علّم محاولة هذه الثانية بصرف النظر عن النتيجة
    if (!mom.ok) {
      stats.blocked++;
      log('⛔ حجب الزخم ث' + sec + ' (' + (mode==='trend'?'مع':'عكس') + ') ' + (dir>0?'CALL':'PUT') + ' — ' + mom.reason, 'warn');
      updateHUD();
      return;
    }
    log('✅ زخم مؤكد ث' + sec + ' — ' + (dir>0?'CALL':'PUT') + ' (' + mom.reason + ')', 'signal');
    const lbl = 'ث' + sec + (mode === 'counter' ? ' معاكس' : ' مع الاتجاه');
    setSignalBox(dir, lbl);
    showSignalPopup(dir, lbl);
    executeTrade(dir, lbl);
  }

  // حلقة دقيقة عالية الدقة لرصد لحظة الثانية المستهدفة
  function strategyLoop() {
    if (autoTrade && activeAsset) {
      const ms = msInCandle();
      const sec = Math.floor(ms / 1000);
      const within = (ms % 1000) <= CFG.FIRE_TOLERANCE_MS;   // ضمن النافذة بعد رأس الثانية
      if (within) {
        if (CFG.FIRE_SECONDS_TREND.includes(sec))   tryFireAtSecond(sec, 'trend');
        if (CFG.FIRE_SECONDS_COUNTER.includes(sec)) tryFireAtSecond(sec, 'counter');
      }
    }
    // تحرير راية التجميد عند انتهائه
    if (cooldownUntil && now() >= cooldownUntil) { cooldownUntil = 0; updateHUD(); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  UI — بنمط bot_v17_edgeprobe (⚡ QUANTUM): أيقونة + لوحة + سجل + إشعار
  // ══════════════════════════════════════════════════════════════════════
  const logBuf = [];          // {line, kind, t}
  let hudEl = null;           // جذر الواجهة (#cbRoot)
  let logInnerEl = null, _logPaused = false, _logFilter = 'all';

  // kind: trade(🟢)/signal/error/warn/risk/info — يطابق ألوان v17
  function log(msg, kind) {
    kind = kind || 'info';
    const e = { msg, kind, t: new Date().toLocaleTimeString('ar-EG', { hour12: false }) };
    logBuf.unshift(e);
    if (logBuf.length > CFG.LOG_MAX) logBuf.pop();
    if (!_logPaused) renderLog();
    try { if (W.navigator && W.navigator.vibrate && (kind === 'trade')) W.navigator.vibrate(40); } catch (_) {}
  }
  const LOG_COLORS = { trade:'#46d98e', signal:'#3fe0ff', error:'#ff5b6e', warn:'#ffd24a', risk:'#ff9f1c', info:'#9fb2c0' };
  function renderLog() {
    if (!logInnerEl) return;
    const items = logBuf.filter(e => _logFilter === 'all' ? true : e.kind === _logFilter);
    logInnerEl.innerHTML = items.slice(0, 120).map(e =>
      '<div style="padding:3px 8px;border-bottom:1px solid #16222e;font-size:10px;line-height:1.4;color:' +
      (LOG_COLORS[e.kind] || '#cfd2d6') + '"><span style="color:#56707f">' + e.t + '</span> ' +
      e.msg.replace(/</g, '&lt;') + '</div>'
    ).join('');
  }

  // ── تصدير HTML كامل + تقرير تشخيصي (ملف txt قابل للتنزيل — بدون كونسول) ──
  function _snip(el, n) {
    try { return el ? el.outerHTML.slice(0, n || 500).replace(/\s+/g, ' ') : 'null'; } catch (_) { return '?'; }
  }
  function buildDomReport() {
    const lines = [];
    lines.push('== PO TIME-CLICK BOT — DOM REPORT v1.1 == ' + new Date().toISOString());
    lines.push('url=' + location.href);
    lines.push('asset=' + (activeAsset || '?') +
      ' | tradeDur(used)=' + tradeDurSec() + 's | wssDur=' + _tradeDurationSec + 's | domDur=' + domTradeDur() + 's' +
      ' | secInCandle=' + (activeAsset ? secInCandle() : '-') +
      ' | anchor=' + (_domAnchor ? ('fresh ' + Math.round((now() - _domAnchor.t0) / 1000) + 's ago') : 'NONE (server clock only)'));
    lines.push('');
    lines.push('[BUY ] ' + (DOM.buyBtn  ? cssPath(DOM.buyBtn)  + '\n       ' + _snip(DOM.buyBtn)  : 'NOT FOUND'));
    lines.push('[SELL] ' + (DOM.sellBtn ? cssPath(DOM.sellBtn) + '\n       ' + _snip(DOM.sellBtn) : 'NOT FOUND'));
    lines.push('[DUR ] ' + (DOM.durInput ? cssPath(DOM.durInput) + '\n       ' + _snip(DOM.durInput) : 'NOT FOUND'));
    lines.push('[CNTD] ' + (DOM.countdownEl ? cssPath(DOM.countdownEl) + '\n       ' + _snip(DOM.countdownEl) : 'NOT FOUND'));
    lines.push('');
    lines.push('-- countdown candidates (decScore = ثبت أنه يتناقص) --');
    for (const [p, c] of _cdCands) lines.push('  score=' + c.decScore + ' last=' + c.lastVal + 's  ' + p);
    lines.push('');
    lines.push('-- recent log --');
    for (const l of logBuf.slice(0, 50).reverse()) lines.push('  [' + l.t + '] ' + l.msg);
    return lines.join('\n');
  }
  function downloadHTML() {
    try {
      let html = '';
      try {
        const clone = document.documentElement.cloneNode(true);
        const hud = clone.querySelector('#cbRoot');
        if (hud) hud.remove();   // لا تلوّث اللقطة بواجهة البوت
        const orb = clone.querySelector('#cbTradeOrb'); if (orb) orb.remove();
        html = clone.outerHTML;
      } catch (_) { html = document.documentElement.outerHTML; }
      const txt = '/*\n' + buildDomReport() + '\n*/\n\n' + html;
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'po_page_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      log('📄 تم تنزيل HTML + التقرير (' + Math.round(txt.length / 1024) + 'KB)', 'signal');
    } catch (e) { log('⛔ فشل تنزيل HTML: ' + (e && e.message), 'error'); }
  }

  function fmtRemain(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms/1000); const m = Math.floor(s/60);
    return String(m).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  }
  const $ = (id) => document.getElementById(id);
  const setTxt = (id, v) => { const e = $(id); if (e) e.textContent = v; };

  // ── CSS بنمط v17 (⚡ QUANTUM دارك خرافي) ──
  const HUD_CSS = `
  #cbRoot{position:fixed;bottom:16px;left:16px;z-index:2147483600;font-family:'IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,sans-serif;direction:rtl;}
  @keyframes cbGradFlow{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}
  @keyframes cbBorderGlow{0%,100%{box-shadow:0 8px 40px rgba(0,0,0,0.5),0 0 22px rgba(0,210,100,0.18);}50%{box-shadow:0 8px 44px rgba(0,0,0,0.55),0 0 30px rgba(0,170,255,0.22);}}
  #cbIcon{width:50px;height:50px;border-radius:15px;background:linear-gradient(145deg,#13212e,#0c1a16);border:1.5px solid #2a4a3c;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;animation:cbBorderGlow 6s ease-in-out infinite;}
  #cbIcon.buy{border-color:#86EFAC;}#cbIcon.sell{border-color:#FCA5A5;}
  #cbIconSig{font-size:20px;}
  #cbIconDot{width:6px;height:6px;border-radius:50%;background:#33485a;margin-top:3px;}
  #cbIconDot.on{background:#16A34A;box-shadow:0 0 8px #16A34A;}
  #cbPanel{position:fixed;bottom:76px;left:8px;width:300px;background:linear-gradient(165deg,#0d1722 0%,#0a1219 60%,#0c1a16 100%);border:1px solid #243443;border-radius:20px;display:none;flex-direction:column;overflow:hidden;max-height:calc(100svh - 120px);animation:cbBorderGlow 6s ease-in-out infinite;}
  #cbPanel.open{display:flex;}
  @media(max-width:480px){#cbPanel{width:calc(100vw - 16px);left:8px;bottom:72px;}}
  .cb-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:grab;flex-shrink:0;background:linear-gradient(100deg,#11202c,#0e2b22);border-bottom:1px solid #243443;}
  .cb-hdr-dot{width:8px;height:8px;border-radius:50%;background:#56707f;flex-shrink:0;}
  .cb-hdr-dot.on{background:#00d264;box-shadow:0 0 0 3px rgba(0,210,100,0.18),0 0 12px rgba(0,210,100,0.6);}
  .cb-ttl{font-size:12px;font-weight:800;letter-spacing:0.6px;flex:1;background:linear-gradient(90deg,#00d264,#3fe0ff,#9b8cff,#00d264);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cbGradFlow 5s linear infinite;}
  .cb-icon-btn{width:24px;height:24px;border-radius:8px;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;font-size:12px;cursor:pointer;}
  #cbScroll{overflow-y:auto;flex:1;background:#0c151c;padding-bottom:6px;}
  #cbScroll::-webkit-scrollbar{width:3px;}#cbScroll::-webkit-scrollbar-thumb{background:#33485a;border-radius:3px;}
  .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:10px 10px 0;}
  .cb-stat{background:#16222e;border:1px solid #243443;border-radius:10px;padding:7px 9px;border-right:3px solid #1E3A2F;}
  .cb-stat-lbl{display:block;font-size:8.5px;color:#7c8d9b;margin-bottom:3px;}
  .cb-stat-val{font-size:12px;font-weight:700;color:#eef3f7;}
  .cb-stat-val.w{color:#46d98e;}.cb-stat-val.g{color:#16A34A;}.cb-stat-val.y{color:#D97706;}.cb-stat-val.r{color:#DC2626;}
  .cb-ind-row{display:flex;align-items:center;gap:6px;padding:6px 10px 0;font-size:9px;}
  .cb-ind-lbl{color:#9fb2c0;flex-shrink:0;min-width:56px;}
  .cb-ind-val{font-family:ui-monospace,monospace;color:#dfe7ee;font-size:9px;flex:1;}
  .cb-ind-badge{font-size:8px;font-weight:700;padding:2px 7px;border-radius:20px;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;flex-shrink:0;}
  .cb-ind-badge.up{background:#0f2a1c;border-color:#86EFAC;color:#16A34A;}
  .cb-ind-badge.dn{background:#2a1416;border-color:#FCA5A5;color:#DC2626;}
  .cb-ind-badge.yw{background:#2a2410;border-color:#FCD34D;color:#D97706;}
  .cb-sig-wrap{padding:10px 10px 0;}
  .cb-sig-box{background:#16222e;border:1.5px solid #243443;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
  .cb-sig-box.buy{background:#0f2a1c;border-color:#46d98e;}.cb-sig-box.sell{background:#2a1416;border-color:#DC2626;}
  .cb-sig-main{font-size:18px;font-weight:800;color:#eef3f7;}
  .cb-sig-main.BUY{color:#46d98e;}.cb-sig-main.SELL{color:#DC2626;}.cb-sig-main.HOLD{color:#7c8d9b;font-size:15px;}
  .cb-sig-sub{font-size:10px;color:#9fb2c0;}
  .cb-stats-bar{display:flex;gap:5px;padding:8px 10px 0;}
  .cb-stt{flex:1;background:#16222e;border:1px solid #243443;border-radius:10px;padding:6px 7px;text-align:center;}
  .cb-stt-lbl{display:block;font-size:7.5px;color:#7c8d9b;margin-bottom:3px;}
  .cb-stt-val{font-size:13px;font-weight:700;color:#eef3f7;}
  .cb-stt-val.g{color:#16A34A;}.cb-stt-val.r{color:#DC2626;}.cb-stt-val.y{color:#D97706;}.cb-stt-val.b{color:#3fe0ff;}
  .cb-sep{height:1px;background:#243443;margin:11px 10px 0;}
  .cb-manual-row{display:flex;gap:8px;padding:10px;}
  .cb-manual-btn{flex:1;padding:12px 8px;border-radius:50px;border:none;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:0.5px;}
  .cb-manual-btn.buy{background:#1E3A2F;color:#fff;}.cb-manual-btn.buy:active{transform:scale(0.95);}
  .cb-manual-btn.sell{background:#DC2626;color:#fff;}.cb-manual-btn.sell:active{transform:scale(0.95);}
  .cb-auto-row{display:flex;align-items:center;gap:10px;padding:2px 10px 6px;}
  .cb-auto-lbl{font-size:10.5px;color:#9fb2c0;flex:1;}
  .cb-toggle{appearance:none;width:40px;height:22px;border-radius:11px;cursor:pointer;background:#243443;border:none;position:relative;transition:all 0.25s;flex-shrink:0;}
  .cb-toggle::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#16222e;transition:all 0.25s;}
  .cb-toggle:checked{background:#1E3A2F;}.cb-toggle:checked::after{transform:translateX(18px);}
  .cb-auto-badge{font-size:10px;font-weight:700;color:#7c8d9b;min-width:28px;text-align:center;}
  .cb-util{display:flex;gap:6px;flex-wrap:wrap;margin:6px 10px;}
  .cb-util-btn{flex:1;min-width:72px;padding:8px 4px;border-radius:10px;border:1px solid #243443;background:#16222e;color:#9fb2c0;font-family:inherit;font-size:9.5px;font-weight:700;cursor:pointer;}
  .cb-util-btn.g{border-color:#1E3A2F;color:#46d98e;}.cb-util-btn.r{border-color:#3a1a1a;color:#ff8a8a;}.cb-util-btn.o{border-color:#5a3410;color:#f0a850;}
  #cbStatus{padding:7px 14px 9px;font-size:8px;font-weight:700;font-family:ui-monospace,monospace;border-top:1px solid #243443;letter-spacing:0.5px;text-align:center;background-image:linear-gradient(90deg,#00d264,#3fe0ff,#9b8cff,#00d264);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cbGradFlow 7s linear infinite;}
  #cbLogFloat{position:fixed;bottom:148px;left:6px;z-index:2147483590;width:360px;background:#16222e;border:1px solid #243443;border-radius:16px;display:none;flex-direction:column;overflow:hidden;max-height:calc(100svh - 160px);}
  #cbLogFloat.open{display:flex;}
  @media(max-width:480px){#cbLogFloat{width:calc(100vw - 12px);left:6px;}}
  #cbLogHdr{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid #243443;cursor:grab;background:#0c151c;}
  .cb-log-title{font-size:10px;font-weight:800;color:#46d98e;letter-spacing:0.8px;flex:1;}
  .cb-log-hbtn{height:24px;padding:0 9px;border-radius:20px;background:#16222e;border:1px solid #243443;color:#9fb2c0;cursor:pointer;font-size:9px;font-weight:700;}
  .cb-log-filters{display:flex;gap:4px;padding:6px 8px;flex-wrap:wrap;border-bottom:1px solid #243443;}
  .cb-lf{font-size:9px;padding:3px 8px;border-radius:14px;background:#0c151c;border:1px solid #243443;color:#9fb2c0;cursor:pointer;}
  .cb-lf.active{background:#1E3A2F;color:#46d98e;border-color:#1E3A2F;}
  #cbLogInner{overflow-y:auto;flex:1;background:#0b0e13;min-height:120px;max-height:40vh;}
  #cbLogInner::-webkit-scrollbar{width:3px;}#cbLogInner::-webkit-scrollbar-thumb{background:#33485a;border-radius:3px;}
  /* ── إشعار الإشارة (LIQUID ORB بنمط v17) ── */
  #cbTradeOrb{position:fixed;top:90px;right:14px;z-index:2147483640;width:172px;background:linear-gradient(165deg,rgba(13,23,34,0.97),rgba(10,18,25,0.97));border:1.5px solid #243443;border-radius:22px;padding:14px;opacity:0;transform:translateY(-16px) scale(0.9);pointer-events:none;transition:all 0.35s cubic-bezier(.2,.9,.3,1.2);box-shadow:0 12px 40px rgba(0,0,0,0.6);}
  #cbTradeOrb.visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}
  #cbTradeOrb.buy{border-color:#46d98e;box-shadow:0 12px 44px rgba(0,210,100,0.35);}
  #cbTradeOrb.sell{border-color:#DC2626;box-shadow:0 12px 44px rgba(220,38,38,0.35);}
  #cbOrbCloseX{position:absolute;top:8px;left:8px;width:20px;height:20px;border-radius:50%;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;font-size:11px;cursor:pointer;line-height:18px;text-align:center;}
  #cbOrbArrow{font-size:40px;text-align:center;line-height:1;}
  #cbOrbDir{font-size:20px;font-weight:900;text-align:center;letter-spacing:2px;}
  #cbOrbDir.buy{color:#46d98e;}#cbOrbDir.sell{color:#ff5b6e;}
  #cbOrbAsset{font-size:11px;color:#cdd7e0;text-align:center;margin-top:2px;}
  .cb-orb-info{display:flex;justify-content:space-between;font-size:10px;color:#9fb2c0;margin-top:8px;border-top:1px solid #243443;padding-top:8px;}
  .cb-orb-info b{display:block;color:#eef3f7;font-size:12px;font-family:ui-monospace,monospace;}
  #cbOrbProbTrack{height:5px;border-radius:3px;background:#243443;overflow:hidden;margin-top:8px;}
  #cbOrbProbBar{height:100%;border-radius:3px;transition:width 0.3s;background:#46d98e;}
  #cbTradeOrb.sell #cbOrbProbBar{background:#ff5b6e;}
  `;

  const HUD_HTML = `
  <div id="cbIcon" title="⏱️ PO TIME-CLICK BOT — اضغط للفتح"><div id="cbIconSig">⚡</div><div id="cbIconDot"></div></div>
  <div id="cbPanel">
    <div class="cb-hdr" id="cbDragHdr">
      <div class="cb-hdr-dot" id="cbHdrDot"></div>
      <span class="cb-ttl">⚡ QUANTUM TIME-CLICK ⚡</span>
      <div style="display:flex;gap:4px;">
        <button class="cb-icon-btn" id="cbLogBtn" title="السجل">☰</button>
        <button class="cb-icon-btn" id="cbClose">−</button>
      </div>
    </div>
    <div id="cbScroll">
      <div class="cb-grid">
        <div class="cb-stat"><span class="cb-stat-lbl">الزوج</span><span class="cb-stat-val w" id="cbAsset">جاري…</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">السعر</span><span class="cb-stat-val g" id="cbPrice">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">مدة الشمعة</span><span class="cb-stat-val y" id="cbPeriod">M1 · 60ث</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">⏱ عمر الصفقة</span><span class="cb-stat-val g" id="cbTradeDur">؟</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">ثانية الشمعة</span><span class="cb-stat-val y" id="cbCd">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">تيكات</span><span class="cb-stat-val" id="cbTickCount">0</span></div>
      </div>
      <div class="cb-ind-row" title="اتجاه الشمعة الحالية (افتتاح مقابل السعر)">
        <span class="cb-ind-lbl">🕯️ الشمعة</span><span class="cb-ind-val" id="cbCandleVal">–</span>
        <span class="cb-ind-badge" id="cbCandleBadge">–</span>
      </div>
      <div class="cb-ind-row" title="الزخم التنبّئي من تيكات ORACLE/MAIN">
        <span class="cb-ind-lbl">⚡ الزخم</span><span class="cb-ind-val" id="cbMomVal">–</span>
        <span class="cb-ind-badge" id="cbMomBadge">–</span>
      </div>
      <div class="cb-ind-row" title="🔮 المقابس المعترَضة">
        <span class="cb-ind-lbl">🔮 المقابس</span><span class="cb-ind-val" id="cbWssVal">بانتظار…</span>
        <span class="cb-ind-badge" id="cbWssBadge">–</span>
      </div>
      <div class="cb-ind-row" title="عناصر الواجهة المستخرجة">
        <span class="cb-ind-lbl">🎯 DOM</span><span class="cb-ind-val" id="cbDomVal">–</span>
        <span class="cb-ind-badge" id="cbDomBadge">–</span>
      </div>
      <div class="cb-ind-row" title="نظام التجميد الزمني (حماية رأس المال)">
        <span class="cb-ind-lbl">🧊 تجميد</span><span class="cb-ind-val" id="cbCoolVal">—</span>
        <span class="cb-ind-badge" id="cbCoolBadge">جاهز</span>
      </div>
      <div class="cb-sig-wrap">
        <div class="cb-sig-box" id="cbSigBox">
          <div class="cb-sig-main HOLD" id="cbSigMain">انتظار</div>
          <div class="cb-sig-sub" id="cbSigSub">ث36/ث26 مع الاتجاه · ث11 معاكس</div>
        </div>
      </div>
      <div class="cb-stats-bar">
        <div class="cb-stt"><span class="cb-stt-lbl">دخول ✅</span><span class="cb-stt-val g" id="cbEntries">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">محجوب ⛔</span><span class="cb-stt-val y" id="cbBlocked">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">انعكاس 🧊</span><span class="cb-stt-val r" id="cbReversals">0</span></div>
      </div>
      <div class="cb-sep"></div>
      <div class="cb-manual-row">
        <button class="cb-manual-btn buy" id="cbManualBuy">↑ شراء</button>
        <button class="cb-manual-btn sell" id="cbManualSell">↓ بيع</button>
      </div>
      <div class="cb-auto-row">
        <span class="cb-auto-lbl">تداول تلقائي (الاستراتيجية الزمنية)</span>
        <input type="checkbox" class="cb-toggle" id="cbAutoToggle">
        <span class="cb-auto-badge" id="cbAutoBadge">OFF</span>
      </div>
      <div class="cb-auto-row" style="padding-top:0;">
        <span class="cb-auto-lbl">🔔 إشعار الإشارة</span>
        <input type="checkbox" class="cb-toggle" id="cbPopupToggle" checked>
        <span class="cb-auto-badge" id="cbPopupBadge" style="color:#00d264;">ON</span>
      </div>
      <div class="cb-util">
        <button class="cb-util-btn" id="cbRescan">🔍 مسح DOM</button>
        <button class="cb-util-btn g" id="cbTestBuy">🧪 اختبار شراء</button>
        <button class="cb-util-btn r" id="cbTestSell">🧪 اختبار بيع</button>
        <button class="cb-util-btn o" id="cbDlHtml">📄 تنزيل HTML</button>
      </div>
    </div>
    <div id="cbStatus">◆ QUANTUM TIME-CLICK ◆ ORACLE/MAIN ◆ ث36·26·11 ◆ DOM-CLICK ONLY ◆</div>
  </div>
  <div id="cbLogFloat">
    <div id="cbLogHdr">
      <span class="cb-log-title">⚡ السجل الحي</span>
      <button class="cb-log-hbtn" id="cbLogPause">⏸ وقفة</button>
      <button class="cb-log-hbtn" id="cbLogClear">🗑 مسح</button>
      <button class="cb-log-hbtn" id="cbLogCloseX">✕</button>
    </div>
    <div class="cb-log-filters" id="cbLogFilters">
      <button class="cb-lf active" data-f="all">الكل</button>
      <button class="cb-lf" data-f="trade">🟢 صفقات</button>
      <button class="cb-lf" data-f="signal">📡 إشارات</button>
      <button class="cb-lf" data-f="warn">⛔ حجب</button>
      <button class="cb-lf" data-f="risk">🧊 مخاطر</button>
      <button class="cb-lf" data-f="info">ℹ معلومات</button>
    </div>
    <div id="cbLogInner"></div>
  </div>
  <div id="cbTradeOrb">
    <div id="cbOrbCloseX">✕</div>
    <div id="cbOrbArrow">▲</div>
    <div id="cbOrbDir" class="buy">BUY</div>
    <div id="cbOrbAsset">–</div>
    <div class="cb-orb-info"><span>السعر<b id="cbOrbPrice">–</b></span><span>المدة<b id="cbOrbDur">–</b></span><span>متبقٍ<b id="cbOrbCd">–</b></span></div>
    <div id="cbOrbProbTrack"><div id="cbOrbProbBar" style="width:0%"></div></div>
  </div>`;

  // ── إشعار الإشارة (Orb) ──
  let _popupEnabled = true, _orbTimer = null;
  function showSignalPopup(dir, label) {
    if (!_popupEnabled) return;
    const orb = $('cbTradeOrb'); if (!orb) return;
    const isBuy = dir > 0;
    orb.className = 'visible ' + (isBuy ? 'buy' : 'sell');
    setTxt('cbOrbArrow', isBuy ? '▲' : '▼');
    $('cbOrbArrow').style.color = isBuy ? '#46d98e' : '#ff5b6e';
    const dirEl = $('cbOrbDir'); if (dirEl) { dirEl.textContent = isBuy ? 'BUY' : 'SELL'; dirEl.className = isBuy ? 'buy' : 'sell'; }
    setTxt('cbOrbAsset', (activeAsset || '–').replace(/_OTC$/i, ' OTC'));
    setTxt('cbOrbPrice', lastPrice ? lastPrice.toFixed(5) : '–');
    const dur = tradeDurSec();
    setTxt('cbOrbDur', dur + 'ث');
    try { if (W.navigator.vibrate) W.navigator.vibrate([60, 30, 60]); } catch (_) {}
    if (_orbTimer) clearInterval(_orbTimer);
    const endMs = now() + dur * 1000;
    _orbTimer = setInterval(() => {
      const remain = Math.max(0, endMs - now());
      setTxt('cbOrbCd', Math.ceil(remain / 1000) + 'ث');
      const pb = $('cbOrbProbBar'); if (pb) pb.style.width = (100 * remain / (dur * 1000)) + '%';
      if (remain <= 0) { clearInterval(_orbTimer); _orbTimer = null; setTimeout(hideSignalPopup, 1000); }
    }, 200);
  }
  function hideSignalPopup() { const orb = $('cbTradeOrb'); if (orb) orb.className = ''; if (_orbTimer) { clearInterval(_orbTimer); _orbTimer = null; } }

  function updateHUD() {
    if (!hudEl) return;
    const sec = activeAsset ? secInCandle() : '–';
    const cdir = candleDirection();
    setTxt('cbAsset', activeAsset ? activeAsset.replace(/_OTC$/i, ' OTC') : 'جاري…');
    setTxt('cbPrice', lastPrice ? lastPrice.toFixed(5) : '–');
    setTxt('cbTradeDur', tradeDurSec() + 'ث' + (_tradeDurationSec >= 1 ? '' : ' (افتراضي)'));
    setTxt('cbCd', 'ث' + sec);
    setTxt('cbTickCount', ticks.merged.length);

    const cv = $('cbCandleVal'), cb = $('cbCandleBadge');
    if (cv) cv.textContent = candleOpenPrice ? candleOpenPrice.toFixed(5) + ' ← ' + (lastPrice||0).toFixed(5) : '–';
    if (cb) { cb.textContent = cdir > 0 ? 'صعود ▲' : cdir < 0 ? 'هبوط ▼' : 'محايد'; cb.className = 'cb-ind-badge ' + (cdir>0?'up':cdir<0?'dn':''); }

    const wss = $('cbWssVal'), wssB = $('cbWssBadge');
    if (wss) wss.textContent = 'O:' + ticks.oracle.length + ' · M:' + ticks.main.length;
    if (wssB) { const on = ticks.merged.length > 0; wssB.textContent = on ? '🟢 متصل' : '🔴 انتظار'; wssB.className = 'cb-ind-badge ' + (on?'up':'dn'); }

    const dv = $('cbDomVal'), db = $('cbDomBadge');
    const found = (DOM.buyBtn?1:0)+(DOM.sellBtn?1:0)+(DOM.durInput?1:0);
    if (dv) dv.textContent = (DOM.buyBtn?'شراء✓':'شراء✗') + ' · ' + (DOM.sellBtn?'بيع✓':'بيع✗') + ' · ' + (DOM.durInput?'زمن✓':'زمن✗');
    if (db) { db.textContent = found + '/3'; db.className = 'cb-ind-badge ' + (found>=2?'up':found>0?'yw':'dn'); }

    const coolOn = cooldownUntil && now() < cooldownUntil;
    setTxt('cbCoolVal', coolOn ? fmtRemain(cooldownUntil - now()) : '—');
    const coolB = $('cbCoolBadge'); if (coolB) { coolB.textContent = coolOn ? '🧊 نشط' : 'جاهز'; coolB.className = 'cb-ind-badge ' + (coolOn?'dn':'up'); }

    setTxt('cbEntries', stats.entries);
    setTxt('cbBlocked', stats.blocked);
    setTxt('cbReversals', stats.reversals);

    const dot = $('cbHdrDot'); if (dot) dot.className = 'cb-hdr-dot ' + (autoTrade ? 'on' : '');
    const idot = $('cbIconDot'); if (idot) idot.className = autoTrade ? 'on' : '';
    const ab = $('cbAutoBadge'); if (ab) { ab.textContent = autoTrade ? 'ON' : 'OFF'; ab.style.color = autoTrade ? '#46d98e' : '#7c8d9b'; }
    const at = $('cbAutoToggle'); if (at) at.checked = autoTrade;
  }

  // إظهار الإشارة في صندوق اللوحة (دون فتح Orb)
  function setSignalBox(dir, txt) {
    const box = $('cbSigBox'), main = $('cbSigMain'), sub = $('cbSigSub');
    if (!box) return;
    if (dir === 0) { box.className = 'cb-sig-box'; main.className = 'cb-sig-main HOLD'; main.textContent = 'انتظار'; if (txt) sub.textContent = txt; return; }
    const isBuy = dir > 0;
    box.className = 'cb-sig-box ' + (isBuy ? 'buy' : 'sell');
    main.className = 'cb-sig-main ' + (isBuy ? 'BUY' : 'SELL');
    main.textContent = isBuy ? '▲ شراء / CALL' : '▼ بيع / PUT';
    if (txt) sub.textContent = txt;
  }

  function _dragEl(handle, target) {
    let sx=0, sy=0, ox=0, oy=0, dragging=false;
    const start = (x,y) => { dragging=true; sx=x; sy=y; const r=target.getBoundingClientRect(); ox=r.left; oy=r.top; };
    const move = (x,y) => { if(!dragging) return; target.style.left=Math.max(0,ox+x-sx)+'px'; target.style.top=Math.max(0,oy+y-sy)+'px'; target.style.right='auto'; target.style.bottom='auto'; };
    const end = () => dragging=false;
    handle.addEventListener('mousedown', e => { start(e.clientX,e.clientY); });
    document.addEventListener('mousemove', e => move(e.clientX,e.clientY));
    document.addEventListener('mouseup', end);
    handle.addEventListener('touchstart', e => { const t=e.touches[0]; if(t) start(t.clientX,t.clientY); }, {passive:true});
    document.addEventListener('touchmove', e => { const t=e.touches[0]; if(t&&dragging) move(t.clientX,t.clientY); }, {passive:true});
    document.addEventListener('touchend', end);
  }

  function setAuto(on) {
    autoTrade = on;
    log(on ? '▶️ تشغيل التداول التلقائي' : '⏸️ إيقاف التداول التلقائي', 'info');
    updateHUD();
  }

  function buildHUD() {
    if ($('cbRoot')) return;
    const style = document.createElement('style'); style.textContent = HUD_CSS; document.head.appendChild(style);
    hudEl = document.createElement('div'); hudEl.id = 'cbRoot'; hudEl.innerHTML = HUD_HTML;
    document.body.appendChild(hudEl);
    logInnerEl = $('cbLogInner');

    const panel = $('cbPanel'), logFloat = $('cbLogFloat');
    $('cbIcon').addEventListener('click', () => panel.classList.toggle('open'));
    $('cbClose').addEventListener('click', () => panel.classList.remove('open'));
    $('cbLogBtn').addEventListener('click', () => { logFloat.classList.toggle('open'); renderLog(); });
    $('cbLogCloseX').addEventListener('click', () => logFloat.classList.remove('open'));
    $('cbLogPause').addEventListener('click', (e) => { _logPaused = !_logPaused; e.target.textContent = _logPaused ? '▶ تشغيل' : '⏸ وقفة'; if (!_logPaused) renderLog(); });
    $('cbLogClear').addEventListener('click', () => { logBuf.length = 0; renderLog(); });
    $('cbLogFilters').addEventListener('click', (e) => {
      const b = e.target.closest('.cb-lf'); if (!b) return;
      _logFilter = b.dataset.f;
      $('cbLogFilters').querySelectorAll('.cb-lf').forEach(x => x.classList.toggle('active', x === b));
      renderLog();
    });

    $('cbAutoToggle').addEventListener('change', (e) => setAuto(e.target.checked));
    $('cbPopupToggle').addEventListener('change', (e) => {
      _popupEnabled = e.target.checked;
      const pb = $('cbPopupBadge'); pb.textContent = _popupEnabled ? 'ON' : 'OFF'; pb.style.color = _popupEnabled ? '#00d264' : '#7c8d9b';
    });
    $('cbManualBuy').addEventListener('click', () => { manualTrade(+1); });
    $('cbManualSell').addEventListener('click', () => { manualTrade(-1); });
    $('cbRescan').addEventListener('click', () => { scanDOM(); log('🔍 إعادة مسح الواجهة يدوياً', 'info'); });
    $('cbTestBuy').addEventListener('click', () => { physicalClick(DOM.buyBtn) ? log('🧪 نقر شراء تجريبي','trade') : log('⛔ لا زر شراء','error'); });
    $('cbTestSell').addEventListener('click', () => { physicalClick(DOM.sellBtn) ? log('🧪 نقر بيع تجريبي','trade') : log('⛔ لا زر بيع','error'); });
    $('cbDlHtml').addEventListener('click', downloadHTML);
    $('cbOrbCloseX').addEventListener('click', hideSignalPopup);

    _dragEl($('cbDragHdr'), panel);
    _dragEl($('cbLogHdr'), logFloat);

    log('🚀 البوت جاهز — اضغط ⚡ ثم فعّل «تداول تلقائي». التنفيذ عبر نقر الأزرار فقط.', 'info');
    log('ℹ️ الاستراتيجية: ث36/ث26 مع اتجاه الشمعة، ث11 معاكس + فلتر زخم + تجميد عند الانعكاس.', 'info');
    updateHUD();
  }

  // نقر يدوي (لا يمر بفلتر الزخم — تنفيذ مباشر بناءً على ضغط المستخدم)
  function manualTrade(dir) {
    setSignalBox(dir, 'أمر يدوي');
    showSignalPopup(dir, 'يدوي');
    executeTrade(dir, 'يدوي');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    buildHUD();
    scanDOM();
    setInterval(scanDOM, CFG.RESCAN_DOM_MS);
    setInterval(countdownPoll, 400);    // متتبّع عداد الشمعة + مرساة الطور
    setInterval(strategyLoop, 60);      // حلقة الاستراتيجية عالية الدقة (~60ms)
    setInterval(updateHUD, 250);
    log('🔌 اعتراض WSS مُفعّل (ORACLE/MAIN).', 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  // محاولة احتياطية إذا تأخر الـ body
  let _bootTries = 0;
  const _bootCheck = setInterval(() => {
    if (document.getElementById('cbRoot') || ++_bootTries > 40) { clearInterval(_bootCheck); return; }
    if (document.body) boot();
  }, 500);

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
