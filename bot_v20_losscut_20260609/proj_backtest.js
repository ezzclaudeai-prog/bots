#!/usr/bin/env node
// [V21] تحقق رياضي مستقل لمحرك الإسقاط على تيكات التجسس الحقيقية.
// يعيد بناء منطق TickProjector.decision حرفياً ويقيس: هل الإسقاط (الاتجاه عند الدخول)
// يتنبأ فعلاً بنتيجة الصفقة الثنائية بعد أفق H ثانية؟ + توزيع SNR.
// التشغيل: node proj_backtest.js <spy.ndjson> [horizonSec]
const fs = require('fs');

const CFG = {
  PROJ_SLOPE_MS: 2000, PROJ_ACCEL_MS: 1500, PROJ_NOISE_TICKS: 40,
  PROJ_DAMP_BASE: 0.60, PROJ_DAMP_WITH_ACCEL: 0.90, PROJ_DAMP_VS_ACCEL: 0.30,
  PROJ_MIN_SNR: 1.5, PROJ_EXEC_LATENCY_MS: 400,
};

function microSlope(buf, ms) {
  if (buf.length < 2) return null;
  const last = buf[buf.length - 1], now = last.t;
  let i = buf.length - 1; while (i > 0 && buf[i].t > now - ms) i--;
  const p0 = buf[i].p, dt = now - buf[i].t, n = buf.length - 1 - i;
  if (!(p0 > 0) || dt <= 0) return null;
  return { rel: (last.p - p0) / p0, abs: last.p - p0, dt, ticks: n, ratePerSec: n / (dt / 1000) };
}
function microAccel(buf, ms) {
  if (buf.length < 3) return null;
  const last = buf[buf.length - 1], now = last.t, half = ms * 0.5;
  let iMid = buf.length - 1; while (iMid > 0 && buf[iMid].t > now - half) iMid--;
  let iStart = iMid; while (iStart > 0 && buf[iStart].t > now - ms) iStart--;
  const pNow = last.p, pMid = buf[iMid].p, pStart = buf[iStart].p;
  const dt1 = buf[iMid].t - buf[iStart].t, dt2 = now - buf[iMid].t;
  if (!(pStart > 0) || !(pMid > 0) || dt1 <= 0 || dt2 <= 0) return null;
  const v1 = ((pMid - pStart) / pStart) / (dt1 / 1000);
  const v2 = ((pNow - pMid) / pMid) / (dt2 / 1000);
  return { accel: v2 - v1 };
}
function tickNoise(prices) {
  const n = Math.min(CFG.PROJ_NOISE_TICKS, prices.length - 1);
  if (n < 2) return null;
  let s = 0, s2 = 0, k = 0;
  for (let i = prices.length - n; i < prices.length; i++) { const d = prices[i] - prices[i-1]; s += d; s2 += d*d; k++; }
  const mean = s/k, varr = Math.max(0, s2/k - mean*mean);
  return { sd: Math.sqrt(varr), n: k };
}
function decision(buf, prices, horizonSec) {
  const slope = microSlope(buf, CFG.PROJ_SLOPE_MS);
  const noise = tickNoise(prices);
  if (!slope || !noise || !(noise.sd > 0) || !(slope.dt > 0)) return null;
  let h = Math.max(0.5, horizonSec - CFG.PROJ_EXEC_LATENCY_MS / 1000);
  const vPerSec = slope.abs / (slope.dt / 1000);
  const acc = microAccel(buf, CFG.PROJ_ACCEL_MS);
  let damp = CFG.PROJ_DAMP_BASE;
  if (acc && Number.isFinite(acc.accel)) damp = ((acc.accel >= 0) === (vPerSec >= 0)) ? CFG.PROJ_DAMP_WITH_ACCEL : CFG.PROJ_DAMP_VS_ACCEL;
  const projMove = vPerSec * h * damp;
  const tickRate = slope.ratePerSec > 0 ? slope.ratePerSec : (noise.n / (CFG.PROJ_SLOPE_MS / 1000));
  const noiseHorizon = noise.sd * Math.sqrt(Math.max(1, tickRate * h));
  const snr = noiseHorizon > 0 ? projMove / noiseHorizon : 0;
  return { dir: projMove > 0 ? 'BUY' : 'SELL', snr, absSnr: Math.abs(snr), projMove, edge: Math.abs(snr) >= CFG.PROJ_MIN_SNR };
}

const file = process.argv[2];
const H = Number(process.argv[3] || 9);   // أفق الصفقة (التجسس: ~9ث)
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const byAsset = {};   // asset -> [{t,p}]  (t بالملي ثانية من serverTs)
const samples = [];   // كل صفقة افتراضية: قرار الآن مقابل السعر الفعلي بعد H

for (const ln of lines) {
  let o; try { o = JSON.parse(ln); } catch { continue; }
  if (o.type !== 'TICK' || !o.asset || !o.data || typeof o.data.price !== 'number') continue;
  const a = o.asset, t = Math.round(o.data.serverTs * 1000), p = o.data.price;
  const buf = byAsset[a] || (byAsset[a] = []);
  buf.push({ t, p });
  if (buf.length > 800) buf.shift();
  // اتخذ قراراً افتراضياً، ثم احسب نتيجته الفعلية بعد H ثانية ضمن نفس الزوج
  if (buf.length >= 10) {
    const prices = buf.map(x => x.p);
    const d = decision(buf, prices, H);
    if (d) samples.push({ a, t, p, dir: d.dir, snr: d.snr, absSnr: d.absSnr, edge: d.edge });
  }
}

// قيّم كل عيّنة: ابحث عن سعر الزوج بعد ~H ثانية (±1.5ث) وحدّد الفوز الثنائي
function evalSet(arr, label) {
  let win = 0, loss = 0, tie = 0;
  for (const s of arr) {
    const buf = byAsset[s.a];
    const tgt = s.t + H * 1000;
    let future = null;
    for (let i = 0; i < buf.length; i++) { if (buf[i].t >= tgt && buf[i].t <= tgt + 1500) { future = buf[i].p; break; } }
    if (future == null) continue;
    const moved = future - s.p;
    if (Math.abs(moved) < 1e-9) { tie++; continue; }
    const correct = (s.dir === 'BUY' && moved > 0) || (s.dir === 'SELL' && moved < 0);
    if (correct) win++; else loss++;
  }
  const total = win + loss;
  const wr = total ? (100 * win / total).toFixed(1) : 'n/a';
  console.log(`${label.padEnd(28)} n=${String(total).padStart(5)}  WR=${wr}%  (win ${win} / loss ${loss}, ties ${tie})`);
  return { total, win, loss, wr: total ? win/total : null };
}

console.log(`\n=== V21 Projector validation — file=${file.split('/').pop()} horizon=${H}s ===`);
console.log(`total ticks parsed: ${Object.values(byAsset).reduce((s,b)=>s+b.length,0)}, assets: ${Object.keys(byAsset).join(', ')}`);
console.log(`decisions evaluated: ${samples.length}\n`);
evalSet(samples, 'ALL decisions');
evalSet(samples.filter(s => s.edge), `EDGE only (|SNR|>=${CFG.PROJ_MIN_SNR})`);
evalSet(samples.filter(s => s.absSnr >= 2.5), 'STRONG edge (|SNR|>=2.5)');
evalSet(samples.filter(s => s.absSnr < 0.5), 'NO edge (|SNR|<0.5) [coinflip]');

// توزيع SNR
const abs = samples.map(s => s.absSnr).sort((a,b)=>a-b);
const q = f => abs.length ? abs[Math.floor(f*(abs.length-1))].toFixed(2) : 'n/a';
console.log(`\n|SNR| distribution: p25=${q(.25)} p50=${q(.5)} p75=${q(.75)} p90=${q(.9)} p99=${q(.99)} max=${abs.length?abs[abs.length-1].toFixed(2):'n/a'}`);
const edgePct = samples.length ? (100*samples.filter(s=>s.edge).length/samples.length).toFixed(1) : '0';
console.log(`decisions flagged as real edge: ${edgePct}%  ← الباقي = رمي عملة (لا أفضلية)\n`);
