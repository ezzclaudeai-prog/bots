/**
 * collector.js — PHONE_A (المصدر السريع القائد)  [TASK-2]
 * ─────────────────────────────────────────────────────────────────────────
 * يتصل بمصدر سعر حقيقي مستقل (مثال: Binance public WS — يقود كثيراً من الوسطاء
 * في الكريبتو)، يبني شموع OHLC بـ1ث، ويبثّ التيكات + الشموع على ناقل محلي (BUS)
 * عبر WebSocket حتى يستهلكها predictor.js.
 *
 * ⚠️ هذا يعمل فقط لأصل حقيقي له مصدر مرجعي. لا فائدة منه لأزواج OTC المُولَّدة.
 *
 * التشغيل:  npm i ws && node collector.js
 */
'use strict';
const WebSocket = require('ws');

const CFG = {
  BUS_PORT: 8787,
  // TODO: بدّل بمصدرك الحقيقي السريع. هذا مثال عام (Binance trade stream) لأصل حقيقي.
  SOURCE_WS: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
  SYMBOL: 'BTCUSDT',
  CANDLE_MS: 1000,   // شمعة كل ثانية
};

// ── BUS: خادم WebSocket محلي يوزّع البيانات على المشتركين ────────────────────
const bus = new WebSocket.Server({ port: CFG.BUS_PORT });
const clients = new Set();
bus.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients) { if (c.readyState === WebSocket.OPEN) c.send(msg); }
}
console.log(`[A] BUS يستمع على ws://localhost:${CFG.BUS_PORT}`);

// ── بناء شمعة OHLC من التيكات ────────────────────────────────────────────────
let candle = null;
function onTick(price, ts) {
  // ابثّ التيك الخام فوراً (هذا هو «القائد» الذي يسبق الوسيط)
  broadcast({ type: 'tick', symbol: CFG.SYMBOL, price, ts });

  const bucket = Math.floor(ts / CFG.CANDLE_MS) * CFG.CANDLE_MS;
  if (!candle || candle.t !== bucket) {
    if (candle) broadcast({ type: 'candle', symbol: CFG.SYMBOL, ...candle });
    candle = { t: bucket, open: price, high: price, low: price, close: price };
  } else {
    candle.close = price;
    if (price > candle.high) candle.high = price;
    if (price < candle.low) candle.low = price;
  }
}

// ── الاتصال بالمصدر السريع مع إعادة اتصال ────────────────────────────────────
function connect() {
  const src = new WebSocket(CFG.SOURCE_WS);
  src.on('open', () => console.log('[A] متصل بالمصدر السريع:', CFG.SOURCE_WS));
  src.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      // مثال Binance trade: { p: "price", T: tradeTimeMs }
      const price = parseFloat(d.p);
      const ts = Number(d.T) || Date.now();
      if (price > 0) onTick(price, ts);
    } catch (_) {}
  });
  src.on('close', () => { console.log('[A] انقطع — إعادة اتصال بعد 2ث'); setTimeout(connect, 2000); });
  src.on('error', (e) => { console.log('[A] خطأ:', e.message); try { src.close(); } catch (_) {} });
}
connect();
