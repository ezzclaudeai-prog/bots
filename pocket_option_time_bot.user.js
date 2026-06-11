// ==UserScript==
// @name         ⏱️ PO TIME-CLICK BOT — M1 Timed Strategy + Predictive Momentum + DOM Click Execution
// @namespace    pocket-option-time-click-bot
// @version      1.0.0
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

  function candleIndex() { return Math.floor(serverNow() / (CFG.CANDLE_SEC * 1000)); }
  function secInCandle()  { return Math.floor((serverNow() % (CFG.CANDLE_SEC * 1000)) / 1000); }
  function msInCandle()   { return serverNow() % (CFG.CANDLE_SEC * 1000); }

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
      DOM.countdownEl = findCountdownEl();
    } catch (_) {}
    updateHUD();
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
    const buyWords  = ['شراء','call','buy','up','higher','أعلى'];
    const sellWords = ['بيع','put','sell','down','lower','أدنى'];
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

  function findDurationInput() {
    // خانة "الزمن"/عمر الصفقة (مثل 00:00:05). نبحث عن حقل قيمته بصيغة وقت قرب كلمة الزمن.
    const timeRe = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    const inputs = Array.from(document.querySelectorAll('input, [contenteditable="true"], [class*="time"], [class*="duration"], [class*="expir"]'));
    for (const el of inputs) {
      if (!visible(el)) continue;
      const val = (el.value || el.textContent || '').trim();
      if (timeRe.test(val) && val.length <= 10) return el;
    }
    return null;
  }

  // يقرأ عمر الصفقة من الواجهة (بالثواني) — كتأكيد لـ WSS
  function domTradeDur() {
    const el = DOM.durInput; if (!el) return 0;
    const val = (el.value || el.textContent || '').trim();
    const m = val.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return 0;
    if (m[3] != null) return (+m[1])*3600 + (+m[2])*60 + (+m[3]);
    return (+m[1])*60 + (+m[2]);   // mm:ss
  }

  function findCountdownEl() {
    // العداد التنازلي للشمعة بجوار وسم الإطار (M1 00:24). نبحث عن نص "00:24" بصيغة mm:ss يتغيّر.
    const re = /^\s*[0-5]?\d:[0-5]\d\s*$/;
    const all = Array.from(document.querySelectorAll('span, div, p, time'));
    const matches = [];
    for (const el of all) {
      if (!visible(el)) continue;
      if (el.children.length > 0) continue;             // عقدة نصية فقط
      const t = (el.textContent || '').trim();
      if (re.test(t)) matches.push(el);
    }
    // فضّل العنصر الأقرب لوسم M1/الإطار الزمني
    for (const el of matches) {
      const parentTxt = (el.parentElement && el.parentElement.textContent || '').toLowerCase();
      if (/\bm1\b|m1|التداول|m5|m15/.test(parentTxt)) return el;
    }
    return matches[0] || null;
  }

  // ثواني متبقية من عداد الواجهة (تأكيد لساعة الخادم)
  function domCandleRemain() {
    const el = DOM.countdownEl; if (!el) return null;
    const t = (el.textContent || '').trim();
    const m = t.match(/^([0-5]?\d):([0-5]\d)$/);
    if (!m) return null;
    return (+m[1])*60 + (+m[2]);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  PHYSICAL CLICK EXECUTION (محاكاة نقر فعلي — لا WS/API)
  // ══════════════════════════════════════════════════════════════════════
  function physicalClick(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const base = { bubbles: true, cancelable: true, composed: true, view: W, clientX: cx, clientY: cy, button: 0 };
      const seq = [
        ['pointerover', PointerEvent], ['pointerenter', PointerEvent],
        ['mouseover', MouseEvent], ['mousemove', MouseEvent],
        ['pointerdown', PointerEvent], ['mousedown', MouseEvent],
        ['pointerup', PointerEvent], ['mouseup', MouseEvent],
        ['click', MouseEvent],
      ];
      for (const [type, Ctor] of seq) {
        let ev;
        try {
          ev = new Ctor(type, type.startsWith('pointer')
            ? Object.assign({ pointerId: 1, pointerType: 'touch', isPrimary: true }, base)
            : base);
        } catch (_) { ev = new MouseEvent(type, base); }
        el.dispatchEvent(ev);
      }
      // محاولة لمس فعلي إضافية (هواتف)
      try {
        const touchOpts = { bubbles:true, cancelable:true, composed:true, view:W };
        el.dispatchEvent(new TouchEvent('touchstart', touchOpts));
        el.dispatchEvent(new TouchEvent('touchend', touchOpts));
      } catch (_) {}
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
    executeTrade(dir, 'ث' + sec + (mode==='counter'?' معاكس':''));
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
  // § 10  FLOATING HUD (مكتفٍ ذاتياً — لا حاجة لكونسول)
  // ══════════════════════════════════════════════════════════════════════
  const logBuf = [];
  let logEl = null, statusEl = null, hudEl = null;

  function log(msg, kind) {
    const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    logBuf.push({ line, kind });
    if (logBuf.length > CFG.LOG_MAX) logBuf.shift();
    if (logEl) {
      const div = document.createElement('div');
      div.textContent = line;
      div.style.color = ({
        error:'#ff6b6b', warn:'#ffd166', risk:'#ff9f43', trade:'#2ecc71',
        signal:'#4dabf7', info:'#9aa0a6'
      })[kind] || '#cfd2d6';
      logEl.appendChild(div);
      while (logEl.children.length > CFG.LOG_MAX) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function fmtRemain(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms/1000); const m = Math.floor(s/60);
    return String(m).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
  }

  function updateHUD() {
    if (!statusEl) return;
    const sec = activeAsset ? secInCandle() : '--';
    const cdir = candleDirection();
    const cd = cdir > 0 ? '🟢صعود' : cdir < 0 ? '🔴هبوط' : '⚪';
    const cool = (cooldownUntil && now() < cooldownUntil) ? ('🧊' + fmtRemain(cooldownUntil-now())) : '—';
    const domOk = (DOM.buyBtn?'B':'·') + (DOM.sellBtn?'S':'·') + (DOM.durInput?'D':'·') + (DOM.countdownEl?'C':'·');
    statusEl.innerHTML =
      '<b style="color:' + (autoTrade?'#2ecc71':'#ff6b6b') + '">' + (autoTrade?'● يعمل':'○ متوقف') + '</b>' +
      ' | ' + (activeAsset||'؟') +
      ' | شمعة ث' + sec + ' ' + cd +
      ' | عمر الصفقة ' + tradeDurSec() + 'ث' +
      ' | DOM[' + domOk + ']' +
      ' | تجميد ' + cool +
      '<br>دخول ' + stats.entries + ' · محجوب ' + stats.blocked + ' · انعكاس ' + stats.reversals;
  }

  function buildHUD() {
    if (document.getElementById('po-time-bot-hud')) return;
    hudEl = document.createElement('div');
    hudEl.id = 'po-time-bot-hud';
    hudEl.style.cssText = [
      'position:fixed','z-index:2147483647','right:8px','bottom:8px','width:320px','max-width:92vw',
      'background:rgba(15,18,24,0.96)','color:#e6e6e6','font:12px/1.45 monospace',
      'border:1px solid #2b3340','border-radius:10px','box-shadow:0 6px 24px rgba(0,0,0,.5)',
      'padding:8px','user-select:none'
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:move';
    title.innerHTML = '<span style="font-weight:bold;color:#4dabf7">⏱️ PO TIME-CLICK BOT</span>';
    const minBtn = document.createElement('button');
    minBtn.textContent = '_';
    minBtn.style.cssText = 'background:#222a35;color:#ccc;border:0;border-radius:5px;width:24px;height:22px;cursor:pointer';
    title.appendChild(minBtn);
    hudEl.appendChild(title);

    statusEl = document.createElement('div');
    statusEl.style.cssText = 'background:#11161f;border:1px solid #232b36;border-radius:7px;padding:6px;margin-bottom:6px;font-size:11px';
    hudEl.appendChild(statusEl);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap';
    const mkBtn = (txt, bg, fn) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'flex:1;min-width:64px;background:'+bg+';color:#fff;border:0;border-radius:6px;padding:7px 4px;font-weight:bold;cursor:pointer;font-size:12px';
      b.onclick = fn; return b;
    };
    const startBtn = mkBtn(autoTrade?'إيقاف':'تشغيل', autoTrade?'#c0392b':'#27ae60', () => {
      autoTrade = !autoTrade;
      startBtn.textContent = autoTrade?'إيقاف':'تشغيل';
      startBtn.style.background = autoTrade?'#c0392b':'#27ae60';
      log(autoTrade?'▶️ تم التشغيل':'⏸️ تم الإيقاف', 'info');
      updateHUD();
    });
    row.appendChild(startBtn);
    row.appendChild(mkBtn('مسح DOM', '#2c3e50', () => { scanDOM(); log('🔍 إعادة مسح الواجهة', 'info'); }));
    row.appendChild(mkBtn('اختبار شراء', '#16a085', () => { physicalClick(DOM.buyBtn) ? log('🧪 نقر شراء تجريبي','trade') : log('⛔ لا زر شراء','error'); }));
    row.appendChild(mkBtn('اختبار بيع', '#8e44ad', () => { physicalClick(DOM.sellBtn) ? log('🧪 نقر بيع تجريبي','trade') : log('⛔ لا زر بيع','error'); }));
    hudEl.appendChild(row);

    logEl = document.createElement('div');
    logEl.style.cssText = 'height:150px;overflow-y:auto;background:#0b0e13;border:1px solid #1d242e;border-radius:7px;padding:5px;font-size:10.5px;white-space:pre-wrap;word-break:break-word';
    hudEl.appendChild(logEl);

    let collapsed = false;
    minBtn.onclick = () => {
      collapsed = !collapsed;
      row.style.display = collapsed ? 'none' : 'flex';
      logEl.style.display = collapsed ? 'none' : 'block';
      minBtn.textContent = collapsed ? '▢' : '_';
    };

    // سحب الواجهة
    (function drag(){
      let sx=0, sy=0, ox=0, oy=0, dragging=false;
      const start = (x,y) => { dragging=true; sx=x; sy=y; const r=hudEl.getBoundingClientRect(); ox=r.left; oy=r.top; };
      const move = (x,y) => { if(!dragging) return; hudEl.style.left=(ox+x-sx)+'px'; hudEl.style.top=(oy+y-sy)+'px'; hudEl.style.right='auto'; hudEl.style.bottom='auto'; };
      const end = () => dragging=false;
      title.addEventListener('mousedown', e => start(e.clientX,e.clientY));
      document.addEventListener('mousemove', e => move(e.clientX,e.clientY));
      document.addEventListener('mouseup', end);
      title.addEventListener('touchstart', e => { const t=e.touches[0]; start(t.clientX,t.clientY); }, {passive:true});
      document.addEventListener('touchmove', e => { const t=e.touches[0]; if(t) move(t.clientX,t.clientY); }, {passive:true});
      document.addEventListener('touchend', end);
    })();

    document.body.appendChild(hudEl);
    log('🚀 البوت جاهز — اضغط "تشغيل" للبدء. التنفيذ عبر نقر الأزرار فقط.', 'info');
    log('ℹ️ الاستراتيجية: ث36/ث26 مع اتجاه الشمعة، ث11 معاكس. فلتر زخم + تجميد عند الانعكاس.', 'info');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    buildHUD();
    scanDOM();
    setInterval(scanDOM, CFG.RESCAN_DOM_MS);
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
    if (document.getElementById('po-time-bot-hud') || ++_bootTries > 40) { clearInterval(_bootCheck); return; }
    if (document.body) boot();
  }, 500);

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
