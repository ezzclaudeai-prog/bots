#!/usr/bin/env python3
"""
edge_analyzer.py — أداة قياس الحافة التنبؤية من سجل أداة Spy (Pocket Option)
=============================================================================
الغرض: قياس — بالأدلة لا بالتخمين — هل يملك أي مصدر بيانات (الزخم/المدة/
الاتجاه/إشارة الشات) حافة تنبؤية حقيقية على بياناتك، قبل المخاطرة بأي مال.

لا يتداول ولا يغيّر منطق البوت. يقرأ فقط مخرجات Spy ويُخرج تقريراً.

الإدخال المدعوم:
  • سجل Spy النصي (.txt) — الذي يحوي أسطر "BINARY event=... / DECODED: ..."
  • أو ملف NDJSON المُصدَّر من زر "📊 .ndjson" في أداة Spy.

التشغيل:
    python3 edge_analyzer.py <مسار_السجل>

ما يقيسه:
  1) تردد التيك وبنية البيانات (هل توجد bid/ask/عمق؟).
  2) الارتباط الذاتي لعوائد التيك (هل الحركة تحمل ذاكرة تنبؤية؟).
  3) حافة الزخم: لو دخلنا مع ميل نافذة N، ما نتيجة الإغلاق عند آفاق مختلفة؟
  4) حافة المدة: نفس نقاط الدخول الفعلية لو أُغلقت عند 3/5/.../30ث.
  5) ملخص الصفقات الفعلية (WR، PnL، الهوامش، نقطة التعادل من العائد).
  6) ثبات النتائج: P(فوز|فوز سابق) مقابل P(فوز|خسارة سابقة).
"""
import sys, re, json, bisect, math, statistics
from collections import defaultdict


# ─────────────────────────────────────────────────────────────────────────
# قراءة السجل: ندعم صيغتي .txt و .ndjson
# نُخرج: ticks[asset]=[(serverTs, price)] , opens=[openOrder...] , deals=[...]
# ─────────────────────────────────────────────────────────────────────────
def load(path):
    ticks = defaultdict(list)
    opens = []
    deals = []
    chat = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()

    # محاولة NDJSON أولاً (كل سطر كائن طبّعته Spy)
    ndjson_hits = 0
    for line in raw.split("\n"):
        line = line.strip()
        if not (line.startswith("{") and line.endswith("}")):
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        t = rec.get("type")
        if not t:
            continue
        ndjson_hits += 1
        d = rec.get("data", {})
        if t == "TICK" and "serverTs" in d and "price" in d:
            ticks[rec.get("asset")].append((d["serverTs"], d["price"]))
        elif t == "TRADE_OPEN":
            opens.append(d)
        elif t == "TRADE_CLOSE":
            deals.append(d)

    if ndjson_hits > 50:
        for a in ticks:
            ticks[a].sort()
        return ticks, opens, deals, chat, "ndjson"

    # وإلا: صيغة السجل النصي (DECODED: ...)
    lines = raw.split("\n")
    sig_re = re.compile(
        r'"signal":\{"symbol":"([^"]+)"[^}]*?"forecast":"([^"]+)","timeframe":"([^"]+)"'
    )
    for i, l in enumerate(lines):
        for m in sig_re.finditer(l):
            sym, fc, tf = m.group(1), m.group(2), m.group(3)
            d = "BUY" if "UP" in fc else ("SELL" if "DOWN" in fc else None)
            if d:
                chat.append((sym, d, tf))
        if (
            'BINARY event="updateStream"' in l
            or 'BINARY event="successopenOrder"' in l
            or 'BINARY event="successcloseOrder"' in l
        ):
            dec = None
            for k in range(i + 1, min(i + 4, len(lines))):
                if lines[k].startswith("  DECODED:"):
                    try:
                        dec = json.loads(lines[k][11:])
                    except Exception:
                        dec = None
                    break
            if dec is None:
                continue
            if "updateStream" in l and isinstance(dec, list):
                for row in dec:
                    if isinstance(row, list) and len(row) >= 3:
                        ticks[row[0]].append((row[1], row[2]))
            elif "successopenOrder" in l:
                opens.append(dec)
            elif "successcloseOrder" in l:
                deals.extend(dec.get("deals", []))
    for a in ticks:
        ticks[a].sort()
    return ticks, opens, deals, chat, "text"


def price_at(arr, keys, t, max_stale=3.0):
    """آخر سعر عند الزمن t (ثوانٍ)، شرط ألا يكون أقدم من max_stale ثانية."""
    j = bisect.bisect_right(keys, t) - 1
    if j < 0 or t - arr[j][0] > max_stale:
        return None
    return arr[j][1]


def slope(arr, j, ms):
    """العائد النسبي على نافذة ms المنتهية عند المؤشر j؛ يُرجع (rel, ticks)."""
    t1, p1 = arr[j]
    lo = t1 - ms / 1000.0
    i = j
    while i > 0 and arr[i - 1][0] > lo:
        i -= 1
    t0, p0 = arr[i]
    n = j - i
    if n < 1 or p0 <= 0 or t1 <= t0:
        return None, 0
    return (p1 - p0) / p0, n


# ─────────────────────────────────────────────────────────────────────────
def report(path):
    ticks, opens, deals, chat, fmt = load(path)
    print("=" * 70)
    print(f"  EDGE ANALYZER — مصدر: {path}  (صيغة: {fmt})")
    print("=" * 70)

    # (1) بنية البيانات + تردد التيك
    total_ticks = sum(len(v) for v in ticks.values())
    print(f"\n[1] بنية البيانات: {len(ticks)} أصل، {total_ticks} تيك إجمالاً.")
    print("    updateStream = سعر mid واحد فقط — لا bid/ask ولا عمق سوق في التدفق.")
    main = sorted(ticks.items(), key=lambda kv: -len(kv[1]))[:4]
    for a, arr in main:
        gaps = [arr[i + 1][0] - arr[i][0] for i in range(len(arr) - 1) if 0 < arr[i + 1][0] - arr[i][0] < 10]
        if gaps:
            gaps.sort()
            print(f"    {a}: n={len(arr)}  تيك وسطي كل {statistics.median(gaps)*1000:.0f}ms "
                  f"(p90 {gaps[int(len(gaps)*0.9)]*1000:.0f}ms)")

    # (2) الارتباط الذاتي
    print("\n[2] الارتباط الذاتي لعوائد التيك (≈0 يعني لا ذاكرة تنبؤية):")
    for a, arr in main:
        rets = [arr[i][1] - arr[i - 1][1] for i in range(1, len(arr))
                if 0 < arr[i][0] - arr[i - 1][0] < 3]
        if len(rets) < 100:
            continue
        m = sum(rets) / len(rets)
        den = sum((r - m) ** 2 for r in rets) or 1e-18
        def ac(lag):
            return sum((rets[i] - m) * (rets[i - lag] - m) for i in range(lag, len(rets))) / den
        print(f"    {a}: lag1 {ac(1):+.3f}  lag2 {ac(2):+.3f}  lag3 {ac(3):+.3f}  (n={len(rets)})")

    # (3) حافة الزخم: نسخة طبق الأصل من منطق TickPulse
    print("\n[3] حافة الزخم (ميل 1500ms ≥30e-6 + اتساق نافذتين، تبريد 1ث):")
    horizons = [5, 10, 15, 20, 30, 45, 60, 90, 120]
    res = {h: [0, 0] for h in horizons}
    fired = 0
    for a, arr in ticks.items():
        if len(arr) < 100:
            continue
        keys = [x[0] for x in arr]
        lastfire = 0
        for j in range(10, len(arr)):
            t, p = arr[j]
            if t - lastfire < 1.0:
                continue
            s, n = slope(arr, j, 1500)
            if s is None or n < 3 or abs(s) < 30e-6:
                continue
            s2, _ = slope(arr, j, 750)
            s3, _ = slope(arr, j, 300)
            if s2 is None or s3 is None:
                continue
            up = s > 0
            if not ((up and s2 >= 0 and s3 >= 0) or (not up and s2 <= 0 and s3 <= 0)):
                continue
            lastfire = t
            fired += 1
            for h in horizons:
                fp = price_at(arr, keys, t + h)
                if fp is None or fp == p:
                    continue
                res[h][0 if (fp > p) == up else 1] += 1
    print(f"    إشارات مُطلَقة: {fired}")
    for h in horizons:
        w, l = res[h]
        if w + l:
            print(f"      أفق {h:>3}ث: W{w} L{l}  →  WR {100*w/(w+l):.1f}%")
    print("    (50% = لا حافة. <50% = الزخم مضلِّل والانعكاس أفضل.)")

    # (3b) حافة الفريم الأعلى: نبني شموعاً من تيار التيك عند فترات مختلفة،
    # ونختبر — لكل فريم — هل اتجاه آخر شمعة مغلقة يتنبأ باتجاه الشمعة التالية
    # (حافة الاستمرار) أم بعكسها (حافة الانعكاس). كل مصدر يُقاس على حدة.
    print("\n[3b] حافة الفريم الأعلى (شموع مبنية من التيك — هل تتنبأ الشمعة التالية؟):")
    print("     cont = الاستمرار يربح | rev = الانعكاس يربح | n = عدد الشموع المختبرة")
    for period in (5, 10, 15, 30, 60):
        cont = rev = flat = 0
        for a, arr in ticks.items():
            if len(arr) < 60:
                continue
            # تجميع التيكات في شموع period-ثانية: نأخذ سعر الإغلاق لكل دلو
            buckets = {}
            for ts, px in arr:
                key = int(ts // period)
                buckets[key] = px  # آخر سعر في الدلو = الإغلاق
            keys_sorted = sorted(buckets)
            closes = [buckets[k] for k in keys_sorted]
            # نحتاج 3 إغلاقات متتالية على دلاء متلاصقة لقياس اتجاه→التالي
            for i in range(2, len(keys_sorted)):
                if keys_sorted[i] != keys_sorted[i - 1] + 1 or keys_sorted[i - 1] != keys_sorted[i - 2] + 1:
                    continue
                prev_move = closes[i - 1] - closes[i - 2]   # اتجاه الشمعة المغلقة
                next_move = closes[i] - closes[i - 1]        # اتجاه الشمعة التالية
                if prev_move == 0 or next_move == 0:
                    flat += 1
                    continue
                if (prev_move > 0) == (next_move > 0):
                    cont += 1
                else:
                    rev += 1
        n = cont + rev
        if n >= 10:
            print(f"      فريم {period:>2}ث: استمرار {100*cont/n:.0f}% | انعكاس {100*rev/n:.0f}%  (n={n})")
        else:
            print(f"      فريم {period:>2}ث: عينة غير كافية (n={n})")
    print("     (≈50% = لا حافة. انحراف واضح ومتسق عبر الأصول = مصدر يستحق الاختبار.)")

    # (3c) فلتر حالة السوق (REGIME): الزخم في سوق متجه مقابل سوق هادئ.
    # هذه الحافة الوحيدة المرشّحة — نقسم إشارات الزخم حسب |ميل النافذة الأطول|.
    print("\n[3c] حالة السوق (REGIME): الزخم مشروطاً بحركة النافذة الأطول 10ث:")
    reg = {"trend_agree": [0, 0], "trend_against": [0, 0], "quiet": [0, 0]}
    REG_WIN, REG_MIN, HOR = 10.0, 0.0002, 10
    for a, arr in ticks.items():
        if len(arr) < 120:
            continue
        keys = [x[0] for x in arr]
        lastfire = 0
        for j in range(20, len(arr)):
            t, p = arr[j]
            if t - lastfire < 1.0:
                continue
            s, n = slope(arr, j, 1500)
            if s is None or n < 3 or abs(s) < 30e-6:
                continue
            s2, _ = slope(arr, j, 750)
            s3, _ = slope(arr, j, 300)
            if s2 is None or s3 is None:
                continue
            up = s > 0
            if not ((up and s2 >= 0 and s3 >= 0) or (not up and s2 <= 0 and s3 <= 0)):
                continue
            lastfire = t
            r, _ = slope(arr, j, REG_WIN * 1000)
            fp = price_at(arr, keys, t + HOR)
            if fp is None or fp == p or r is None:
                continue
            win = (fp > p) == up
            if abs(r) < REG_MIN:
                bucket = "quiet"
            elif (up and r > 0) or (not up and r < 0):
                bucket = "trend_agree"
            else:
                bucket = "trend_against"
            reg[bucket][0 if win else 1] += 1
    labels = {"trend_agree": "سوق متجه يوافق", "trend_against": "سوق متجه يعاكس", "quiet": "سوق هادئ"}
    for k in ("trend_agree", "trend_against", "quiet"):
        w, l = reg[k]
        if w + l:
            print(f"      {labels[k]:<16}: W{w} L{l}  →  WR {100*w/(w+l):.1f}%  (n={w+l})")
    print("     (إن بقي «المتجه يوافق» فوق نقطة التعادل عبر جلسات = فلتر REGIME يستحق التفعيل.)")

    # (4)+(5) الصفقات الفعلية + حافة المدة
    cmap = {d["id"]: d for d in deals if "id" in d}
    durbk = {d: [0, 0, 0] for d in [3, 5, 7, 10, 15, 20, 30]}
    win = loss = tie = 0
    pnl = 0.0
    mloss, mwin = [], []
    for o in opens:
        a, cmd, ot, op = o.get("asset"), o.get("command"), o.get("openTimestamp"), o.get("openPrice")
        cd = cmap.get(o.get("id"))
        arr = ticks.get(a)
        if not (a and ot and op is not None and cmd in (0, 1) and arr):
            continue
        keys = [x[0] for x in arr]
        for dur in durbk:
            p = price_at(arr, keys, ot + dur)
            if p is None:
                continue
            if p == op:
                durbk[dur][2] += 1
            elif (cmd == 0 and p > op) or (cmd == 1 and p < op):
                durbk[dur][0] += 1
            else:
                durbk[dur][1] += 1
        if cd:
            pr = cd.get("profit", 0)
            if pr > 0:
                win += 1
            elif pr < 0:
                loss += 1
            else:
                tie += 1
            pnl += pr
            if cd.get("closePrice"):
                (mwin if pr > 0 else mloss).append(abs(cd["closePrice"] - op))

    if win + loss:
        print(f"\n[4] الصفقات الفعلية: W{win} L{loss} T{tie}  |  PnL {pnl:.2f}")
        print(f"    WR {100*win/(win+loss):.1f}%")
        # نقطة التعادل من العائد
        payouts = [d.get("percentProfit") for d in deals
                   if isinstance(d.get("percentProfit"), (int, float)) and 50 <= d["percentProfit"] <= 100]
        if payouts:
            pay = statistics.median(payouts) / 100.0
            be = 1.0 / (1.0 + pay)
            print(f"    العائد الوسطي {pay*100:.0f}% → نقطة التعادل المطلوبة {be*100:.1f}% WR")
        if mloss and mwin:
            print(f"    هامش |إغلاق−فتح|: خسائر وسيط {statistics.median(mloss):.5f} | أرباح {statistics.median(mwin):.5f}")
            print("    (هوامش الخسارة الضئيلة = نتائج قريبة من رمي العملة = لا حافة)")

    print("\n[5] حافة المدة (نفس نقاط الدخول الفعلية لو أُغلقت عند):")
    for dur, (w, l, t) in durbk.items():
        if w + l:
            print(f"      {dur:>2}ث: W{w} L{l} T{t}  →  WR {100*w/(w+l):.0f}%")
    print("    (انتبه لحجم العينة — فروق ≤5% على <100 صفقة ضمن الضوضاء.)")

    # (6) ثبات النتائج
    seq = []
    for o in sorted(opens, key=lambda x: x.get("openTimestamp", 0)):
        cd = cmap.get(o.get("id"))
        if cd and cd.get("profit", 0) != 0:
            seq.append(1 if cd["profit"] > 0 else 0)
    if len(seq) > 10:
        aw = [seq[i] for i in range(1, len(seq)) if seq[i - 1] == 1]
        al = [seq[i] for i in range(1, len(seq)) if seq[i - 1] == 0]
        pw = sum(aw) / len(aw) if aw else float("nan")
        pl = sum(al) / len(al) if al else float("nan")
        print(f"\n[6] ثبات النتائج: P(فوز|فوز سابق)={pw:.2f}  P(فوز|خسارة سابقة)={pl:.2f}")
        if pl - pw > 0.12:
            print("    → بعد الخسارة الفوز أرجح: «وقف الخسائر المتتالي» قد يكون عكسياً (يتجنّب الأفضل).")

    # (7) تغطية الشات
    if chat:
        norm = lambda s: s.replace("#", "").replace("-", "").replace("/", "").upper()
        watched = {norm(a) for a in ticks}
        cov = sum(1 for sym, _, _ in chat if norm(sym) in watched)
        print(f"\n[7] إشارات الشات: {len(chat)} إجمالاً، {cov} منها لأصل متوفر في تدفّق التيك.")
        if cov < len(chat) * 0.2:
            print("    → غالبية إشارات الشات لأصول لا يراقبها البوت — قيمتها كمؤكِّد ضعيفة.")

    print("\n" + "=" * 70)
    print("الخلاصة: إذا كان [2]≈0 و[3]≈50% و[4] أقل من نقطة التعادل،")
    print("فالمشكلة ليست في الكود بل في غياب حافة تنبؤية بهذه البيانات على هذا الأصل.")
    print("=" * 70)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("الاستخدام: python3 edge_analyzer.py <مسار_سجل_Spy.txt | export.ndjson>")
        sys.exit(1)
    report(sys.argv[1])
