# Dual-Node Latency Arbitrage — سجل التحديث (v7)

`bot_v7_dual-node-arbitrage.js` — غلاف معماري بعقدتين منطقيتين فوق محرّك كشف
الأنماط القائم (المبني على `bot_v1_decode-closetime.js`). **لم يُحذف أو يُغيَّر أي
منطق كشف أنماط** — أُعيد توجيه مسار التنفيذ فقط ليمرّ عبر العقدتين.

## المعمارية

```
كشف الأنماط (كما هو)
      │  _enqueueSignal(signal)
      ▼
┌──────────────────────┐
│ Oracular-Node (US)   │  «المراقب الأساسي»
│  • observeFrame()    │  اعتراض الإطار الخام (Uint8Array) قبل الواجهة
│  • _predictFutureClose│ حساب «الإغلاق المستقبلي» من الميل + التيك
│  • fireIntent()      │  يطلق «نية تنفيذ»
└──────────┬───────────┘
           │  NodeEventBus.emit('EXECUTION_INTENT', intent, hop)
           ▼  (MessagePort إن توفّر، وإلا EventEmitter — قفزة محاكاة + اهتزاز)
┌──────────────────────┐
│ Executor-Node (KSA)  │  «معالج التنفيذ»
│  • قياس كمون القفزة  │  recvTs − sendTs (ساعة مونوتونية)
│  • ClockSync         │  تصحيح إزاحة الساعة US↔KSA + الانجراف (EMA)
│  • فحص العمر المصحّح  │  رفض النوايا المنتهية
└──────────┬───────────┘
           │  _deliverIntentToPipeline(signal)
           ▼
حُرّاس _processQueue القائمون (إعادة معايرة، وقف خسائر، تهدئة، قفل شمعة،
FIX-A/C/E/F، نافذة الصفقات، ETE) ← _executeDualTrade ← إرسال المقبس
```

## المكوّنات (نمط معياري)

| الوحدة | الدور |
|--------|------|
| `NodeEventBus` | ناقل أحداث داخلي يحاكي قفزة شبكية عبر القارات (`MessageChannel`/`MessagePort` مع رجوع إلى EventEmitter). كمون + اهتزاز قابلان للضبط. |
| `ClockSync` | مزامنة الساعة بين بيئة الاستقبال (US) والتنفيذ (KSA): إزاحة بـ EMA + تتبّع الانجراف + عمر مصحّح للإشارة. |
| `LatencyArbStats` | إحصاءات الكمون (متوسط/أدنى/أقصى/p95/اهتزاز) + إزاحة الساعة والانجراف + عدّادات النوايا، مع تسجيل دوري. |
| `OracularNode` | عقدة US: اعتراض خام + تنبؤ «الإغلاق المستقبلي» + إطلاق النية. |
| `ExecutorNode` | عقدة KSA: استقبال النية + تصحيح الانحراف + التسليم لخط الأنابيب. |

## نقاط الربط في الكود القائم

- `handleBinaryFrame` → `OracularNode.observeFrame(new Uint8Array(buf), role)` (اعتراض خام بلا DOM).
- `recordMsgTs(role)` → `ClockSync.sampleOracle/sampleExecutor` (مزامنة من زمن وصول المقبسين الفعلي).
- `_enqueueSignal` → `OracularNode.fireIntent(signal)` بدل `_processQueue()` المباشر.
- `DualWSSManager.init()` → ربط مصرف `ExecutorNode` بـ `_deliverIntentToPipeline` + مؤقت الإحصاءات.

## الإعدادات (`CFG`)

`DN_ENABLED`, `DN_HOP_BASE_MS`, `DN_HOP_JITTER_MS`, `DN_CLOCK_EMA_ALPHA`,
`DN_CLOCK_BASE_OFFSET_MS`, `DN_CLOCK_MAX_SAMPLE_MS`, `DN_PREDICT_SLOPE_MS`,
`DN_STATS_LOG_MS`.

## ملاحظة صدق معماري ⚠️

العقدتان تعملان في **نفس سياق التنفيذ** وتراقبان **نفس المقبس**، لذا **لا توجد
مراجحة كمون حقيقية** تسبق المنصة — القفزة الشبكية **محاكاة** لغرض العزل والقياس
ومراقبة صحة المسار. القيمة الفعلية هنا هي **فصل المسؤوليات** (مراقبة/تنبؤ مقابل
تنفيذ) عبر ناقل أحداث + أدوات قياس الكمون والانجراف. الأساس الافتراضي
`DN_HOP_BASE_MS = 0` يبقي التنفيذ فورياً (مطابقاً لسلوك V24-FAST)؛ القفزة غير
الصفرية **تضيف** كموناً (لاختبار السلوك) ولا تزيله.
