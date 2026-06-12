// ==UserScript==
// @name         🍪 PO Session Exporter — Cookie + Storage dumper for CDP injection
// @namespace    pocket-option-session-exporter
// @version      1.0.0
// @description  يسحب كوكيز جلسة بوكيت أوبشن (بما فيها httpOnly عبر GM_cookie) + localStorage/sessionStorage ويُنزّلها كملف txt (وصيغة JSON جاهزة لحقن CDP Network.setCookie). لإعداد بيئة الاختبار الذاتية على حسابك التجريبي فقط.
// @author       aoirusra
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://pocketoption.com/*
// @grant        GM_cookie
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

/*
  ⚠️ تحذير أمني — اقرأه:
  • هذا الملف يحتوي على كوكيز جلستك = وصول كامل لحسابك. عامله كأنه كلمة المرور.
  • أرسله فقط إلى VPS الخاص بك عبر قناة آمنة، واستخدمه على الحساب التجريبي.
  • احذف الملف بعد الحقن. الكوكيز تنتهي صلاحيتها، فأعد التصدير عند الحاجة.
  • لا ترفعه إلى Git/أي مكان عام، ولا ترسله لأي طرف لا تثق به.
*/

(function () {
  'use strict';
  if (window.__PO_SESSION_EXPORTER) return;
  window.__PO_SESSION_EXPORTER = true;

  const HOST = location.hostname;

  // ── جمع الكوكيز عبر GM_cookie (يشمل httpOnly) مع fallback إلى document.cookie ──
  function collectCookies() {
    return new Promise((resolve) => {
      const out = [];
      // 1) document.cookie (غير httpOnly فقط) — احتياطي دائماً متاح
      try {
        document.cookie.split(';').forEach((kv) => {
          const i = kv.indexOf('=');
          if (i > 0) {
            const name = kv.slice(0, i).trim();
            const value = kv.slice(i + 1).trim();
            if (name) out.push({ name, value, domain: HOST, path: '/', source: 'document.cookie', httpOnly: false });
          }
        });
      } catch (_) {}

      // 2) GM_cookie.list — يقرأ كل الكوكيز للنطاق بما فيها httpOnly/secure
      if (typeof GM_cookie !== 'undefined' && GM_cookie && typeof GM_cookie.list === 'function') {
        try {
          GM_cookie.list({}, (cookies, err) => {
            if (!err && Array.isArray(cookies)) {
              // استبدل/أضف من قائمة GM (أدق: فيها httpOnly والنطاق والمسار)
              const byKey = new Map(out.map((c) => [c.name + '|' + c.domain + '|' + c.path, c]));
              for (const c of cookies) {
                const rec = {
                  name: c.name, value: c.value,
                  domain: c.domain || HOST, path: c.path || '/',
                  secure: !!c.secure, httpOnly: !!c.httpOnly,
                  sameSite: c.sameSite || undefined,
                  expirationDate: c.expirationDate || undefined,
                  session: c.session !== undefined ? c.session : undefined,
                  source: 'GM_cookie',
                };
                byKey.set(rec.name + '|' + rec.domain + '|' + rec.path, rec);
              }
              resolve(Array.from(byKey.values()));
              return;
            }
            resolve(out);
          });
          return;
        } catch (_) { resolve(out); return; }
      }
      resolve(out);
    });
  }

  function dumpStorage(store) {
    const o = {};
    try { for (let i = 0; i < store.length; i++) { const k = store.key(i); o[k] = store.getItem(k); } } catch (_) {}
    return o;
  }

  // ── تحويل الكوكيز لصيغة CDP Network.setCookie الجاهزة للحقن ──
  function toCDP(cookies) {
    return cookies.map((c) => {
      const e = { name: c.name, value: c.value, domain: c.domain || HOST, path: c.path || '/' };
      if (c.secure)   e.secure = true;
      if (c.httpOnly) e.httpOnly = true;
      if (c.sameSite) e.sameSite = (c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1));
      if (c.expirationDate) e.expires = Math.floor(c.expirationDate);
      return e;
    });
  }

  async function exportAll() {
    const cookies = await collectCookies();
    const local   = dumpStorage(localStorage);
    const session = dumpStorage(sessionStorage);
    const cdp     = toCDP(cookies);

    const httpOnlyCount = cookies.filter((c) => c.httpOnly).length;
    const hasSession = cookies.some((c) => /sess|auth|token|ci_session/i.test(c.name));

    const txt = [
      '════════════════════════════════════════════════════════',
      '  PO SESSION EXPORT  ·  ' + new Date().toISOString(),
      '  url=' + location.href,
      '  host=' + HOST,
      '  cookies=' + cookies.length + ' (httpOnly=' + httpOnlyCount + ')' +
        '  localStorage=' + Object.keys(local).length +
        '  sessionStorage=' + Object.keys(session).length,
      '  session-like cookie present: ' + (hasSession ? 'YES' : 'NO — قد تحتاج GM_cookie أو إعادة تسجيل الدخول'),
      '════════════════════════════════════════════════════════',
      '',
      '── [1] COOKIES (human-readable) ──',
      cookies.map((c) =>
        c.name + ' = ' + c.value +
        '   {domain:' + (c.domain||HOST) + ', path:' + (c.path||'/') +
        ', httpOnly:' + (!!c.httpOnly) + ', secure:' + (!!c.secure) +
        (c.expirationDate ? ', expires:' + new Date(c.expirationDate*1000).toISOString() : '') +
        ', src:' + (c.source||'?') + '}'
      ).join('\n'),
      '',
      '── [2] COOKIES — CDP Network.setCookie array (paste/inject as-is) ──',
      JSON.stringify(cdp, null, 2),
      '',
      '── [3] COOKIE HEADER (single line, for curl -H "Cookie: …") ──',
      cookies.map((c) => c.name + '=' + c.value).join('; '),
      '',
      '── [4] localStorage (JSON) ──',
      JSON.stringify(local, null, 2),
      '',
      '── [5] sessionStorage (JSON) ──',
      JSON.stringify(session, null, 2),
      '',
      '⚠️ سرّي: يساوي كلمة مرور حسابك. للحساب التجريبي وVPS الخاص بك فقط. احذفه بعد الحقن.',
      '',
    ].join('\n');

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'po_session_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    setStatus('✅ نُزّل: ' + cookies.length + ' كوكي (httpOnly ' + httpOnlyCount + ')' +
              (hasSession ? '' : ' — ⚠️ لا كوكي جلسة، فعّل GM_cookie أو سجّل دخول'));
  }

  // ── واجهة زر عائم بسيطة ──
  let statusEl = null;
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  function buildUI() {
    if (document.getElementById('po-cookie-exporter')) return;
    const box = document.createElement('div');
    box.id = 'po-cookie-exporter';
    box.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'top:70px', 'left:10px', 'width:230px',
      'background:rgba(13,23,34,0.97)', 'color:#e6e6e6', 'font:12px/1.45 system-ui,sans-serif',
      'border:1px solid #2a4a3c', 'border-radius:12px', 'padding:10px',
      'box-shadow:0 8px 30px rgba(0,0,0,.6)', 'direction:rtl'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '🍪 مُصدّر جلسة PO';
    title.style.cssText = 'font-weight:800;color:#46d98e;margin-bottom:8px;font-size:13px;';
    box.appendChild(title);

    const btn = document.createElement('button');
    btn.textContent = '⬇️ تصدير الكوكيز + التخزين';
    btn.style.cssText = 'width:100%;padding:10px;border:0;border-radius:9px;background:#1E3A2F;color:#fff;font-weight:800;cursor:pointer;font-size:12px;';
    btn.onclick = () => { setStatus('… جاري التصدير'); exportAll().catch((e) => setStatus('⛔ خطأ: ' + (e && e.message))); };
    box.appendChild(btn);

    statusEl = document.createElement('div');
    statusEl.style.cssText = 'margin-top:8px;font-size:10.5px;color:#9fb2c0;word-break:break-word;';
    statusEl.textContent = (typeof GM_cookie !== 'undefined')
      ? 'GM_cookie متاح ✅ (سيشمل httpOnly)'
      : '⚠️ GM_cookie غير متاح — document.cookie فقط';
    box.appendChild(statusEl);

    const hide = document.createElement('div');
    hide.textContent = '✕ إخفاء';
    hide.style.cssText = 'margin-top:6px;font-size:10px;color:#7c8d9b;cursor:pointer;text-align:left;';
    hide.onclick = () => box.remove();
    box.appendChild(hide);

    document.body.appendChild(box);
  }

  if (document.body) buildUI();
  else document.addEventListener('DOMContentLoaded', buildUI, { once: true });
})();
