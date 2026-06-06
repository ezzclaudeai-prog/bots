/**
 * predictor.js — PHONE_B (يستهلك القائد A + فيد الوسيط المتأخر B)  [TASK-2]
 * ─────────────────────────────────────────────────────────────────────────
 * يشترك في BUS (المصدر السريع A من collector.js) ويتصل بفيد الوسيط (B).
 * يقيس الفجوة الكمونية A→B، وعندما يتحرك A بما يتجاوز ما يعكسه B بعدُ (وبهامش
 * أكبر من السبريد/العمولة)، يصدر قراراً للرهان على **B** (المتأخر).
 *
 * ⚠️ المبدأ الحاسم: تربح فقط لأن A يقود B لـ«نفس» الأصل الحقيقي. الرهان على B.
 *    لا ينطبق على PO-OTC (خادم واحد، يفتح بسعره اللحظي).
 *
 * يبدأ في «وضع القياس» (MEASURE): لا قرارات تنفيذ — فقط يطبع هل A يقود B فعلاً
 * وبكم. لا تفعّل التنفيذ قبل أن تؤكّد الأرقام أن lead ثابت > التكلفة.
 *
 * التشغيل:  node predictor.js
 */
'use strict';
const WebSocket = require('ws');

const CFG = {
  BUS_URL: 'ws://localhost:8787',
  // TODO: نقطة فيد الوسيط (B) لنفس الأصل الحقيقي. يجب أن تستقبل أسعاره المتأخرة.
  BROKER_WS: '',                 // اتركه فارغاً للبقاء في وضع القياس على A فقط
  MODE: 'MEASURE',               // 'MEASURE' (قياس فقط) | 'LIVE' (يصدر قرارات)
  LEAD_MIN_REL: 0.00010,         // أدنى فجوة نسبية A↔B لاعتبارها حافة (> سبريد/عمولة)
  COOLDOWN_MS: 1500,             // أدنى فاصل بين القرارات
  HORIZON_MS: 3000,              // أفق الصفقة (لتقييم القياس)
};

// أحدث سعر من كل مصدر
let lastA = null;   // { price, ts }
let lastB = null;   // { price, ts }
let lastDecision = 0;

// إحصاء القياس: هل اتجاه A الآن يتنبّأ بحركة B خلال الأفق؟
const meas = { n: 0, hit: 0, leadSumMs: 0, leadN: 0 };
const pendB = [];   // [{t, bPrice, aDir}] لتقييم لاحق

function onA(price, ts) {
  const prev = lastA;
  lastA = { price, ts };
  if (!prev) return;
  // اتجاه A اللحظي
  const aDir = price > prev.price ? 1 : price < prev.price ? -1 : 0;
  if (aDir === 0 || !lastB) return;

  // الفجوة A↔B: كم يتأخر B عن A الآن
  const relGap = (lastA.price - lastB.price) / lastB.price;

  // قياس: سجّل سعر B الحالي + اتجاه A، وقيّم بعد الأفق هل تحرّك B باتجاه A
  pendB.push({ t: ts, bPrice: lastB.price, aDir });

  // قرار (LIVE فقط): A تحرّك بوضوح وB لم يلحق بعد بهامش يفوق التكلفة
  if (CFG.MODE === 'LIVE' && Math.abs(relGap) >= CFG.LEAD_MIN_REL && (ts - lastDecision) >= CFG.COOLDOWN_MS) {
    const dir = relGap > 0 ? 'BUY' : 'SELL';   // A أعلى من B → B سيرتفع ليلحق → BUY على B
    lastDecision = ts;
    emitDecision(dir, relGap);
  }
}

function onB(price, ts) {
  lastB = { price, ts };
  // نضّج تقييمات القياس التي بلغت الأفق
  while (pendB.length && (ts - pendB[0].t) >= CFG.HORIZON_MS) {
    const e = pendB.shift();
    const move = price - e.bPrice;        // كم تحرّك B خلال الأفق
    if (Math.abs(move) < 1e-12) continue;
    meas.n++;
    if (move * e.aDir > 0) meas.hit++;    // هل تحرّك B باتجاه A الذي سبق؟
    if (meas.n % 25 === 0) {
      const hr = (100 * meas.hit / meas.n).toFixed(1);
      console.log(`[MEASURE] هل A يقود B؟ معدل توافق=${hr}% (عينة ${meas.n}) — ` +
                  `${hr >= 55 ? 'A يقود B ✓ (حافة محتملة)' : 'لا قيادة واضحة ✗ (لا حافة)'}`);
    }
  }
}

function emitDecision(dir, relGap) {
  const rec = { ts: Date.now(), action: dir, venue: 'B', leadRel: +(relGap * 1e6).toFixed(1) + 'e-6' };
  console.log('[DECISION]', JSON.stringify(rec));
  // TODO: مرّر القرار لمنفّذ الوسيط (B) — غير مُوصَّل هنا قصداً (اختبر القياس أولاً).
}

// ── الاشتراك في BUS (A) ───────────────────────────────────────────────────────
function connectBus() {
  const ws = new WebSocket(CFG.BUS_URL);
  ws.on('open', () => console.log('[B] مشترك في BUS (A):', CFG.BUS_URL, '| الوضع:', CFG.MODE));
  ws.on('message', (raw) => {
    try { const d = JSON.parse(raw); if (d.type === 'tick') onA(d.price, d.ts); } catch (_) {}
  });
  ws.on('close', () => setTimeout(connectBus, 2000));
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
}
connectBus();

// ── الاتصال بفيد الوسيط (B) ───────────────────────────────────────────────────
function connectBroker() {
  if (!CFG.BROKER_WS) {
    console.log('[B] لا فيد وسيط مضبوط — قياس A فقط لن يكتمل. اضبط CFG.BROKER_WS لنفس الأصل الحقيقي.');
    return;
  }
  const ws = new WebSocket(CFG.BROKER_WS);
  ws.on('open', () => console.log('[B] متصل بفيد الوسيط:', CFG.BROKER_WS));
  ws.on('message', (raw) => {
    try {
      // TODO: حلّل رسالة الوسيط لاستخراج (price, ts) لنفس الأصل.
      const d = JSON.parse(raw);
      const price = parseFloat(d.price || d.p);
      const ts = Number(d.ts || d.T) || Date.now();
      if (price > 0) onB(price, ts);
    } catch (_) {}
  });
  ws.on('close', () => setTimeout(connectBroker, 2000));
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
}
connectBroker();
