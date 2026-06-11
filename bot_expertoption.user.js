// ==UserScript==
// @name         🛰️ EXPERTOPTION_ENGINE — WS Interceptor + Protocol Decoder + Trade Engine + Risk Guard + Signal Orb
// @namespace    expertoption-trade-engine
// @version      1.0.0
// @description  ExpertOption trading bot — intercepts the native JSON WebSocket protocol (candles / profile / trade lifecycle), tracks ticks·balance·active-asset, runs an adaptive signal engine, protects capital (% risk sizing, daily drawdown, loss-streak pause/halt), executes trades via the verified buyOption format, and shows a draggable panel + liquid-glass signal orb.
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
  if (W.__EO_ENGINE_V1) return;
  W.__EO_ENGINE_V1 = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  CONFIG  (ExpertOption native protocol — JSON text/binary frames)
  // ══════════════════════════════════════════════════════════════════════
  // Every frame is UTF-8 JSON: { action, message:{...}, token, ns }. Batched
  // frames are wrapped in "multipleAction". Live prices arrive via "candles"
  // (tf:0 = tick, v[0] = price; tf>0 = OHLC candle, v=[o,h,l,c]). assetId is
  // numeric and resolved to a symbol via the "assets" action.
  const CFG = {
    // ─── Diagnostics / raw traffic log ──────────────────────────────────
    DIAG_ENABLED      : true,
    DIAG_MAX_PACKETS  : 1500,
    // Low-value, high-frequency actions — counted but not printed to the log
    LOG_MUTE_ACTIONS  : ['ping', 'pong', 'candles', 'tradesStatus', 'openOptionsStat', 'setConversionData'],

    // ─── UI ─────────────────────────────────────────────────────────────
    UI_ENABLED        : true,
    POPUP_ENABLED     : true,
    DEFAULT_AMOUNT    : 1,
    DEFAULT_EXP_SHIFT : 60,           // seconds — default option expiration

    TRADE_HOST_HINTS  : ['expertoption.com', 'expertoption.finance'],

    // ─── Capital protection (the most important layer) ──────────────────
    RISK_PCT_ENABLED  : true,         // stake = % of balance (not a fixed amount)
    RISK_PCT          : 0.02,         // 2% of balance per trade
    RISK_MIN_STAKE    : 1,
    RISK_MAX_STAKE    : 100000,
    RISK_MAX_PCT      : 0.05,         // hard ceiling: never risk > 5% on one trade
    DAILY_MAX_DD_PCT  : 0.20,         // halt session at -20% of the session-start balance
    DAILY_PROFIT_PCT  : 0.30,         // halt session at +30% (lock in profit)
    STREAK_PAUSE_LOSSES : 3,          // 3 consecutive losses → long pause
    STREAK_PAUSE_MS   : 180000,       // 3 minutes
    STREAK_HALT_LOSSES : 5,           // 5 consecutive losses → hard halt (manual resume)

    // ─── Native action names (confirmed from traffic) ───────────────────
    A: {
      CANDLES        : 'candles',               // live price stream
      SUBSCRIBE      : 'subscribeCandles',      // reveals the active asset
      HISTORY        : 'assetHistoryCandles',
      PROFILE        : 'profile',               // balance
      ASSETS         : 'assets',                // asset list → id ↔ symbol
      SET_CONTEXT    : 'setContext',            // carries the session token
      MULTIPLE       : 'multipleAction',        // batched frames wrapper
      BUY            : 'buyOption',              // outgoing order + confirmation
      OPEN_OK        : 'openTradeSuccessful',
      TRADE_STATUS   : 'tradesStatus',          // live status of open trades
      CLOSE_OK       : 'closeTradeSuccessful',  // settled trade (win/loss)
      TRADERS_CHOICE : 'tradersChoice',         // official crowd indicator { asset_id, put% }
    },
    // result-object type map: 0 = call (up), 1 = put (down)
    TYPE_CALL: 0, TYPE_PUT: 1,

    // ─── Signal engine / strategy ───────────────────────────────────────
    STRATEGY: {
      SERIES_MAX     : 240,   // max price points kept per asset
      MIN_POINTS     : 24,    // min points before a signal is generated
      EMA_FAST       : 5,
      EMA_SLOW       : 20,
      RSI_PERIOD     : 14,
      RSI_OS         : 30,    // oversold → up signal (call)
      RSI_OB         : 70,    // overbought → down signal (put)
      ROC_LOOKBACK   : 6,     // momentum lookback points
      W_TREND        : 40,    // EMA crossover weight
      W_RSI          : 30,    // RSI weight
      W_MOMENTUM     : 20,    // price-momentum weight
      W_CROWD        : 10,    // crowd indicator weight
      CROWD_FOLLOW   : true,  // true = trade with the majority, false = contrarian
      MIN_CONFIDENCE : 60,    // confidence threshold to auto-fire
      COOLDOWN_MS    : 8000,  // cooldown between auto trades
      ONE_TRADE      : true,  // don't open a new trade while one is open
    },
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

  // ══════════════════════════════════════════════════════════════════════
  // § 3  STATE
  // ══════════════════════════════════════════════════════════════════════
  let activeAssetId   = null;
  let wsConnected     = false;
  let totalFrames     = 0;
  let totalTicks      = 0;
  let _lastTickMs     = 0;            // time of last captured price — liveness indicator
  let balanceDemo     = null;
  let balanceReal     = null;
  let isDemo          = 1;
  let tradeAmount     = CFG.DEFAULT_AMOUNT;
  let expShift        = CFG.DEFAULT_EXP_SHIFT;
  let tradeWS         = null;
  let tradeWSOrig     = null;
  let lastToken       = null;

  const _lastPrice     = new Map();   // assetId → last price
  const _assetsById    = new Map();   // assetId → { symbol, name, profit, digits, ... }
  const _openTrades    = new Map();   // tradeId → trade
  const _settledTrades = new Set();   // tradeId already counted (dedupe across tradesStatus/closeTradeSuccessful)
  const _tradersChoice = new Map();   // assetId → { put, call }  (official platform %)
  const _series        = new Map();   // assetId → [ price, ... ]  (rolling price series)

  // ─── signal / auto-trading state ───
  let autoTrade        = false;
  let minConfidence    = CFG.STRATEGY.MIN_CONFIDENCE;
  let _lastSignal      = { dir: null, conf: 0, reasons: [] };
  let _lastAutoTradeMs = 0;
  const _botNs         = new Set();   // ns of trades sent through this tool
  const _botTradeIds   = new Set();   // tradeIds confirmed as bot trades

  // ─── stats / streak ───
  const STATS = { trades: 0, wins: 0, losses: 0, pnl: 0, lossStreak: 0, winStreak: 0, bestStreak: 0 };
  const BOT   = { trades: 0, wins: 0, losses: 0, pnl: 0 };
  let _pauseUntil = 0;                // streak pause expiry (ms)

  function symOf(id) { const a = _assetsById.get(id); return a ? a.symbol : ('#' + id); }
  function curBalance() { return isDemo ? balanceDemo : balanceReal; }

  // ══════════════════════════════════════════════════════════════════════
  // § 4  RISK MANAGER — capital protection (independent of the signal engine)
  // ══════════════════════════════════════════════════════════════════════
  const RiskManager = (function () {
    let _sessionStart = null;   // session-start balance (set on first balance seen)
    let _halted = false, _reason = '';
    function _bal() { return curBalance() || 0; }
    function noteBalance(b) { if (_sessionStart === null && b > 0) _sessionStart = b; }
    // % sizing with hard ceilings; falls back to the manual amount when disabled / no balance
    function size() {
      const bal = _bal();
      if (!CFG.RISK_PCT_ENABLED || bal <= 0) return tradeAmount;
      let amt = bal * CFG.RISK_PCT;
      amt = Math.min(amt, bal * CFG.RISK_MAX_PCT, CFG.RISK_MAX_STAKE);
      amt = Math.max(amt, CFG.RISK_MIN_STAKE);
      return Math.round(amt * 100) / 100;
    }
    function checkDaily() {
      const bal = _bal();
      if (_sessionStart === null || bal <= 0) return true;
      if (bal <= _sessionStart * (1 - CFG.DAILY_MAX_DD_PCT)) { halt('daily drawdown limit -' + Math.round(CFG.DAILY_MAX_DD_PCT * 100) + '%'); return false; }
      if (CFG.DAILY_PROFIT_PCT && bal >= _sessionStart * (1 + CFG.DAILY_PROFIT_PCT)) { halt('daily profit target +' + Math.round(CFG.DAILY_PROFIT_PCT * 100) + '%'); return false; }
      return true;
    }
    function halt(reason) {
      if (_halted) return;
      _halted = true; _reason = reason;
      autoTrade = false;
      try { syncAutoBtn(); } catch (_) {}
      addLog('🛑 [RISK] session halted — ' + reason + '. Resume manually: window.__EO.resumeRisk()', 'error');
      try { showResultPopup(false, 'HALTED', reason); } catch (_) {}
    }
    function isHalted() { return _halted; }
    function resume() {
      _halted = false; _reason = ''; const b = _bal(); if (b > 0) _sessionStart = b;
      addLog('▶️ [RISK] manual resume — session-start balance ' + b.toFixed(2), 'signal');
    }
    function status() {
      const b = _bal();
      return { sessionStart: _sessionStart, balance: b, halted: _halted, reason: _reason,
               pnlPct: (_sessionStart && b) ? (((b - _sessionStart) / _sessionStart) * 100).toFixed(1) + '%' : 'n/a',
               nextSize: size() };
    }
    return { noteBalance, size, checkDaily, halt, isHalted, resume, status };
  })();

  // record a settled trade outcome → streak + pause/halt logic
  function recordResult(win, resultAmount, isBot) {
    STATS.trades++; STATS.pnl += resultAmount;
    if (win) {
      STATS.wins++; STATS.winStreak++; STATS.lossStreak = 0;
      if (STATS.winStreak > STATS.bestStreak) STATS.bestStreak = STATS.winStreak;
    } else {
      STATS.losses++; STATS.lossStreak++; STATS.winStreak = 0;
      if (STATS.lossStreak >= CFG.STREAK_HALT_LOSSES) {
        RiskManager.halt(STATS.lossStreak + ' consecutive losses');
      } else if (STATS.lossStreak >= CFG.STREAK_PAUSE_LOSSES) {
        _pauseUntil = nowMs() + CFG.STREAK_PAUSE_MS;
        addLog('⛔ [STREAK] ' + STATS.lossStreak + ' consecutive losses — paused ' + (CFG.STREAK_PAUSE_MS / 1000) + 's', 'error');
      }
    }
    if (isBot) { BOT.trades++; BOT.pnl += resultAmount; win ? BOT.wins++ : BOT.losses++; }
    RiskManager.checkDaily();
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 5  DECODE ENGINE  (ExpertOption frames are plain UTF-8 JSON)
  // ══════════════════════════════════════════════════════════════════════
  function parseFrame(data) {
    if (typeof data === 'string') { const j = safeJSONParse(data.trim()); return j ? { method: 'text-json', value: j } : null; }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!bytes.length) return null;
    const txt = tryUtf8(bytes);
    if (!txt) return null;
    const i = txt.search(/[{\[]/);
    if (i < 0) return null;
    const j = safeJSONParse(i === 0 ? txt : txt.slice(i));
    return j ? { method: i === 0 ? 'json' : 'json-embedded', value: j } : null;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  PROTOCOL HANDLERS  (native ExpertOption structures)
  // ══════════════════════════════════════════════════════════════════════
  function flattenActions(msg) {
    if (!msg || typeof msg !== 'object') return [];
    if (msg.action === CFG.A.MULTIPLE && msg.message && Array.isArray(msg.message.actions)) {
      return msg.message.actions.filter(a => a && typeof a === 'object');
    }
    if (msg.action) return [msg];
    return [];
  }

  // A) candles: message.assetId + message.candles[].v = [open, high, low, close]
  function onCandles(m) {
    if (!m || !Array.isArray(m.candles)) return;
    const aid = m.assetId;
    if (activeAssetId == null) activeAssetId = aid;
    for (const c of m.candles) {
      let price = null;
      if (c.tf === 0 && Array.isArray(c.v) && c.v.length) { price = c.v[0]; activeAssetId = aid; }  // tick = currently displayed asset
      else if (Array.isArray(c.v) && c.v.length >= 4) price = c.v[3];                                // close (larger timeframes)
      if (price > 0) {
        totalTicks++; _lastPrice.set(aid, price); _lastTickMs = nowMs();
        let ser = _series.get(aid); if (!ser) { ser = []; _series.set(aid, ser); }
        ser.push(price); if (ser.length > CFG.STRATEGY.SERIES_MAX) ser.shift();
      }
    }
  }

  function onSubscribe(m) {
    let id = null;
    if (Array.isArray(m?.assetsIds) && m.assetsIds.length) id = m.assetsIds[m.assetsIds.length - 1];
    else if (Array.isArray(m?.assets) && m.assets.length) id = m.assets[m.assets.length - 1]?.id;
    if (id != null) { activeAssetId = id; addLog('🎯 active asset: ' + symOf(id) + ' (' + id + ')', 'info'); }
  }

  // B) profile: message.profile.{demo_balance, real_balance, is_demo}
  function onProfile(m) {
    const p = m?.profile || m;
    if (!p) return;
    if (p.demo_balance != null) balanceDemo = +p.demo_balance;
    if (p.real_balance != null) balanceReal = +p.real_balance;
    if (p.is_demo != null) isDemo = +p.is_demo;
    RiskManager.noteBalance(curBalance());   // feed the money-management module the active balance
    RiskManager.checkDaily();
    addLog('💰 balance — demo: ' + balanceDemo + ' | real: ' + balanceReal + ' | demo=' + isDemo, 'info');
  }

  function onAssets(m) {
    const list = m?.assets;
    if (!Array.isArray(list)) return;
    for (const a of list) _assetsById.set(a.id, { symbol: a.symbol, name: a.name, profit: a.profit, digits: a.digits, expStep: a.expiration_step, purchaseTime: a.purchase_time, active: a.is_active });
    addLog('📋 assets loaded: ' + _assetsById.size, 'info');
  }

  function onOpenOk(m) {
    const t = m?.trade || m;
    if (!t || t.id == null) return;
    _openTrades.set(t.id, t);
    const isBot = _botTradeIds.has(t.id);
    addLog('🟢 trade opened #' + t.id + ' | ' + symOf(t.asset_id) + ' | ' + (t.type === CFG.TYPE_PUT ? 'PUT▼' : 'CALL▲') + ' | $' + t.amount + ' | entry ' + t.open_rate + ' | profit ' + t.profit + '%' + (isBot ? ' 🤖' : ''), 'signal');
  }

  // normalize a trade object → { settled, win, amount } (handles win-string or numeric result)
  function tradeOutcome(t) {
    if (t == null) return { settled: false };
    if (t.win != null) {
      const w = String(t.win).toLowerCase();
      if (w === 'win' || w === 'won' || w === '1') return { settled: true, win: true, amount: +(t.profit ?? t.result_amount ?? 0) };
      if (w === 'loose' || w === 'lose' || w === 'lost' || w === '0') return { settled: true, win: false, amount: -(+(t.amount ?? 0)) };
      if (w === 'refund' || w === 'draw' || w === 'tie') return { settled: true, win: null, amount: 0 };
    }
    if (t.result_amount != null) { const r = +t.result_amount; return { settled: true, win: r > 0, amount: r }; }
    if ((t.status === 'closed' || t.closed === true) && t.profit_amount != null) { const r = +t.profit_amount; return { settled: true, win: r > 0, amount: r }; }
    return { settled: false };
  }

  // C) tradesStatus / closeTradeSuccessful → wins/losses, streak, win/loss popup
  function onTradeResults(m) {
    const trades = Array.isArray(m?.trades) ? m.trades
                 : (m?.trade ? [m.trade] : (Array.isArray(m) ? m : []));
    for (const t of trades) {
      if (t == null || t.id == null) continue;
      const out = tradeOutcome(t);
      if (!out.settled) { _openTrades.set(t.id, t); continue; }   // still live → just track
      if (_settledTrades.has(t.id)) continue;                     // dedupe
      _settledTrades.add(t.id);
      _openTrades.delete(t.id);
      const isBot = _botTradeIds.has(t.id);
      if (isBot) _botTradeIds.delete(t.id);
      if (out.win === null) {                                     // refund / draw — neutral
        addLog('➖ refund' + (isBot ? ' 🤖' : '') + ' #' + t.id + ' | ' + symOf(t.asset_id), 'info');
        continue;
      }
      recordResult(out.win, out.amount, isBot);
      addLog((out.win ? '✅ WIN' : '❌ LOSS') + (isBot ? ' 🤖' : '') + ' #' + t.id + ' | ' + symOf(t.asset_id) + ' | exit ' + (t.close_rate ?? '—') + ' | result $' + out.amount.toFixed(2) + ' | streak ' + (out.win ? STATS.winStreak + 'W' : STATS.lossStreak + 'L'), out.win ? 'signal' : 'error');
      showResultPopup(out.win, out.win ? 'WIN' : 'LOSS', symOf(t.asset_id) + '  $' + out.amount.toFixed(2));
    }
  }

  function onTradersChoice(m) {
    const list = m?.assets;
    if (!Array.isArray(list)) return;
    for (const a of list) {
      if (a.asset_id == null || a.put == null) continue;
      _tradersChoice.set(a.asset_id, { put: +a.put, call: 100 - +a.put });
    }
  }

  function dispatch(action, message, fullMsg) {
    if (fullMsg && fullMsg.token) lastToken = fullMsg.token;   // token rides on most frames
    switch (action) {
      case CFG.A.CANDLES:        onCandles(message); break;
      case CFG.A.SUBSCRIBE:      onSubscribe(message); break;
      case CFG.A.PROFILE:        onProfile(message); break;
      case CFG.A.ASSETS:         onAssets(message); break;
      case CFG.A.SET_CONTEXT:    if (message?.token) lastToken = message.token; break;
      case CFG.A.OPEN_OK:        onOpenOk(message); break;
      case CFG.A.TRADE_STATUS:   onTradeResults(message); break;
      case CFG.A.CLOSE_OK:       onTradeResults(message); break;
      case CFG.A.TRADERS_CHOICE: onTradersChoice(message); break;
      case CFG.A.BUY:
        if (message?.trade_id != null) {
          if (fullMsg && _botNs.has(fullMsg.ns)) { _botTradeIds.add(message.trade_id); _botNs.delete(fullMsg.ns); }
          addLog('📨 buy confirmed — trade_id ' + message.trade_id, 'info');
        }
        break;
      default: break;
    }
  }

  function processDecoded(decoded) {
    if (!decoded || typeof decoded !== 'object') return;
    if (decoded.token) lastToken = decoded.token;                // top-level token (setContext / multipleAction)
    const actions = flattenActions(decoded);
    for (const a of actions) dispatch(a.action, a.message ?? a, a);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  SIGNAL ENGINE + STRATEGY
  // ══════════════════════════════════════════════════════════════════════
  function ema(values, period) {
    if (!values.length) return null;
    const k = 2 / (period + 1);
    let e = values[0];
    for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
    return e;
  }
  function rsi(values, period) {
    if (values.length <= period) return null;
    let gain = 0, loss = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    if (loss === 0) return 100;
    const rs = (gain / period) / (loss / period);
    return 100 - 100 / (1 + rs);
  }

  // generates { dir:'call'|'put'|null, conf:0-100, reasons:[] } for an asset
  function computeSignal(assetId) {
    const S = CFG.STRATEGY;
    const ser = _series.get(assetId);
    if (!ser || ser.length < S.MIN_POINTS) return { dir: null, conf: 0, reasons: ['not enough points'] };

    let callScore = 0, putScore = 0;
    const reasons = [];

    // 1) trend — EMA crossover
    const eF = ema(ser.slice(-S.EMA_SLOW * 2), S.EMA_FAST);
    const eS = ema(ser.slice(-S.EMA_SLOW * 2), S.EMA_SLOW);
    if (eF != null && eS != null && eF !== eS) {
      const diff = Math.abs(eF - eS) / eS;
      const strength = 0.5 + 0.5 * Math.min(1, diff / 0.0006);
      if (eF > eS) { callScore += strength * S.W_TREND; reasons.push('uptrend'); }
      else { putScore += strength * S.W_TREND; reasons.push('downtrend'); }
    }

    // 2) RSI — strong extremes + a light lean around 50
    const r = rsi(ser, S.RSI_PERIOD);
    if (r != null) {
      if (r <= S.RSI_OS) { callScore += S.W_RSI * (0.6 + 0.4 * (S.RSI_OS - r) / S.RSI_OS); reasons.push('RSI oversold ' + r.toFixed(0)); }
      else if (r >= S.RSI_OB) { putScore += S.W_RSI * (0.6 + 0.4 * (r - S.RSI_OB) / (100 - S.RSI_OB)); reasons.push('RSI overbought ' + r.toFixed(0)); }
      else { const lean = (r - 50) / 50; const w = Math.abs(lean) * 0.5 * S.W_RSI; if (lean < 0) callScore += w; else putScore += w; }
    }

    // 3) momentum — price change over the last ROC_LOOKBACK points
    if (ser.length > S.ROC_LOOKBACK) {
      const base = ser[ser.length - 1 - S.ROC_LOOKBACK];
      const roc = base ? (ser[ser.length - 1] - base) / base : 0;
      if (roc !== 0) {
        const strength = 0.4 + 0.6 * Math.min(1, Math.abs(roc) / 0.0006);
        if (roc > 0) { callScore += strength * S.W_MOMENTUM; reasons.push('rising momentum'); }
        else { putScore += strength * S.W_MOMENTUM; reasons.push('falling momentum'); }
      }
    }

    // 4) official crowd indicator
    const tc = _tradersChoice.get(assetId);
    if (tc) {
      const lean = (tc.call - tc.put) / 100;
      if (Math.abs(lean) > 0.05) {
        const dirCall = S.CROWD_FOLLOW ? lean > 0 : lean < 0;
        const w = Math.min(1, Math.abs(lean) * 3) * S.W_CROWD;
        if (dirCall) { callScore += w; reasons.push('crowd ' + (S.CROWD_FOLLOW ? 'with' : 'vs') + ' call'); }
        else { putScore += w; reasons.push('crowd ' + (S.CROWD_FOLLOW ? 'with' : 'vs') + ' put'); }
      }
    }

    const dir = callScore === putScore ? null : (callScore > putScore ? 'call' : 'put');
    const conf = Math.round(Math.min(100, Math.max(callScore, putScore)));
    return { dir, conf, reasons, callScore: Math.round(callScore), putScore: Math.round(putScore) };
  }

  // evaluation loop: refresh the signal and auto-fire when all gates pass
  function evaluateStrategy() {
    if (activeAssetId == null) return;
    _lastSignal = computeSignal(activeAssetId);
    if (!autoTrade || !_lastSignal.dir) return;
    const S = CFG.STRATEGY;
    if (RiskManager.isHalted()) return;
    if (nowMs() < _pauseUntil) return;
    if (_lastSignal.conf < minConfidence) return;
    if (S.ONE_TRADE && _openTrades.size > 0) return;
    if (nowMs() - _lastAutoTradeMs < S.COOLDOWN_MS) return;
    if (!tradeWS || tradeWS.readyState !== 1 || !ensureToken()) return;
    _lastAutoTradeMs = nowMs();
    addLog('🤖 auto signal: ' + (_lastSignal.dir === 'put' ? 'PUT▼' : 'CALL▲') + ' conf ' + _lastSignal.conf + '% — ' + _lastSignal.reasons.join(', '), 'signal');
    executeTrade(_lastSignal.dir, activeAssetId, null, expShift);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 8  DIAGNOSTIC LOGGER
  // ══════════════════════════════════════════════════════════════════════
  const Diag = {
    packets: [], counts: { IN: 0, OUT: 0, byAction: {} },
    record(dir, kind, sizeBytes, decodeResult) {
      if (!CFG.DIAG_ENABLED) return null;
      const method = decodeResult ? decodeResult.method : (kind === 'text' ? 'text' : 'undecoded');
      const decoded = decodeResult ? decodeResult.value : null;
      const action = decoded && typeof decoded === 'object' ? (decoded.action || null) : null;
      this.counts[dir] = (this.counts[dir] || 0) + 1;
      if (action) this.counts.byAction[action] = (this.counts.byAction[action] || 0) + 1;
      const entry = { dir, t: nowMs(), kind, action, method, size: sizeBytes || 0, decoded };
      this.packets.push(entry);
      if (this.packets.length > CFG.DIAG_MAX_PACKETS) this.packets.shift();
      if (!CFG.LOG_MUTE_ACTIONS.includes(action)) { try { renderRawLog(entry); } catch (_) {} }
      return entry;
    },
    export() { return JSON.stringify({ meta: { ua: navigator.userAgent, when: new Date().toISOString(), counts: this.counts }, packets: this.packets }, null, 2); },
    clear() { this.packets.length = 0; this.counts = { IN: 0, OUT: 0, byAction: {} }; },
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 9  WEBSOCKET INTERCEPTION
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;
  const _sockets = new Set();
  function isTradeSocket(urlStr) { return CFG.TRADE_HOST_HINTS.some(h => urlStr.includes(h)); }

  function handleIncoming(data, sizeBytes) {
    totalFrames++;
    const result = parseFrame(data);
    Diag.record('IN', typeof data === 'string' ? 'text' : 'binary', sizeBytes, result);
    if (result && result.value) processDecoded(result.value);
  }

  function attachHooks(ws, urlStr) {
    if (_sockets.has(ws)) return;
    _sockets.add(ws);
    ws._eoUrl = urlStr;
    try { ws.binaryType = 'arraybuffer'; } catch (_) {}
    const origSend = ws.send.bind(ws);

    if (isTradeSocket(urlStr)) {
      if (!tradeWS || tradeWS.readyState !== 1) { tradeWS = ws; tradeWSOrig = origSend; }
      const um = urlStr.match(/[?&](?:token|auth|access_token)=([a-f0-9]{16,64})/i);
      if (um && !lastToken) lastToken = um[1];
      addLog('🔌 trade socket: ' + urlStr.split('?')[0], 'info');
    }

    ws.send = function (data) {
      try {
        let txt = null, size = 0;
        if (typeof data === 'string') { txt = data; size = data.length; }
        else if (data instanceof ArrayBuffer) { const b = new Uint8Array(data); txt = tryUtf8(b); size = b.length; }
        else if (ArrayBuffer.isView(data)) { const b = new Uint8Array(data.buffer, data.byteOffset, data.byteLength); txt = tryUtf8(b); size = b.length; }
        const d = txt ? safeJSONParse(txt) : null;
        if (d && d.token) { lastToken = d.token; if (d.action) { tradeWS = ws; tradeWSOrig = origSend; } }  // socket carrying platform commands = confirmed trade socket
        Diag.record('OUT', typeof data === 'string' ? 'text' : 'binary', size, d ? { method: 'json', value: d } : null);
      } catch (_) {}
      return origSend(data);
    };

    ws.addEventListener('message', (ev) => {
      try {
        const d = ev.data;
        if (typeof d === 'string') handleIncoming(d, d.length);
        else if (d instanceof ArrayBuffer) handleIncoming(d, d.byteLength);
        else if (d instanceof Blob) d.arrayBuffer().then(ab => handleIncoming(ab, ab.byteLength)).catch(() => {});
        else if (ArrayBuffer.isView(d)) handleIncoming(d.buffer, d.byteLength);
      } catch (_) {}
    });
    ws.addEventListener('open', () => { wsConnected = true; addLog('✅ connection open', 'info'); });
    ws.addEventListener('close', () => { if (ws === tradeWS) tradeWS = null; _sockets.delete(ws); });
  }

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); try { attachHooks(ws, String(args[0] || '')); } catch (_) {} return ws; },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 10  TRADE ENGINE  (verified buyOption format)
  // ══════════════════════════════════════════════════════════════════════
  function buildOpenPayload(direction, assetId, amount, expSeconds, ns) {
    return JSON.stringify({
      action: 'buyOption',
      message: {
        type            : direction === 'put' ? 'put' : 'call',
        amount          : amount,
        assetid         : assetId,                 // lowercase (confirmed from traffic)
        strike_time     : nowSec(),
        is_demo         : isDemo,
        expiration_shift: expSeconds,
        ratePosition    : 0,
      },
      token: lastToken,
      ns   : ns != null ? ns : nextNs(),
    });
  }

  // token discovery — independent of catching a rare outgoing frame
  const _TOKEN_RE = /^[a-f0-9]{16,64}$/i;
  function discoverToken() {
    try { for (const ws of _sockets) { const m = String(ws._eoUrl || '').match(/[?&](?:token|auth|access_token)=([a-f0-9]{16,64})/i); if (m) return m[1]; } } catch (_) {}
    for (const store of [W.localStorage, W.sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i), v = store.getItem(k);
          if (!v) continue;
          if (/token|auth|access/i.test(k) && _TOKEN_RE.test(v)) return v;
          if (v[0] === '{' || v[0] === '[') { try { const o = JSON.parse(v); const t = o.token || o.access_token || o.authToken || o.authtoken || o.api_token; if (typeof t === 'string' && _TOKEN_RE.test(t)) return t; } catch (_) {} }
        }
      } catch (_) {}
    }
    try { const m = String(document.cookie).match(/(?:token|auth|access_token)=([a-f0-9]{16,64})/i); if (m) return m[1]; } catch (_) {}
    return null;
  }
  function ensureToken() { if (!lastToken) { const t = discoverToken(); if (t) { lastToken = t; addLog('🔑 token auto-discovered', 'info'); } } return lastToken; }

  // direction: 'call' (up) or 'put' (down); amount null → risk-managed sizing
  function executeTrade(direction, assetId, amount, expSeconds) {
    const aid = assetId != null ? assetId : activeAssetId;
    if (aid == null) { addLog('⚠️ no active asset — open an asset chart first', 'error'); return false; }
    if (RiskManager.isHalted()) { addLog('🛑 risk halt active — resume to trade', 'error'); return false; }
    if (nowMs() < _pauseUntil) { addLog('⛔ loss-streak pause active (' + Math.ceil((_pauseUntil - nowMs()) / 1000) + 's left)', 'error'); return false; }
    if (!tradeWS || tradeWS.readyState !== 1) { addLog('⚠️ no open trade socket (state=' + (tradeWS ? tradeWS.readyState : 'null') + ')', 'error'); return false; }
    if (!ensureToken()) { addLog('⚠️ token not found — switch asset/timeframe once to capture it', 'error'); return false; }
    const amt = amount != null ? amount : RiskManager.size();
    const exp = expSeconds || expShift;
    const ns = nextNs();
    _botNs.add(ns);
    const payload = buildOpenPayload(direction, aid, amt, exp, ns);
    try {
      tradeWS.send(new TextEncoder().encode(payload));   // through the hook → logged in traffic for verification
      addLog('⚡ sent: ' + (direction === 'put' ? 'PUT▼' : 'CALL▲') + ' | ' + symOf(aid) + ' | $' + amt + ' | ' + exp + 's | token✓ | ns=' + ns, 'signal');
      showSignalPopup({ direction: direction === 'put' ? 'put' : 'call', asset: symOf(aid), price: _lastPrice.get(aid) || 0, confidence: _lastSignal.conf || 0, durationSec: exp });
      return true;
    } catch (e) { addLog('❌ send failed: ' + e.message, 'error'); return false; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 11  UI — Control Panel
  // ══════════════════════════════════════════════════════════════════════
  let _ui = null, _body = null, _logEl = null, _rawEl = null, _hudEl = null, _sigEl = null, _restoreBtn = null, _autoBtn = null, _riskChk = null;
  const LS_KEY = 'eo_engine_ui_v1';
  let _uiState = { left: null, top: null, w: 520, h: null, collapsed: false, hidden: false, opacity: 1 };
  function loadUIState() { try { Object.assign(_uiState, JSON.parse(W.localStorage.getItem(LS_KEY)) || {}); } catch (_) {} }
  function saveUIState() { try { W.localStorage.setItem(LS_KEY, JSON.stringify(_uiState)); } catch (_) {} }

  function addLog(msg, type) {
    if (!_logEl) { try { console.log('[EO-ENGINE]', msg); } catch (_) {} return; }
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
    const body = entry.decoded ? JSON.stringify(entry.decoded.message ?? entry.decoded).slice(0, 260) : '';
    row.textContent = entry.dir + ' ' + fmtTime(entry.t) + ' ' + entry.size + 'B [' + (entry.action || entry.method) + '] ' + body;
    row.title = entry.decoded ? JSON.stringify(entry.decoded, null, 1).slice(0, 3000) : '';
    _rawEl.insertBefore(row, _rawEl.firstChild);
    while (_rawEl.childNodes.length > 300) _rawEl.removeChild(_rawEl.lastChild);
  }
  function updateHud() {
    if (!_hudEl) return;
    const tc = activeAssetId != null ? _tradersChoice.get(activeAssetId) : null;
    const sent = tc ? ('▲' + tc.call + '% / ▼' + tc.put + '%') : '—';
    const price = activeAssetId != null ? _lastPrice.get(activeAssetId) : null;
    const asset = activeAssetId != null ? _assetsById.get(activeAssetId) : null;
    const ageMs = _lastTickMs ? (nowMs() - _lastTickMs) : null;
    const ageSec = ageMs != null ? Math.round(ageMs / 1000) : null;
    const live = ageMs == null ? '⚪ waiting' : (ageMs < 3000 ? '🟢 live' : (ageMs < 10000 ? '🟡 slow ' + ageSec + 's' : '🔴 stalled ' + ageSec + 's'));
    const rs = RiskManager.status();
    const riskTag = rs.halted ? '🛑 HALTED' : (nowMs() < _pauseUntil ? '⏸ paused' : '🛡️ ' + rs.pnlPct);
    _hudEl.innerHTML =
      '<b style="color:#33ddaa">EO-ENGINE v1.0</b> ' + (wsConnected ? '🟢' : '🔴') +
      ' | <b>' + (activeAssetId != null ? symOf(activeAssetId) : '—') + '</b>' +
      ' @ <b>' + (price != null ? price.toFixed(asset?.digits || 5) : '—') + '</b>' +
      ' | payout ' + (asset?.profit ?? '—') + '%' +
      ' | crowd ' + sent +
      '<br><span style="color:#9ab;font-size:10px">' + live +
      ' | balance: <b>' + (curBalance() ?? '—') + '</b> (' + (isDemo ? 'demo' : 'real') + ')' +
      ' | risk ' + riskTag + ' | next $' + rs.nextSize +
      ' | token ' + (lastToken ? '🔑' : '❌') +
      ' | socket ' + (tradeWS && tradeWS.readyState === 1 ? '✓' : '✗') +
      ' | ticks ' + totalTicks + ' | open ' + _openTrades.size + '</span>';
    renderSignal();
  }
  function renderSignal() {
    if (!_sigEl) return;
    const sg = _lastSignal || { dir: null, conf: 0, reasons: [] };
    const arrow = sg.dir === 'call' ? '<span style="color:#33dd88">▲ CALL</span>' : sg.dir === 'put' ? '<span style="color:#ff5577">▼ PUT</span>' : '<span style="color:#778">— neutral</span>';
    const bar = sg.conf >= minConfidence ? '#33dd88' : '#667';
    const wr = (st) => st.trades ? Math.round(st.wins / st.trades * 100) + '%' : '—';
    _sigEl.innerHTML =
      '🧭 signal: ' + arrow + ' <b style="color:' + bar + '">' + sg.conf + '%</b>' +
      ' <span style="color:#778;font-size:10px">(min ' + minConfidence + '%)</span>' +
      (sg.reasons && sg.reasons.length ? ' <span style="color:#9ab;font-size:10px">— ' + sg.reasons.join(', ') + '</span>' : '') +
      '<br><span style="color:#9ab;font-size:10px">📊 bot: ' + BOT.trades + ' | win ' + wr(BOT) + ' (' + BOT.wins + 'W/' + BOT.losses + 'L) | P/L $' + BOT.pnl.toFixed(2) +
      '  •  all: ' + STATS.trades + ' | win ' + wr(STATS) + ' | streak ' + (STATS.lossStreak ? STATS.lossStreak + 'L' : STATS.winStreak + 'W') + '</span>';
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

  function syncAutoBtn() {
    if (!_autoBtn) return;
    _autoBtn.textContent = '🤖 auto: ' + (autoTrade ? 'ON ✅' : 'OFF');
    _autoBtn.style.background = autoTrade ? '#1f4d2e' : '#1a1a33';
  }

  function buildUI() {
    if (!CFG.UI_ENABLED || _ui) return;
    loadUIState();

    _ui = document.createElement('div');
    _ui.style.cssText = 'position:fixed;top:8px;right:8px;width:520px;min-width:280px;min-height:0;max-height:92vh;z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;resize:both;background:#0d0d18;border:1px solid #2a2a44;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.6);font-family:system-ui,sans-serif;color:#ccd';

    // ─── title bar (drag handle + window buttons) ───
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:#1a1a3a;cursor:move;border-bottom:1px solid #2a2a44;user-select:none';
    const title = document.createElement('span'); title.innerHTML = '🛰️ <b>EO-ENGINE</b> <span style="color:#667;font-size:10px">v1.0</span>'; title.style.cssText = 'font:12px sans-serif;color:#cce';
    const ctrls = document.createElement('div'); ctrls.style.cssText = 'display:flex;gap:4px';
    ctrls.append(
      mkWinBtn('🌓', cycleOpacity, 'opacity'),
      mkWinBtn('▁', toggleCollapse, 'collapse/expand'),
      mkWinBtn('✕', hidePanel, 'hide (Alt+S to show)'),
    );
    bar.append(title, ctrls);

    // ─── body (hidden when collapsed) ───
    _body = document.createElement('div');
    _body.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;min-height:0';
    _hudEl = document.createElement('div'); _hudEl.style.cssText = 'flex:0 0 auto;padding:6px 8px;font:11px monospace;border-bottom:1px solid #2a2a44;background:#11112a';
    const tabs = document.createElement('div'); tabs.style.cssText = 'flex:0 0 auto;display:flex;gap:4px;padding:4px 6px;border-bottom:1px solid #2a2a44;flex-wrap:wrap';
    _logEl = document.createElement('div'); _logEl.style.cssText = 'flex:1 1 35%;min-height:34px;overflow:auto;background:#0a0a14';
    _rawEl = document.createElement('div'); _rawEl.style.cssText = 'flex:1 1 45%;min-height:34px;overflow:auto;background:#08080f;border-top:1px solid #2a2a44';

    tabs.append(
      mkBtn('▲ CALL', () => executeTrade('call'), 'open an up trade'),
      mkBtn('▼ PUT', () => executeTrade('put'), 'open a down trade'),
      mkBtn('📈 candles', () => { const i = CFG.LOG_MUTE_ACTIONS.indexOf('candles'); if (i >= 0) { CFG.LOG_MUTE_ACTIONS.splice(i, 1); addLog('📈 showing candle stream in the log', 'info'); } else { CFG.LOG_MUTE_ACTIONS.push('candles'); addLog('📉 muted candle stream', 'info'); } }, 'show/mute the price stream in the log'),
      mkBtn('📋 summary', () => { navigator.clipboard?.writeText(JSON.stringify({ byAction: Diag.counts.byAction, risk: RiskManager.status(), stats: STATS }, null, 2)); addLog('📋 summary copied', 'info'); }),
      mkBtn('⬇️ export', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Diag.export()], { type: 'application/json' })); a.download = 'eo_traffic_' + Date.now() + '.json'; a.click(); addLog('⬇️ exported ' + Diag.packets.length + ' packets', 'info'); }),
      mkBtn('🗑️ clear', () => { Diag.clear(); if (_rawEl) _rawEl.innerHTML = ''; addLog('🗑️ cleared', 'info'); }),
      mkBtn('▶️ resume', () => RiskManager.resume(), 'manually resume after a risk halt'),
    );

    // ─── control row: amount + duration + confidence + risk + auto ───
    const ctrlRow = document.createElement('div'); ctrlRow.style.cssText = 'flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:4px 6px;border-bottom:1px solid #2a2a44;background:#0f0f22;flex-wrap:wrap;font:11px sans-serif;color:#9ab';
    const mkNum = (label, val, fn, w) => { const wrap = document.createElement('label'); wrap.style.cssText = 'display:flex;align-items:center;gap:3px'; const inp = document.createElement('input'); inp.type = 'number'; inp.value = val; inp.min = '1'; inp.style.cssText = 'width:' + (w || 46) + 'px;background:#1a1a33;color:#cce;border:1px solid #33335a;border-radius:4px;padding:2px 4px;font:11px monospace'; inp.onchange = () => fn(parseFloat(inp.value)); wrap.append(document.createTextNode(label), inp); return wrap; };
    ctrlRow.append(
      mkNum('💵', tradeAmount, v => { if (v > 0) { tradeAmount = v; addLog('💵 manual amount: $' + v, 'info'); } }),
      mkNum('⏱️', expShift, v => { if (v > 0) { expShift = v; addLog('⏱️ duration: ' + v + 's', 'info'); } }),
    );
    // risk-based sizing toggle
    const riskWrap = document.createElement('label'); riskWrap.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer';
    _riskChk = document.createElement('input'); _riskChk.type = 'checkbox'; _riskChk.checked = CFG.RISK_PCT_ENABLED;
    _riskChk.onchange = () => { CFG.RISK_PCT_ENABLED = _riskChk.checked; addLog('🛡️ risk sizing: ' + (CFG.RISK_PCT_ENABLED ? 'ON (' + Math.round(CFG.RISK_PCT * 100) + '% of balance)' : 'OFF (manual amount)'), 'info'); };
    riskWrap.append(_riskChk, document.createTextNode('🛡️ ' + Math.round(CFG.RISK_PCT * 100) + '%'));
    ctrlRow.append(riskWrap);

    const confWrap = document.createElement('label'); confWrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1 1 120px';
    const confSlider = document.createElement('input'); confSlider.type = 'range'; confSlider.min = '40'; confSlider.max = '90'; confSlider.value = String(minConfidence); confSlider.style.cssText = 'flex:1';
    const confVal = document.createElement('span'); confVal.textContent = minConfidence + '%'; confVal.style.cssText = 'font:11px monospace;color:#cce;min-width:34px';
    confSlider.oninput = () => { minConfidence = parseInt(confSlider.value, 10); confVal.textContent = minConfidence + '%'; };
    confWrap.append(document.createTextNode('🎯'), confSlider, confVal);
    _autoBtn = mkBtn('🤖 auto: OFF', () => {
      autoTrade = !autoTrade;
      syncAutoBtn();
      addLog(autoTrade ? '🤖 auto-trading ON — min confidence ' + minConfidence + '%' : '🤖 auto-trading OFF', autoTrade ? 'signal' : 'info');
    }, 'toggle auto-trading');
    ctrlRow.append(confWrap, _autoBtn);

    // ─── live signal row ───
    _sigEl = document.createElement('div'); _sigEl.style.cssText = 'flex:0 0 auto;padding:5px 8px;font:11px monospace;border-bottom:1px solid #2a2a44;background:#0c0c1c';

    const rawHdr = document.createElement('div'); rawHdr.style.cssText = 'flex:0 0 auto;padding:3px 8px;font:10px monospace;color:#778;background:#11111e;border-top:1px solid #2a2a44';
    rawHdr.textContent = '── RAW WS LOG (candles/ping muted — scroll for details) ──';

    _body.append(_hudEl, _sigEl, ctrlRow, tabs, _logEl, rawHdr, _rawEl);
    _ui.append(bar, _body);
    document.documentElement.appendChild(_ui);

    // ─── floating restore button after hiding ───
    _restoreBtn = document.createElement('div');
    _restoreBtn.textContent = '🛰️'; _restoreBtn.title = 'show EO-ENGINE';
    _restoreBtn.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:2147483647;width:36px;height:36px;border-radius:50%;background:#1a1a3a;border:1px solid #3a3a66;color:#cce;font-size:17px;line-height:36px;text-align:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.6);display:none';
    _restoreBtn.onclick = showPanel;
    document.documentElement.appendChild(_restoreBtn);

    makeDraggable(bar);
    if (typeof W.ResizeObserver === 'function') {
      new W.ResizeObserver(() => { if (!_uiState.collapsed && _ui.style.display !== 'none') { _uiState.w = _ui.offsetWidth; _uiState.h = _ui.offsetHeight; saveUIState(); } }).observe(_ui);
    }
    W.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); _uiState.hidden ? showPanel() : hidePanel(); } });

    applyUIState();
    syncAutoBtn();
    buildSignalOrb();
    updateHud();
    addLog('🛰️ EO-ENGINE v1.0 ready — drag the top bar to move, ✕ to hide (Alt+S)', 'signal');
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 12  SIGNAL ORB — liquid-glass signal + win/loss popup
  // ══════════════════════════════════════════════════════════════════════
  let _orb = null, _orbTimer = null, _orbHideTimer = null;
  function buildSignalOrb() {
    if (_orb || !CFG.POPUP_ENABLED) return;
    const css = document.createElement('style');
    css.textContent = `
      #eoOrb{position:fixed;top:72px;right:14px;width:160px;z-index:2147483647;cursor:grab;user-select:none;opacity:0;pointer-events:none;transition:opacity .35s ease;font-family:system-ui,-apple-system,sans-serif;}
      #eoOrb.visible{opacity:1;pointer-events:auto;}
      #eoOrb:active{cursor:grabbing;}
      .eo-sphere{position:relative;width:160px;height:160px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
        background:radial-gradient(circle at 38% 30%,rgba(255,255,255,.10),rgba(13,13,24,.92) 60%);
        border:1px solid rgba(60,90,120,.4);box-shadow:inset 0 2px 8px rgba(255,255,255,.05),inset 0 -6px 16px rgba(0,0,0,.55),0 0 26px rgba(0,150,230,.18);
        transition:box-shadow .4s,border-color .4s;}
      .eo-ambient{position:absolute;inset:-14px;border-radius:50%;filter:blur(18px);opacity:.6;animation:eoBreath 3.5s ease-in-out infinite;z-index:-1;
        background:radial-gradient(circle,rgba(0,200,255,.6),rgba(0,100,200,.25) 55%,transparent 75%);transition:background .5s;}
      .eo-ring{position:absolute;inset:-4px;border-radius:50%;animation:eoSpin 5s linear infinite;
        background:conic-gradient(from 0deg,rgba(0,200,255,.9),rgba(0,140,255,.35) 25%,transparent 50%,transparent 75%,rgba(0,200,255,.9));
        -webkit-mask:radial-gradient(circle,transparent calc(100% - 3px),#000 calc(100% - 2px));mask:radial-gradient(circle,transparent calc(100% - 3px),#000 calc(100% - 2px));transition:background .4s;}
      #eoOrb.buy .eo-ambient{background:radial-gradient(circle,rgba(70,217,142,.75),rgba(0,180,90,.3) 55%,transparent 75%);}
      #eoOrb.sell .eo-ambient{background:radial-gradient(circle,rgba(220,38,38,.75),rgba(180,0,0,.3) 55%,transparent 75%);}
      #eoOrb.win .eo-ambient{background:radial-gradient(circle,rgba(70,217,142,.9),rgba(0,180,90,.4) 55%,transparent 75%);}
      #eoOrb.loss .eo-ambient{background:radial-gradient(circle,rgba(220,38,38,.9),rgba(180,0,0,.4) 55%,transparent 75%);}
      #eoOrb.buy .eo-ring,#eoOrb.win .eo-ring{background:conic-gradient(from 0deg,rgba(70,217,142,.9),rgba(0,255,140,.35) 25%,transparent 50%,transparent 75%,rgba(70,217,142,.9));}
      #eoOrb.sell .eo-ring,#eoOrb.loss .eo-ring{background:conic-gradient(from 0deg,rgba(220,38,38,.9),rgba(255,80,80,.35) 25%,transparent 50%,transparent 75%,rgba(220,38,38,.9));}
      #eoOrb.buy .eo-sphere,#eoOrb.win .eo-sphere{border-color:rgba(70,217,142,.45);box-shadow:inset 0 2px 8px rgba(70,217,142,.08),inset 0 -6px 16px rgba(0,0,0,.5),0 0 30px rgba(70,217,142,.25);}
      #eoOrb.sell .eo-sphere,#eoOrb.loss .eo-sphere{border-color:rgba(220,38,38,.45);box-shadow:inset 0 2px 8px rgba(220,38,38,.08),inset 0 -6px 16px rgba(0,0,0,.5),0 0 30px rgba(220,38,38,.25);}
      .eo-arrow{font-size:24px;line-height:1;filter:drop-shadow(0 0 8px currentColor);}
      .eo-dir{font-size:18px;font-weight:900;letter-spacing:3px;font-family:ui-monospace,monospace;}
      .eo-conf{font-size:13px;font-weight:900;color:rgba(255,255,255,.9);font-family:ui-monospace,monospace;}
      .eo-asset{font-size:9px;font-weight:600;color:rgba(180,210,240,.75);letter-spacing:.4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .eo-count{font-size:10px;color:rgba(180,210,240,.6);font-family:ui-monospace,monospace;}
      .eo-x{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(10,18,34,.85);border:1px solid rgba(60,80,100,.6);color:rgba(140,170,200,.85);font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;line-height:1;}
      .eo-x:hover{background:rgba(220,38,38,.3);color:#ff6b6b;}
      @keyframes eoSpin{to{transform:rotate(360deg);}}
      @keyframes eoBreath{0%,100%{transform:scale(1);opacity:.5;}50%{transform:scale(1.08);opacity:.75;}}
    `;
    (document.head || document.documentElement).appendChild(css);

    _orb = document.createElement('div');
    _orb.id = 'eoOrb';
    _orb.innerHTML =
      '<div class="eo-ambient"></div><div class="eo-ring"></div>' +
      '<div class="eo-sphere">' +
        '<div class="eo-x" id="eoOrbX">✕</div>' +
        '<div class="eo-arrow" id="eoOrbArrow">▲</div>' +
        '<div class="eo-dir" id="eoOrbDir">CALL</div>' +
        '<div class="eo-conf" id="eoOrbConf">0%</div>' +
        '<div class="eo-asset" id="eoOrbAsset">—</div>' +
        '<div class="eo-count" id="eoOrbCount"></div>' +
      '</div>';
    document.documentElement.appendChild(_orb);
    document.getElementById('eoOrbX').addEventListener('click', (e) => { e.stopPropagation(); hideOrb(); });

    // drag (pointer events — touch + mouse)
    let drag = false, ox = 0, oy = 0, sx = 0, sy = 0;
    _orb.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'eoOrbX') return;
      drag = true; ox = _orb.offsetLeft; oy = _orb.offsetTop; sx = e.clientX; sy = e.clientY;
      try { _orb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    _orb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const nx = Math.max(0, Math.min(W.innerWidth - 170, ox + e.clientX - sx));
      const ny = Math.max(0, Math.min(W.innerHeight - 200, oy + e.clientY - sy));
      _orb.style.left = nx + 'px'; _orb.style.top = ny + 'px'; _orb.style.right = 'auto';
    });
    _orb.addEventListener('pointerup', () => { drag = false; });
    _orb.addEventListener('pointercancel', () => { drag = false; });
  }

  function _setOrbState(state) { if (_orb) _orb.className = state ? state : ''; }
  function hideOrb() {
    if (!_orb) return;
    _orb.classList.remove('visible');
    if (_orbTimer) { clearInterval(_orbTimer); _orbTimer = null; }
    if (_orbHideTimer) { clearTimeout(_orbHideTimer); _orbHideTimer = null; }
  }

  // signal popup (a trade was sent)
  function showSignalPopup(opts) {
    if (!CFG.POPUP_ENABLED || !_orb) return;
    const isBuy = opts.direction === 'call';
    _setOrbState(isBuy ? 'buy' : 'sell');
    _orb.classList.add('visible');
    const arrow = document.getElementById('eoOrbArrow'); arrow.textContent = isBuy ? '▲' : '▼'; arrow.style.color = isBuy ? '#46d98e' : '#ff4d4d';
    document.getElementById('eoOrbDir').textContent = isBuy ? 'CALL' : 'PUT';
    document.getElementById('eoOrbConf').textContent = (opts.confidence || 0) + '%';
    document.getElementById('eoOrbAsset').textContent = (opts.asset || '—');
    try { if (W.navigator.vibrate) W.navigator.vibrate([60, 30, 60]); } catch (_) {}

    const durSec = opts.durationSec || expShift;
    const closeAt = nowMs() + durSec * 1000;
    if (_orbTimer) clearInterval(_orbTimer);
    const countEl = document.getElementById('eoOrbCount');
    _orbTimer = setInterval(() => {
      const remain = Math.max(0, Math.ceil((closeAt - nowMs()) / 1000));
      if (countEl) countEl.textContent = remain >= 60 ? Math.floor(remain / 60) + ':' + String(remain % 60).padStart(2, '0') : remain + 's';
      if (remain <= 0 && _orbTimer) { clearInterval(_orbTimer); _orbTimer = null; }
    }, 250);

    if (_orbHideTimer) clearTimeout(_orbHideTimer);
    _orbHideTimer = setTimeout(hideOrb, (durSec + 1) * 1000);
  }

  // win/loss/halt result popup
  function showResultPopup(win, label, detail) {
    if (!CFG.POPUP_ENABLED || !_orb) return;
    _setOrbState(win === false ? 'loss' : (win === true ? 'win' : 'sell'));
    _orb.classList.add('visible');
    const arrow = document.getElementById('eoOrbArrow'); arrow.textContent = win === true ? '✅' : (win === false ? '❌' : '⚠️'); arrow.style.color = win === false ? '#ff4d4d' : '#46d98e';
    document.getElementById('eoOrbDir').textContent = label;
    document.getElementById('eoOrbConf').textContent = '';
    document.getElementById('eoOrbAsset').textContent = detail || '';
    document.getElementById('eoOrbCount').textContent = '';
    try { if (W.navigator.vibrate) W.navigator.vibrate(win === false ? [120, 40, 120] : [40, 20, 40, 20, 80]); } catch (_) {}
    if (_orbTimer) { clearInterval(_orbTimer); _orbTimer = null; }
    if (_orbHideTimer) clearTimeout(_orbHideTimer);
    _orbHideTimer = setTimeout(hideOrb, 4000);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 13  BOOT
  // ══════════════════════════════════════════════════════════════════════
  function boot() { if (document.documentElement) buildUI(); else W.addEventListener('DOMContentLoaded', buildUI, { once: true }); }
  if (document.readyState === 'loading') W.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();

  setIntervalT(() => { ensureToken(); }, 3000);   // periodically try to discover the token before the first trade
  setIntervalT(evaluateStrategy, 1000);            // evaluate signal / auto-trade every second
  setIntervalT(updateHud, 1000);

  // ─── public console API ───
  W.__EO = {
    CFG, Diag, executeTrade, computeSignal, discoverToken, ensureToken,
    risk: () => RiskManager.status(), resumeRisk: () => RiskManager.resume(),
    state: () => ({ activeAsset: activeAssetId != null ? symOf(activeAssetId) : null, assetId: activeAssetId, wsConnected, totalTicks, totalFrames, balance: curBalance(), isDemo, openTrades: _openTrades.size, assets: _assetsById.size, hasToken: !!lastToken, token: lastToken }),
    signal: () => _lastSignal, stats: () => ({ all: STATS, bot: BOT }),
    setAuto: (on) => { autoTrade = !!on; syncAutoBtn(); }, setAmount: (v) => { tradeAmount = v; }, setExp: (v) => { expShift = v; }, setMinConf: (v) => { minConfidence = v; },
    assets: () => _assetsById, trades: () => _openTrades, tradersChoice: () => _tradersChoice, price: (id) => _lastPrice.get(id ?? activeAssetId),
  };

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
