// ==UserScript==
// @name         🛰️ EXPERTOPTION_SPY — WebSocket Interceptor + Protocol Decoder + Spy Panel
// @namespace    expertoption-spy-tool
// @version      0.1.0
// @description  ExpertOption spy skeleton — WebSocket interception, JSON protocol decoding, raw traffic logging for protocol verification, tick/order/balance extractors (best-estimate), and a spy panel with export.
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
  if (W.__EO_SPY_V01) return;
  W.__EO_SPY_V01 = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  CONFIG
  // ══════════════════════════════════════════════════════════════════════
  // ملاحظة: ExpertOption يستخدم WebSocket بـ JSON نصّي (وليس Socket.IO/MsgPack
  // مثل PocketOption). الرسائل عادةً بالشكل:
  //   { "action": "<name>", "message": {...}, "token": "...", "ns": <seq>, "v": <ver> }
  // والإجراءات المتعددة تُغلَّف بـ:
  //   { "action": "multipleAction", "message": { "actions": [ {...}, {...} ] } }
  //
  // ⚠️ بما أنه لا توجد عيّنات traffic مؤكدة بعد، أسماء الـ actions أدناه هي أفضل
  // تقدير. المسجّل الخام (RAW LOG) يلتقط كل شيء — استخدمه على المنصة الحقيقية ثم
  // عدّل خريطة ACTIONS هذه لتطابق الأسماء الفعلية. كل المنطق يقرأ من هنا فقط.
  const CFG = {
    DIAG_ENABLED        : true,     // التشخيص + المسجّل الخام
    DIAG_MAX_PACKETS    : 2000,     // أقصى عدد حزم محفوظة في الذاكرة
    RAW_LOG_DECODED_ONLY: false,    // true = سجّل فقط ما أمكن تحليله كـ JSON
    LOG_PING_FRAMES     : false,    // ضوضاء heartbeat — معطلة افتراضياً

    UI_ENABLED          : true,
    DEFAULT_AMOUNT      : 1,

    // أسماء النطاقات التي تُعدّ مقابس تداول (تُنفّذ عليها الصفقات)
    TRADE_HOST_HINTS    : ['expertoption.com', 'expertoption.finance'],

    // ─── خريطة الإجراءات (best-estimate — عدّلها بعد التحقق من العيّنات) ───
    ACTIONS: {
      // أحداث واردة (server → client)
      TICK            : ['tick', 'ticks', 'subscribeAsset', 'assetQuote'],
      CANDLES         : ['assetHistoryCandles', 'candles', 'getCandles'],
      BALANCE         : ['profile', 'userBalance', 'balance', 'setContext'],
      OPEN_RESULT     : ['buyOption', 'openOption', 'optionOpened', 'openOptionResult'],
      CLOSE_RESULT    : ['expertOption', 'closeOption', 'optionFinished', 'optionsClosed'],
      ASSETS          : ['assets', 'getCurrencies', 'environment'],
      // أحداث صادرة (client → server) — للتنفيذ
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
  let tradeWS        = null;       // المقبس المختار للتنفيذ
  let tradeWSOrig    = null;       // send الأصلي قبل الهوك
  let lastToken      = null;       // آخر token مرصود (لإعادة استخدامه في التنفيذ)
  let autoTrade      = false;

  const _lastPrice   = new Map();  // asset → آخر سعر
  const _assets      = new Map();  // asset → معلومات
  const _sockets     = new Set();  // كل المقابس المعترَضة

  // ══════════════════════════════════════════════════════════════════════
  // § 4  DIAGNOSTIC — Raw traffic logger (الأهم للتحقق من البروتوكول)
  // ══════════════════════════════════════════════════════════════════════
  const Diag = {
    packets: [],   // { dir, t, kind, action, size, raw, decoded }
    counts : { IN: 0, OUT: 0, byAction: {} },

    log(dir, raw, decoded) {
      if (!CFG.DIAG_ENABLED) return;
      const action = decoded && typeof decoded === 'object' ? (decoded.action || null) : null;
      if (CFG.RAW_LOG_DECODED_ONLY && decoded == null) return;

      this.counts[dir] = (this.counts[dir] || 0) + 1;
      if (action) this.counts.byAction[action] = (this.counts.byAction[action] || 0) + 1;

      const entry = {
        dir, t: nowMs(), action,
        kind: typeof raw === 'string' ? 'text' : (raw instanceof ArrayBuffer ? 'binary' : 'other'),
        size: (raw && raw.length) || (raw && raw.byteLength) || 0,
        raw : typeof raw === 'string' ? raw : '[binary]',
        decoded,
      };
      this.packets.push(entry);
      if (this.packets.length > CFG.DIAG_MAX_PACKETS) this.packets.shift();
      try { renderRawLog(entry); } catch (_) {}
    },

    export() {
      return JSON.stringify({
        meta: { ua: navigator.userAgent, when: new Date().toISOString(), counts: this.counts },
        packets: this.packets,
      }, null, 2);
    },

    clear() { this.packets.length = 0; this.counts = { IN: 0, OUT: 0, byAction: {} }; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 5  PROTOCOL DECODER (ExpertOption JSON)
  // ══════════════════════════════════════════════════════════════════════
  // يفكّ إطار WebSocket نصّياً. ExpertOption نصّي JSON بالكامل تقريباً، لكن
  // نتعامل أيضاً مع heartbeat البسيط ('2'/'3' أو نصوص قصيرة).
  function decodeFrame(raw) {
    if (typeof raw !== 'string') return null;       // الثنائي نادر هنا؛ يُسجَّل خاماً
    const s = raw.trim();
    if (!s) return null;
    if (s === '2' || s === '3') return { _heartbeat: true };
    if (s[0] !== '{' && s[0] !== '[') return null;  // ليس JSON
    return safeJSONParse(s);
  }

  // يفكّك الرسالة لقائمة actions (يتعامل مع multipleAction)
  function flattenActions(msg) {
    if (!msg || typeof msg !== 'object') return [];
    if (msg.action === 'multipleAction' && msg.message && Array.isArray(msg.message.actions)) {
      return msg.message.actions.filter(a => a && typeof a === 'object');
    }
    if (msg.action) return [msg];
    return [];
  }

  // ── مستخرِجات best-estimate ──────────────────────────────────────────
  function extractTicks(message) {
    // أشكال محتملة: {tick:{asset_id,price,time}} | {ticks:[[id,time,price],...]}
    //              | {asset:'EURUSD',price:..,time:..}
    const out = [];
    if (!message) return out;
    const push = (asset, price, ts) => {
      if (price > 0 && asset) out.push({ asset: normalizeAsset(asset), price: +price, ts: ts || nowMs() });
    };
    if (message.tick && typeof message.tick === 'object') {
      const t = message.tick; push(t.asset || t.asset_id || t.symbol, t.price ?? t.value, t.time || t.timestamp);
    }
    if (Array.isArray(message.ticks)) {
      for (const t of message.ticks) {
        if (Array.isArray(t) && t.length >= 3) push(t[0], t[2], t[1]);
        else if (t && typeof t === 'object') push(t.asset || t.asset_id, t.price ?? t.value, t.time);
      }
    }
    if (message.price != null && (message.asset || message.asset_id)) {
      push(message.asset || message.asset_id, message.price, message.time);
    }
    return out;
  }

  function extractBalance(message) {
    if (!message || typeof message !== 'object') return null;
    const m = message.profile || message.user || message;
    if (m.demo_balance != null && m.real_balance != null) {
      return { demo: +m.demo_balance, real: +m.real_balance };
    }
    if (m.balance != null) return { balance: +m.balance, isDemo: m.is_demo ?? m.demo };
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  EVENT HANDLERS
  // ══════════════════════════════════════════════════════════════════════
  function onTick(asset, price, ts) {
    totalTicks++;
    _lastPrice.set(asset, price);
    if (!activeAsset) activeAsset = asset;
    updateHud();
  }

  function onBalance(b) {
    if (!b) return;
    if (b.balance != null) currentBalance = b.balance;
    else if (b.demo != null) currentBalance = isDemo ? b.demo : b.real;
    updateHud();
    addLog('💰 رصيد: ' + JSON.stringify(b), 'info');
  }

  function onAssets(message) {
    const list = message?.assets || message?.currencies || (Array.isArray(message) ? message : null);
    if (!Array.isArray(list)) return;
    for (const a of list) {
      const id = a.id ?? a.asset_id, name = a.symbol || a.name;
      if (name) _assets.set(normalizeAsset(name), { id, payout: a.profit ?? a.payout, open: a.is_open });
    }
    addLog('📋 أصول: ' + _assets.size, 'info');
  }

  function dispatch(action, message, fullMsg) {
    if (fullMsg && fullMsg.token) lastToken = fullMsg.token;
    const cat = matchAction(action);
    switch (cat) {
      case 'TICK': {
        const ticks = extractTicks(message);
        for (const t of ticks) onTick(t.asset, t.price, t.ts);
        break;
      }
      case 'BALANCE':     onBalance(extractBalance(message)); break;
      case 'ASSETS':      onAssets(message); break;
      case 'OPEN_RESULT': addLog('🟢 فتح صفقة: ' + JSON.stringify(message).slice(0, 200), 'signal'); break;
      case 'CLOSE_RESULT':addLog('🔴 إغلاق صفقة: ' + JSON.stringify(message).slice(0, 200), 'signal'); break;
      case 'CANDLES':     /* شموع تاريخية — تُسجَّل خاماً */ break;
      default:            /* غير معروف — متاح في RAW LOG للتحليل */ break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  WEBSOCKET INTERCEPTION (معمارية مُعاد استخدامها من أداة PO)
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;

  function isTradeSocket(urlStr) {
    return CFG.TRADE_HOST_HINTS.some(h => urlStr.includes(h));
  }

  function handleIncoming(raw, wsRef) {
    totalFrames++;
    const decoded = decodeFrame(raw);
    if (decoded && decoded._heartbeat) { if (CFG.LOG_PING_FRAMES) Diag.log('IN', raw, decoded); return; }
    Diag.log('IN', raw, decoded);
    if (!decoded) return;

    const actions = flattenActions(decoded);
    if (actions.length) {
      for (const a of actions) dispatch(a.action, a.message ?? a, decoded);
    } else if (Array.isArray(decoded)) {
      // احتياطي: مصفوفة ticks خام
      const ticks = extractTicks({ ticks: decoded });
      for (const t of ticks) onTick(t.asset, t.price, t.ts);
    }
  }

  function attachHooks(ws, urlStr) {
    if (_sockets.has(ws)) return;
    _sockets.add(ws);
    ws._eoUrl = urlStr;
    const origSend = ws.send.bind(ws);

    if (isTradeSocket(urlStr)) {
      if (!tradeWS || tradeWS.readyState !== 1) { tradeWS = ws; tradeWSOrig = origSend; }
      addLog('🔌 مقبس تداول: ' + urlStr.split('?')[0], 'info');
    }

    // هوك على الإرسال (لرصد token/ns وتسجيل الصادر)
    ws.send = function (data) {
      try {
        if (typeof data === 'string') {
          const d = decodeFrame(data);
          if (d && !d._heartbeat) {
            if (d.token) lastToken = d.token;
            Diag.log('OUT', data, d);
          } else if (CFG.LOG_PING_FRAMES) {
            Diag.log('OUT', data, d);
          }
        }
      } catch (_) {}
      return origSend(data);
    };

    ws.addEventListener('message', (ev) => {
      try {
        const d = ev.data;
        if (typeof d === 'string') handleIncoming(d, ws);
        else if (d instanceof Blob) d.text().then(txt => handleIncoming(txt, ws)).catch(() => {});
        else if (d instanceof ArrayBuffer) Diag.log('IN', d, null); // ثنائي نادر — خام
      } catch (_) {}
    });

    ws.addEventListener('open',  () => { wsConnected = true; updateHud(); addLog('✅ اتصال مفتوح', 'info'); });
    ws.addEventListener('close', () => { if (ws === tradeWS) { tradeWS = null; } _sockets.delete(ws); updateHud(); });
  }

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); try { attachHooks(ws, String(args[0] || '')); } catch (_) {} return ws; },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 8  TRADE EXECUTION (scaffold — يحتاج تأكيد صيغة الـ payload)
  // ══════════════════════════════════════════════════════════════════════
  function buildOpenPayload(direction, asset, amount, expSeconds) {
    // ⚠️ best-estimate — عدّل الحقول بعد التحقق من عيّنة buyOption حقيقية.
    const assetInfo = _assets.get(normalizeAsset(asset)) || {};
    return JSON.stringify({
      action : CFG.ACTIONS.OPEN_OPTION_OUT,
      message: {
        type     : 'binary',
        asset_id : assetInfo.id,
        direction: direction === 'put' ? 'put' : 'call',
        amount   : amount,
        exp_time : expSeconds,
        is_demo  : isDemo,
      },
      token: lastToken,
      ns   : nextNs(),
    });
  }

  function executeTrade(direction, asset, amount, expSeconds) {
    if (!tradeWS || tradeWS.readyState !== 1 || !tradeWSOrig) { addLog('⚠️ لا مقبس تداول جاهز', 'error'); return false; }
    const payload = buildOpenPayload(direction, asset || activeAsset, amount || tradeAmount, expSeconds || 60);
    try { tradeWSOrig(payload); addLog('⚡ تنفيذ: ' + direction + ' | ' + (asset || activeAsset), 'signal'); return true; }
    catch (e) { addLog('❌ فشل التنفيذ: ' + e.message, 'error'); return false; }
  }
  W.__EO_executeTrade = executeTrade; // متاح للاختبار اليدوي من الكونسول

  // ══════════════════════════════════════════════════════════════════════
  // § 9  UI — Spy Panel
  // ══════════════════════════════════════════════════════════════════════
  let _ui = null, _logEl = null, _rawEl = null, _hudEl = null;

  function addLog(msg, type) {
    if (!_logEl) { try { console.log('[EO-SPY]', msg); } catch (_) {} return; }
    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 4px;border-bottom:1px solid #1a1a2e;font:11px monospace;color:' +
      (type === 'error' ? '#ff5577' : type === 'signal' ? '#33ddaa' : '#aab');
    row.textContent = fmtTime(nowMs()) + '  ' + msg;
    _logEl.insertBefore(row, _logEl.firstChild);
    while (_logEl.childNodes.length > 200) _logEl.removeChild(_logEl.lastChild);
  }

  function renderRawLog(entry) {
    if (!_rawEl) return;
    const row = document.createElement('div');
    const col = entry.dir === 'OUT' ? '#ffaa44' : (entry.action ? '#66ccff' : '#777');
    row.style.cssText = 'padding:1px 4px;border-bottom:1px solid #16161e;font:10px monospace;color:' + col + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const label = entry.action || '(' + entry.kind + ')';
    row.textContent = entry.dir + ' ' + fmtTime(entry.t) + ' [' + label + '] ' + String(entry.raw).slice(0, 300);
    row.title = String(entry.raw).slice(0, 4000);
    _rawEl.insertBefore(row, _rawEl.firstChild);
    while (_rawEl.childNodes.length > 300) _rawEl.removeChild(_rawEl.lastChild);
  }

  function updateHud() {
    if (!_hudEl) return;
    _hudEl.innerHTML =
      '<b style="color:#33ddaa">EO-SPY</b> ' +
      (wsConnected ? '🟢' : '🔴') +
      ' | أصل: <b>' + (activeAsset || '—') + '</b>' +
      ' | سعر: <b>' + (_lastPrice.get(activeAsset)?.toFixed(5) ?? '—') + '</b>' +
      ' | ticks: ' + totalTicks +
      ' | إطارات: ' + totalFrames +
      ' | رصيد: ' + (currentBalance ?? '—');
  }

  function buildUI() {
    if (!CFG.UI_ENABLED || _ui) return;
    _ui = document.createElement('div');
    _ui.style.cssText = 'position:fixed;top:8px;right:8px;width:480px;z-index:2147483647;background:#0d0d18;border:1px solid #2a2a44;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.6);font-family:system-ui,sans-serif;color:#ccd';

    _hudEl = document.createElement('div');
    _hudEl.style.cssText = 'padding:6px 8px;font:11px monospace;border-bottom:1px solid #2a2a44;background:#11112a';

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:4px;padding:4px 6px;border-bottom:1px solid #2a2a44';
    const mkBtn = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'flex:0 0 auto;padding:3px 8px;font:11px sans-serif;background:#1a1a33;color:#cce;border:1px solid #33335a;border-radius:4px;cursor:pointer'; b.onclick = fn; return b; };

    _logEl = document.createElement('div');
    _logEl.style.cssText = 'height:140px;overflow:auto;background:#0a0a14';
    _rawEl = document.createElement('div');
    _rawEl.style.cssText = 'height:200px;overflow:auto;background:#08080f;border-top:1px solid #2a2a44';

    tabs.appendChild(mkBtn('📋 نسخ خريطة الإجراءات', () => {
      const summary = JSON.stringify(Diag.counts.byAction, null, 2);
      navigator.clipboard?.writeText(summary); addLog('📋 نُسخ ملخص الإجراءات', 'info');
    }));
    tabs.appendChild(mkBtn('⬇️ تصدير traffic', () => {
      const blob = new Blob([Diag.export()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'eo_traffic_' + Date.now() + '.json'; a.click();
      addLog('⬇️ صُدّر ' + Diag.packets.length + ' حزمة', 'info');
    }));
    tabs.appendChild(mkBtn('🗑️ مسح', () => { Diag.clear(); if (_rawEl) _rawEl.innerHTML = ''; addLog('🗑️ مُسح', 'info'); }));
    tabs.appendChild(mkBtn('▁ إخفاء', () => { const hidden = _logEl.style.display === 'none'; _logEl.style.display = _rawEl.style.display = hidden ? 'block' : 'none'; }));

    const rawHdr = document.createElement('div');
    rawHdr.style.cssText = 'padding:3px 8px;font:10px monospace;color:#778;background:#11111e;border-top:1px solid #2a2a44';
    rawHdr.textContent = '── RAW WS LOG (للتحقق من البروتوكول — OUT=برتقالي, action معروف=أزرق) ──';

    _ui.appendChild(_hudEl);
    _ui.appendChild(tabs);
    _ui.appendChild(_logEl);
    _ui.appendChild(rawHdr);
    _ui.appendChild(_rawEl);
    document.documentElement.appendChild(_ui);
    updateHud();
    addLog('🛰️ EO-SPY جاهز — اعتراض WebSocket نشط، يراقب كل traffic', 'signal');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() {
    if (document.body || document.documentElement) buildUI();
    else W.addEventListener('DOMContentLoaded', buildUI, { once: true });
  }
  if (document.readyState === 'loading') W.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // واجهة كونسول للتشخيص اليدوي
  W.__EO_SPY = { CFG, Diag, state: () => ({ activeAsset, wsConnected, totalTicks, totalFrames, currentBalance, assets: _assets.size, lastToken: !!lastToken }), executeTrade };
  setIntervalT(updateHud, 1000);

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
