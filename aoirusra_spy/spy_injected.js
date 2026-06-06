/**
 * AOIRUSRA Data Spy — spy_injected.js  (v2.0 — extraction engine)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WORLD: MAIN (full page-JS access — WebSocket, Worker, DOM, React/Vue).
 *
 * WHAT CHANGED vs v1 (and WHY — grounded in the real captured traffic):
 *
 *  1. DECODER — CORRECTNESS FIX (the single most important change).
 *     Pocket Option does NOT send msgpack or protobuf, and nothing is
 *     encrypted. It uses socket.io v4 (Engine.IO 4). "Binary" frames are
 *     socket.io BINARY_EVENT *attachments* whose bytes are plain UTF-8 JSON:
 *         hex  5b 5b 22 41 55 44 ...  ->  [["AUDCAD_otc",1780699719.905,0.99326]]
 *     v1's msgpackDecode() read the first byte 0x5b ('[') = 91 as a msgpack
 *     positive-fixint and "succeeded" with the integer 91 — corrupting every
 *     single frame. v2 decodes JSON-first and only falls back to a genuine
 *     msgpack pass for frames that are actually msgpack.
 *
 *  2. PACKET REASSEMBLY — socket.io 451 attachment pairing, done per-socket.
 *     A binary event arrives as a TEXT header frame
 *         451-["updateStream",{"_placeholder":true,"num":0}]
 *     followed by one (or more) BINARY attachment frames. v1 tracked the
 *     pending event name in a single GLOBAL variable shared across all 3 live
 *     sockets — a race that mislabels frames. v2 keeps a reassembly state
 *     machine per socket and substitutes placeholders correctly.
 *
 *  3. NORMALIZED SCHEMA — every meaningful event is mapped to a flat,
 *     deterministic record:  { ts, type, asset, data }  with explicit types
 *     (TICK / TRADE_OPEN / TRADE_CLOSE / ORDER_PENDING / ORDER_REJECTED /
 *      BALANCE / CANDLE_TIMING / HISTORY / LATENCY ...) ready for bot ingest.
 *
 *  4. MICROSTRUCTURE — real, defensible tick-level features computed from the
 *     single mid-price quote feed: inter-tick delta, expected time-to-next
 *     tick, signed price delta, velocity, rolling realized volatility,
 *     directional run length, tick rate, and server->client latency.
 *     NOTE: PO transmits ONE mid price per tick — there is no bid/ask and no
 *     order-book depth anywhere in the stream. True Bid/Ask Spread and Order
 *     Book Imbalance are therefore NOT derivable; those fields are emitted as
 *     null, and a depth-aware path is wired in case a depth-bearing event ever
 *     appears (it does not in any captured session).
 *
 *  5. LATENCY PIPELINE — emit() now BATCHES records and flushes coalesced
 *     bursts in a single CustomEvent, instead of one dispatch per frame.
 *     (A SharedArrayBuffer cannot be shared MAIN<->ISOLATED and needs
 *      cross-origin-isolation headers PO does not set, so batching is the
 *      real, achievable main-thread win.)
 *
 *  6. RAW RING BUFFER — a fixed Uint8Array circular buffer retains the last
 *     N raw binary frames losslessly with O(1) bounded memory, for clean
 *     export to external model training without unbounded heap growth.
 *
 *  7. WORKER COVERAGE + STEALTH — Worker/SharedWorker postMessage traffic is
 *     tapped (defensive: PO currently runs WS on the main thread, but this
 *     future-proofs against the socket moving into a worker), and all patched
 *     globals keep native-looking toString() + descriptors.
 *
 * DATA FLOW:  spy_injected.js --(batched CustomEvent '__aoispy_data')--> spy_content.js
 */
(function () {
  'use strict';

  if (window.__AOISPY_INJECTED) return;
  window.__AOISPY_INJECTED = true;

  // Cache native references up-front so later page code (or our own patches)
  // can't redirect us. Bind to keep `this` correct.
  const TD            = new TextDecoder('utf-8');
  const NativeWS      = window.WebSocket;
  const NativeFetch   = window.fetch;
  const NativeXHR     = window.XMLHttpRequest;
  const NativeWorker  = window.Worker;
  const NativeShared  = window.SharedWorker;
  const _now          = Date.now;
  const _perf         = (typeof performance !== 'undefined' && performance.now)
                          ? performance.now.bind(performance) : () => _now();
  const _defineProp   = Object.defineProperty;
  const _defineProps  = Object.defineProperties;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 0: STEALTH HELPERS
  // Make patched functions report a native-looking signature so the platform's
  // integrity checks (Function.prototype.toString sniffing) see nothing odd.
  // ════════════════════════════════════════════════════════════════════════
  const _toString = Function.prototype.toString;
  function maskToString(fake, realName) {
    const native = `function ${realName}() { [native code] }`;
    try {
      _defineProp(fake, 'toString', {
        value: function () { return native; },
        writable: true, configurable: true, enumerable: false,
      });
      _defineProp(fake, 'name', { value: realName, configurable: true });
    } catch {}
    return fake;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: BATCHED EMIT PIPELINE
  // Records are pushed into a queue and flushed together. Bursts (the common
  // case: a price tick + its 451 header + chart updates landing in the same
  // event-loop turn) collapse into ONE CustomEvent dispatch, which is the
  // dominant cost of crossing into the isolated world.
  // ════════════════════════════════════════════════════════════════════════
  const EMIT_QUEUE   = [];
  const FLUSH_MAX    = 256;   // hard flush when the queue reaches this size
  const FLUSH_MS     = 30;    // …or after this many ms, whichever comes first
  let   flushTimer   = null;
  let   flushQueued  = false;

  function scheduleFlush() {
    if (flushQueued) return;
    flushQueued = true;
    // queueMicrotask coalesces a synchronous burst with zero added latency;
    // the timer guards against a slow trickle never reaching the threshold.
    queueMicrotask(flushNow);
    if (!flushTimer) flushTimer = setTimeout(flushNow, FLUSH_MS);
  }

  function flushNow() {
    flushQueued = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (EMIT_QUEUE.length === 0) return;
    // Move the batch out before dispatch so re-entrant emits queue cleanly.
    const batch = EMIT_QUEUE.splice(0, EMIT_QUEUE.length);
    try {
      window.dispatchEvent(new CustomEvent('__aoispy_data', { detail: { batch } }));
    } catch {}
  }

  // A raw log record (human-readable diagnostics stream).
  // shape: { k:'raw', category, data, ts }
  function emitRaw(category, data) {
    EMIT_QUEUE.push({ k: 'raw', category, data, ts: _now() });
    if (EMIT_QUEUE.length >= FLUSH_MAX) flushNow(); else scheduleFlush();
  }

  // A normalized structured record (clean bot-feed stream).
  // shape: { k:'norm', rec:{ ts, type, asset, data } }
  function emitNorm(type, asset, data) {
    EMIT_QUEUE.push({ k: 'norm', rec: { ts: _now(), type, asset: asset || null, data } });
    if (EMIT_QUEUE.length >= FLUSH_MAX) flushNow(); else scheduleFlush();
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: RAW RING BUFFER (TypedArray, lossless, bounded memory)
  // Stores the most recent raw binary frames as length-prefixed records inside
  // one pre-allocated Uint8Array. Old data is overwritten in place — heap usage
  // is flat regardless of session length. Used for clean raw export.
  // ════════════════════════════════════════════════════════════════════════
  function RawRingBuffer(sizeBytes) {
    const buf   = new Uint8Array(sizeBytes);
    let   head  = 0;       // next write offset
    let   stored = 0;      // number of frames currently retained
    const index = [];      // [{off,len,ts,evt}] in insertion order (bounded)
    const MAX_INDEX = 4096;

    function push(u8, ts, evt) {
      if (u8.length + 8 > sizeBytes) return; // frame larger than whole buffer
      if (head + u8.length > sizeBytes) head = 0; // wrap
      buf.set(u8, head);
      index.push({ off: head, len: u8.length, ts, evt });
      head += u8.length;
      stored++;
      if (index.length > MAX_INDEX) index.shift();
    }
    // Export everything currently retained as an array of {ts,evt,bytes}.
    function snapshot() {
      return index.map(e => ({ ts: e.ts, evt: e.evt, bytes: buf.subarray(e.off, e.off + e.len) }));
    }
    return { push, snapshot, get count() { return stored; } };
  }
  const RAW_RING = RawRingBuffer(4 * 1024 * 1024); // 4 MB lossless window

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: DECODERS
  // ════════════════════════════════════════════════════════════════════════

  // Genuine MsgPack decoder — kept ONLY as a real fallback for frames that are
  // actually msgpack. It is never allowed to run on JSON-as-bytes frames.
  function msgpackDecode(u8) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let pos = 0;
    const rb   = () => u8[pos++];
    const ru8  = () => u8[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos,false); pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos,false); pos += 8; return v; };
    const ri64 = () => { const hi=view.getInt32(pos,false),lo=view.getUint32(pos+4,false); pos+=8; return hi*4294967296+lo; };
    const ru64 = () => { const hi=view.getUint32(pos,false),lo=view.getUint32(pos+4,false); pos+=8; return hi*4294967296+lo; };
    const rStr = (n) => { const s=TD.decode(u8.subarray(pos,pos+n)); pos+=n; return s; };
    const rBin = (n) => { const b=u8.subarray(pos,pos+n); pos+=n; return Array.from(b); };
    function dec() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b & 0xf0) === 0x80) { const n=b&0xf,o={}; for(let i=0;i<n;i++){const k=dec();o[k]=dec();} return o; }
      if ((b & 0xf0) === 0x90) { const n=b&0xf,a=[]; for(let i=0;i<n;i++) a.push(dec()); return a; }
      if ((b & 0xe0) === 0xa0) return rStr(b & 0x1f);
      if ((b & 0xe0) === 0xe0) return b - 256;
      switch(b) {
        case 0xc0: return null;  case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8()); case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8();  case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();  case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8());  case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n=ru16(),a=[]; for(let i=0;i<n;i++) a.push(dec()); return a; }
        case 0xdd: { const n=ru32(),a=[]; for(let i=0;i<n;i++) a.push(dec()); return a; }
        case 0xde: { const n=ru16(),o={}; for(let i=0;i<n;i++){const k=dec();o[k]=dec();} return o; }
        case 0xdf: { const n=ru32(),o={}; for(let i=0;i<n;i++){const k=dec();o[k]=dec();} return o; }
        default: throw new Error('msgpack unknown 0x'+b.toString(16));
      }
    }
    return dec();
  }

  // Decode a binary attachment. JSON-FIRST (the real PO format), then a genuine
  // msgpack attempt, then raw text/hex as a last resort. Returns:
  //   { method, value, text }
  function decodePayload(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const b0 = u8[0];

    // Detect JSON-as-bytes: '[' 0x5b, '{' 0x7b, '"' 0x22  (covers every PO frame)
    if (b0 === 0x5b || b0 === 0x7b || b0 === 0x22) {
      try {
        const text = TD.decode(u8);
        return { method: 'json', value: JSON.parse(text), text };
      } catch { /* fall through */ }
    }
    // Genuine msgpack (only reached for non-JSON leading bytes).
    try {
      return { method: 'msgpack', value: msgpackDecode(u8), text: null };
    } catch { /* fall through */ }
    // Unknown binary — preserve raw for offline analysis.
    let text = null;
    try { text = TD.decode(u8); } catch {}
    return { method: 'raw', value: null, text: text ? text.slice(0, 2000) : null };
  }

  function bufToHex(u8, maxBytes = 256) {
    const slice = u8.subarray(0, maxBytes);
    let s = '';
    for (let i = 0; i < slice.length; i++) s += slice[i].toString(16).padStart(2, '0') + ' ';
    return s.trim() + (u8.length > maxBytes ? ` … (+${u8.length - maxBytes} more bytes)` : '');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: MICROSTRUCTURE ENGINE  (per-asset, bounded)
  // Everything here is derived from the single mid-price quote feed
  // [symbol, serverTsSeconds, price]. Honest about what cannot exist.
  // ════════════════════════════════════════════════════════════════════════
  const VOL_WINDOW = 30;              // ticks in the rolling vol window
  const microState = new Map();       // asset -> state
  const MAX_ASSETS = 64;

  function getAsset(asset) {
    let s = microState.get(asset);
    if (!s) {
      if (microState.size >= MAX_ASSETS) {            // evict oldest-touched
        const firstKey = microState.keys().next().value;
        microState.delete(firstKey);
      }
      s = {
        lastPrice: null, lastServerMs: null, lastLocalMs: null,
        dir: 0, runLen: 0,
        intervalEMA: null,   // expected ms between ticks
        rateEMA: null,       // ticks per second
        rets: [],            // recent log returns for realized vol
      };
      microState.set(asset, s);
    }
    return s;
  }

  // Returns a flat features object for one tick.
  function computeMicrostructure(asset, serverTsSec, price, localMs) {
    const s = getAsset(asset);
    const serverMs = serverTsSec * 1000;

    // Inter-tick timing (use server clock; it carries ms precision).
    const interTickMs = s.lastServerMs == null ? null : (serverMs - s.lastServerMs);
    if (interTickMs != null && interTickMs > 0) {
      s.intervalEMA = s.intervalEMA == null ? interTickMs : s.intervalEMA * 0.8 + interTickMs * 0.2;
      const instRate = 1000 / interTickMs;
      s.rateEMA = s.rateEMA == null ? instRate : s.rateEMA * 0.8 + instRate * 0.2;
    }

    // Signed price move + directional run length.
    let priceDelta = null, direction = 0;
    if (s.lastPrice != null) {
      priceDelta = price - s.lastPrice;
      direction  = priceDelta > 0 ? 1 : priceDelta < 0 ? -1 : 0;
      s.runLen   = (direction !== 0 && direction === s.dir) ? s.runLen + 1 : 1;
      if (direction !== 0) s.dir = direction;
      // Rolling realized volatility from log returns.
      if (s.lastPrice > 0 && price > 0) {
        s.rets.push(Math.log(price / s.lastPrice));
        if (s.rets.length > VOL_WINDOW) s.rets.shift();
      }
    }

    // Velocity (price units / second) over the inter-tick gap.
    const velocity = (priceDelta != null && interTickMs && interTickMs > 0)
      ? priceDelta / (interTickMs / 1000) : null;

    // Realized vol = stdev of recent log returns (population).
    let realizedVol = null;
    if (s.rets.length >= 2) {
      const m = s.rets.reduce((a, b) => a + b, 0) / s.rets.length;
      const v = s.rets.reduce((a, b) => a + (b - m) * (b - m), 0) / s.rets.length;
      realizedVol = Math.sqrt(v);
    }

    // Server -> client transport latency estimate. Both clocks are wall time;
    // this is an estimate (clock skew + ms resolution), not true microseconds.
    const latencyMs = localMs - serverMs;

    s.lastPrice = price; s.lastServerMs = serverMs; s.lastLocalMs = localMs;

    return {
      price,
      serverTs:        serverTsSec,
      priceDelta,
      direction,                                   // +1 up / -1 down / 0 flat
      runLength:       s.runLen,
      interTickMs,                                 // time since previous tick
      expectedNextTickMs: s.intervalEMA == null ? null : Math.round(s.intervalEMA),
      velocity,
      realizedVol,
      tickRate:        s.rateEMA == null ? null : +s.rateEMA.toFixed(3),
      latencyMs,
      // --- Not available from PO's single-quote feed (kept for schema stability) ---
      bid:    null,
      ask:    null,
      spread: null,   // PO sends one mid price; there is no bid/ask to difference
      obi:    null,   // no order-book depth is transmitted, so OBI is undefined
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: EVENT NORMALIZERS  (socket.io event name -> structured record)
  // Schemas confirmed from captured frames.
  // ════════════════════════════════════════════════════════════════════════

  // updateStream payload: [[symbol, serverTsSeconds, price], ...]
  function normTick(payload, localMs) {
    if (!Array.isArray(payload)) return;
    for (const row of payload) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const [asset, serverTs, price] = row;
      if (typeof price !== 'number') continue;
      emitNorm('TICK', asset, computeMicrostructure(asset, serverTs, price, localMs));
    }
  }

  // chafor payload: [[symbol, secondsRemainingInCandle]]
  function normCandleTiming(payload) {
    if (!Array.isArray(payload)) return;
    for (const row of payload) {
      if (!Array.isArray(row) || row.length < 2) continue;
      emitNorm('CANDLE_TIMING', row[0], { secondsRemaining: row[1] });
    }
  }

  // successopenOrder payload: full deal object (see header for fields)
  function normTradeOpen(payload) {
    const d = payload || {};
    emitNorm('TRADE_OPEN', d.asset, {
      id: d.id, requestId: d.requestId,
      command: d.command,                 // 0 = CALL/up, 1 = PUT/down
      direction: d.command === 0 ? 'CALL' : d.command === 1 ? 'PUT' : null,
      amount: d.amount, openPrice: d.openPrice,
      openTimestamp: d.openTimestamp, closeTimestamp: d.closeTimestamp,
      percentProfit: d.percentProfit, profit: d.profit,
      openMs: d.openMs, optionType: d.optionType,
      isDemo: d.isDemo, currency: d.currency,
    });
  }

  // failopenOrder payload: { error, amount, requestId, asset, balance }
  function normOrderReject(payload) {
    const d = payload || {};
    emitNorm('ORDER_REJECTED', d.asset, {
      error: d.error, amount: d.amount, requestId: d.requestId, balance: d.balance,
    });
  }

  // successcloseOrder payload: { profit, deals:[{...,closePrice,profit,closeMs}] }
  function normTradeClose(payload) {
    const deals = (payload && payload.deals) || [];
    for (const d of deals) {
      emitNorm('TRADE_CLOSE', d.asset, {
        id: d.id, requestId: d.requestId,
        command: d.command, direction: d.command === 0 ? 'CALL' : d.command === 1 ? 'PUT' : null,
        amount: d.amount, profit: d.profit,             // negative = loss
        openPrice: d.openPrice, closePrice: d.closePrice,
        openTimestamp: d.openTimestamp, closeTimestamp: d.closeTimestamp,
        openMs: d.openMs, closeMs: d.closeMs,
        won: typeof d.profit === 'number' ? d.profit > 0 : null,
        currency: d.currency, isDemo: d.isDemo,
      });
    }
  }

  // successupdateBalance payload: { isDemo, balance }
  function normBalance(payload) {
    const d = payload || {};
    emitNorm('BALANCE', null, { balance: d.balance, isDemo: d.isDemo });
  }

  // updateHistoryNewFast payload: { asset, period, history:[[ts,price],...] }
  function normHistory(payload) {
    const d = payload || {};
    emitNorm('HISTORY', d.asset, {
      period: d.period,
      points: Array.isArray(d.history) ? d.history.length : 0,
      first: Array.isArray(d.history) ? d.history[0] : null,
      last:  Array.isArray(d.history) ? d.history[d.history.length - 1] : null,
    });
  }

  // Dispatch an event name + payload to the right normalizer.
  function normalizeEvent(eventName, payload, localMs) {
    try {
      switch (eventName) {
        case 'updateStream':         normTick(payload, localMs); break;
        case 'chafor':               normCandleTiming(payload);  break;
        case 'successopenOrder':     normTradeOpen(payload);     break;
        case 'failopenOrder':        normOrderReject(payload);   break;
        case 'successcloseOrder':    normTradeClose(payload);    break;
        case 'successupdateBalance': normBalance(payload);       break;
        case 'updateHistoryNewFast': normHistory(payload);       break;
        // Other events (updateAssets, updateCharts, updateClosedDeals, …) are
        // captured in the raw stream but not part of the hot bot feed.
        default: break;
      }
    } catch (err) {
      emitRaw('norm_error', { eventName, error: String(err) });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: SOCKET.IO FRAME HANDLING + per-socket REASSEMBLY
  // ════════════════════════════════════════════════════════════════════════

  // Recursively replace {_placeholder:true,num:N} with attachments[N].
  function rebuildPlaceholders(node, attachments) {
    if (Array.isArray(node)) return node.map(n => rebuildPlaceholders(n, attachments));
    if (node && typeof node === 'object') {
      if (node._placeholder === true && typeof node.num === 'number') {
        return attachments[node.num];
      }
      const o = {};
      for (const k in node) o[k] = rebuildPlaceholders(node[k], attachments);
      return o;
    }
    return node;
  }

  // Parse the socket.io BINARY_EVENT header text, e.g.
  //   "451-["updateStream",{"_placeholder":true,"num":0}]"
  //    │└ socket.io type 5 = BINARY_EVENT
  //    └─ engine.io type 4 = MESSAGE
  // Returns { expected, header } or null.
  function parseBinaryHeader(text) {
    if (!text.startsWith('45')) return null;
    const dash = text.indexOf('-');
    if (dash === -1) return null;
    const expected = parseInt(text.slice(2, dash), 10) || 0;
    try {
      const header = JSON.parse(text.slice(dash + 1));
      return { expected, header };
    } catch { return null; }
  }

  function completeReassembly(state, localMs) {
    const p = state.pending;
    state.pending = null;
    if (!p) return;
    // Substitute attachments back into the header array: [eventName, ...args].
    const full = rebuildPlaceholders(p.header, p.attachments);
    const eventName = Array.isArray(full) ? full[0] : 'binary';
    const args = Array.isArray(full) ? full.slice(1) : [];
    const payload = args.length <= 1 ? args[0] : args;

    emitRaw('ws_binary', {
      wsId: state.wsId, wsUrl: state.wsUrl, direction: 'recv',
      eventName, byteLength: p.totalBytes,
      decoded: payload, decodeMethod: p.method,
      hexRaw: p.firstHex, rawText: p.firstText,
    });
    normalizeEvent(eventName, payload, localMs);
  }

  function handleTextFrame(state, raw, localMs) {
    // Engine.IO heartbeat: server ping '2', client pong '3'.
    if (raw === '2' || raw === '3') {
      if (raw === '2') {
        const prev = state.lastPing;
        state.lastPing = localMs;
        const since = prev == null ? null : localMs - prev;
        emitNorm('LATENCY', null, {
          wsId: state.wsId, kind: 'server_ping',
          interPingMs: since, intervalHealthy: since == null ? null : Math.abs(since - 25000) < 10000,
        });
      }
      emitRaw('ws_text', {
        wsId: state.wsId, wsUrl: state.wsUrl, direction: 'recv',
        raw, isHeartbeat: true, byteLength: raw.length,
      });
      return;
    }

    // BINARY_EVENT header (precedes attachment frames).
    if (raw.startsWith('45')) {
      const parsed = parseBinaryHeader(raw);
      if (parsed) {
        state.pending = {
          header: parsed.header, expected: Math.max(1, parsed.expected),
          attachments: [], totalBytes: 0, method: null, firstHex: null, firstText: null,
        };
        emitRaw('ws_text', {
          wsId: state.wsId, wsUrl: state.wsUrl, direction: 'recv',
          raw, byteLength: raw.length, parseMethod: 'socketio_binary_header',
        });
        return;
      }
    }

    // Plain socket.io EVENT: "42[...]"  or  ack/control frames.
    let parsed = null, parseMethod = 'none';
    if (raw.startsWith('42')) {
      try {
        parsed = JSON.parse(raw.slice(2));
        parseMethod = 'socketio_42';
        if (Array.isArray(parsed)) normalizeEvent(parsed[0], parsed[1], localMs);
      } catch {}
    } else if (raw.startsWith('{') || raw.startsWith('[')) {
      try { parsed = JSON.parse(raw); parseMethod = 'json'; } catch {}
    }

    emitRaw('ws_text', {
      wsId: state.wsId, wsUrl: state.wsUrl, direction: 'recv',
      raw, parsed, parseMethod, byteLength: raw.length,
    });
  }

  function handleBinaryFrame(state, ab, localMs) {
    const u8 = new Uint8Array(ab);
    RAW_RING.push(u8, localMs, state.pending ? (state.pending.header?.[0] || 'binary') : 'binary');

    const dec = decodePayload(ab);

    if (state.pending) {
      const p = state.pending;
      p.attachments.push(dec.value);
      p.totalBytes += u8.length;
      if (p.method == null) {           // remember first attachment diagnostics
        p.method = dec.method;
        p.firstHex = bufToHex(u8, 256);
        p.firstText = dec.text ? dec.text.slice(0, 2000) : null;
      }
      if (p.attachments.length >= p.expected) completeReassembly(state, localMs);
      return;
    }

    // Standalone binary with no preceding header (unexpected for PO).
    emitRaw('ws_binary', {
      wsId: state.wsId, wsUrl: state.wsUrl, direction: 'recv',
      eventName: 'binary_unframed', byteLength: u8.length,
      decoded: dec.value, decodeMethod: dec.method,
      hexRaw: bufToHex(u8, 256), rawText: dec.text,
    });
  }

  function handleSend(state, data, localMs) {
    if (typeof data === 'string') {
      let parsed = null;
      if (data.startsWith('42')) { try { parsed = JSON.parse(data.slice(2)); } catch {} }
      else if (data.startsWith('{') || data.startsWith('[')) { try { parsed = JSON.parse(data); } catch {} }

      // Surface outgoing orders as a pending-order record for the bot feed.
      if (Array.isArray(parsed) && parsed[0] === 'openOrder') {
        const o = parsed[1] || {};
        emitNorm('ORDER_PENDING', o.asset, {
          command: o.command, direction: o.command === 0 ? 'CALL' : o.command === 1 ? 'PUT' : null,
          amount: o.amount, requestId: o.requestId, optionType: o.optionType,
        });
      }
      emitRaw('ws_text', {
        wsId: state.wsId, wsUrl: state.wsUrl, direction: 'sent',
        raw: data, parsed, parseMethod: parsed ? 'socketio' : 'none',
        isHeartbeat: data === '2' || data === '3', byteLength: data.length,
      });
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer);
      const dec = decodePayload(u8.buffer);
      emitRaw('ws_binary', {
        wsId: state.wsId, wsUrl: state.wsUrl, direction: 'sent',
        eventName: 'sent_binary', byteLength: u8.length,
        decoded: dec.value, decodeMethod: dec.method, hexRaw: bufToHex(u8, 256),
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: WEBSOCKET PROXY  (transparent + binaryType-safe)
  // ════════════════════════════════════════════════════════════════════════
  let wsIdCounter = 0;

  function SpyWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);

    // Force ArrayBuffer delivery for received binary so we never juggle Blobs
    // asynchronously (which would desync attachment ordering vs the 451 header).
    try { ws.binaryType = 'arraybuffer'; } catch {}

    const state = {
      wsId: ++wsIdCounter, wsUrl: String(url),
      pending: null, lastPing: null,
    };
    emitRaw('ws_open', { wsId: state.wsId, wsUrl: state.wsUrl, protocols: protocols || null });

    // Capture-phase listener: we observe before the app's own handlers run,
    // and we never call stopPropagation, so the platform is unaffected.
    ws.addEventListener('message', (e) => {
      const localMs = _now();
      const raw = e.data;
      if (typeof raw === 'string') { handleTextFrame(state, raw, localMs); return; }
      if (raw instanceof ArrayBuffer) { handleBinaryFrame(state, raw, localMs); return; }
      if (raw instanceof Blob) { raw.arrayBuffer().then(ab => handleBinaryFrame(state, ab, _now())).catch(() => {}); return; }
    }, true);

    // Wrap send transparently.
    const nativeSend = ws.send;
    const wrappedSend = function (data) {
      try { handleSend(state, data, _now()); } catch {}
      return nativeSend.call(ws, data);
    };
    maskToString(wrappedSend, 'send');
    try { ws.send = wrappedSend; } catch {}

    ws.addEventListener('close', (e) => emitRaw('ws_close', { wsId: state.wsId, wsUrl: state.wsUrl, code: e.code, reason: e.reason }));
    ws.addEventListener('error', ()  => emitRaw('ws_error', { wsId: state.wsId, wsUrl: state.wsUrl }));
    return ws;
  }

  // Keep prototype identity + static constants so `instanceof` and WS.OPEN work.
  SpyWebSocket.prototype = NativeWS.prototype;
  _defineProps(SpyWebSocket, {
    CONNECTING: { value: 0, enumerable: true },
    OPEN:       { value: 1, enumerable: true },
    CLOSING:    { value: 2, enumerable: true },
    CLOSED:     { value: 3, enumerable: true },
  });
  maskToString(SpyWebSocket, 'WebSocket');
  try {
    _defineProp(window, 'WebSocket', { value: SpyWebSocket, writable: true, configurable: true });
  } catch { window.WebSocket = SpyWebSocket; }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: WORKER / SHAREDWORKER postMessage TAP  (defensive, non-breaking)
  // PO currently runs its WebSocket on the main thread (all 3 sockets were
  // captured above), but if the socket ever moves into a worker, the data
  // matrices still cross this postMessage boundary, where we observe them.
  // ════════════════════════════════════════════════════════════════════════
  function tapWorkerPort(port, label) {
    if (!port) return;
    try {
      const nativePost = port.postMessage;
      const wrapped = function (msg, ...rest) {
        try { emitRaw('worker_send', { label, preview: previewMsg(msg) }); } catch {}
        return nativePost.call(port, msg, ...rest);
      };
      maskToString(wrapped, 'postMessage');
      port.postMessage = wrapped;
      port.addEventListener && port.addEventListener('message', (e) => {
        emitRaw('worker_recv', { label, preview: previewMsg(e.data) });
      });
    } catch {}
  }
  function previewMsg(msg) {
    try {
      if (typeof msg === 'string') return msg.slice(0, 500);
      if (msg instanceof ArrayBuffer) return { binary: true, bytes: msg.byteLength };
      return JSON.parse(JSON.stringify(msg, (k, v) =>
        (typeof v === 'string' && v.length > 300) ? v.slice(0, 300) + '…' : v));
    } catch { return '[unserializable]'; }
  }
  if (NativeWorker) {
    function SpyWorker(scriptURL, opts) {
      const w = new NativeWorker(scriptURL, opts);
      emitRaw('worker_open', { scriptURL: String(scriptURL) });
      tapWorkerPort(w, 'worker:' + String(scriptURL).slice(-60));
      return w;
    }
    SpyWorker.prototype = NativeWorker.prototype;
    maskToString(SpyWorker, 'Worker');
    try { window.Worker = SpyWorker; } catch {}
  }
  if (NativeShared) {
    function SpySharedWorker(scriptURL, opts) {
      const w = new NativeShared(scriptURL, opts);
      emitRaw('worker_open', { shared: true, scriptURL: String(scriptURL) });
      try { w.port && tapWorkerPort(w.port, 'shared:' + String(scriptURL).slice(-60)); } catch {}
      return w;
    }
    SpySharedWorker.prototype = NativeShared.prototype;
    maskToString(SpySharedWorker, 'SharedWorker');
    try { window.SharedWorker = SpySharedWorker; } catch {}
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: FETCH INTERCEPTOR  (REST: trade history, account, etc.)
  // ════════════════════════════════════════════════════════════════════════
  const wrappedFetch = async function (...args) {
    const reqUrl    = args[0] instanceof Request ? args[0].url : String(args[0]);
    const reqOpts   = args[1] || {};
    const reqMethod = reqOpts.method || (args[0] instanceof Request ? args[0].method : 'GET');
    let   reqBody   = null;
    try {
      if (reqOpts.body) reqBody = typeof reqOpts.body === 'string' ? reqOpts.body : '[non-string body]';
      else if (args[0] instanceof Request) reqBody = await args[0].clone().text().catch(() => null);
    } catch {}
    emitRaw('fetch_request', { reqUrl, reqMethod, reqBody });
    try {
      const response = await NativeFetch.apply(this, args);
      response.clone().text().then(body => {
        let parsed = null; try { parsed = JSON.parse(body); } catch {}
        emitRaw('fetch_response', { reqUrl, status: response.status, statusText: response.statusText, rawBody: body, parsed });
      }).catch(() => {});
      return response;
    } catch (err) {
      emitRaw('fetch_error', { reqUrl, error: String(err) });
      throw err;
    }
  };
  maskToString(wrappedFetch, 'fetch');
  window.fetch = wrappedFetch;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10: XMLHttpRequest INTERCEPTOR
  // ════════════════════════════════════════════════════════════════════════
  function SpyXHR() {
    const xhr = new NativeXHR();
    let xhrUrl = '', xhrMethod = 'GET';
    const origOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      xhrMethod = method; xhrUrl = url;
      emitRaw('xhr_open', { method, url });
      return origOpen.call(xhr, method, url, ...rest);
    };
    const origSend = xhr.send;
    xhr.send = function (body) {
      emitRaw('xhr_send', { url: xhrUrl, method: xhrMethod, body: body ? String(body).slice(0, 2000) : null });
      return origSend.call(xhr, body);
    };
    xhr.addEventListener('load', () => {
      let parsed = null; try { parsed = JSON.parse(xhr.responseText); } catch {}
      emitRaw('xhr_response', { url: xhrUrl, status: xhr.status, rawBody: xhr.responseText, parsed });
    });
    xhr.addEventListener('error', () => emitRaw('xhr_error', { url: xhrUrl, status: xhr.status }));
    return xhr;
  }
  SpyXHR.prototype = NativeXHR.prototype;
  maskToString(SpyXHR, 'XMLHttpRequest');
  window.XMLHttpRequest = SpyXHR;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 11: DOM EXTRACTION
  //  • MutationObserver-driven (debounced) instead of blind polling.
  //  • React/Vue internal-state fallback when the DOM text lags.
  // ════════════════════════════════════════════════════════════════════════
  function readReactState(el) {
    // Walk up a few fiber parents looking for a balance/asset on memoizedProps
    // or memoizedState. Best-effort and fully guarded.
    try {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return null;
      let fiber = el[key], depth = 0, out = {};
      while (fiber && depth < 8) {
        const props = fiber.memoizedProps;
        if (props && typeof props === 'object') {
          for (const k of ['balance', 'amount', 'asset', 'symbol', 'payout', 'profit']) {
            if (out[k] == null && typeof props[k] === 'number') out[k] = props[k];
            if (out[k] == null && typeof props[k] === 'string') out[k] = props[k];
          }
        }
        fiber = fiber.return; depth++;
      }
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  }

  function pickText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { const t = (el.textContent || el.value || '').trim(); if (t) return t; }
    }
    return null;
  }
  function pickNumber(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const v = parseFloat((el.textContent || el.value || '').replace(/[,\s$€£]/g, ''));
        if (!isNaN(v)) return v;
      }
    }
    return null;
  }

  function extractDOMSnapshot() {
    const snap = {
      accountLabel: null, accountType: null, currency: null, balance: null,
      asset: null, currentPrice: null, tradeAmount: null,
      tradeDuration: null, durationSecs: null, profitPct: null,
      pageUrl: location.href, timestamp: new Date().toISOString(),
    };

    const header = document.querySelector('header, .header, [class*="header"], [class*="Header"]');
    if (header) {
      const txt = header.textContent || '';
      const m = txt.match(/\b(QT Demo|Demo|Real|Live|Practice)\b/i);
      if (m) snap.accountLabel = m[1];
      const c = txt.match(/\b(USD|EUR|GBP|JPY|BTC|ETH)\b/); if (c) snap.currency = c[1];
    }
    snap.accountType = /demo|practice|تجريبي/i.test(snap.accountLabel || '') ? 'Demo'
                     : /real|live|حقيقي/i.test(snap.accountLabel || '') ? 'Real'
                     : /demo/i.test(location.href) ? 'Demo' : null;

    snap.balance = pickNumber([
      '.balance__value', '.user-balance__value', '[class*="balanceValue"]',
      '[class*="balance-value"]', '[class*="userBalance"]', '[data-balance]',
      '.header__balance', '[class*="headerBalance"]',
    ]);
    snap.asset = pickText([
      '[class*="asset-name"]', '[class*="assetName"]', '[class*="currentAsset"]',
      '[class*="asset__name"]', '[class*="selected-asset"]',
    ]) || new URLSearchParams(location.search).get('symbol');
    snap.currentPrice = pickNumber([
      '[class*="current-price"]', '[class*="currentPrice"]', '[class*="last-price"]',
      '[class*="quote__value"]', '[class*="price-value"]',
    ]);
    snap.tradeAmount = pickNumber([
      '[class*="trade-amount"]', '[class*="tradeAmount"]', '[class*="invest"]',
      'input[class*="amount"]', '[class*="betAmount"]',
    ]);

    const dur = pickText([
      '[class*="deal-time"]', '[class*="trade-time"]', '[class*="expiration"]',
      '[class*="duration"]', 'input[class*="time"]',
    ]);
    if (dur) {
      const mt = dur.match(/\d{1,2}:\d{2}(:\d{2})?/);
      if (mt) {
        snap.tradeDuration = mt[0];
        const p = mt[0].split(':').map(Number);
        snap.durationSecs = p.length === 3 ? p[0]*3600 + p[1]*60 + p[2] : p[0]*60 + p[1];
      }
    }

    const panel = document.querySelector('[class*="trade-panel"], [class*="tradePanel"], [class*="deal-form"], [class*="order-form"]');
    if (panel) {
      const pm = (panel.textContent || '').match(/\+?(\d+(?:\.\d+)?)\s*%/);
      if (pm) snap.profitPct = parseFloat(pm[1]);
    }

    // React fallback for the most lag-prone fields (balance/asset).
    if (snap.balance == null || snap.asset == null) {
      const hostEl = document.querySelector('[class*="balance"], [class*="asset"]') || document.body;
      const rs = hostEl && readReactState(hostEl);
      if (rs) {
        if (snap.balance == null && typeof rs.balance === 'number') snap.balance = rs.balance;
        if (snap.asset == null && (rs.asset || rs.symbol)) snap.asset = rs.asset || rs.symbol;
      }
    }
    return snap;
  }

  let lastDOMSnapshot = null;
  function domPoll() {
    try {
      const snap = extractDOMSnapshot();
      const s = JSON.stringify(snap);
      if (s !== lastDOMSnapshot) { lastDOMSnapshot = s; emitRaw('dom_poll', snap); }
    } catch (err) { emitRaw('dom_error', { error: String(err) }); }
  }

  let domTimer = null;
  const domObserver = new MutationObserver(() => {
    clearTimeout(domTimer); domTimer = setTimeout(domPoll, 150);
  });
  function startDom() {
    domObserver.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'data-value', 'data-balance', 'value', 'data-asset'],
    });
    setTimeout(domPoll, 500);
    setInterval(domPoll, 2000); // safety net for fully-canvas chart updates
  }
  if (document.documentElement) startDom();
  else document.addEventListener('DOMContentLoaded', startDom, { once: true });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 12: RAW EXPORT BRIDGE
  // The content script can request the lossless raw ring buffer (e.g. for a
  // binary export). We answer with a one-shot batched record.
  // ════════════════════════════════════════════════════════════════════════
  window.addEventListener('__aoispy_request_raw', () => {
    const frames = RAW_RING.snapshot().map(f => ({
      ts: f.ts, evt: f.evt,
      // hex keeps it transferable through CustomEvent without detaching buffers
      hex: bufToHex(f.bytes, f.bytes.length),
    }));
    window.dispatchEvent(new CustomEvent('__aoispy_raw_dump', { detail: { frames, count: RAW_RING.count } }));
  });

  // ════════════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════════════
  emitRaw('spy_init', {
    version: '2.0.0', timestamp: new Date().toISOString(),
    url: location.href, userAgent: navigator.userAgent,
    notes: 'JSON-first decoder; per-socket 451 reassembly; microstructure; batched emit',
  });
  flushNow();

})();
