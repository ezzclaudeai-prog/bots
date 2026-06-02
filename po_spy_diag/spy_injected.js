/**
 * AOIRUSRA Data Spy — spy_injected.js
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WORLD: MAIN  (full page JS access — WebSocket, DOM, React, Vue)
 *
 * PURPOSE: Extract EVERYTHING from Pocket Option raw and unencrypted:
 *   • Every WebSocket frame (text + binary, decoded to JSON/msgpack)
 *   • All DOM fields visible on screen (balance, asset, time, trade params)
 *   • All trade events (open, close, balance update)
 *   • Price ticks, chafor countdowns, asset changes
 *   • HTTP XHR/fetch interception (account data, trade history API calls)
 *
 * DATA FLOW: spy_injected.js → CustomEvent('__aoispy_data') → spy_content.js
 *
 * NO FILTERING: Everything is passed as-is. The content script decides
 * what to display / log / save. Raw frames are never truncated here.
 */
(function () {
  'use strict';

  if (window.__AOISPY_INJECTED) return;
  window.__AOISPY_INJECTED = true;

  // ── Universal dispatcher ─────────────────────────────────────
  // Sends all captured data to spy_content.js (isolated world)
  const emit = (category, data) => {
    window.dispatchEvent(new CustomEvent('__aoispy_data', {
      detail: {
        category,      // string: 'ws_text' | 'ws_binary' | 'dom_poll' | 'trade' | 'fetch' | 'xhr' | 'tick' | 'chafor'
        data,          // raw payload — whatever was captured, no processing
        ts:  Date.now(),
        url: window.location.href,
      }
    }));
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: MSGPACK DECODER (lossless — decodes binary WS frames)
  // ═══════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const ab    = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off   = buffer.byteOffset || 0;
    const view  = new DataView(ab);
    const bytes = new Uint8Array(ab, off);
    let pos     = 0;

    const rb   = () => bytes[pos++];
    const ru8  = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos,false); pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos,false); pos += 8; return v; };
    const ri64 = () => { const hi=view.getInt32(pos,false),lo=view.getUint32(pos+4,false); pos+=8; return hi*4294967296+lo; };
    const ru64 = () => { const hi=view.getUint32(pos,false),lo=view.getUint32(pos+4,false); pos+=8; return hi*4294967296+lo; };
    const rStr = (n) => { const s=new TextDecoder('utf-8').decode(bytes.subarray(pos,pos+n)); pos+=n; return s; };
    const rBin = (n) => { const b=bytes.subarray(pos,pos+n); pos+=n; return b; };

    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b & 0xf0) === 0x80) { const n=b&0xf,o={}; for(let i=0;i<n;i++){const k=decode();o[k]=decode();} return o; }
      if ((b & 0xf0) === 0x90) { const n=b&0xf,a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
      if ((b & 0xe0) === 0xa0) return rStr(b & 0x1f);
      if ((b & 0xe0) === 0xe0) return b - 256;
      switch(b) {
        case 0xc0: return null;  case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return Array.from(rBin(ru8()));
        case 0xc5: return Array.from(rBin(ru16()));
        case 0xc6: return Array.from(rBin(ru32()));
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8();  case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();  case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8());  case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n=ru16(),a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xdd: { const n=ru32(),a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xde: { const n=ru16(),o={}; for(let i=0;i<n;i++){const k=decode();o[k]=decode();} return o; }
        case 0xdf: { const n=ru32(),o={}; for(let i=0;i<n;i++){const k=decode();o[k]=decode();} return o; }
        default: throw new Error('msgpack unknown 0x'+b.toString(16));
      }
    }
    return decode();
  }

  // Converts ArrayBuffer to hex string for raw logging
  function bufToHex(buf, maxBytes = 128) {
    const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0);
    const slice = bytes.slice(0, maxBytes);
    return Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ') +
           (bytes.length > maxBytes ? ` … (+${bytes.length - maxBytes} more bytes)` : '');
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: DOM FIELD EXTRACTOR
  // Reads every visible trading field from the Pocket Option UI.
  // Runs every 1 second — covers the fields shown in the screenshot.
  // ═══════════════════════════════════════════════════════════════
  function extractDOMSnapshot() {
    const snap = {
      // ── Account ───────────────────────────────────────────────
      accountType:   null,  // Demo / Real / QT Demo
      accountLabel:  null,  // "حلال" etc
      currency:      null,  // USD / EUR
      balance:       null,  // 3032.86

      // ── Asset / Price ─────────────────────────────────────────
      asset:         null,  // AUD/CAD OTC
      currentPrice:  null,  // 0.99998

      // ── Trade Parameters ─────────────────────────────────────
      tradeAmount:   null,  // $1
      tradeDuration: null,  // 00:00:18 (raw text)
      durationSecs:  null,  // 18 (numeric)
      profitPct:     null,  // 90 (%)
      payoutAmount:  null,  // $1.90
      profitAmount:  null,  // $0.90

      // ── Candle / Timer ────────────────────────────────────────
      candleLabel:   null,  // S5 (5-second candle)
      candleTimer:   null,  // 00:02

      // ── Page Info ─────────────────────────────────────────────
      pageUrl:       window.location.href,
      pageTitle:     document.title,
      timestamp:     new Date().toISOString(),
    };

    // ── Account type + label ─────────────────────────────────────
    // "QT Demo" / "Demo" label in header (Pocket Option mobile)
    const acctSelectors = [
      '.header__user-type', '[class*="account-type"]', '[class*="accountType"]',
      '[class*="demo-label"]', '[class*="demoLabel"]',
      '.user-info__type', '[class*="userType"]',
      // Try reading the text block containing "Demo" or "Real"
    ];
    for (const sel of acctSelectors) {
      const el = document.querySelector(sel);
      if (el) { snap.accountLabel = el.textContent.trim(); break; }
    }
    // Broad text search if selectors failed
    if (!snap.accountLabel) {
      const header = document.querySelector('header, .header, [class*="header"], [class*="Header"]');
      if (header) {
        const txt = header.textContent || '';
        const m   = txt.match(/\b(QT Demo|Demo|Real|Live|Practice)\b/i);
        if (m) snap.accountLabel = m[1];
      }
    }
    if (/demo|practice|تجريبي/i.test(snap.accountLabel || '')) snap.accountType = 'Demo';
    else if (/real|live|حقيقي/i.test(snap.accountLabel || '')) snap.accountType = 'Real';
    else if (/demo/i.test(window.location.href)) snap.accountType = 'Demo';

    // ── Currency ──────────────────────────────────────────────────
    const currencySelectors = [
      '[class*="currency"]', '[class*="Currency"]',
      '.header__currency', '[class*="user-currency"]',
    ];
    for (const sel of currencySelectors) {
      const el = document.querySelector(sel);
      if (el) { snap.currency = el.textContent.trim(); break; }
    }
    // Try to find "USD" near balance in header text
    if (!snap.currency) {
      const header = document.querySelector('header, [class*="header"]');
      const m = (header?.textContent || '').match(/\b(USD|EUR|GBP|JPY|BTC|ETH)\b/);
      if (m) snap.currency = m[1];
    }

    // ── Balance ───────────────────────────────────────────────────
    const balSelectors = [
      '.balance__value', '.user-balance__value', '[class*="balanceValue"]',
      '[class*="balance-value"]', '[class*="Balance__value"]', '[class*="userBalance"]',
      '[class*="wallet-amount"]', '[data-balance]', '[class*="amount__value"]',
      // Pocket Option mobile: large number in header
      '.header__balance', '[class*="headerBalance"]', '[class*="header-balance"]',
    ];
    for (const sel of balSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const raw = (el.textContent || el.getAttribute('data-balance') || '').trim();
        const val = parseFloat(raw.replace(/[,\s$€£]/g, ''));
        if (!isNaN(val) && val >= 0) { snap.balance = val; break; }
      }
    }
    // Fallback: look for the number pattern 3,032.86 near "USD" in header
    if (snap.balance === null) {
      const header = document.querySelector('header, [class*="header"]');
      const m = (header?.textContent || '').match(/[\d]{1,6}[,.][\d]{2,3}(?:[,.][\d]{2})?/);
      if (m) {
        const v = parseFloat(m[0].replace(',',''));
        if (v > 0) snap.balance = v;
      }
    }

    // ── Asset name ────────────────────────────────────────────────
    const assetSelectors = [
      '[class*="asset-name"]', '[class*="assetName"]', '[class*="instrument-name"]',
      '[class*="pair-name"]', '[class*="pairName"]', '[class*="symbol-name"]',
      '.trading-asset__name', '.chart-asset__name', '[class*="ActiveAsset"]',
      '[class*="currentAsset"]', '[class*="selected-asset"]',
      // Pocket Option: "AUD/CAD OTC" appears in a dropdown trigger
      '[class*="asset__name"]', '[class*="drop-down"] [class*="name"]',
      '[class*="asset-select"]', '[class*="assetSelect"]',
    ];
    for (const sel of assetSelectors) {
      const el = document.querySelector(sel);
      if (el) { snap.asset = el.textContent.trim(); break; }
    }
    // Fallback: URL params
    if (!snap.asset) {
      const params = new URLSearchParams(window.location.search);
      snap.asset = params.get('symbol') || params.get('asset') || params.get('pair') || null;
    }

    // ── Current price ─────────────────────────────────────────────
    const priceSelectors = [
      '[class*="current-price"]', '[class*="currentPrice"]', '[class*="last-price"]',
      '[class*="quote__value"]', '[class*="price-value"]', '[class*="bid-price"]',
      '[class*="asset-price"]', '[class*="chart-price"]',
    ];
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const v = parseFloat(el.textContent.replace(/[,\s]/g,''));
        if (!isNaN(v) && v > 0) { snap.currentPrice = v; break; }
      }
    }

    // ── Trade amount ($1 تداول) ────────────────────────────────────
    const amountSelectors = [
      '[class*="trade-amount"]', '[class*="tradeAmount"]', '[class*="invest"]',
      '[class*="amount"] input', '[class*="stake"]', '[class*="deal-amount"]',
      'input[class*="amount"]', '[class*="betAmount"]', '[class*="bet-amount"]',
    ];
    for (const sel of amountSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const raw = (el.value || el.textContent || '').trim().replace(/[,$\s]/g,'');
        const v   = parseFloat(raw);
        if (!isNaN(v) && v > 0) { snap.tradeAmount = v; break; }
      }
    }

    // ── Trade duration (الزمن — 00:00:18) ─────────────────────────
    const durSelectors = [
      '[class*="deal-time"]', '[class*="dealTime"]', '[class*="trade-time"]',
      '[class*="tradeTime"]', '[class*="expiration"]', '[class*="timer"]',
      '[class*="duration"]', '[class*="time-block"]', '[class*="timeBlock"]',
      // Input fields showing duration
      'input[class*="time"]', 'input[class*="timer"]', 'input[class*="duration"]',
    ];
    for (const sel of durSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = (el.textContent || el.value || '').trim();
        // Match HH:MM:SS or MM:SS or raw seconds
        if (/\d{1,2}:\d{2}(:\d{2})?/.test(txt) || /^\d+$/.test(txt)) {
          snap.tradeDuration = txt;
          // Convert to seconds
          const parts = txt.split(':').map(Number);
          if (parts.length === 3) snap.durationSecs = parts[0]*3600 + parts[1]*60 + parts[2];
          else if (parts.length === 2) snap.durationSecs = parts[0]*60 + parts[1];
          else snap.durationSecs = parts[0];
          break;
        }
      }
    }

    // ── Profit percentage (+90%) ──────────────────────────────────
    const profitPctSelectors = [
      '[class*="profit-percent"]', '[class*="profitPercent"]', '[class*="payout-percent"]',
      '[class*="yield"]', '[class*="return"]', '[class*="income-percent"]',
      '[class*="profit__value"]', '[class*="payout__percent"]',
    ];
    for (const sel of profitPctSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = el.textContent.trim();
        const m   = txt.match(/[+\-]?(\d+(?:\.\d+)?)\s*%/);
        if (m) { snap.profitPct = parseFloat(m[1]); break; }
      }
    }
    // Broad % search in trading panel area
    if (snap.profitPct === null) {
      const panel = document.querySelector(
        '[class*="trade-panel"], [class*="tradePanel"], [class*="bottom-bar"], ' +
        '[class*="deal-form"], [class*="dealForm"], [class*="order-form"]'
      );
      if (panel) {
        const m = (panel.textContent || '').match(/\+(\d+(?:\.\d+)?)\s*%/);
        if (m) snap.profitPct = parseFloat(m[1]);
      }
    }

    // ── Payout / Payout amount (المنصرف $1.90) ────────────────────
    const payoutSelectors = [
      '[class*="payout"]', '[class*="return-amount"]', '[class*="profit-value"]',
      '[class*="income"]', '[class*="outcome"]', '[class*="total-return"]',
      '[class*="withdrawal"]',
    ];
    for (const sel of payoutSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const raw = el.textContent.trim().replace(/[$,\s]/g,'');
        const v   = parseFloat(raw);
        if (!isNaN(v) && v > 0) { snap.payoutAmount = v; break; }
      }
    }
    // Profit amount (الربح +$0.90)
    const profitAmtSelectors = [
      '[class*="profit-amount"]', '[class*="profitAmount"]', '[class*="win-amount"]',
      '[class*="gain"]', '[class*="earnings"]',
    ];
    for (const sel of profitAmtSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const raw = el.textContent.trim().replace(/[+$,\s]/g,'');
        const v   = parseFloat(raw);
        if (!isNaN(v)) { snap.profitAmount = v; break; }
      }
    }

    // ── Broad trading panel scan (fallback for all numeric fields) ──
    // Read the entire bottom trading area and extract labeled values
    const tradeArea = document.querySelector(
      '[class*="trade-panel"], [class*="tradePanel"], [class*="order"], ' +
      '[class*="bottom-bar"], [class*="deal"], [class*="Deal"]'
    );
    if (tradeArea) {
      const allText = tradeArea.innerText || tradeArea.textContent || '';
      // Extract all $ amounts
      const amounts = [...allText.matchAll(/\$\s*([\d]+\.[\d]{2})/g)].map(m => parseFloat(m[1]));
      // Extract all percentages
      const pcts    = [...allText.matchAll(/([+\-]?\d+(?:\.\d+)?)\s*%/g)].map(m => parseFloat(m[1]));

      // Assign to null fields
      if (!snap.tradeAmount  && amounts[0]) snap.tradeAmount  = amounts[0];
      if (!snap.payoutAmount && amounts[1]) snap.payoutAmount = amounts[1];
      if (!snap.profitPct    && pcts.length > 0) {
        // Highest % is usually the profit %
        snap.profitPct = Math.max(...pcts.filter(p => p > 0 && p <= 100));
      }
    }

    // ── Candle label (S5, M1, M5 etc.) ───────────────────────────
    const candleSelectors = [
      '[class*="candle-type"]', '[class*="candleType"]', '[class*="chart-type"]',
      '[class*="timeframe"]', '[class*="period-label"]', '[class*="intervalLabel"]',
    ];
    for (const sel of candleSelectors) {
      const el = document.querySelector(sel);
      if (el) { snap.candleLabel = el.textContent.trim(); break; }
    }

    // ── Candle countdown timer (00:02 in the chart) ───────────────
    const candleTimerSelectors = [
      '[class*="candle-timer"]', '[class*="candleTimer"]', '[class*="bar-timer"]',
      '[class*="chart-timer"]', '[class*="countdown"]',
    ];
    for (const sel of candleTimerSelectors) {
      const el = document.querySelector(sel);
      if (el) { snap.candleTimer = el.textContent.trim(); break; }
    }

    return snap;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: WEBSOCKET PROXY — captures ALL frames raw
  // Every single frame (sent and received) is logged in full.
  // ═══════════════════════════════════════════════════════════════
  const OriginalWebSocket = window.WebSocket;

  let wsIdCounter = 0;
  let pendingBinaryEventName = null; // socket.io 4.5 name-framing

  // Parse pending "451-[eventName,...]" frames that precede binary
  function parsePending451(text) {
    if (!text || !text.startsWith('45')) return;
    const di = text.indexOf('-');
    if (di === -1) return;
    try {
      const arr = JSON.parse(text.slice(di + 1));
      if (Array.isArray(arr) && typeof arr[0] === 'string') {
        pendingBinaryEventName = arr[0];
      }
    } catch {}
  }

  // Process a binary WebSocket frame — try msgpack, fallback to UTF-8, fallback to hex
  function processBinaryFrame(raw, wsId, wsUrl, direction) {
    const toBuffer = raw instanceof Blob ? raw.arrayBuffer() : Promise.resolve(raw);
    const eventName = pendingBinaryEventName || 'binary';
    pendingBinaryEventName = null;

    return toBuffer.then(buf => {
      const bytes = new Uint8Array(buf);
      const hexFull = bufToHex(buf, 256); // first 256 bytes as hex for raw log

      // Attempt 1: msgpack decode
      let decoded = null;
      let decodeMethod = 'none';
      try {
        decoded = msgpackDecode(buf);
        decodeMethod = 'msgpack';
      } catch {}

      // Attempt 2: UTF-8 text
      if (decoded === null) {
        try {
          const text = new TextDecoder('utf-8').decode(bytes);
          const jStart = text.search(/[{[]/);
          const candidate = jStart >= 0 ? text.slice(jStart) : text;
          decoded = JSON.parse(candidate);
          decodeMethod = 'utf8_json';
        } catch {}
      }

      // Attempt 3: raw UTF-8 text (non-JSON)
      let rawText = null;
      try { rawText = new TextDecoder('utf-8').decode(bytes); } catch {}

      emit('ws_binary', {
        wsId,
        wsUrl,
        direction,
        eventName,
        byteLength: bytes.length,
        hexRaw:     hexFull,      // full hex dump (first 256 bytes)
        rawText:    rawText ? rawText.slice(0, 2000) : null,
        decoded:    decoded,      // parsed object/array if msgpack/json succeeded
        decodeMethod,
      });
    }).catch(err => {
      emit('ws_binary', {
        wsId, wsUrl, direction, eventName,
        error: String(err), decodeMethod: 'error'
      });
    });
  }

  // WebSocket constructor proxy
  function SpyWebSocket(url, protocols) {
    const ws     = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    const wsId   = ++wsIdCounter;
    const wsUrl  = String(url);

    emit('ws_open', { wsId, wsUrl, protocols: protocols || null });

    // ── Intercept RECEIVED messages ────────────────────────────
    ws.addEventListener('message', (e) => {
      const raw = e.data;

      // Binary frames
      if (raw instanceof ArrayBuffer || raw instanceof Blob) {
        processBinaryFrame(raw, wsId, wsUrl, 'recv');
        return;
      }

      // Text frames — log the COMPLETE raw string, no truncation
      if (typeof raw === 'string') {
        // socket.io heartbeats (boring — still log but mark them)
        const isHeartbeat = raw === '2' || raw === '3' || raw === '40' || raw === '41';
        parsePending451(raw);

        // Try to parse as JSON for structured display
        let parsed = null;
        let parseMethod = 'none';
        if (raw.startsWith('42')) {
          try { parsed = JSON.parse(raw.slice(2)); parseMethod = 'socketio_42'; } catch {}
        } else if (raw.startsWith('{') || raw.startsWith('[')) {
          try { parsed = JSON.parse(raw); parseMethod = 'json'; } catch {}
        }

        emit('ws_text', {
          wsId,
          wsUrl,
          direction:   'recv',
          raw:         raw,   // COMPLETE raw frame, no truncation
          parsed:      parsed,
          parseMethod,
          isHeartbeat,
          byteLength:  raw.length,
        });
      }
    });

    // ── Intercept SENT messages ────────────────────────────────
    const origSend = ws.send.bind(ws);
    ws.send = function(data) {
      if (typeof data === 'string') {
        let parsed = null;
        try { parsed = JSON.parse(data.startsWith('42') ? data.slice(2) : data); } catch {}
        emit('ws_text', {
          wsId, wsUrl, direction: 'sent',
          raw: data, parsed,
          parseMethod: parsed ? 'json' : 'none',
          isHeartbeat: data === '2' || data === '3',
          byteLength: data.length,
        });
      } else if (data instanceof ArrayBuffer || data instanceof Blob) {
        processBinaryFrame(data, wsId, wsUrl, 'sent');
      }
      return origSend(data);
    };

    ws.addEventListener('close',  (e) => emit('ws_close', { wsId, wsUrl, code: e.code, reason: e.reason }));
    ws.addEventListener('error',  ()  => emit('ws_error', { wsId, wsUrl }));
    return ws;
  }

  SpyWebSocket.prototype = OriginalWebSocket.prototype;
  Object.defineProperties(SpyWebSocket, {
    CONNECTING: { value: 0, enumerable: true },
    OPEN:       { value: 1, enumerable: true },
    CLOSING:    { value: 2, enumerable: true },
    CLOSED:     { value: 3, enumerable: true }
  });
  window.WebSocket = SpyWebSocket;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: FETCH INTERCEPTOR — captures API calls + responses
  // Intercepts all fetch() calls so we catch REST API trade data,
  // account info, history, etc.
  // ═══════════════════════════════════════════════════════════════
  const OriginalFetch = window.fetch;
  window.fetch = async function(...args) {
    const reqUrl    = args[0] instanceof Request ? args[0].url : String(args[0]);
    const reqOpts   = args[1] || {};
    const reqMethod = reqOpts.method || (args[0] instanceof Request ? args[0].method : 'GET');
    let   reqBody   = null;
    try {
      if (reqOpts.body) reqBody = typeof reqOpts.body === 'string' ? reqOpts.body : '[non-string body]';
      else if (args[0] instanceof Request) reqBody = await args[0].clone().text().catch(() => null);
    } catch {}

    emit('fetch_request', { reqUrl, reqMethod, reqBody });

    try {
      const response = await OriginalFetch.apply(this, args);
      const clone    = response.clone();
      clone.text().then(body => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch {}
        emit('fetch_response', {
          reqUrl,
          status:    response.status,
          statusText: response.statusText,
          rawBody:   body, // complete response body
          parsed,
        });
      }).catch(() => {});
      return response;
    } catch (err) {
      emit('fetch_error', { reqUrl, error: String(err) });
      throw err;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: XMLHttpRequest INTERCEPTOR
  // Some older Pocket Option code uses XHR for account/trade API
  // ═══════════════════════════════════════════════════════════════
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr  = new OriginalXHR();
    let xhrUrl = '';
    let xhrMethod = 'GET';

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url, ...rest) {
      xhrMethod = method; xhrUrl = url;
      emit('xhr_open', { method, url });
      return origOpen(method, url, ...rest);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function(body) {
      emit('xhr_send', { url: xhrUrl, method: xhrMethod, body: body ? String(body).slice(0,2000) : null });
      return origSend(body);
    };

    xhr.addEventListener('load', () => {
      let parsed = null;
      try { parsed = JSON.parse(xhr.responseText); } catch {}
      emit('xhr_response', {
        url:       xhrUrl,
        status:    xhr.status,
        rawBody:   xhr.responseText, // complete response
        parsed,
      });
    });
    xhr.addEventListener('error', () => emit('xhr_error', { url: xhrUrl, status: xhr.status }));
    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6: DOM POLLING — every 1 second, extract all visible fields
  // ═══════════════════════════════════════════════════════════════
  let lastDOMSnapshot = null;

  function domPoll() {
    try {
      const snap = extractDOMSnapshot();

      // Only emit if something changed (avoid log spam with identical data)
      const snapStr = JSON.stringify(snap);
      if (snapStr !== lastDOMSnapshot) {
        lastDOMSnapshot = snapStr;
        emit('dom_poll', snap);
      }
    } catch (err) {
      emit('dom_error', { error: String(err) });
    }
  }

  setInterval(domPoll, 1000);
  setTimeout(domPoll, 500);

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7: MUTATION OBSERVER — instant DOM change detection
  // Watches for any text/attribute changes in the trading UI
  // ═══════════════════════════════════════════════════════════════
  const domObserver = new MutationObserver((mutations) => {
    // Debounce to avoid firing on every single keystroke
    clearTimeout(domObserver._timer);
    domObserver._timer = setTimeout(domPoll, 150);
  });

  domObserver.observe(document.documentElement, {
    childList:     true,
    subtree:       true,
    characterData: true,
    attributes:    true,
    attributeFilter: ['class', 'data-value', 'data-balance', 'value', 'data-asset']
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8: SOCKET.IO PROBE (for io() managed connections)
  // ═══════════════════════════════════════════════════════════════
  let ioProbed = false;
  function probeSocketIO() {
    if (ioProbed || !window.io?.managers) return;
    ioProbed = true;
    try {
      Object.values(window.io.managers).forEach(mgr => {
        const engine = mgr?.engine;
        if (!engine) return;
        engine.on('message', raw => {
          if (typeof raw !== 'string') return;
          parsePending451(raw);
          let parsed = null;
          try { parsed = JSON.parse(raw.startsWith('42') ? raw.slice(2) : raw); } catch {}
          emit('ws_text', {
            wsId: 'socket.io', wsUrl: 'io.engine',
            direction: 'recv', raw, parsed,
            parseMethod: parsed ? 'socketio_probe' : 'none',
            isHeartbeat: raw === '2' || raw === '3',
            byteLength: raw.length,
          });
        });
      });
    } catch {}
  }
  setTimeout(probeSocketIO, 800);
  setTimeout(probeSocketIO, 2000);
  setInterval(probeSocketIO, 8000);

  // ═══════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════
  emit('spy_init', {
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    url:       window.location.href,
    userAgent: navigator.userAgent,
  });

})();
