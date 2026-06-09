#!/usr/bin/env node
// [V21/loss-cut] محلّل نتائج الصفقات: يربط كل صفقة (فوز/خسارة) بظروف دخولها من تدفق التيك،
// ليكشف *أي نوع* من الصفقات يخسر — كي نحجبه بلا أن نكسر الرابح.
// التشغيل: node trade_analyzer.js <spy.ndjson>
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

const ticksByAsset = {};      // asset -> [{t(sec), p}]
const periodByAsset = {};     // asset -> candle period sec (from HISTORY)
const opens = {};             // id -> open data
const trades = [];            // {asset, dir(+1/-1), openP, closeP, openTs, won, openMs}

for (const ln of lines) {
  let o; try { o = JSON.parse(ln); } catch { continue; }
  const d = o.data || {};
  if (o.type === 'TICK' && o.asset && typeof d.price === 'number') {
    (ticksByAsset[o.asset] || (ticksByAsset[o.asset] = [])).push({ t: d.serverTs, p: d.price });
  } else if (o.type === 'HISTORY' && o.asset && d.period) {
    periodByAsset[o.asset] = d.period;
  } else if (o.type === 'TRADE_OPEN' && d.id) {
    opens[d.id] = d;
  } else if (o.type === 'TRADE_CLOSE' && d.id) {
    const op = opens[d.id] || d;
    trades.push({
      asset: o.asset, dir: d.direction === 'CALL' ? 1 : -1,
      openP: d.openPrice, closeP: d.closePrice, openTs: d.openTimestamp,
      won: d.won === true, openMs: op.openMs,
    });
  }
}

// أدوات: السرعة (مشتقة أولى) والعجلة (ثانية) قبل توقيت الدخول مباشرة
function ticksBefore(asset, ts, windowSec) {
  const buf = ticksByAsset[asset]; if (!buf) return [];
  return buf.filter(x => x.t <= ts && x.t > ts - windowSec);
}
function slope(asset, ts, win) {
  const w = ticksBefore(asset, ts, win);
  if (w.length < 2) return null;
  const a = w[0], b = w[w.length - 1], dt = b.t - a.t;
  if (dt <= 0 || !(a.p > 0)) return null;
  return (b.p - a.p) / a.p / dt;   // عائد نسبي/ثانية
}
function noise(asset, ts, win) {
  const w = ticksBefore(asset, ts, win);
  if (w.length < 3) return null;
  let s = 0, s2 = 0, k = 0;
  for (let i = 1; i < w.length; i++) { const d = w[i].p - w[i-1].p; s += d; s2 += d*d; k++; }
  const m = s/k; return Math.sqrt(Math.max(0, s2/k - m*m));
}

// صنّف كل صفقة
const rows = [];
for (const t of trades) {
  if (!(t.openP > 0) || t.closeP == null) continue;
  const s2 = slope(t.asset, t.openTs, 2);
  const s4 = slope(t.asset, t.openTs, 4);
  const acc = (s2 != null && s4 != null) ? (s2 - s4) : null;  // تسارع تقريبي
  const nz = noise(t.asset, t.openTs, 4);
  const per = periodByAsset[t.asset] || 5;
  const secInCandle = ((t.openTs % per) + per) % per;     // موقع الدخول داخل الشمعة
  // محاذاة الزخم مع اتجاه الصفقة: >0 مع الاتجاه، <0 معاكس
  const align = (s2 != null) ? Math.sign(s2) * t.dir : 0;
  const snr = (s2 != null && nz > 0) ? (s2 * t.openP * 9 /*~أفق9ث*/) / (nz * Math.sqrt(9*2)) : null;
  rows.push({ ...t, s2, acc, nz, secInCandle, align, snr });
}

function wr(set) {
  const w = set.filter(r => r.won).length, n = set.length;
  return n ? `${(100*w/n).toFixed(0)}% (${w}/${n})` : 'n/a';
}
function bucket(label, pred) {
  const yes = rows.filter(pred), no = rows.filter(r => !pred(r));
  console.log(`  ${label.padEnd(40)} مطابق: ${wr(yes).padEnd(14)} | غير مطابق: ${wr(no)}`);
}

console.log(`\n=== محلّل الصفقات — ${file.split('/').pop()} ===`);
console.log(`إجمالي الصفقات المُقيّمة: ${rows.length} | الفوز الكلي: ${wr(rows)}\n`);

console.log('— حسب محاذاة الزخم (slope 2ث × الاتجاه):');
bucket('مع الزخم (align>0)',          r => r.align > 0);
bucket('معاكس الزخم (align<0)',       r => r.align < 0);

console.log('\n— حسب قوة الإشارة/الضجيج SNR:');
bucket('|SNR|>=1.5 (زخم قوي)',        r => r.snr != null && Math.abs(r.snr) >= 1.5);
bucket('|SNR|<0.5 (هادئ/مسطّح)',      r => r.snr != null && Math.abs(r.snr) < 0.5);

console.log('\n— حسب التسارع (accel) مقابل الاتجاه:');
bucket('تسارع معاكس (استنفاد)',       r => r.acc != null && Math.sign(r.acc) * r.dir < 0);
bucket('تسارع مع الاتجاه',            r => r.acc != null && Math.sign(r.acc) * r.dir > 0);

console.log('\n— حسب موقع الدخول داخل الشمعة:');
bucket('أول نصف الشمعة',              r => r.secInCandle < (periodByAsset[r.asset]||5)/2);
bucket('آخر نصف الشمعة',              r => r.secInCandle >= (periodByAsset[r.asset]||5)/2);

console.log('\n— حسب كمون التنفيذ openMs:');
bucket('بطيء (openMs>=500)',          r => r.openMs >= 500);
bucket('سريع (openMs<500)',           r => r.openMs < 500);

console.log('\n— حسب الضجيج اللحظي:');
const nzMed = rows.map(r=>r.nz).filter(x=>x>0).sort((a,b)=>a-b)[Math.floor(rows.length/2)]||0;
bucket(`ضجيج مرتفع (>${(nzMed*1e5).toFixed(1)}pip)`, r => r.nz > nzMed);
bucket(`ضجيج منخفض`,                  r => r.nz <= nzMed);

console.log('\n— حسب الزوج:');
const byA = {};
rows.forEach(r => (byA[r.asset]||(byA[r.asset]=[])).push(r));
Object.entries(byA).forEach(([a, set]) => console.log(`  ${a.padEnd(14)} ${wr(set)}`));
console.log('');
