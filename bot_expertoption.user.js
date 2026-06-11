// ==UserScript==
// @name         🛰️ EXPERTOPTION_ENGINE — WS Interceptor + Protocol Decoder + Trade Engine + Risk Guard + Signal Orb
// @namespace    expertoption-trade-engine
// @version      1.2.0
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
  const _buyTemplates  = { call: null, put: null, _any: null };   // real buyOption message learned from manual trades

  // ─── stats / streak ───
  const STATS = { trades: 0, wins: 0, losses: 0, pnl: 0, lossStreak: 0, winStreak: 0, bestStreak: 0 };
  const BOT   = { trades: 0, wins: 0, losses: 0, pnl: 0, lossStreak: 0, winStreak: 0 };
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
    // STATS = every trade observed on the account (manual taps included) — informational only
    STATS.trades++; STATS.pnl += resultAmount;
    if (win) { STATS.wins++; STATS.winStreak++; STATS.lossStreak = 0; if (STATS.winStreak > STATS.bestStreak) STATS.bestStreak = STATS.winStreak; }
    else { STATS.losses++; STATS.lossStreak++; STATS.winStreak = 0; }

    // the streak guard reacts ONLY to the bot's own trades — a human trading manually
    // on the platform must never pause or halt the bot.
    if (isBot) {
      BOT.trades++; BOT.pnl += resultAmount;
      if (win) { BOT.wins++; BOT.winStreak++; BOT.lossStreak = 0; }
      else {
        BOT.losses++; BOT.lossStreak++; BOT.winStreak = 0;
        if (BOT.lossStreak >= CFG.STREAK_HALT_LOSSES) RiskManager.halt(BOT.lossStreak + ' consecutive bot losses');
        else if (BOT.lossStreak >= CFG.STREAK_PAUSE_LOSSES) {
          _pauseUntil = nowMs() + CFG.STREAK_PAUSE_MS;
          addLog('⛔ [STREAK] ' + BOT.lossStreak + ' consecutive bot losses — paused ' + (CFG.STREAK_PAUSE_MS / 1000) + 's', 'error');
        }
      }
    }
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
        if (d && d.action === 'buyOption' && !(d.ns != null && _botNs.has(d.ns))) learnBuyTemplate(d);     // learn the real format from manual trades (not the bot's own)
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
  // detect the direction encoded in a real outgoing buyOption message
  function detectDir(m) {
    for (const k in m) { const v = m[k]; if (v === 'call') return 'call'; if (v === 'put') return 'put'; }
    if (m.type === CFG.TYPE_CALL) return 'call';
    if (m.type === CFG.TYPE_PUT) return 'put';
    return null;
  }
  // learn the exact buyOption format from a manual (non-bot) trade so the bot can replay it verbatim
  function learnBuyTemplate(d) {
    const m = d && d.message;
    if (!m || typeof m !== 'object') return;
    const dir = detectDir(m);
    const copy = JSON.parse(JSON.stringify(m));
    if (dir) {
      if (!_buyTemplates[dir]) addLog('📐 learned the real buyOption format from your manual ' + dir.toUpperCase() + ' — the bot will now replay it exactly', 'signal');
      _buyTemplates[dir] = copy;
    } else {
      _buyTemplates._any = copy;
    }
  }

  function buildOpenPayload(direction, assetId, amount, expSeconds, ns) {
    const tpl = _buyTemplates[direction] || _buyTemplates._any;
    let message;
    if (tpl) {
      // replay the real platform format, overriding only amount / asset / demo-flag / strike-time
      message = JSON.parse(JSON.stringify(tpl));
      for (const k in message) {
        const v = message[k];
        if (/amount|sum|invest|bet/i.test(k) && typeof v === 'number') message[k] = amount;
        else if (/asset/i.test(k)) message[k] = assetId;
        else if (/is_?demo|^demo$/i.test(k)) message[k] = isDemo;
        else if (/strike_?time|exp_?time|expire|^time$/i.test(k) && typeof v === 'number' && v > 1e9) message[k] = nowSec();
      }
    } else {
      // fallback format (used until the bot has seen one manual trade to learn from)
      message = {
        type            : direction === 'put' ? 'put' : 'call',
        amount          : amount,
        assetid         : assetId,                 // lowercase (confirmed from traffic)
        strike_time     : nowSec(),
        is_demo         : isDemo,
        expiration_shift: expSeconds,
        ratePosition    : 0,
      };
    }
    return JSON.stringify({ action: 'buyOption', message, token: lastToken, ns: ns != null ? ns : nextNs() });
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
  // § 11  UI — QUANTUM panel (faithful port of the original injected design)
  // ══════════════════════════════════════════════════════════════════════
  let _uiMounted = false;
  let _logSeq = 0, _logPaused = false, _logFilter = 'all';
  const _logEntries = [];
  const LS_KEY = 'eo_engine_ui_v1';
  let _panelOpen = false;
  const $ = (id) => document.getElementById(id);

  const HUD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');
  #cbRoot{position:fixed;bottom:16px;left:16px;z-index:2147483647;font-family:'IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,sans-serif;direction:rtl;}
  #cbIcon{width:50px;height:50px;border-radius:15px;background:linear-gradient(145deg,#13212e,#0c1a16);border:1.5px solid #2a4a3c;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,0.5),0 0 18px rgba(0,210,100,0.25);transition:all 0.2s ease;animation:cbBorderGlow 6s ease-in-out infinite;}
  #cbIcon:hover{transform:scale(1.08);}
  #cbIcon.buy{border-color:#86EFAC;box-shadow:0 4px 18px rgba(22,163,74,0.4);}
  #cbIcon.sell{border-color:#FCA5A5;box-shadow:0 4px 18px rgba(220,38,38,0.4);}
  #cbIconSig{font-size:20px;}
  #cbIconDot{width:6px;height:6px;border-radius:50%;background:#33485a;margin-top:3px;transition:background 0.3s;}
  #cbIconDot.on{background:#16A34A;box-shadow:0 0 8px rgba(0,210,100,0.7);}
  @keyframes cbGradFlow{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}
  @keyframes cbBorderGlow{0%,100%{box-shadow:0 8px 40px rgba(0,0,0,0.5),0 0 22px rgba(0,210,100,0.18),inset 0 0 0 1px rgba(0,210,100,0.10);}50%{box-shadow:0 8px 44px rgba(0,0,0,0.55),0 0 30px rgba(0,170,255,0.22),inset 0 0 0 1px rgba(0,170,255,0.14);}}
  @keyframes cbWmFloat{0%{transform:translate(-50%,-50%) rotate(-18deg) scale(1);opacity:0.05;}50%{transform:translate(-50%,-54%) rotate(-18deg) scale(1.08);opacity:0.09;}100%{transform:translate(-50%,-50%) rotate(-18deg) scale(1);opacity:0.05;}}
  #cbPanel{position:fixed;bottom:76px;left:8px;width:300px;background:linear-gradient(165deg,#0d1722 0%,#0a1219 60%,#0c1a16 100%);border:1px solid #243443;border-radius:20px;display:none;flex-direction:column;overflow:hidden;max-height:calc(100svh - 120px);touch-action:none;z-index:2147483647;animation:cbBorderGlow 6s ease-in-out infinite;}
  #cbPanel::before{content:'⚡ QUANTUM';position:absolute;top:50%;left:50%;font-size:54px;font-weight:900;letter-spacing:2px;color:transparent;background:linear-gradient(90deg,#00d264,#00aaff,#9b5cff,#00d264);-webkit-background-clip:text;background-clip:text;white-space:nowrap;pointer-events:none;z-index:0;animation:cbWmFloat 9s ease-in-out infinite;}
  #cbScrollArea,.cb-hdr,#cbStatus{position:relative;z-index:1;}
  #cbPanel.open{display:flex;}
  #cbPanel.minimized #cbScrollArea,#cbPanel.minimized #cbStatus{display:none;}
  @media(max-width:480px){#cbPanel{width:calc(100vw - 16px);left:8px;bottom:72px;max-height:calc(100svh - 130px);}}
  .cb-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:grab;flex-shrink:0;background:linear-gradient(100deg,#11202c,#0e2b22);border-bottom:1px solid #243443;border-radius:20px 20px 0 0;}
  .cb-hdr:active{cursor:grabbing;}
  .cb-hdr-dot{width:8px;height:8px;border-radius:50%;background:#56707f;flex-shrink:0;transition:background 0.3s;}
  .cb-hdr-dot.on{background:#00d264;box-shadow:0 0 0 3px rgba(0,210,100,0.18),0 0 12px rgba(0,210,100,0.6);}
  .cb-ttl{font-size:12px;font-weight:800;letter-spacing:0.6px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(90deg,#00d264,#3fe0ff,#9b8cff,#00d264);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cbGradFlow 5s linear infinite;}
  .cb-hdr-actions{display:flex;gap:4px;flex-shrink:0;}
  .cb-icon-btn{width:24px;height:24px;border-radius:8px;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;font-family:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
  .cb-icon-btn:hover{background:#3a1a1a;border-color:#FCA5A5;color:#DC2626;}
  #cbScrollArea{overflow-y:auto;flex:1;background:#0c151c;}
  #cbScrollArea::-webkit-scrollbar{width:3px;}
  #cbScrollArea::-webkit-scrollbar-thumb{background:#33485a;border-radius:3px;}
  .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:10px 10px 0;}
  .cb-marquee{margin:8px 10px 0;overflow:hidden;white-space:nowrap;background:linear-gradient(90deg,#0c1620,#16222e,#0c1620);border:1px solid #243443;border-radius:9px;height:24px;line-height:24px;position:relative;box-shadow:inset 0 0 8px rgba(0,0,0,0.4);}
  .cb-marquee-track{display:inline-block;padding-left:100%;animation:cbMarq 22s linear infinite;font-size:11px;font-weight:700;}
  .cb-marquee:hover .cb-marquee-track{animation-play-state:paused;}
  .cb-marq-item{display:inline-block;margin:0 14px;}
  .cb-marq-otc{color:#00d264;}.cb-marq-pay{color:#ffd24a;}.cb-marq-sep{color:#3a4d5e;margin:0 2px;}
  @keyframes cbMarq{0%{transform:translateX(0);}100%{transform:translateX(-100%);}}
  .cb-stat{background:#16222e;border:1px solid #243443;border-radius:10px;padding:7px 9px;border-right:3px solid #1E3A2F;}
  .cb-stat-lbl{display:block;font-size:8.5px;color:#7c8d9b;margin-bottom:3px;font-weight:500;}
  .cb-stat-val{font-size:11px;font-weight:700;color:#eef3f7;}
  .cb-stat-val.w{color:#46d98e;}.cb-stat-val.g{color:#16A34A;}.cb-stat-val.y{color:#D97706;}
  .cb-ind-row{display:flex;align-items:center;gap:6px;padding:5px 10px 0;font-size:9px;}
  .cb-ind-lbl{color:#9fb2c0;flex-shrink:0;min-width:52px;font-weight:500;}
  .cb-ind-val{font-family:'SF Mono',ui-monospace,monospace;color:#dfe7ee;font-size:9px;flex:1;}
  .cb-ind-badge{font-size:8px;font-weight:700;padding:2px 7px;border-radius:20px;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;flex-shrink:0;}
  .cb-ind-badge.up{background:#0f2a1c;border-color:#86EFAC;color:#16A34A;}
  .cb-ind-badge.dn{background:#2a1416;border-color:#FCA5A5;color:#DC2626;}
  .cb-ind-badge.yw{background:#2a2410;border-color:#FCD34D;color:#D97706;}
  .cb-conf-bar{display:flex;align-items:center;gap:6px;padding:8px 10px 0;font-size:9px;}
  .cb-conf-lbl{color:#9fb2c0;flex-shrink:0;font-weight:500;}
  .cb-conf-score{font-family:'SF Mono',ui-monospace,monospace;font-size:12px;font-weight:700;color:#46d98e;}
  .cb-conf-track{flex:1;height:5px;border-radius:3px;background:#243443;overflow:hidden;}
  .cb-conf-fill{height:100%;border-radius:3px;transition:width 0.3s,background 0.3s;}
  .cb-pause-bar{display:none;align-items:center;justify-content:center;padding:6px 10px;background:#2a1416;border:1px solid #FCA5A5;margin:6px 10px 0;border-radius:10px;}
  .cb-pause-bar.active{display:flex;}
  .cb-pause-txt{font-size:9px;font-weight:700;color:#DC2626;}
  .cb-stats-bar{display:flex;gap:5px;padding:8px 10px 0;}
  .cb-stt{flex:1;background:#16222e;border:1px solid #243443;border-radius:10px;padding:6px 7px;text-align:center;}
  .cb-stt-lbl{display:block;font-size:7.5px;color:#7c8d9b;margin-bottom:3px;font-weight:500;}
  .cb-stt-val{font-size:13px;font-weight:700;color:#eef3f7;}
  .cb-stt-val.g{color:#16A34A;}.cb-stt-val.r{color:#DC2626;}.cb-stt-val.y{color:#D97706;}
  .cb-sig-wrap{padding:10px 10px 0;}
  .cb-sig-box{background:#16222e;border:1.5px solid #243443;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
  .cb-sig-box.buy{background:#0f2a1c;border-color:#46d98e;}
  .cb-sig-box.sell{background:#2a1416;border-color:#DC2626;}
  .cb-sig-main{font-size:18px;font-weight:800;letter-spacing:0.5px;color:#eef3f7;}
  .cb-sig-main.BUY{color:#46d98e;}.cb-sig-main.SELL{color:#DC2626;}.cb-sig-main.HOLD{color:#7c8d9b;font-size:15px;font-weight:500;}
  .cb-sig-sub{font-size:10px;color:#9fb2c0;}
  .cb-sig-badge{font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:#1b2a36;border:1px solid #243443;color:#9fb2c0;align-self:flex-start;}
  .cb-section-lbl{font-size:9px;font-weight:700;color:#9fb2c0;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
  .cb-section-lbl::after{content:'';flex:1;height:1px;background:#243443;}
  .cb-candle-sect{padding:10px 10px 0;}
  .cb-candle-row{display:flex;gap:4px;align-items:flex-end;flex-wrap:wrap;min-height:34px;}
  .cb-c{width:22px;height:22px;border-radius:6px;border:1.5px solid;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;}
  .cb-c.bull{background:#0f2a1c;border-color:#86EFAC;color:#16A34A;}
  .cb-c.bear{background:#2a1416;border-color:#FCA5A5;color:#DC2626;}
  .cb-sep{height:1px;background:#243443;margin:11px 0 0;}
  .cb-amount-row{display:flex;align-items:center;gap:8px;padding:10px 10px 0;}
  .cb-amount-lbl{font-size:10px;color:#9fb2c0;flex-shrink:0;font-weight:600;}
  .cb-amount-inp{flex:1;background:#16222e;border:1px solid #243443;border-radius:10px;padding:6px 10px;color:#eef3f7;font-family:inherit;font-size:13px;font-weight:700;text-align:center;outline:none;transition:border-color 0.2s;}
  .cb-amount-inp:focus{border-color:#46d98e;}
  .cb-demo-badge{font-size:9px;font-weight:700;padding:3px 9px;border-radius:20px;background:#2a2410;border:1px solid #FCD34D;color:#D97706;flex-shrink:0;}
  .cb-demo-badge.real{background:#0f2a1c;border-color:#86EFAC;color:#16A34A;}
  .cb-manual-row{display:flex;gap:8px;padding:8px 10px;}
  .cb-manual-btn{flex:1;padding:12px 8px;border-radius:50px;border:none;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;text-align:center;transition:all 0.15s ease;touch-action:manipulation;letter-spacing:0.5px;}
  .cb-manual-btn.buy{background:#1E3A2F;color:#fff;}
  .cb-manual-btn.buy:hover{background:#2D5540;}.cb-manual-btn.buy:active{transform:scale(0.95);}
  .cb-manual-btn.sell{background:#DC2626;color:#fff;}
  .cb-manual-btn.sell:hover{background:#B91C1C;}.cb-manual-btn.sell:active{transform:scale(0.95);}
  .cb-auto-row{display:flex;align-items:center;gap:10px;padding:2px 10px 6px;}
  .cb-auto-lbl{font-size:10.5px;color:#9fb2c0;flex:1;font-weight:500;}
  .cb-toggle{appearance:none;-webkit-appearance:none;width:40px;height:22px;border-radius:11px;cursor:pointer;background:#243443;border:none;position:relative;transition:all 0.25s;flex-shrink:0;}
  .cb-toggle::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#cfe;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:all 0.25s ease;}
  .cb-toggle:checked{background:#1E3A2F;}
  .cb-toggle:checked::after{transform:translateX(18px);}
  .cb-auto-badge{font-size:10px;font-weight:700;color:#7c8d9b;min-width:28px;text-align:center;}
  .cb-dur-row{display:flex;align-items:center;gap:5px;padding:4px 10px;}
  .cb-dur-lbl{font-size:10px;color:#9fb2c0;flex-shrink:0;font-weight:600;}
  .cb-dur-btn{padding:5px 9px;border-radius:16px;border:1px solid #243443;background:#16222e;color:#9fb2c0;font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;transition:all 0.15s;}
  .cb-dur-btn.active{background:#0f2a1c;border-color:#46d98e;color:#46d98e;}
  .cb-reset-btn{padding:8px;border-radius:12px;border:1px solid #243443;background:#16222e;color:#9fb2c0;font-family:inherit;font-size:9.5px;font-weight:600;cursor:pointer;text-align:center;transition:all 0.15s;}
  .cb-reset-btn:hover{background:#2a1416;border-color:#FCA5A5;color:#DC2626;}
  #cbStatus{padding:7px 14px 9px;font-size:8px;font-weight:700;font-family:'SF Mono',ui-monospace,monospace;border-top:1px solid #243443;letter-spacing:0.5px;flex-shrink:0;background:#0e1a16;border-radius:0 0 20px 20px;text-align:center;background-image:linear-gradient(90deg,#00d264,#3fe0ff,#9b8cff,#00d264);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:cbGradFlow 7s linear infinite;}
  #cbLogToggle{position:fixed;bottom:100px;left:6px;z-index:2147483646;padding:6px 12px;border-radius:20px;background:#16222e;border:1px solid #243443;color:#46d98e;font-family:'IBM Plex Sans Arabic',sans-serif;font-size:9px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(0,0,0,0.4);}
  #cbLogCount{background:#0f2a1c;color:#16A34A;border-radius:10px;padding:1px 6px;font-size:7.5px;min-width:16px;text-align:center;border:1px solid #86EFAC;}
  #cbLogFloat{position:fixed;bottom:148px;left:6px;z-index:2147483646;width:360px;background:#16222e;border:1px solid #243443;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);display:none;flex-direction:column;overflow:hidden;touch-action:none;max-height:calc(100svh - 160px);direction:rtl;}
  #cbLogFloat.open{display:flex;}
  @media(max-width:480px){#cbLogFloat{width:calc(100vw - 12px);left:6px;}}
  #cbLogHdr{display:flex;align-items:center;gap:6px;padding:9px 10px 8px;border-bottom:1px solid #243443;cursor:grab;flex-shrink:0;background:#0c151c;border-radius:16px 16px 0 0;}
  .cb-log-title{font-size:10px;font-weight:800;color:#46d98e;letter-spacing:0.8px;flex:1;}
  .cb-log-hbtn{height:24px;padding:0 9px;border-radius:20px;background:#16222e;border:1px solid #243443;color:#9fb2c0;cursor:pointer;font-size:9px;font-family:inherit;font-weight:700;}
  .cb-log-hbtn:hover{background:#0f2a1c;border-color:#86EFAC;color:#16A34A;}
  .cb-log-filters{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #243443;flex-wrap:wrap;flex-shrink:0;background:#16222e;}
  .cb-log-filter{font-size:8px;padding:2px 9px;border-radius:20px;border:1px solid #243443;background:transparent;color:#7c8d9b;cursor:pointer;font-family:inherit;font-weight:600;transition:all 0.15s;}
  .cb-log-filter.active{border-color:#46d98e;color:#46d98e;background:#0f2a1c;}
  .cb-log-inner{overflow-y:auto;flex:1;padding-bottom:4px;background:#16222e;}
  .cb-log-inner::-webkit-scrollbar{width:3px;}
  .cb-log-inner::-webkit-scrollbar-thumb{background:#33485a;border-radius:2px;}
  .cb-log-line{font-size:9px;line-height:1.5;display:flex;align-items:baseline;gap:5px;padding:4px 10px;border-bottom:1px solid #1a2630;border-right:2px solid transparent;}
  .cb-log-line.t-signal{border-right-color:#16A34A;}
  .cb-log-line.t-error{border-right-color:#DC2626;}
  .cb-log-line.t-info{border-right-color:#3B82F6;}
  .cb-log-t{color:#7c8d9b;font-family:'SF Mono',ui-monospace,monospace;flex-shrink:0;font-size:7.5px;}
  .cb-log-m{font-weight:500;word-break:break-word;flex:1;}
  .cb-log-m.signal{color:#46d98e;font-weight:700;}
  .cb-log-m.error{color:#ff6b6b;font-weight:600;}
  .cb-log-m.info{color:#9fb2c0;}
  /* ══ LIQUID GLASS TRADING ORB ══ */
  #cbTradeOrb{position:fixed;top:72px;right:14px;width:150px;z-index:2147483647;cursor:grab;user-select:none;touch-action:none;opacity:0;pointer-events:none;transition:opacity 0.35s ease;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl;}
  #cbTradeOrb.visible{opacity:1;pointer-events:auto;animation:orbAppear 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards;}
  #cbTradeOrb:active{cursor:grabbing;}
  .orb-sphere-wrap{position:relative;width:150px;height:150px;}
  .orb-ambient{position:absolute;inset:-14px;border-radius:50%;opacity:0;filter:blur(18px);transition:background 0.6s ease,opacity 0.6s ease;animation:orbBreath 3.5s ease-in-out infinite;}
  .orb-ambient.orb-buy{background:radial-gradient(circle,rgba(70,217,142,0.75),rgba(0,180,90,0.35) 50%,transparent 75%);opacity:0.7;}
  .orb-ambient.orb-sell{background:radial-gradient(circle,rgba(220,38,38,0.75),rgba(180,0,0,0.35) 50%,transparent 75%);opacity:0.7;}
  .orb-ambient.orb-idle{background:radial-gradient(circle,rgba(0,200,255,0.6),rgba(0,100,200,0.3) 50%,transparent 75%);opacity:0.5;}
  .orb-conic-ring{position:absolute;inset:-3px;border-radius:50%;animation:orbRingRotate 5s linear infinite;-webkit-mask:radial-gradient(circle,transparent calc(100% - 3px),#000 calc(100% - 2px));mask:radial-gradient(circle,transparent calc(100% - 3px),#000 calc(100% - 2px));}
  .orb-conic-ring.orb-buy{background:conic-gradient(from 0deg,rgba(70,217,142,0.9),rgba(0,255,140,0.4) 25%,transparent 50%,transparent 75%,rgba(70,217,142,0.9));}
  .orb-conic-ring.orb-sell{background:conic-gradient(from 0deg,rgba(220,38,38,0.9),rgba(255,80,80,0.4) 25%,transparent 50%,transparent 75%,rgba(220,38,38,0.9));}
  .orb-conic-ring.orb-idle{background:conic-gradient(from 0deg,rgba(0,200,255,0.9),rgba(0,140,255,0.4) 25%,transparent 50%,transparent 75%,rgba(0,200,255,0.9));}
  .orb-shell{position:absolute;inset:0;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 38% 30%,rgba(255,255,255,0.18),rgba(140,220,255,0.05) 35%,rgba(4,12,36,0.90) 75%,rgba(2,6,20,0.96) 100%);backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);border:1.5px solid rgba(80,160,220,0.25);box-shadow:inset 0 2px 6px rgba(255,255,255,0.12),inset 0 -4px 12px rgba(0,0,0,0.5),0 4px 24px rgba(0,0,0,0.6);transition:border-color 0.5s,box-shadow 0.5s;}
  .orb-shell.orb-buy{border-color:rgba(70,217,142,0.45);box-shadow:inset 0 2px 6px rgba(70,217,142,0.08),inset 0 -4px 12px rgba(0,0,0,0.5),0 0 28px rgba(70,217,142,0.22);}
  .orb-shell.orb-sell{border-color:rgba(220,38,38,0.45);box-shadow:inset 0 2px 6px rgba(220,38,38,0.08),inset 0 -4px 12px rgba(0,0,0,0.5),0 0 28px rgba(220,38,38,0.22);}
  .orb-shell.orb-idle{border-color:rgba(0,200,255,0.3);}
  .orb-specular{position:absolute;top:9%;left:16%;width:38%;height:30%;background:radial-gradient(ellipse at 40% 40%,rgba(255,255,255,0.26),rgba(200,240,255,0.08) 55%,transparent 80%);border-radius:50%;filter:blur(3px);pointer-events:none;}
  .orb-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;z-index:4;pointer-events:none;text-align:center;}
  .orb-dir-arrow{font-size:22px;line-height:1;filter:drop-shadow(0 0 8px currentColor);transition:color 0.4s;}
  .orb-dir-label{font-size:17px;font-weight:900;letter-spacing:3px;line-height:1.1;font-family:'SF Mono',ui-monospace,monospace;}
  .orb-dir-label.orb-buy{color:#46d98e;text-shadow:0 0 12px rgba(70,217,142,0.9);}
  .orb-dir-label.orb-sell{color:#ff4d4d;text-shadow:0 0 12px rgba(220,38,38,0.9);}
  .orb-dir-label.orb-idle{color:#3fe0ff;}
  .orb-conf-badge{font-size:12px;font-weight:900;color:rgba(255,255,255,0.88);font-family:'SF Mono',ui-monospace,monospace;}
  .orb-asset-chip{font-size:8px;font-weight:600;color:rgba(180,210,240,0.7);letter-spacing:0.4px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .orb-count{font-size:11px;font-weight:800;color:rgba(180,210,240,0.85);font-family:'SF Mono',ui-monospace,monospace;}
  .orb-close-x{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:rgba(10,18,34,0.85);border:1px solid rgba(36,52,67,0.6);color:rgba(140,170,200,0.8);font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;line-height:1;}
  .orb-close-x:hover{background:rgba(220,38,38,0.3);border-color:#DC2626;color:#ff6b6b;}
  @keyframes orbBreath{0%,100%{transform:scale(0.93);opacity:0.55;}50%{transform:scale(1.06);opacity:0.78;}}
  @keyframes orbRingRotate{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
  @keyframes orbAppear{from{opacity:0;transform:scale(0.82);}to{opacity:1;transform:scale(1);}}
  `;

  const HUD_HTML = `
  <style>${HUD_CSS}</style>
  <div id="cbIcon" title="EXPERTOPTION ENGINE"><div id="cbIconSig">⚡</div><div id="cbIconDot"></div></div>
  <div id="cbPanel">
    <div class="cb-hdr" id="cbDragHdr">
      <div class="cb-hdr-dot" id="cbHdrDot"></div>
      <span class="cb-ttl">⚡ QUANTUM PRO ⚡</span>
      <div class="cb-hdr-actions">
        <button class="cb-icon-btn" id="cbMinimize">−</button>
        <button class="cb-icon-btn" id="cbClose">✕</button>
      </div>
    </div>
    <div id="cbScrollArea">
      <div class="cb-grid">
        <div class="cb-stat"><span class="cb-stat-lbl">الزوج</span><span class="cb-stat-val w" id="cbAsset">جاري…</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">السعر</span><span class="cb-stat-val g" id="cbPrice">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">العائد</span><span class="cb-stat-val y" id="cbPayout">؟</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">البث</span><span class="cb-stat-val g" id="cbLive">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">الرصيد</span><span class="cb-stat-val g" id="cbBalance">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">تيكات</span><span class="cb-stat-val" id="cbTickCount">0</span></div>
      </div>
      <div class="cb-marquee"><div class="cb-marquee-track" id="cbMarqueeTrack">🔎 جاري رصد الفرص…</div></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">📈 الاتجاه</span><span class="cb-ind-val" id="cbTrendVal">–</span><span class="cb-ind-badge" id="cbTrendBadge">–</span></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">RSI</span><span class="cb-ind-val" id="cbRsiVal">–</span><span class="cb-ind-badge" id="cbRsiBadge">–</span></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">⚡ الزخم</span><span class="cb-ind-val" id="cbMomVal">–</span><span class="cb-ind-badge" id="cbMomBadge">–</span></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">👥 الجمهور</span><span class="cb-ind-val" id="cbCrowdVal">–</span><span class="cb-ind-badge" id="cbCrowdBadge">–</span></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">🛡️ المخاطر</span><span class="cb-ind-val" id="cbRiskVal">–</span><span class="cb-ind-badge" id="cbRiskBadge">–</span></div>
      <div class="cb-ind-row"><span class="cb-ind-lbl">🔌 الاتصال</span><span class="cb-ind-val" id="cbConnVal">–</span><span class="cb-ind-badge" id="cbConnBadge">–</span></div>
      <div class="cb-conf-bar">
        <span class="cb-conf-lbl">🎯 الثقة</span>
        <span class="cb-conf-score" id="cbConfScore">–</span>
        <div class="cb-conf-track"><div class="cb-conf-fill" id="cbConfFill" style="width:0%;background:#243443;"></div></div>
      </div>
      <div class="cb-pause-bar" id="cbPauseBar"><span class="cb-pause-txt" id="cbPauseTxt">⛔ وقف مؤقت بسبب الخسائر</span></div>
      <div class="cb-stats-bar">
        <div class="cb-stt"><span class="cb-stt-lbl">ربح ✅</span><span class="cb-stt-val g" id="cbWins">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">خسارة ❌</span><span class="cb-stt-val r" id="cbLosses">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">% الفوز</span><span class="cb-stt-val y" id="cbWinRate">–</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">سلسلة</span><span class="cb-stt-val y" id="cbStreak">0</span></div>
      </div>
      <div class="cb-sig-wrap">
        <div class="cb-sig-box" id="cbSigBox">
          <div class="cb-sig-main HOLD" id="cbSigMain">انتظار</div>
          <div class="cb-sig-sub" id="cbSigSub">في انتظار الإشارة…</div>
          <div class="cb-sig-badge" id="cbSigBadge">ثقة: –</div>
        </div>
      </div>
      <div class="cb-candle-sect">
        <div class="cb-section-lbl">آخر الحركات</div>
        <div class="cb-candle-row" id="cbCandleRow"></div>
      </div>
      <div class="cb-sep"></div>
      <div class="cb-amount-row">
        <span class="cb-amount-lbl">المبلغ $</span>
        <input type="number" class="cb-amount-inp" id="cbAmountInp" value="1" min="1" step="0.01">
        <span class="cb-demo-badge" id="cbAccMode">ديمو</span>
      </div>
      <div class="cb-dur-row">
        <span class="cb-dur-lbl">⏱ المدة</span>
        <button class="cb-dur-btn" data-dur="30">30ث</button>
        <button class="cb-dur-btn" data-dur="60">1د</button>
        <button class="cb-dur-btn" data-dur="120">2د</button>
        <button class="cb-dur-btn" data-dur="180">3د</button>
        <button class="cb-dur-btn" data-dur="300">5د</button>
      </div>
      <div class="cb-manual-row">
        <button class="cb-manual-btn buy"  id="cbManualBuy">↑ شراء</button>
        <button class="cb-manual-btn sell" id="cbManualSell">↓ بيع</button>
      </div>
      <div class="cb-auto-row">
        <span class="cb-auto-lbl">تداول تلقائي</span>
        <input type="checkbox" class="cb-toggle" id="cbAutoToggle">
        <span class="cb-auto-badge" id="cbAutoBadge">OFF</span>
      </div>
      <div class="cb-auto-row" style="padding:2px 10px;">
        <span class="cb-auto-lbl">🛡️ حجم بنسبة المخاطرة</span>
        <input type="checkbox" class="cb-toggle" id="cbRiskToggle">
        <span class="cb-auto-badge" id="cbRiskBadge2">ON</span>
      </div>
      <div class="cb-conf-slider-row" style="display:flex;align-items:center;gap:6px;padding:4px 10px;">
        <span style="font-size:10px;color:#7c8d9b;min-width:58px;">🎯 ثقة ≥</span>
        <input type="range" id="cbConfSlider" min="50" max="95" value="60" style="flex:1;accent-color:#00d264;height:4px;">
        <span style="font-size:11px;font-weight:700;color:#00d264;min-width:28px;text-align:right;" id="cbConfSliderVal">60%</span>
      </div>
      <div class="cb-auto-row" style="padding:2px 10px 4px;">
        <span class="cb-auto-lbl">🔔 إشعار الإشارة</span>
        <input type="checkbox" class="cb-toggle" id="cbPopupToggle" checked>
        <span class="cb-auto-badge" id="cbPopupBadge" style="color:#00d264;">ON</span>
      </div>
      <div style="display:flex;gap:6px;margin:0 10px 8px;">
        <button class="cb-reset-btn" id="cbResetStats" style="flex:1;">إعادة تعيين</button>
        <button class="cb-reset-btn" id="cbResumeRisk" style="flex:1;border-color:#1e3a5f;color:#2563EB;">▶️ استئناف</button>
        <button class="cb-reset-btn" id="cbExport" style="flex:1;border-color:#1e3a5f;color:#2563EB;">⬇️ تصدير</button>
      </div>
    </div>
    <div id="cbStatus">◆ EXPERTOPTION ENGINE ◆ % RISK · DAILY DD · STREAK GUARD ◆</div>
  </div>
  <button id="cbLogToggle">📋 السجل <span id="cbLogCount">0</span></button>
  <div id="cbLogFloat">
    <div id="cbLogHdr">
      <span class="cb-log-title">⚡ السجل الحي</span>
      <button class="cb-log-hbtn" id="cbLogCopy">📋 نسخ</button>
      <button class="cb-log-hbtn" id="cbLogClear">🗑 مسح</button>
      <button class="cb-log-hbtn" id="cbLogCloseBtn">✕</button>
    </div>
    <div class="cb-log-filters">
      <button class="cb-log-filter active" data-filter="all">الكل</button>
      <button class="cb-log-filter" data-filter="signal">🟢 صفقات</button>
      <button class="cb-log-filter" data-filter="error">🔴 رفض</button>
      <button class="cb-log-filter" data-filter="info">ℹ معلومات</button>
    </div>
    <div class="cb-log-inner" id="cbLogInner"></div>
  </div>
  <div id="cbTradeOrb">
    <div class="orb-sphere-wrap">
      <div class="orb-ambient orb-idle" id="cbOrbAmbient"></div>
      <div class="orb-conic-ring orb-idle" id="cbOrbRing"></div>
      <div class="orb-shell orb-idle" id="cbOrbShell">
        <div class="orb-specular"></div>
        <div class="orb-center">
          <div class="orb-dir-arrow" id="cbOrbArrow">▲</div>
          <div class="orb-dir-label orb-idle" id="cbOrbDir">—</div>
          <div class="orb-conf-badge" id="cbOrbConf"></div>
          <div class="orb-asset-chip" id="cbOrbAsset">—</div>
          <div class="orb-count" id="cbOrbCount"></div>
        </div>
      </div>
      <div class="orb-close-x" id="cbOrbCloseX">✕</div>
    </div>
  </div>
  `;

  // ─── log ───
  function addLog(msg, type) {
    type = type || 'info';
    if (!_uiMounted) { try { console.log('[EO-ENGINE]', msg); } catch (_) {} return; }
    _logSeq++;
    _logEntries.push({ seq: _logSeq, t: nowMs(), msg, type });
    if (_logEntries.length > 400) _logEntries.shift();
    const cnt = $('cbLogCount'); if (cnt) cnt.textContent = _logSeq;
    if (_logPaused) return;
    renderLog(type, msg);
  }
  function renderLog(type, msg) {
    const inner = $('cbLogInner'); if (!inner) return;
    if (_logFilter !== 'all' && _logFilter !== type) return;
    const row = document.createElement('div');
    row.className = 'cb-log-line t-' + type;
    row.innerHTML = '<span class="cb-log-t">' + fmtTime(nowMs()).slice(0, 8) + '</span><span class="cb-log-m ' + type + '">' + String(msg).replace(/</g, '&lt;') + '</span>';
    inner.insertBefore(row, inner.firstChild);
    while (inner.childNodes.length > 200) inner.removeChild(inner.lastChild);
  }
  function rebuildLog() {
    const inner = $('cbLogInner'); if (!inner) return;
    inner.innerHTML = '';
    for (const e of _logEntries.slice(-200)) {
      if (_logFilter !== 'all' && _logFilter !== e.type) continue;
      const row = document.createElement('div');
      row.className = 'cb-log-line t-' + e.type;
      row.innerHTML = '<span class="cb-log-t">' + fmtTime(e.t).slice(0, 8) + '</span><span class="cb-log-m ' + e.type + '">' + String(e.msg).replace(/</g, '&lt;') + '</span>';
      inner.insertBefore(row, inner.firstChild);
    }
  }

  function syncAutoBtn() {
    const t = $('cbAutoToggle'), b = $('cbAutoBadge');
    if (t) t.checked = autoTrade;
    if (b) { b.textContent = autoTrade ? 'ON' : 'OFF'; b.style.color = autoTrade ? '#00d264' : '#7c8d9b'; }
  }

  function setDuration(sec) {
    expShift = sec;
    document.querySelectorAll('.cb-dur-btn').forEach(b => b.classList.toggle('active', +b.dataset.dur === sec));
  }

  function makeDrag(handle, target) {
    let drag = false, ox = 0, oy = 0, sx = 0, sy = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = true; const r = target.getBoundingClientRect(); ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      target.style.right = 'auto'; target.style.bottom = 'auto'; target.style.left = ox + 'px'; target.style.top = oy + 'px';
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      target.style.left = Math.max(0, Math.min(W.innerWidth - 60, ox + e.clientX - sx)) + 'px';
      target.style.top = Math.max(0, Math.min(W.innerHeight - 30, oy + e.clientY - sy)) + 'px';
    });
    const end = () => { drag = false; };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }

  function buildUI() {
    if (!CFG.UI_ENABLED || _uiMounted) return;
    const root = document.createElement('div');
    root.id = 'cbRoot';
    root.innerHTML = HUD_HTML;
    document.documentElement.appendChild(root);
    _uiMounted = true;

    const panel = $('cbPanel'), icon = $('cbIcon'), logFloat = $('cbLogFloat');
    // launcher
    icon.addEventListener('click', () => { _panelOpen = !_panelOpen; panel.classList.toggle('open', _panelOpen); });
    $('cbClose').addEventListener('click', () => { _panelOpen = false; panel.classList.remove('open'); });
    $('cbMinimize').addEventListener('click', () => panel.classList.toggle('minimized'));
    makeDrag($('cbDragHdr'), panel);

    // log panel
    $('cbLogToggle').addEventListener('click', () => logFloat.classList.toggle('open'));
    $('cbLogCloseBtn').addEventListener('click', () => logFloat.classList.remove('open'));
    $('cbLogClear').addEventListener('click', () => { _logEntries.length = 0; rebuildLog(); });
    $('cbLogCopy').addEventListener('click', () => { navigator.clipboard?.writeText(_logEntries.map(e => fmtTime(e.t) + ' ' + e.msg).join('\n')); });
    makeDrag($('cbLogHdr'), logFloat);
    document.querySelectorAll('.cb-log-filter').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.cb-log-filter').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); _logFilter = b.dataset.filter; rebuildLog();
    }));

    // controls
    $('cbManualBuy').addEventListener('click', () => executeTrade('call'));
    $('cbManualSell').addEventListener('click', () => executeTrade('put'));
    $('cbAmountInp').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v > 0) { tradeAmount = v; addLog('💵 manual amount: $' + v, 'info'); } });
    $('cbAutoToggle').addEventListener('change', (e) => { autoTrade = e.target.checked; syncAutoBtn(); addLog(autoTrade ? '🤖 auto-trading ON — min conf ' + minConfidence + '%' : '🤖 auto-trading OFF', autoTrade ? 'signal' : 'info'); });
    $('cbRiskToggle').checked = CFG.RISK_PCT_ENABLED;
    $('cbRiskBadge2').textContent = CFG.RISK_PCT_ENABLED ? 'ON' : 'OFF';
    $('cbRiskToggle').addEventListener('change', (e) => { CFG.RISK_PCT_ENABLED = e.target.checked; $('cbRiskBadge2').textContent = e.target.checked ? 'ON' : 'OFF'; addLog('🛡️ risk sizing: ' + (e.target.checked ? 'ON (' + Math.round(CFG.RISK_PCT * 100) + '%)' : 'OFF (manual)'), 'info'); });
    const cs = $('cbConfSlider'), csv = $('cbConfSliderVal');
    cs.value = String(minConfidence); csv.textContent = minConfidence + '%';
    cs.addEventListener('input', () => { minConfidence = parseInt(cs.value, 10); csv.textContent = minConfidence + '%'; });
    $('cbPopupToggle').addEventListener('change', (e) => { CFG.POPUP_ENABLED = e.target.checked; $('cbPopupBadge').textContent = e.target.checked ? 'ON' : 'OFF'; $('cbPopupBadge').style.color = e.target.checked ? '#00d264' : '#7c8d9b'; });
    document.querySelectorAll('.cb-dur-btn').forEach(b => b.addEventListener('click', () => { setDuration(+b.dataset.dur); addLog('⏱️ duration: ' + b.dataset.dur + 's', 'info'); }));
    setDuration(expShift);
    $('cbResetStats').addEventListener('click', () => { STATS.trades = STATS.wins = STATS.losses = STATS.lossStreak = STATS.winStreak = STATS.bestStreak = 0; STATS.pnl = 0; BOT.trades = BOT.wins = BOT.losses = BOT.lossStreak = BOT.winStreak = 0; BOT.pnl = 0; _pauseUntil = 0; addLog('🔄 stats reset', 'info'); });
    $('cbResumeRisk').addEventListener('click', () => RiskManager.resume());
    $('cbExport').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([Diag.export()], { type: 'application/json' })); a.download = 'eo_traffic_' + Date.now() + '.json'; a.click(); addLog('⬇️ exported ' + Diag.packets.length + ' packets', 'info'); });

    initOrb();
    syncAutoBtn();
    updateHud();
    addLog('🛰️ EXPERTOPTION ENGINE ready — اضغط أيقونة ⚡ لفتح اللوحة', 'signal');
  }

  let _marqueeBuilt = 0;
  function buildMarquee() {
    const track = $('cbMarqueeTrack'); if (!track) return;
    const arr = [...(_assetsById.values())].filter(a => a.active && a.profit != null).sort((a, b) => (b.profit || 0) - (a.profit || 0)).slice(0, 14);
    if (!arr.length) return;
    track.innerHTML = arr.map(a => '<span class="cb-marq-item"><span class="cb-marq-otc">' + (a.symbol || '?') + '</span><span class="cb-marq-sep">·</span><span class="cb-marq-pay">' + (a.profit || 0) + '%</span></span>').join('');
  }

  function renderCandles() {
    const row = $('cbCandleRow'); if (!row) return;
    const ser = activeAssetId != null ? _series.get(activeAssetId) : null;
    if (!ser || ser.length < 2) { row.innerHTML = '<span style="color:#7c8d9b;font-size:9px">—</span>'; return; }
    const last = ser.slice(-12);
    let html = '';
    for (let i = 1; i < last.length; i++) { const up = last[i] >= last[i - 1]; html += '<div class="cb-c ' + (up ? 'bull' : 'bear') + '">' + (up ? '▲' : '▼') + '</div>'; }
    row.innerHTML = html;
  }

  function setIndBadge(id, txt, cls) { const el = $(id); if (el) { el.textContent = txt; el.className = 'cb-ind-badge' + (cls ? ' ' + cls : ''); } }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  function updateHud() {
    if (!_uiMounted) return;
    const asset = activeAssetId != null ? _assetsById.get(activeAssetId) : null;
    const price = activeAssetId != null ? _lastPrice.get(activeAssetId) : null;
    const ageMs = _lastTickMs ? (nowMs() - _lastTickMs) : null;
    const live = ageMs == null ? '⚪ انتظار' : (ageMs < 3000 ? '🟢 حيّ' : (ageMs < 10000 ? '🟡 بطيء' : '🔴 ركود'));
    const onDot = wsConnected && ageMs != null && ageMs < 10000;
    $('cbHdrDot')?.classList.toggle('on', onDot);
    $('cbIconDot')?.classList.toggle('on', onDot);

    setText('cbAsset', activeAssetId != null ? symOf(activeAssetId) : '—');
    setText('cbPrice', price != null ? price.toFixed(asset?.digits || 5) : '–');
    setText('cbPayout', asset?.profit != null ? asset.profit + '%' : '؟');
    setText('cbLive', live);
    setText('cbBalance', curBalance() != null ? (+curBalance()).toFixed(2) : '–');
    setText('cbTickCount', String(totalTicks));

    // account mode badge
    const am = $('cbAccMode'); if (am) { am.textContent = isDemo ? 'ديمو' : 'حقيقي'; am.className = 'cb-demo-badge' + (isDemo ? '' : ' real'); }

    // indicators from the live signal
    const sg = _lastSignal || { dir: null, conf: 0, reasons: [] };
    const ser = activeAssetId != null ? _series.get(activeAssetId) : null;
    if (ser && ser.length >= CFG.STRATEGY.MIN_POINTS) {
      const eF = ema(ser.slice(-CFG.STRATEGY.EMA_SLOW * 2), CFG.STRATEGY.EMA_FAST);
      const eS = ema(ser.slice(-CFG.STRATEGY.EMA_SLOW * 2), CFG.STRATEGY.EMA_SLOW);
      const up = eF != null && eS != null && eF > eS;
      setText('cbTrendVal', eF != null ? (up ? 'صاعد' : 'هابط') : '–'); setIndBadge('cbTrendBadge', up ? 'UP' : 'DN', up ? 'up' : 'dn');
      const r = rsi(ser, CFG.STRATEGY.RSI_PERIOD);
      setText('cbRsiVal', r != null ? r.toFixed(0) : '–'); setIndBadge('cbRsiBadge', r == null ? '–' : (r <= CFG.STRATEGY.RSI_OS ? 'OS' : r >= CFG.STRATEGY.RSI_OB ? 'OB' : 'MID'), r == null ? '' : (r <= CFG.STRATEGY.RSI_OS ? 'up' : r >= CFG.STRATEGY.RSI_OB ? 'dn' : 'yw'));
      const base = ser[ser.length - 1 - CFG.STRATEGY.ROC_LOOKBACK];
      const roc = base ? (ser[ser.length - 1] - base) / base * 100 : 0;
      setText('cbMomVal', roc.toFixed(3) + '%'); setIndBadge('cbMomBadge', roc > 0 ? 'UP' : roc < 0 ? 'DN' : '–', roc > 0 ? 'up' : roc < 0 ? 'dn' : '');
    }
    const tc = activeAssetId != null ? _tradersChoice.get(activeAssetId) : null;
    setText('cbCrowdVal', tc ? ('▲' + tc.call + '% / ▼' + tc.put + '%') : '–');
    setIndBadge('cbCrowdBadge', tc ? (tc.call >= tc.put ? 'CALL' : 'PUT') : '–', tc ? (tc.call >= tc.put ? 'up' : 'dn') : '');

    const rs = RiskManager.status();
    setText('cbRiskVal', 'P/L ' + rs.pnlPct + ' · صفقة $' + rs.nextSize);
    setIndBadge('cbRiskBadge', rs.halted ? 'HALT' : (nowMs() < _pauseUntil ? 'PAUSE' : 'OK'), rs.halted || nowMs() < _pauseUntil ? 'dn' : 'up');

    setText('cbConnVal', (lastToken ? 'token🔑' : 'token❌') + ' · ' + (tradeWS && tradeWS.readyState === 1 ? 'مقبس✓' : 'مقبس✗'));
    setIndBadge('cbConnBadge', wsConnected ? 'LIVE' : 'OFF', wsConnected ? 'up' : 'dn');

    // confidence bar
    setText('cbConfScore', sg.conf + '%');
    const fill = $('cbConfFill'); if (fill) { fill.style.width = Math.min(100, sg.conf) + '%'; fill.style.background = sg.conf >= minConfidence ? (sg.dir === 'put' ? '#DC2626' : '#16A34A') : '#243443'; }

    // pause bar
    const pb = $('cbPauseBar');
    if (pb) {
      if (rs.halted) { pb.classList.add('active'); $('cbPauseTxt').textContent = '🛑 إيقاف المخاطر — ' + rs.reason; }
      else if (nowMs() < _pauseUntil) { pb.classList.add('active'); $('cbPauseTxt').textContent = '⛔ وقف خسائر — ' + Math.ceil((_pauseUntil - nowMs()) / 1000) + 'ث متبقية'; }
      else pb.classList.remove('active');
    }

    // stats
    setText('cbWins', String(STATS.wins)); setText('cbLosses', String(STATS.losses));
    setText('cbWinRate', STATS.trades ? Math.round(STATS.wins / STATS.trades * 100) + '%' : '–');
    setText('cbStreak', BOT.lossStreak ? BOT.lossStreak + 'L🤖' : (BOT.winStreak ? BOT.winStreak + 'W🤖' : '0'));

    // signal box
    const box = $('cbSigBox'), main = $('cbSigMain'), sub = $('cbSigSub'), badge = $('cbSigBadge');
    if (box && main) {
      if (sg.dir === 'call') { box.className = 'cb-sig-box buy'; main.className = 'cb-sig-main BUY'; main.textContent = '↑ شراء (CALL)'; }
      else if (sg.dir === 'put') { box.className = 'cb-sig-box sell'; main.className = 'cb-sig-main SELL'; main.textContent = '↓ بيع (PUT)'; }
      else { box.className = 'cb-sig-box'; main.className = 'cb-sig-main HOLD'; main.textContent = 'انتظار'; }
      sub.textContent = sg.reasons && sg.reasons.length ? sg.reasons.join('، ') : 'في انتظار الإشارة…';
      badge.textContent = 'ثقة: ' + sg.conf + '% (حد ' + minConfidence + '%)';
    }

    renderCandles();
    if (nowMs() - _marqueeBuilt > 8000) { buildMarquee(); _marqueeBuilt = nowMs(); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 12  LIQUID-GLASS ORB — signal + win/loss popup
  // ══════════════════════════════════════════════════════════════════════
  let _orbTimer = null, _orbHideTimer = null;
  function initOrb() {
    const orb = $('cbTradeOrb'); if (!orb) return;
    $('cbOrbCloseX').addEventListener('click', (e) => { e.stopPropagation(); hideOrb(); });
    let drag = false, ox = 0, oy = 0, sx = 0, sy = 0;
    orb.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'cbOrbCloseX') return;
      drag = true; ox = orb.offsetLeft; oy = orb.offsetTop; sx = e.clientX; sy = e.clientY;
      try { orb.setPointerCapture(e.pointerId); } catch (_) {}
    });
    orb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      orb.style.left = Math.max(0, Math.min(W.innerWidth - 160, ox + e.clientX - sx)) + 'px';
      orb.style.top = Math.max(0, Math.min(W.innerHeight - 170, oy + e.clientY - sy)) + 'px';
      orb.style.right = 'auto';
    });
    const end = () => { drag = false; };
    orb.addEventListener('pointerup', end); orb.addEventListener('pointercancel', end);
  }
  function _orbState(s) {
    ['cbOrbAmbient', 'cbOrbRing', 'cbOrbShell', 'cbOrbDir'].forEach(id => { const el = $(id); if (!el) return; el.classList.remove('orb-buy', 'orb-sell', 'orb-idle'); el.classList.add('orb-' + s); });
  }
  function hideOrb() {
    const orb = $('cbTradeOrb'); if (orb) orb.classList.remove('visible');
    if (_orbTimer) { clearInterval(_orbTimer); _orbTimer = null; }
    if (_orbHideTimer) { clearTimeout(_orbHideTimer); _orbHideTimer = null; }
  }
  function showSignalPopup(opts) {
    const orb = $('cbTradeOrb'); if (!CFG.POPUP_ENABLED || !orb) return;
    const isBuy = opts.direction === 'call';
    _orbState(isBuy ? 'buy' : 'sell');
    orb.classList.add('visible');
    const arrow = $('cbOrbArrow'); arrow.textContent = isBuy ? '▲' : '▼'; arrow.style.color = isBuy ? '#46d98e' : '#ff4d4d';
    $('cbOrbDir').textContent = isBuy ? 'CALL' : 'PUT';
    $('cbOrbConf').textContent = (opts.confidence || 0) + '%';
    $('cbOrbAsset').textContent = opts.asset || '—';
    try { if (W.navigator.vibrate) W.navigator.vibrate([60, 30, 60]); } catch (_) {}
    const durSec = opts.durationSec || expShift, closeAt = nowMs() + durSec * 1000;
    if (_orbTimer) clearInterval(_orbTimer);
    const countEl = $('cbOrbCount');
    _orbTimer = setInterval(() => {
      const remain = Math.max(0, Math.ceil((closeAt - nowMs()) / 1000));
      if (countEl) countEl.textContent = remain >= 60 ? Math.floor(remain / 60) + ':' + String(remain % 60).padStart(2, '0') : remain + 'ث';
      if (remain <= 0 && _orbTimer) { clearInterval(_orbTimer); _orbTimer = null; }
    }, 250);
    if (_orbHideTimer) clearTimeout(_orbHideTimer);
    _orbHideTimer = setTimeout(hideOrb, (durSec + 1) * 1000);
  }
  function showResultPopup(win, label, detail) {
    const orb = $('cbTradeOrb'); if (!CFG.POPUP_ENABLED || !orb) return;
    _orbState(win === false ? 'sell' : 'buy');
    orb.classList.add('visible');
    const arrow = $('cbOrbArrow'); arrow.textContent = win === true ? '✅' : (win === false ? '❌' : '⚠️'); arrow.style.color = win === false ? '#ff4d4d' : '#46d98e';
    $('cbOrbDir').textContent = label; $('cbOrbConf').textContent = ''; $('cbOrbAsset').textContent = detail || ''; $('cbOrbCount').textContent = '';
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
