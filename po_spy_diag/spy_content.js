/**
 * PO SPY DIAG — spy_content.js  (ISOLATED world)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * يستقبل الأحداث الخام من spy_injected.js عبر CustomEvent('__aoispy_data')
 * ثم يبني طبقة تشخيص Dual-WSS: تصنيف الأوراكل/المنفّذ، عدّ تيكات الأوراكل،
 * قياس السبق Lead/Lag، استخراج السعر/الصفقة/الشمعة/الجلسة، وواجهة عائمة + تصدير.
 * مراقبة سلبية فقط — لا يرسل أوامر.
 */
(function () {
  'use strict';
  if (window.__AOISPY_DIAG_UI) return;
  window.__AOISPY_DIAG_UI = true;

  // ── إعدادات ───────────────────────────────────────────────
  const CFG = { MAX_LOG: 500, MAX_TICKS: 400, UI_MS: 700, PIP: 100000, LOG_TICKS: false };

  const SERVER_MAP = [
    { re: /events-po/i,            role: 'ORACLE',    tag: '🔮 أوراكل' },
    { re: /demo-api|try-demo/i,    role: 'EXEC-DEMO', tag: '⚡ منفّذ ديمو' },
    { re: /api-msk/i,              role: 'EXEC-REAL', tag: '💼 منفّذ حقيقي' },
    { re: /api-eu|api-l/i,         role: 'DATA',      tag: '📊 بيانات' },
    { re: /chat-po/i,              role: 'CHAT',      tag: '💬 شات' },
    { re: /po\.market|pocketoption|po\.trade/i, role: 'PLATFORM', tag: '🌐 منصة' },
  ];
  const classify = (u) => SERVER_MAP.find(s => s.re.test(u || '')) || { role: 'UNKNOWN', tag: '❔ مجهول' };

  // ── مخازن ─────────────────────────────────────────────────
  const S = {
    sockets: new Map(),  // wsId -> {id,url,role,tag,inN,outN,lastIn,lastOut,events}
    rawLog: [], ticks: {}, lastPrice: {}, candles: {}, trades: [],
    session: { token: null, ssid: null, uid: null, balance: null, isDemo: null,
               activeAsset: null, cookies: '', storage: {}, dom: {} },
    leadlag: { samples: [], emaMs: null },
    counters: { text: 0, bin: 0, decoded: 0 },
    start: Date.now(),
  };
  const log = (dir, sid, role, ev, prev) => {
    S.rawLog.push({ ts: Date.now(), dir, sid, role, ev, prev: String(prev).slice(0, 170) });
    if (S.rawLog.length > CFG.MAX_LOG) S.rawLog.shift();
  };
  const pushTick = (role, asset, price, ts) => {
    const a = S.ticks[role] || (S.ticks[role] = []);
    a.push({ asset, price, ts }); if (a.length > CFG.MAX_TICKS) a.shift();
  };

  // ── مستخرج التيك (يدعم كل صيغ PO) ─────────────────────────
  function extractTick(arr) {
    try {
      if (Array.isArray(arr)) {
        if (Array.isArray(arr[0]) && typeof arr[0][0] === 'string') arr = arr[0];
        if (typeof arr[0] === 'string' && arr[0].length >= 3) {
          const asset = arr[0].replace(/^#/, '');
          let price = null;
          for (let i = arr.length - 1; i >= 1; i--) if (typeof arr[i] === 'number' && arr[i] > 0) { price = arr[i]; break; }
          if (price != null) return { asset, price, ts: Date.now() };
        }
      } else if (arr && typeof arr === 'object') {
        const asset = arr.asset || arr.symbol || arr.active;
        const price = arr.price || arr.close || arr.rate || arr.value;
        if (asset && typeof price === 'number') return { asset: String(asset).replace(/^#/, ''), price, ts: Date.now() };
      }
    } catch (_) {}
    return null;
  }
  function buildCandle(asset, price) {
    const c = S.candles[asset];
    const now = Date.now();
    if (!c) { S.candles[asset] = { open: price, high: price, low: price, close: price, prices: [price], startTime: now, period: 0, ticks: 1 }; return; }
    c.close = price; c.ticks++; c.prices.push(price); if (c.prices.length > 300) c.prices.shift();
    if (price > c.high) c.high = price; if (price < c.low) c.low = price;
  }
  function recordLeadLag(asset, price, role) {
    const lp = S.lastPrice[asset] || (S.lastPrice[asset] = {});
    lp[role] = { p: price, t: Date.now() };
    const o = lp.ORACLE, x = lp['EXEC-DEMO'] || lp['EXEC-REAL'] || lp.DATA;
    if (o && x) {
      const dT = o.t - x.t;
      S.leadlag.samples.push({ dT, t: Date.now() });
      if (S.leadlag.samples.length > 200) S.leadlag.samples.shift();
      S.leadlag.emaMs = S.leadlag.emaMs == null ? dT : S.leadlag.emaMs * 0.9 + dT * 0.1;
    }
  }
  function captureSession(obj) {
    try {
      const flat = JSON.stringify(obj);
      const m = flat.match(/"(session|token|ssid|auth_token|access_token)"\s*:\s*"([^"]{8,})"/i);
      if (m && !S.session.token) { S.session.token = m[2]; S.session.ssid = m[2]; }
      if (obj && typeof obj === 'object') {
        if (obj.uid != null) S.session.uid = obj.uid;
        if (obj.balance != null) S.session.balance = obj.balance;
        if (obj.isDemo != null) S.session.isDemo = obj.isDemo;
        if (obj.demo != null) S.session.isDemo = obj.demo;
      }
    } catch (_) {}
  }
  function refreshClient() {
    try { S.session.cookies = document.cookie || ''; } catch (_) {}
    try {
      const st = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/token|session|ssid|uid|auth|user|balance|demo/i.test(k)) st[k] = String(localStorage.getItem(k)).slice(0, 200);
      }
      S.session.storage = st;
    } catch (_) {}
  }

  // ── معالج موحّد لإطار ──────────────────────────────────────
  function handleFrame(wsId, wsUrl, dir, ev, payload) {
    const sock = S.sockets.get(wsId);
    const role = sock ? sock.role : classify(wsUrl).role;
    if (sock) { sock.events[ev] = (sock.events[ev] || 0) + 1; }

    if (/auth|success|profile|user|balance|environment/i.test(ev)) captureSession(payload);

    if (ev === 'signals') {
      const t = extractTick(payload);
      if (t) { pushTick(role, t.asset, t.price, t.ts); recordLeadLag(t.asset, t.price, role); if (role === 'ORACLE') buildCandle(t.asset, t.price); }
    }
    if (['updateStream', 'tick', 'quote', 'stream'].includes(ev)) {
      const t = extractTick(payload);
      if (t) { pushTick(role, t.asset, t.price, t.ts); recordLeadLag(t.asset, t.price, role); buildCandle(t.asset, t.price); }
    }
    if (ev === 'updateHistoryNewFast' && payload && payload.asset) {
      const a = String(payload.asset).replace(/^#/, '');
      const c = S.candles[a] || (S.candles[a] = { prices: [], ticks: 0, startTime: Date.now() });
      if (payload.period) c.period = payload.period;
    }
    if (ev === 'changeSymbol' && payload) {
      const a = payload.asset || (Array.isArray(payload) ? payload[0] : null);
      if (a) S.session.activeAsset = String(a).replace(/^#/, '');
    }
    if (ev === 'successopenOrder' && payload && payload.id) {
      S.trades.push({ id: payload.id, asset: (payload.asset || payload.active || '').replace(/^#/, ''),
        dir: (payload.command === 0 || payload.action === 'call') ? 'BUY' : 'SELL',
        amount: payload.amount, dur: payload.duration || payload.timeframe,
        openPrice: payload.openPrice || payload.openRate, openTs: Date.now(), result: 'pending', pips: null });
      if (S.trades.length > 80) S.trades.shift();
    }
    if (ev === 'successcloseOrder' && payload) {
      const deals = payload.deals || (Array.isArray(payload) ? payload : [payload]);
      for (const d of deals) {
        const tr = S.trades.find(x => x.id === d.id);
        if (tr) { tr.closePrice = d.closePrice || d.closeRate; tr.profit = d.profit;
          tr.result = d.profit > 0 ? 'WIN' : (d.profit < 0 ? 'LOSS' : 'TIE');
          if (tr.openPrice && tr.closePrice) tr.pips = ((tr.closePrice - tr.openPrice) * CFG.PIP).toFixed(1); }
      }
    }
    if (ev === 'successupdateBalance' && payload && payload.balance != null) S.session.balance = payload.balance;

    if (!/updateStream|^binary$/.test(ev) || CFG.LOG_TICKS) log(dir, wsId, role, ev, JSON.stringify(payload));
  }

  // ── استقبال أحداث الحقن ────────────────────────────────────
  window.addEventListener('__aoispy_data', (e) => {
    const d = e.detail || {}; const c = d.category, data = d.data;
    if (!c || !data) return;
    try {
      if (c === 'ws_open') {
        const cl = classify(data.wsUrl);
        if (!S.sockets.has(data.wsId)) S.sockets.set(data.wsId, { id: data.wsId, url: data.wsUrl, role: cl.role, tag: cl.tag, inN: 0, outN: 0, lastIn: 0, lastOut: 0, events: {} });
        log('sys', data.wsId, cl.role, 'OPEN', (data.wsUrl || '').split('?')[0]);
      }
      else if (c === 'ws_text') {
        S.counters.text++;
        const sock = S.sockets.get(data.wsId);
        if (sock) { const di = data.direction === 'sent' ? 'outN' : 'inN'; sock[di]++; sock[data.direction === 'sent' ? 'lastOut' : 'lastIn'] = Date.now(); }
        if (data.isHeartbeat) return;
        if (data.direction === 'sent') captureSession(data.parsed);
        if (Array.isArray(data.parsed) && data.parsed.length >= 1) {
          handleFrame(data.wsId, data.wsUrl, data.direction === 'sent' ? 'out' : 'in', data.parsed[0], data.parsed[1]);
        }
      }
      else if (c === 'ws_binary') {
        S.counters.bin++; if (data.decoded != null) S.counters.decoded++;
        const sock = S.sockets.get(data.wsId);
        if (sock) { sock.inN++; sock.lastIn = Date.now(); }
        handleFrame(data.wsId, data.wsUrl, data.direction === 'sent' ? 'out' : 'in', data.eventName || 'binary', data.decoded);
      }
      else if (c === 'dom_poll') {
        S.session.dom = data;
        if (data.asset) S.session.activeAsset = S.session.activeAsset || data.asset;
        if (data.balance != null) S.session.balance = data.balance;
        if (data.isDemo != null || data.accountType) S.session.isDemo = data.isDemo != null ? data.isDemo : /demo/i.test(data.accountType || '');
      }
    } catch (_) {}
  });

  // ── الواجهة ────────────────────────────────────────────────
  const TABS = ['servers', 'ticks', 'oracle', 'candles', 'trades', 'session', 'raw'];
  const LBL = { servers: '📡 سيرفرات', ticks: '💹 تيكات', oracle: '🔮 أوراكل', candles: '🕯️ شموع', trades: '💰 صفقات', session: '🔑 جلسة', raw: '📜 خام' };
  let tab = 'oracle';

  function mount() {
    if (document.getElementById('poDiagRoot')) return;
    const st = document.createElement('style');
    st.textContent = `
      #poDiagRoot{position:fixed;bottom:14px;right:14px;width:440px;max-width:96vw;z-index:2147483647;
        font-family:'Segoe UI','Noto Sans Arabic',sans-serif;direction:rtl;font-size:12px;}
      #poDiagHd{background:linear-gradient(135deg,#0f2027,#2c5364);color:#fff;padding:9px 12px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:grab;}
      #poDiagHd b{font-size:13px} #poDiagHd .s{font-size:10px;opacity:.85}
      #poDiagBd{background:#0b1220;color:#cbd5e1;border:1px solid #1e293b;border-top:none;border-radius:0 0 12px 12px;max-height:64vh;display:flex;flex-direction:column}
      #poDiagTabs{display:flex;flex-wrap:wrap;gap:3px;padding:6px;background:#0e1626;border-bottom:1px solid #1e293b}
      .poDiagTab{font-size:10.5px;padding:4px 8px;border-radius:7px;background:#1e293b;color:#94a3b8;cursor:pointer}
      .poDiagTab.on{background:#2563eb;color:#fff}
      #poDiagCt{padding:8px;overflow:auto;font-size:11px;line-height:1.55}
      #poDiagFt{display:flex;gap:6px;padding:7px;border-top:1px solid #1e293b;background:#0e1626;border-radius:0 0 12px 12px}
      .poDiagB{flex:1;font-size:11px;padding:6px;border-radius:8px;border:none;cursor:pointer;color:#fff}
      .bC{background:#16a34a} .bJ{background:#7c3aed} .bX{background:#475569} .bM{background:#334155}
      table.t{width:100%;border-collapse:collapse}
      table.t td,table.t th{border-bottom:1px solid #1e293b;padding:4px 5px;text-align:right;font-size:10.5px}
      table.t th{color:#7dd3fc}
      .m{font-family:Consolas,monospace;direction:ltr;unicode-bidi:embed}
      .pill{display:inline-block;padding:1px 6px;border-radius:6px;font-size:9.5px}
      .pOracle{background:#7c3aed;color:#fff}.pExec{background:#16a34a;color:#fff}.pData{background:#2563eb;color:#fff}.pChat{background:#475569;color:#fff}.pPlat{background:#0891b2;color:#fff}.pUnk{background:#b91c1c;color:#fff}
      .kv{display:flex;justify-content:space-between;padding:2px 0}.kv b{color:#7dd3fc}.kv span{color:#e2e8f0}
      .big{font-size:16px;font-weight:700}.grn{color:#4ade80}.red{color:#f87171}.yel{color:#facc15}
      #poDiagRoot.min #poDiagBd{display:none}
    `;
    (document.head || document.documentElement).appendChild(st);
    const r = document.createElement('div'); r.id = 'poDiagRoot';
    r.innerHTML = `<div id="poDiagHd"><b>🕵️ PO SPY DIAG</b><span class="s" id="poDiagS">—</span></div>
      <div id="poDiagBd"><div id="poDiagTabs"></div><div id="poDiagCt">…</div>
      <div id="poDiagFt">
        <button class="poDiagB bC">📋 نسخ</button><button class="poDiagB bJ">⬇️ JSON</button>
        <button class="poDiagB bX">🗑️</button><button class="poDiagB bM">_</button></div></div>`;
    (document.body || document.documentElement).appendChild(r);
    const tb = r.querySelector('#poDiagTabs');
    TABS.forEach(t => { const b = document.createElement('div'); b.className = 'poDiagTab' + (t === tab ? ' on' : ''); b.textContent = LBL[t];
      b.onclick = () => { tab = t; tb.querySelectorAll('.poDiagTab').forEach(x => x.classList.remove('on')); b.classList.add('on'); render(); }; tb.appendChild(b); });
    r.querySelector('.bC').onclick = () => copy(report());
    r.querySelector('.bJ').onclick = () => dl();
    r.querySelector('.bX').onclick = () => { S.rawLog.length = 0; S.trades.length = 0; for (const k in S.ticks) S.ticks[k].length = 0; render(); };
    r.querySelector('.bM').onclick = () => r.classList.toggle('min');
    let drag = null;
    r.querySelector('#poDiagHd').addEventListener('mousedown', e => drag = { x: e.clientX, y: e.clientY, b: r.getBoundingClientRect() });
    window.addEventListener('mousemove', e => { if (!drag) return; r.style.left = (drag.b.left + e.clientX - drag.x) + 'px'; r.style.top = (drag.b.top + e.clientY - drag.y) + 'px'; r.style.right = 'auto'; r.style.bottom = 'auto'; });
    window.addEventListener('mouseup', () => drag = null);
  }

  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const ago = t => t ? ((Date.now() - t) / 1000).toFixed(1) + 'ث' : '—';
  const pc = r => r === 'ORACLE' ? 'pOracle' : /EXEC/.test(r) ? 'pExec' : r === 'DATA' ? 'pData' : r === 'CHAT' ? 'pChat' : r === 'PLATFORM' ? 'pPlat' : 'pUnk';

  function render() {
    const el = document.getElementById('poDiagCt'); if (!el) return;
    const o = (S.ticks.ORACLE || []).length;
    const sEl = document.getElementById('poDiagS');
    if (sEl) sEl.textContent = `سوكِت:${S.sockets.size} · أوراكل:${o} · ${((Date.now() - S.start) / 1000) | 0}ث`;
    let h = '';
    if (tab === 'servers') {
      h += `<table class="t"><tr><th>#</th><th>الدور</th><th>الرابط</th><th>وارد</th><th>صادر</th><th>آخر</th></tr>`;
      for (const [, s] of S.sockets) h += `<tr><td>${s.id}</td><td><span class="pill ${pc(s.role)}">${s.tag}</span></td><td class="m" style="max-width:120px;overflow:hidden">${esc((s.url || '').replace(/^wss?:\/\//, '').split('/')[0])}</td><td>${s.inN}</td><td>${s.outN}</td><td class="m">${ago(s.lastIn)}</td></tr>`;
      h += `</table><div class="m" style="margin-top:6px">إطارات: نص ${S.counters.text} · ثنائي ${S.counters.bin} · مفكوك ${S.counters.decoded}</div>`;
    }
    else if (tab === 'ticks') {
      for (const role of Object.keys(S.ticks)) { const a = S.ticks[role], l = a[a.length - 1]; h += `<div class="kv"><b><span class="pill ${pc(role)}">${role}</span></b><span class="m">${a.length} تيك · ${l ? l.asset + ' @ ' + l.price : '—'}</span></div>`; }
      h += `<table class="t" style="margin-top:6px"><tr><th>الدور</th><th>الزوج</th><th>السعر</th><th>منذ</th></tr>`;
      const mg = []; for (const role of Object.keys(S.ticks)) for (const t of S.ticks[role].slice(-12)) mg.push({ role, ...t });
      mg.sort((a, b) => b.ts - a.ts);
      for (const t of mg.slice(0, 16)) h += `<tr><td><span class="pill ${pc(t.role)}">${t.role}</span></td><td class="m">${esc(t.asset)}</td><td class="m">${t.price}</td><td class="m">${ago(t.ts)}</td></tr>`;
      h += `</table>`;
    }
    else if (tab === 'oracle') {
      const o2 = S.ticks.ORACLE || [], ll = S.leadlag;
      const hasOracleSock = [...S.sockets.values()].some(s => s.role === 'ORACLE');
      h += `<div class="kv"><b>مقبس أوراكل مفتوح؟</b><span class="${hasOracleSock ? 'grn' : 'red'}">${hasOracleSock ? 'نعم ✓' : 'لا ✗'}</span></div>`;
      h += `<div class="kv"><b>تيكات الأوراكل:</b><span class="big ${o2.length ? 'grn' : 'red'}">${o2.length}</span></div>`;
      if (!o2.length) h += `<div class="yel" style="margin:6px 0">⚠️ ${hasOracleSock ? 'المقبس مفتوح لكن لا يبثّ signals لهذا الزوج.' : 'لم يُفتح اتصال events-po إطلاقاً.'} هذا سبب خمول فلتر الأوراكل في البوت.</div>`;
      else { const l = o2[o2.length - 1]; h += `<div class="kv"><b>آخر سعر:</b><span class="m big">${l.price}</span></div><div class="kv"><b>الزوج:</b><span class="m">${esc(l.asset)}</span></div>`; }
      h += `<div class="kv"><b>السبق Lead/Lag (EMA):</b><span class="m ${ll.emaMs < 0 ? 'grn' : 'yel'}">${ll.emaMs == null ? '— لا مقارنة' : ll.emaMs.toFixed(0) + ' ms'}</span></div>`;
      h += `<div class="m" style="font-size:10px;color:#64748b">سالب = الأوراكل أسرع (سبق حقيقي للمراجحة) · موجب = المنفّذ أسرع · عيّنات: ${ll.samples.length}</div>`;
    }
    else if (tab === 'candles') {
      h += `<table class="t"><tr><th>الزوج</th><th>سعر</th><th>قمة/قاع</th><th>تيكات</th><th>عمر</th><th>فريم</th></tr>`;
      for (const a of Object.keys(S.candles)) { const c = S.candles[a]; h += `<tr><td class="m">${esc(a)}</td><td class="m">${c.close || 0}</td><td class="m">${c.high || 0}/${c.low || 0}</td><td>${c.ticks || 0}</td><td class="m">${ago(c.startTime)}</td><td class="m">${c.period || '?'}ث</td></tr>`; }
      h += `</table>`;
      const dom = S.session.dom || {};
      if (dom.candleLabel || dom.candleTimer) h += `<div class="kv" style="margin-top:6px"><b>من الشاشة:</b><span class="m">شمعة ${esc(dom.candleLabel || '?')} · مؤقت ${esc(dom.candleTimer || '?')}</span></div>`;
    }
    else if (tab === 'trades') {
      h += `<table class="t"><tr><th>الزوج</th><th>اتجاه</th><th>مبلغ</th><th>مدة</th><th>دخول</th><th>نقاط</th><th>نتيجة</th></tr>`;
      for (const t of S.trades.slice(-14).reverse()) { const rc = t.result === 'WIN' ? 'grn' : t.result === 'LOSS' ? 'red' : 'yel'; h += `<tr><td class="m">${esc(t.asset)}</td><td>${t.dir}</td><td class="m">${t.amount ?? '?'}</td><td class="m">${t.dur ?? '?'}</td><td class="m">${t.openPrice ?? '?'}</td><td class="m ${rc}">${t.pips ?? '—'}</td><td class="${rc}">${t.result}</td></tr>`; }
      h += `</table>`;
      if (!S.trades.length) h += `<div style="color:#64748b">لا صفقات بعد.</div>`;
    }
    else if (tab === 'session') {
      refreshClient(); const s = S.session, dom = s.dom || {};
      const row = (k, v) => `<div class="kv"><b>${k}</b><span class="m">${esc(v == null ? '—' : String(v).slice(0, 60))}</span></div>`;
      h += row('الزوج النشط', s.activeAsset || dom.asset);
      h += row('نوع الحساب', dom.accountType); h += row('isDemo', s.isDemo);
      h += row('الرصيد', s.balance ?? dom.balance); h += row('UID', s.uid);
      h += row('السعر الحالي', dom.currentPrice); h += row('مبلغ الصفقة', dom.tradeAmount);
      h += row('مدة الصفقة', dom.tradeDuration || dom.durationSecs); h += row('نسبة الربح %', dom.profitPct);
      h += row('التوكن', s.token); h += row('SSID', s.ssid);
      h += `<div class="kv"><b>الكوكي</b><span class="m" style="max-width:60%;overflow:hidden">${esc((s.cookies || '').slice(0, 70))}…</span></div>`;
      h += `<div style="color:#7dd3fc;margin-top:4px">localStorage:</div>`;
      for (const k of Object.keys(s.storage || {})) h += row(k, s.storage[k]);
    }
    else if (tab === 'raw') {
      h += `<div class="m" style="font-size:10px">`;
      for (const r of S.rawLog.slice(-60).reverse()) { const cls = r.dir === 'in' ? 'grn' : r.dir === 'out' ? 'red' : 'yel'; const tm = new Date(r.ts).toLocaleTimeString('en-GB', { hour12: false }); h += `<div class="${cls}">[${tm}] #${r.sid} ${r.dir.toUpperCase()} <b>${esc(r.ev)}</b> ${esc(r.prev)}</div>`; }
      h += `</div>`;
    }
    el.innerHTML = h;
  }

  // ── تصدير ─────────────────────────────────────────────────
  function report() {
    const L = ['════ PO SPY DIAG — تقرير تشخيصي ════', 'الوقت: ' + new Date().toLocaleString(), 'تشغيل: ' + (((Date.now() - S.start) / 1000) | 0) + 'ث', ''];
    L.push('── السيرفرات (' + S.sockets.size + ') ──');
    for (const [, s] of S.sockets) { L.push(`#${s.id} [${s.role}] ${(s.url || '').split('?')[0]}`); L.push(`   وارد:${s.inN} صادر:${s.outN} آخر:${ago(s.lastIn)} | أحداث: ${Object.entries(s.events).map(([k, v]) => k + '×' + v).join(', ') || '—'}`); }
    L.push(''); L.push('── الأوراكل (الحاسم) ──');
    const o = S.ticks.ORACLE || []; const hasO = [...S.sockets.values()].some(s => s.role === 'ORACLE');
    L.push('مقبس أوراكل مفتوح: ' + (hasO ? 'نعم' : 'لا'));
    L.push('تيكات الأوراكل: ' + o.length + (o.length ? '' : '  ⚠️ لا يبثّ → فلتر الأوراكل خامل'));
    L.push('Lead/Lag EMA: ' + (S.leadlag.emaMs == null ? '—' : S.leadlag.emaMs.toFixed(0) + ' ms') + ' (سالب=سبق) | عيّنات: ' + S.leadlag.samples.length);
    L.push(''); L.push('── التيكات لكل مصدر ──');
    for (const r of Object.keys(S.ticks)) { const a = S.ticks[r], l = a[a.length - 1]; L.push(`${r}: ${a.length} | آخر: ${l ? l.asset + ' @ ' + l.price : '—'}`); }
    L.push(''); L.push('── الشموع ──');
    for (const a of Object.keys(S.candles)) { const c = S.candles[a]; L.push(`${a}: ${c.close} | قمة ${c.high} قاع ${c.low} | تيكات ${c.ticks} | عمر ${ago(c.startTime)} | فريم ${c.period || '?'}ث`); }
    L.push(''); L.push('── الصفقات ──');
    for (const t of S.trades) L.push(`${t.asset} ${t.dir} $${t.amount} ${t.dur} | دخول ${t.openPrice} خروج ${t.closePrice ?? '?'} | نقاط ${t.pips ?? '?'} | ${t.result}`);
    L.push(''); L.push('── الجلسة ──'); refreshClient(); const s = S.session, dom = s.dom || {};
    L.push('الزوج: ' + (s.activeAsset || dom.asset) + ' | نوع: ' + (dom.accountType || '?') + ' | isDemo: ' + s.isDemo);
    L.push('الرصيد: ' + (s.balance ?? dom.balance) + ' | UID: ' + s.uid);
    L.push('السعر: ' + dom.currentPrice + ' | مبلغ: ' + dom.tradeAmount + ' | مدة: ' + (dom.tradeDuration || dom.durationSecs) + ' | ربح%: ' + dom.profitPct);
    L.push('التوكن: ' + (s.token || '—')); L.push('الكوكي: ' + (s.cookies || '—'));
    L.push('localStorage: ' + JSON.stringify(s.storage || {}));
    L.push(''); L.push('── آخر 80 إطار خام ──');
    for (const r of S.rawLog.slice(-80)) { const tm = new Date(r.ts).toLocaleTimeString('en-GB', { hour12: false }); L.push(`[${tm}] #${r.sid} ${r.dir.toUpperCase()} ${r.ev} ${r.prev}`); }
    return L.join('\n');
  }
  function copy(txt) {
    try { navigator.clipboard.writeText(txt).then(() => flash('✅ نُسخ'), () => fb(txt)); } catch (_) { fb(txt); }
  }
  function fb(txt) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); flash('✅ نُسخ'); } catch (_) { flash('❌ تعذّر'); } ta.remove(); }
  function dl() {
    const data = { generatedAt: new Date().toISOString(), uptimeSec: (Date.now() - S.start) / 1000,
      sockets: [...S.sockets.values()], ticks: S.ticks, candles: S.candles, trades: S.trades,
      leadlag: S.leadlag, session: S.session, counters: S.counters, rawLog: S.rawLog.slice(-200) };
    const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'po_spy_diag_' + Date.now() + '.json'; a.click(); flash('⬇️ نُزّل');
  }
  function flash(m) { const s = document.getElementById('poDiagS'); if (!s) return; s.textContent = m; setTimeout(() => { try { render(); } catch (_) {} }, 1400); }

  // ── إقلاع ──────────────────────────────────────────────────
  function boot() {
    if (!document.body) return setTimeout(boot, 150);
    mount(); refreshClient();
    setInterval(() => { try { render(); } catch (_) {} }, CFG.UI_MS);
    setInterval(refreshClient, 5000);
    render();
    console.log('%c🕵️ PO SPY DIAG (extension) active', 'color:#2c5364;font-weight:bold');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
