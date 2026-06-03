// ==UserScript==
// @name         ⚡ V13.1_QUANTUM_ENGINE — Ultra-Low-Latency Adaptive Prediction Engine + MicroTrend Filter
// @namespace    candle-pro-strategy-v13-quantum-engine
// @version      13.3.0
// @description  QUANTUM SKELETON — Diagnostic Mode + WebSocket Interception + UI
// @author       aoirusra
// @match        *://pocketoption.com/*
// @match        *://*.pocketoption.com/*
// @match        *://m.pocketoption.com/*
// @match        *://trade.pocketoption.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function (W) {
  'use strict';
  if (W.__CANDLE_BOT_V13_QUANTUM) return;
  W.__CANDLE_BOT_V13_QUANTUM = true;

  // ══════════════════════════════════════════════════════════════════════
  // § 1  MINIMAL CFG — Diagnostic & Core Only
  // ══════════════════════════════════════════════════════════════════════
  const CFG = {
    // ─── WebSocket / Connection ─────────────────────────────────────
    DSO_WS_PING_MS           : 8000,        // ping كل 8 ثواني لمنع انقطاع الخادم

    // ─── Database ───────────────────────────────────────────────────
    DB_LOG_ENABLED           : true,
    DB_TICK_ENABLED          : true,

    // ─── GitHub Sync ────────────────────────────────────────────────
    GH_TOKEN                 : '',
    GH_REPO                  : 'boonndd/scan',
    GH_BRANCH                : 'data',
    GH_SYNC_INTERVAL_MS      : 300000,

    // ─── Diagnostic Engine ──────────────────────────────────────────
    DIAG_ENABLED             : true,
    DIAG_MAX_PACKETS         : 1000,
    DIAG_MAX_ARCHIVE         : 500,
    DIAG_EXPORT_FORMAT       : 'json',

    // ─── Keep minimal legacy flags for preserved code compatibility ──
    CRC_ENABLED              : true,
    Q1_SIG_ENABLED           : true,
    CLOCK_SYNC_ENABLED       : true,
    DOM_HEAL_ENABLED         : true,
    FRAG_BUFFER_TTL          : 5000,
    SUPREME_MIN_CONF         : 70,
    SUPREME_HURST_TREND      : 0.6,
    SUPREME_HURST_RANGE      : 0.4,
    CONFLUENCE_AUTO_MIN      : 4.5,
    CONFLUENCE_MIN_SCORE     : 3.0,
    BAD_SESSION_MIN_TRADES   : 10,
    BAD_SESSION_WR_THRESH    : 0.05,
    KELLY_ENABLED            : false,
    DEFAULT_AMOUNT           : 1,
    MAX_CANDLES              : 30,
    MIN_TICKS_PER_CANDLE     : 1,
    TICK_CANDLE_TIMEOUT      : 3500,
    ADAPTIVE_SIGMA_ENABLED   : false,
    TVE_SIGMA_THRESHOLD      : 3.0,
    ADAPTIVE_SIGMA_FLOOR     : 1.0,
    ADAPTIVE_SIGMA_DECAY_STEP: 0.1,
    ADAPTIVE_SIGMA_DECAY_MS  : 30000,
    ADAPTIVE_SIGMA_IDLE_MS   : 60000,
    SHORT_MODE_ASSUME        : true,
    SHORT_MODE_ASSUME_MAX    : 15,
    TVE_ENABLED              : false,
    OBI_ENABLED              : false,
    LAD_ENABLED              : false,
    LSTM_ENABLED             : false,
    RL_ENABLED               : false,
    WORKER_ENABLED           : false,
    PYRAMID_ENABLED          : false,
    SLIPPAGE_ENABLED         : false,
    TVE_PRIORITY             : false,
    TREND_FILTER_ENABLED     : true,
    SHORT_MODE_TVE_DIRECT    : false,
    SEE_ENABLED              : false,
    PREDICTIVE_FIRE_MS       : 200,
    SEE_CONF_HIGH            : 80,
    SEE_CONF_MED             : 55,
    SEE_RATIO_HIGH           : 0.35,
    SEE_RATIO_MED            : 0.25,
    SEE_RATIO_LOW            : 0.10,
    SEE_MIN_MS               : 80,
    SEE_MAX_MS               : 5000,
    MINI_BACKTEST_ENABLED    : false,
    IMDB_TIER_DOUBLE         : 70,
    SIGNAL_WATCHER_MS        : 25,
    SIGNAL_WATCHER_EXPIRY_MS : 1500,
    MAX_LOSS_STREAK          : 3,
    MIN_CANDLES_TO_TRADE     : 3,
    MIN_PATTERN_CONFIDENCE   : 2,
    DOUBLE_MIN_CONFLUENCE    : 4.5,
    MACD_FAST                : 12,
    MACD_SLOW                : 26,
    MACD_SIGNAL              : 9,
    BB_PERIOD                : 20,
    BB_STD                   : 2,
    SRSI_PERIOD              : 14,
    SRSI_K                   : 3,
    SRSI_D                   : 3,
    TVE_STD_WINDOW_MS        : 10000,
    TVE_STREAK_MIN           : 3,
    SLIPPAGE_TICKS           : 2,
    TRADE_COOLDOWN_MS        : 500,
    BODY_SMA_PERIOD          : 20,
    ENTRY_DELAY_MS           : 20,
    ENTRY_DELAY_SHORT        : 3,
    MINI_BACKTEST_MIN_CANDLES: 10,
    ADAPTIVE_CONF_WINDOW     : 20,

    // ─── Dual-WSS Latency Arbitrage ──────────────────────────────────
    DUAL_WSS_ENABLED        : true,
    DUAL_WSS_MIN_GAP_MS     : 150,        // الحد الأدنى لفجوة الكمون (مللي ثانية)
    DUAL_WSS_SYNTHETIC_DELAY : 300,       // تأخير اصطناعي إذا كانت الفجوة أقل من الحد الأدنى
    DUAL_WSS_PING_INTERVAL  : 5000,       // فاصل قياس الكمون (مللي ثانية)
    DUAL_WSS_RECONNECT_DELAY: 3000,       // تأخير إعادة الاتصال عند الفشل
    DUAL_WSS_MAX_SIGNAL_AGE : 2000,       // أقصى عمر للإشارة (مللي ثانية) قبل الرفض
    DUAL_WSS_JITTER_MS      : 50,         // اهتزاز التنفيذ (مللي ثانية)

    // ─── حماية متقدمة ──────────────────────────────────────────────
    MIN_CONFIDENCE_THRESHOLD: 75,          // حد الثقة الأدنى — يتحكم به سلايدر الواجهة
    GHOST_TRADE_ENABLED     : true,        // صفقة وهمية بعد أول خسارة
    GHOST_TRIGGER_STREAK    : 2,           // ✅ [V13.6] فعّل Ghost فقط بعد N خسائر متتالية (2 بدل 1 — أسرع)
    GHOST_MAX_CONSECUTIVE   : 1,           // ✅ [V13.6] عدد الصفقات الوهمية قبل العودة للحقيقي (1 بدل 2 — أسرع)
    RECALIBRATE_ON_STREAK   : 3,          // إعادة معايرة بعد N خسائر متتالية
    RECALIBRATE_DURATION_MS : 45000,      // مدة إعادة المعايرة القصوى (45 ثانية)
    RECALIBRATE_MIN_TREND_CANDLES : 3,    // عدد الشموع المتتالية المطلوبة لإنهاء إعادة المعايرة
    CANDLE_LOCK_ENABLED     : true,        // منع التداول في نفس الشمعة مرتين
    TRADE_COOLDOWN_RATIO    : 0.25,       // نسبة التهدئة من مدة الشمعة
    TRADE_COOLDOWN_FLOOR_MS : 500,        // الحد الأدنى للتهدئة
    LOSS_STREAK_PAUSE_MS    : 10000,      // وقف بعد خسائر متتالية (10ث بدل 45ث — لا نعطل 3 شموع)

    // ─── حماية استنفاد الاتجاه وتكرار النمط ──────────────────────────────
    EXHAUSTION_ENABLED      : true,       // كشف استنفاد الاتجاه — منع الدخول عند القمة
    EXHAUSTION_PEAK_THRESHOLD: 0.80,      // نسبة موقع السعر من المدى (80% = قمة / 20% = قاع)
    EXHAUSTION_MIN_CANDLES   : 60,        // الحد الأدنى لشموع الفحص — يضمن تغطية 60 ثانية على أي فريم
    EXHAUSTION_BULL_RATIO    : 0.65,      // نسبة الشموع الصاعدة المطلوبة للكشف (65% من آخر N شموع)
    MAX_CONSEC_SAME_DIR     : 2,          // حد الصفقات المتتالية في نفس الاتجاه (2 = أقصى صفقتين BUY أو SELL متتاليتين)
    CONSEC_CONF_PENALTY     : 20,         // خصم من الثقة لكل صفقة متتالية في نفس الاتجاه (20% → 80% تصبح 60%)
    PATTERN_REARM_ENABLED   : true,       // حاجز إعادة تسليح النمط — نفس النمط لا يكرر خلال فترة الحماية
    PATTERN_REARM_MIN_MS    : 10000,      // الحد الأدنى لنافذة إعادة التسليح (10 ثانية) — تقليل الانتظار على الفريمات القصيرة
    MAX_TRADES_PER_WINDOW   : 12,         // ✅ [V14.5] سقف الصفقات/دقيقة (12 بدل 4 — تسريع السكالبينغ)
    TRADE_WINDOW_MS         : 60000,      // نافذة العد: 60 ثانية

    // ─── تحسين الأنماط ──────────────────────────────────────────────────
    ENGULFING_BASE_CONF     : 72,          // ثقة ابتلاع أساسية (72% بدل 65% — يجتاز معظم العتبات)
    ENGULFING_TREND_BONUS   : 12,          // مكافأة الاتجاه (12% بدل 15% — أقل تشدد)
    ENGULFING_SIZE_BONUS    : 5,           // مكافأة حجم الابتلاع (>2× جسم سابق)
    THREE_CANDLE_PEAK_REJECT: 0.72,        // رفض 3bullish إذا السعر فوق 72% من المدى الأخير
    THREE_CANDLE_MIN_ACCEL  : 1.0,         // تسارع أدنى — جسم الشمعة الأخيرة يجب أن ≥ جسم الأولى
    THREE_CANDLE_PEAK_WINDOW : 30,         // ✅ [V13.4] نافذة فحص القمة/القاع لنمط 3 شموع (30 بدل 10)

    // ─── [V13.4] تحسين فلتر الاتجاه + استنفاد اتجاهي + ثقة تكيفية ───────────
    TREND_WINDOW_CANDLES    : 24,          // ✅ [V13.6] نافذة كشف الاتجاه (24 — أقل لزوجة، يحجب أقل في التذبذب)
    TREND_ATR_Z_THRESHOLD   : 0.9,         // ✅ [V13.6] قوة الاتجاه بوحدات ATR (0.9 — يحجب الترند الواضح فقط)
    TREND_FILTER_MODE       : 'soft',      // ✅ [V13.6] 'soft'=خصم ثقة للمعاكس (يبقى سريعاً) | 'hard'=حظر تام
    TREND_SOFT_PENALTY      : 12,          // ✅ [V13.6] خصم الثقة للإشارة المعاكسة في الوضع الناعم
    COUNTERTREND_NEEDS_ORACLE: false,      // ✅ [V14.6] اختياري ومُطفأ: بيانات السجل أثبتت أن المعاكس 75% رابح — لا تحجبه
    COUNTERTREND_MIN_CONF    : 90,         // عتبة الثقة لو فعّلته يدوياً
    EXHAUSTION_COOLDOWN_MS  : 4000,        // ✅ [V13.6] بعد الاستنفاد امنع اتجاه الاستمرار 4ث (كان 9 — أسرع)
    MIN_TRADE_SEC           : 3,           // ✅ [V14.2] حد أدنى لمدة الصفقة — المنصة ترفض <3ث (IncorrectExpTime)
    ADAPTIVE_CONF_ENABLED   : true,        // ✅ ثقة تكيفية — رفع العتبة للأنماط الخاسرة حياً
    ADAPTIVE_MIN_SAMPLES    : 6,           // الحد الأدنى من الصفقات قبل تفعيل التكيّف لكل نمط
    ADAPTIVE_CONF_PER_LOSS  : 6,           // رفع عتبة الثقة المطلوبة % لكل خسارة صافية للنمط
    ADAPTIVE_DISABLE_WR     : 0.40,        // تعطيل النمط مؤقتاً إذا نزل معدل فوزه الحي تحت 40%

    // ─── [V13.5 / المسار C] فلتر تأكيد الأوراكل (Latency lead confirmation) ──
    ORACLE_CONFIRM_ENABLED  : true,        // ✅ لا تنفّذ نمطاً إلا إذا لم يعارضه ميل سعر الأوراكل اللحظي
    ORACLE_CONFIRM_WINDOW_MS: 2500,        // نافذة تيكات الأوراكل المعتبرة (مللي ثانية)
    ORACLE_CONFIRM_MIN_TICKS: 3,           // أقل عدد تيكات أوراكل مطلوب — وإلا fail-open (يسمح)
    ORACLE_CONFIRM_K        : 1.0,         // الميل يُحسب معارِضاً فقط إذا تجاوز K×ضجيج التيك (يحجب التعارض الواضح فقط)
    // ─── [V14 — إصلاح الأوراكل] إشارات المنصة الحقيقية (signals/update + شات) ──
    ORACLE_SIG_TTL_MS       : 8000,        // ✅ صلاحية قوة المنصة الرقمية (تُحدّث كل ~5ث)
    ORACLE_CHAT_TTL_MS      : 90000,       // ✅ صلاحية إشارة الشات الاتجاهية (M1+ تبقى صالحة ~90ث)
    ORACLE_MIN_STRENGTH     : 3,           // ✅ الحد الأدنى لقوة إشارة المنصة (0-4) لاعتبارها تأكيداً
    // ─── [V15/V16] محرّك إشارات المنصة (PSE) — الأوراكل كمولّد صفقات ──────────
    PSE_ENABLED             : false,       // ✅ اختياري: تفعيل توليد الصفقات من الأوراكل
    PSE_CONF                : 88,          // ثقة الإشارة المولّدة (تُرفع مع قوة المنصة)
    PSE_USE_PLAT            : true,        // [V16] استخدم قوة signals/update كبوابة
    PSE_USE_SLOPE           : true,        // [V16] استخدم ميل التيك لتحديد الاتجاه عند غياب الشات
    PSE_SLOPE_MS            : 500,         // نافذة حساب الميل (ميلي ثانية)
    PSE_SLOPE_MIN_REL       : 0.000020,   // أدنى عائد نسبي لاعتبار الميل اتجاهاً واضحاً
    // ─── [V18] التقييم السريع داخل الشمعة — تسريع تكرار التداول ──────────────
    FAST_EVAL_ENABLED       : true,        // ✅ قيّم الأنماط داخل الشمعة (لا تنتظر إغلاقها)
    FAST_EVAL_MS            : 1500,        // أدنى فاصل بين تقييمين سريعين (مللي ثانية)
    FAST_EVAL_MIN_TICKS     : 4,           // أدنى عدد تيكات في الشمعة المتشكّلة قبل تقييمها
    // ─── [V17] محرّك توقيت الدخول (ETE) — لا تدخل إلا حين يوافق الزخم اللحظي ──
    ENTRY_TIMING_ENABLED    : true,        // ✅ تأجيل الدخول حتى يوافق ميل التيك اتجاه الصفقة
    ETE_SLOPE_MS            : 1200,        // نافذة قياس الزخم اللحظي عند الدخول (ميلي ثانية)
    ETE_MIN_REL             : 0.000020,   // أدنى عائد نسبي ليُعدّ الميل اتجاهاً (وإلا «مسطّح»)
    ETE_MAX_WAIT_MS         : 0,           // 0 = تلقائي حسب عمر الصفقة | >0 = override ثابت بالملي
    ETE_WAIT_FRAC           : 0.30,        // نسبة عمر الصفقة المسموح انتظارها للدخول (30% من time)
    ETE_WAIT_MIN_MS         : 600,         // حدّ أدنى للانتظار (لفريمات 3-4ث)
    ETE_WAIT_MAX_MS         : 5000,        // حدّ أقصى للانتظار (لفريمات 15ث+)
    ETE_POLL_MS             : 120,         // فحص الموافقة كل N ميلي ثانية
    ETE_ON_TIMEOUT          : 'skip',      // عند انتهاء المهلة دون توافق: 'skip' إلغاء | 'enter' دخول
    // ─── [V16] مختبر الأوراكل (OracleLab) — قياس خام لتطوير الأوراكل ──────────
    ORACLE_LAB_ENABLED      : true,        // ✅ تسجيل خام: يربط كل صفقة بمصدرها ونتيجتها (آمن)
    ORACLE_LAB_REPORT_EVERY : 10,          // اطبع جدول الأداء كل N صفقة
    ORACLE_LAB_FLAT_REL     : 0.000001,   // عتبة اعتبار الميل «مسطّحاً»

    // ─── Socket Stability ──────────────────────────────────────────────
    WS_SELF_PING_ENABLED    : false,       // ✅ إيقاف PING الخاص — المنصة تدير PING/PONG بنفسها
    WS_HEALTH_TIMEOUT_MS    : 25000,       // تحذير إذا لم تأتِ بيانات خلال 25 ثانية
    WS_ERROR_THROTTLE_MS    : 5000,        // تقييد رسائل الخطأ (رسالة واحدة كل 5 ثواني)
    WS_EXEC_POOL_ENABLED    : true,        // تجمع مقابس المنفذ — لا تفقد الاتصال عند إغلاق مقبس
    WS_PROMOTE_AUTH_DELAY   : 2000,        // انتظر 2 ثانية بعد الاتصال قبل ترقية المقبس
  };

  // ══════════════════════════════════════════════════════════════════════
  // § 2  Utility Functions
  // ══════════════════════════════════════════════════════════════════════
  let _reqIdCounter = 0;
  function _nextReqId() {
    const perfNs   = Math.round((W.performance?.now?.() ?? Date.now()) * 1000) & 0xFFFFF;
    _reqIdCounter  = (_reqIdCounter + 1) & 0xFFF;
    return (perfNs * 4096 + _reqIdCounter) >>> 0;
  }

  const _v11_intervals = [];
  const _v11_setInterval = (fn, ms) => { const id = setInterval(fn, ms); _v11_intervals.push(id); return id; };
  function _v11_clearAllIntervals() { _v11_intervals.forEach(id => clearInterval(id)); _v11_intervals.length = 0; }

  const PO_VALID_TIMES  = [1,2,3,5,10,15,20,25,30,45,60,90,120,180,300,600,900,1800,3600];
  const TRUSTED_SOURCES = new Set(['saveCharts','platform','updateCharts','history']);

  // ✅ [V14.4] المسموح فعلياً: أي ثانية صحيحة ≥ 3 (3،4،5،6،7...). الممنوع فقط 1 و 2.
  //   لا تثبيت على شبكة — نحترم مدة المستخدم بالضبط، فقط حد أدنى 3ث.
  function _snapTradeDuration(secs) {
    const s = Math.round(Number(secs) || 0);
    return Math.max(CFG.MIN_TRADE_SEC || 3, s); // مدة المستخدم كما هي، بحد أدنى 3ث
  }

  function snapToPOTime(secs) {
    if (!secs || secs <= 0) return 5;
    let best = PO_VALID_TIMES[0];
    for (const t of PO_VALID_TIMES) { if (Math.abs(t - secs) < Math.abs(best - secs)) best = t; }
    return best;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 3  Global State Variables (MINIMAL)
  // ══════════════════════════════════════════════════════════════════════
  let activeAsset     = '';
  let candlePeriod    = 0;
  let _tradeDuration  = 0;
  let durSource       = 'none';
  let wsConnected     = false;
  let totalTicks      = 0;
  let autoTrade       = false;   // Keep but no strategy uses it
  let tradeExec       = false;
  let lastTradeMs     = 0;
  let _lastTickMs     = 0;
  let _streamStalled  = false;
  let _wsReconnectTs  = 0;
  let tradeWS         = null;
  let tradeWSOrig     = null;
  let _tradeSocketReady = false;
  let isDemo          = 0;
  let _tickSize       = 0;
  let fastCloseAt     = 0;
  let clockOffset     = 0;
  let currentBalance  = 0;
  let tradeAmount     = CFG.DEFAULT_AMOUNT;
  let _manualAmountOverride = false;
  let _minConfThreshold = 75; // حد الثقة الأدنى — يتحكم به سلايدر الواجهة
  let accountBalance  = null;
  let _dynamicPayout  = null;
  let _pendingTradeRecord = null;
  let _lastTradeWasTVE = false;
  let _lastTradeWasDouble = false;
  let _lastTradePatternCase = null;
  let _pendingEvent   = null;
  const _pendingEventMap = new WeakMap();
  const _PENDING_EVENT_TTL_MS = 500;
  let _tradeExecLockTimer  = null;
  let _tradeExecResetTimer = null;
  let _adaptiveSigmaActive = false;
  let _currentSigma = 3.0;
  let _adaptiveSigmaTimer_v100 = null;
  let _timingOffset   = 0;
  let _predictiveTimer = null;
  let _predictiveRAF   = null;
  let _readySignal     = null;
  let _readySignalTs   = 0;
  let _signalPrice     = null;
  let _pendingIsTVE    = false;
  let _lossStreakPauseUntil = 0;
  let _ghostTradeActive = false;
  let _ghostWatching    = false;
  let _ghostConsecutive = 0;          // عداد الصفقات الوهمية المتتالية
  let _recalibrating    = false;
  let _recalibrateUntil = 0;
  let _lastTradeCandleKey = null;
  let _tradeExecTimeout  = null;       // مؤقت تحرير tradeExec التلقائي
  let _pendingRetrySignal = null;      // إشارة معلقة لإعادة المحاولة عند إعادة الاتصال
  let _lastTrendDirection = 'NEUTRAL';
  let _trendEmaStack = [];
  // ✅ [V13.4] حالة الاستنفاد الاتجاهي + سجل أداء الأنماط الحي
  let _exhaustDir   = null;    // 'UP' أو 'DOWN' — اتجاه آخر استنفاد مكتشف
  let _exhaustUntil = 0;       // وقف اتجاه الاستمرار حتى هذا الوقت
  let _lastExhaustLogTs = 0;   // ✅ [V14.2] تقييد تكرار سجل الاستنفاد
  const _patternWL = {};       // { pattern: { w:عدد فوز, l:عدد خسارة } } — سجل حي لكل نمط
  let _lastWsErrorMsgTs = 0;                // تقييد رسائل خطأ المقابس
  const _executorPool = new Map();           // تجمع مقابس المنفذ: ws → { origSend, connectedAt, lastActivity, authed }
  const _wsLastActivity = new Map();         // آخر نشاط لكل مقبس
  let _wsHealthTimer = null;                 // مؤقت فحص صحة المقابس
  let _miniBacktestDone = true;
  let _candlesSinceAssetChange = 0;
  let _lastDetectedPeriod = 0;
  let _lastDetectedCount  = 0;
  let _periodLockUntil    = 0;
  let tickCandleTimer     = null;
  let lastOpenedOrder     = null;
  let _sioManager         = null;
  let _isIslamicAccount   = false;
  let _aiTradingMode      = false;
  let _platformId         = 0;
  let _appData            = null;
  let _payloadCache = { prefixCall: null, suffixCall: null, prefixPut: null, suffixPut: null };

  const _assetPayouts    = new Map();
  const _assetIsOpen     = new Map();
  const botOrderIds      = new Set();
  const _chatSignalSeen  = new Set();
  const _fragBuffers     = new WeakMap();
  const _recentResults   = [];
  const patternStats     = {};

  // SPY panel state
  const _spyEntries      = [];
  let   _spyFilter       = 'all';
  let   _spyAICount      = 0;
  const _aiLogStats      = { w10:0, l10:0, w30:0, l30:0, w60:0, l60:0 };

  // Candle/tick buffers
  const candleBuffers    = {};
  const currentCandles   = {};
  const tickBuffers      = {};
  const chaforState      = {};

  // ═══════════════════════════════════════════════════════════════════════
  // [V16] مختبر الأوراكل (OracleLab) — التقاط خام عالي الدقة لتطوير الأوراكل
  //   الهدف: قياس كل تيك بدقة ميلي ثانية + ربط كل صفقة بمصدرها (chat/plat/slope)
  //   ونتيجتها، لمعرفة أي مصدر أدقّ وتوسيع اصطياد الأوراكل بناءً على بيانات حقيقية.
  // ═══════════════════════════════════════════════════════════════════════
  const OracleLab = (function () {
    const ticks = {};   // asset -> [{t,p}] حلقة بدقة ميلي ثانية
    const stats = {
      chat:  { w:0, l:0 },
      plat:  { 0:{w:0,l:0}, 1:{w:0,l:0}, 2:{w:0,l:0}, 3:{w:0,l:0}, 4:{w:0,l:0} },
      slope: { agree:{w:0,l:0}, against:{w:0,l:0}, flat:{w:0,l:0} },
      total: 0,
    };
    function onTick(a, price, now) {
      const buf = ticks[a] || (ticks[a] = []);
      buf.push({ t: now, p: price });
      const cut = now - 6000;
      while (buf.length && buf[0].t < cut) buf.shift();
      if (buf.length > 1500) buf.shift();
    }
    // الميل اللحظي على نافذة ms: عائد نسبي + فرق مطلق + عدد تيكات + المعدّل
    function microSlope(a, ms) {
      const buf = ticks[a]; if (!buf || buf.length < 2) return null;
      const last = buf[buf.length - 1], p1 = last.p, now = last.t;
      let i = buf.length - 1; while (i > 0 && buf[i].t > now - ms) i--;
      const p0 = buf[i].p, dt = now - buf[i].t, n = buf.length - 1 - i;
      if (!(p0 > 0) || dt <= 0) return null;
      return { rel: (p1 - p0) / p0, abs: p1 - p0, dt, ticks: n, ratePerSec: n / (dt / 1000) };
    }
    function snapshot(a, dir) {
      const os = (typeof DualWSSManager !== 'undefined' && DualWSSManager.oracleState)
        ? DualWSSManager.oracleState(a) : {};
      return {
        dir,
        chatDir: os.chatDir || null, chatTf: os.chatTf || null, chatAge: os.chatAge,
        platBest: os.platBest || 0, platTf: os.platTf || {},
        s200: microSlope(a, 200), s500: microSlope(a, 500), s1000: microSlope(a, 1000),
      };
    }
    function _fmtSlope(s) {
      if (!s) return '—';
      return (s.rel >= 0 ? '+' : '') + (s.rel * 1e6).toFixed(1) + 'e-6(n' + s.ticks + ')';
    }
    function recordClose(rec, win, openPrice, closePrice) {
      if (!CFG.ORACLE_LAB_ENABLED) return;
      const f = rec && rec.lab; if (!f) return;
      stats.total++;
      const dir = f.dir, hit = win ? 'w' : 'l';
      // ① مصدر الاتجاه: شات؟
      const chatAgree = f.chatDir && f.chatDir === dir;
      if (chatAgree) stats.chat[hit]++;
      // ② قوة المنصة (الكود الرقمي 0-4)
      const lvl = Math.max(0, Math.min(4, f.platBest | 0));
      stats.plat[lvl][hit]++;
      // ③ ميل التيك (الأجزاء): اتفاق/تعارض/مسطّح على نافذة 500ms
      const s = f.s500;
      let slopeCls = 'flat';
      if (s && Math.abs(s.rel) >= (CFG.ORACLE_LAB_FLAT_REL || 1e-6)) {
        const slopeDir = s.rel > 0 ? 'BUY' : 'SELL';
        slopeCls = (slopeDir === dir) ? 'agree' : 'against';
      }
      stats.slope[slopeCls][hit]++;
      // سطر خام مُعلَّم (قابل للتحليل لاحقاً)
      const tfStr = Object.keys(f.platTf || {}).map(k => k + ':' + f.platTf[k]).join(',');
      addLog('🧪 [LAB] ' + (win ? 'WIN ' : 'LOSS') + ' | ' + dir +
             ' | chat=' + (f.chatDir ? (chatAgree ? f.chatDir + '✓' : f.chatDir + '✗') + '/' + (f.chatTf||'?') : '—') +
             ' | plat=' + lvl + '{' + tfStr + '}' +
             ' | slope500=' + _fmtSlope(s) + '[' + slopeCls + ']' +
             ' | px ' + (openPrice||0).toFixed(5) + '→' + (closePrice||0).toFixed(5),
             win ? 'signal' : 'error');
      if (stats.total % (CFG.ORACLE_LAB_REPORT_EVERY || 10) === 0) report();
    }
    function _pct(o) { const t = o.w + o.l; return t ? Math.round(o.w / t * 100) + '% (' + o.w + '/' + t + ')' : '—'; }
    function report() {
      if (!CFG.ORACLE_LAB_ENABLED) return;
      const p = stats.plat;
      addLog('🧪 [LAB-REPORT] إجمالي:' + stats.total +
             ' | شات:' + _pct(stats.chat) +
             ' | plat4:' + _pct(p[4]) + ' plat3:' + _pct(p[3]) +
             ' plat2:' + _pct(p[2]) + ' plat≤1:' + _pct({ w: p[0].w + p[1].w, l: p[0].l + p[1].l }) +
             ' | ميل-موافق:' + _pct(stats.slope.agree) +
             ' ميل-معاكس:' + _pct(stats.slope.against) +
             ' ميل-مسطّح:' + _pct(stats.slope.flat), 'info');
    }
    return { onTick, microSlope, snapshot, recordClose, report, _stats: stats };
  })();
  try { W._oracleLabReport = () => OracleLab.report(); } catch (_) {}

  // ETC stubs
  const ETC_MAX_HIST     = 30;
  let _etcOffset         = 0;
  const _etcHistory      = [];

  // ══════════════════════════════════════════════════════════════════════
  // § 4  Stub Engines & Helpers (for preserved code compatibility)
  // ══════════════════════════════════════════════════════════════════════
  const _PS = {
    tickCount: 0, lastPrice: null, lastNow: 0,
    buyPct: 50, sellPct: 50,
    direction: 'NEUTRAL', confidence: 0, spConf: 0,
    tickTs: new Float64Array(10), tickTs_n: 0,
    spikeActive: false, spikePenaltyUntil: 0,
    W5:[], W10:[], W20:[], W40:[], W80:[],
    vels:[], accels:[],
    e2:null, e3:null, e5:null, e8:null, e13:null, e21:null, e34:null, e55:null,
    tRsi_ag:0, tRsi_al:0, tRsi_val:50, tRsi_n:0, tRsi_prev:[],
    ofi_streak:0, ofi_score:0, ofi_bid:0, ofi_ask:0,
    mom:0, momHL:5,
    vol_sq_sum:0, vol_sum:0, vol_n:0, vol:1e-9,
    vol_hist: new Float64Array(50), vol_hist_n:0,
    lr_xy:0, lr_x:0, lr_y:0, lr_x2:0, lr_n:0, lr_prices:[], lr_r2:0,
    ac_lags: [{prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},{prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},{prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},{prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0},{prevVel:null,sxy:0,sx:0,sy:0,sx2:0,n:0}],
    ac_velBuf: new Float64Array(60), ac_velBuf_n: 0,
    kf_x: null, kf_p: 1.0,
    ent_up: 0, ent_dn: 0, ent_n: 0,
    hurst_h: 0.5,
    kalmanPredDir: 0, kalmanMagnitude: 0,
    snap: null,
    regimeStats: { TREND:{wins:0,total:0}, RANGE:{wins:0,total:0}, VOLATILE:{wins:0,total:0} },
    regimeBlocked: {},
    aw: {},
    groupVotes: { A:{bull:0,bear:0,total:0}, B:{bull:0,bear:0,total:0}, C:{bull:0,bear:0,total:0}, D:{bull:0,bear:0,total:0} },
  };

  const PERF = {
    packetRecv:0, decodeStart:0, tickRecv:0, psmArmed:0, schedFired:0, orderSent:0,
    lastATR:null, lastTotal:null,
    _tickLatEma:null, _tickCount:0, _DISPLAY_EVERY:8,
    mark(label) { this[label] = performance.now(); },
    tickDone() {
      if (!this.packetRecv || !this.tickRecv) return;
      const lat = this.tickRecv - this.packetRecv;
      if (lat < 0 || lat > 2000) return;
      this._tickLatEma = this._tickLatEma===null ? lat : this._tickLatEma*0.85+lat*0.15;
      this._tickCount++;
      if (this._tickCount % this._DISPLAY_EVERY === 0) this._refreshLatUI();
    },
    _refreshLatUI() {
      const el = W.document.getElementById('cbPerfVal'); if (!el) return;
      const v = this._tickLatEma; if (v===null) { el.textContent='–'; return; }
      el.textContent = v.toFixed(1)+'ms';
      el.style.color = v<15 ? '#00d264' : v<40 ? '#ffb020' : '#ff3755';
    },
    report() {
      if (!this.orderSent || !this.packetRecv) return;
      const total = this.orderSent - this.packetRecv; this.lastTotal = total.toFixed(2);
      const el = W.document.getElementById('cbPerfVal');
      if (el) { el.textContent=this.lastTotal+'ms ⚡'; el.style.color='#00d264'; }
    },
  };

  function loadStats() {
    try {
      const raw = localStorage.getItem('cb_v100_stats');
      if (raw) {
        const s = JSON.parse(raw);
        // [V18] العدّادات المتتالية لا تُورَّث عبر تحديث الصفحة — جلسة جديدة = بداية نظيفة
        // (كانت 3 خسائر قديمة تُسترجع وتُطلق RECALIBRATE فتوقف البوت 45ث عند الإقلاع)
        s.lossStreak = 0; s.winStreak = 0;
        return s;
      }
    } catch(_) {}
    return { wins:0, losses:0, total:0, lossStreak:0, bestStreak:0, winStreak:0, tveWins:0, tveLosses:0, confWins:0, confLosses:0, doubles:0, doubleWins:0 };
  }
  const STATS = loadStats();
  function saveStats() { try { localStorage.setItem('cb_v100_stats', JSON.stringify(STATS)); } catch (_) {} }
  function winRate() { return STATS.total > 0 ? Math.round((STATS.wins / STATS.total) * 100) : 0; }

  // ── Stub functions for removed strategy code ────────────────────────
  function normalizeAsset(str) {
    return String(str).replace(/^#/, '').replace(/[/\\\-\s]/g,'').replace(/_?otc$/i, '_otc');
  }

  function _safeAmount(amt) { return Math.max(1, Math.round(amt * 100) / 100); }
  function _rebuildPayloadCache() {
    const a = activeAsset || '';
    // ✅ [V14.3] الوقت المُرسَل = مدة المستخدم المختارة، مُثبّتة على مدة مسموحة فعلياً (يمنع IncorrectExpTime)
    const t = _snapTradeDuration(_tradeDuration > 0 ? _tradeDuration : (candlePeriod || 3));
    const amt = tradeAmount;
    const d = isDemo;
    _payloadCache.prefixCall = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"call","isDemo":'+d+',"requestId":';
    _payloadCache.suffixCall = ',"optionType":100,"time":'+t+'}]';
    _payloadCache.prefixPut  = '42["openOrder",{"asset":"'+a+'","amount":'+amt+',"action":"put","isDemo":'+d+',"requestId":';
    _payloadCache.suffixPut  = _payloadCache.suffixCall;
  }
  function computeKellyAmount() { return CFG.DEFAULT_AMOUNT; }
  function getTopPatterns(n) { return []; }
  function recordPatternResult() {}
  function _savePatternStats() {}
  function recordTrade(win, wasTVE) {
    STATS.total++;
    // ملاحظة: تسجيل أداء النمط الحي يتم داخل DualWSSManager.onTradeResult (حيث النمط في النطاق)
    if (win) {
      STATS.wins++; STATS.winStreak++; STATS.lossStreak=0;
      if(STATS.winStreak>STATS.bestStreak) STATS.bestStreak=STATS.winStreak;
      if(wasTVE) STATS.tveWins++;
      // فوز → إلغاء حالات الحماية
      _ghostTradeActive = false;
      _ghostWatching = false;
      _ghostConsecutive = 0;
      _recalibrating = false;
      _recalibrateUntil = 0;
      _pendingRetrySignal = null;
      // ✅ إبلاغ DualWSSManager بنتيجة الفوز
      if (DualWSSManager && DualWSSManager.onTradeResult) {
        DualWSSManager.onTradeResult(true, _pendingTradeRecord ? _pendingTradeRecord.direction : null);
      }
    } else {
      STATS.losses++; STATS.lossStreak++; STATS.winStreak=0;
      if(wasTVE) STATS.tveLosses++;
      // ✅ وقف خسائر تدريجي: خسارة واحدة = 5ث، خسارتين = 10ث، 3+ = 15ث
      const pauseMs = Math.min(CFG.LOSS_STREAK_PAUSE_MS, STATS.lossStreak * 5000);
      _lossStreakPauseUntil = Date.now() + pauseMs;
      addLog('⛔ [LOSS-STREAK] خسارة متتالية: ' + STATS.lossStreak + ' | وقف ' + (pauseMs/1000) + 'ث', 'error');
      // ✅ إبلاغ DualWSSManager بنتيجة الخسارة — إعادة تعيين العداد المتتالي
      if (DualWSSManager && DualWSSManager.onTradeResult) {
        DualWSSManager.onTradeResult(false, _pendingTradeRecord ? _pendingTradeRecord.direction : null);
      }
    }
    tradeExec = false;
    if (_tradeExecTimeout) { clearTimeout(_tradeExecTimeout); _tradeExecTimeout = null; }
    saveStats(); updateStatsUI(); updateTradeBtn();
  }
  function getIMDBTier() { return 0; }
  function canIMDB() { return false; }
  function executeTrade(direction, asset, overrideAmount) {
    if (!autoTrade) return;
    if (tradeExec) return;
    if (!tradeWSOrig || !tradeWS || tradeWS.readyState !== 1) {
      addLog('❌ لا يوجد مقبس تداول متاح', 'error');
      return;
    }
    const action = direction === 'BUY' ? 'call' : 'put';
    const amt = overrideAmount || tradeAmount;
    const safeAmt = _safeAmount(amt);
    const tradeSec = _snapTradeDuration(_tradeDuration || (candlePeriod || 3));
    const rid = _nextReqId();
    if (!_payloadCache.prefixCall) _rebuildPayloadCache();
    const prefix = action === 'call' ? _payloadCache.prefixCall : _payloadCache.prefixPut;
    const suffix = action === 'call' ? _payloadCache.suffixCall : _payloadCache.suffixPut;
    const msg = prefix + rid + suffix;
    try {
      tradeWSOrig(msg);
      tradeExec = true;
      lastTradeMs = Date.now();
      _pendingTradeRecord = { asset: asset || activeAsset, direction, amount: safeAmt, openTs: Date.now(), source: 'directWS' };
      try { const _la = normalizeAsset(asset || activeAsset); const _tb = tickBuffers[_la]; _pendingTradeRecord.lab = OracleLab.snapshot(_la, direction); _pendingTradeRecord.openPrice = (_tb && _tb.length) ? _tb[_tb.length-1] : 0; } catch(_) {}  // [V16] لقطة ميزات الأوراكل عند الفتح
      addLog('⚡ [EXEC] ' + direction + ' | ' + (asset || activeAsset) + ' | $' + safeAmt + ' | ' + tradeSec + 'ث', 'signal');
      updateTradeBtn();
      // ✅ تحرير تلقائي لـ tradeExec بعد مدة الصفقة + 5 ثواني أمان
      // هذا يمنع تعليق البوت إذا انقطع المقبس قبل وصول نتيجة الصفقة
      if (_tradeExecTimeout) clearTimeout(_tradeExecTimeout);
      _tradeExecTimeout = setTimeout(() => {
        if (tradeExec) {
          tradeExec = false;
          addLog('⏰ [TRADE-EXEC] تحرير تلقائي — لم تأتِ نتيجة الصفقة خلال ' + (tradeSec + 5) + 'ث', 'info');
          updateTradeBtn();
        }
      }, (tradeSec + 5) * 1000);
    } catch(err) {
      addLog('❌ فشل إرسال الأمر: ' + err.message, 'error');
    }
  }
  function executeIMDB() {}
  function _executeWithJitter() {}
  function scoreConfluence() { return { score: 0, breakdown: [] }; }
  function checkStrategy() { return null; }
  function analyzeTrend(candles) {
    if (!candles || candles.length < 2) return { trend:'NEUTRAL', label:'NEUTRAL' };
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2];
    if (last.isBullish && prev.isBullish) return { trend:'UP', label:'↑ UP' };
    if (!last.isBullish && !prev.isBullish) return { trend:'DOWN', label:'↓ DOWN' };
    return { trend:'NEUTRAL', label:'NEUTRAL' };
  }
  function buildCandle(prices, startTime) {
    if (!prices || prices.length < 2) return null;
    const o=prices[0], c=prices[prices.length-1], h=Math.max(...prices), l=Math.min(...prices);
    return { open:o, close:c, high:h, low:l, isBullish:c>=o, prices, startTime, fromHistory:false };
  }
  function computeMACD() { return null; }
  function computeBB() { return null; }
  function computeStochRSI() { return null; }
  function getHigherTFTrend() { return { trend:'NEUTRAL', label:'NEUTRAL' }; }
  function _classifyAIText() { return null; }
  function _applyAISignal() {}
  function _onTVESignal() {}
  function _startSignalWatcher() {}
  function _readAppData() {}
  function _initWorker() {}
  function _runMiniBacktest() {}
  function _cc3Fire() {}
  function scheduleWindowEntry() {}
  function closeCurrentCandle() {}
  function injectPhantomCandle() {}
  function predictClosePrice(prices) { return prices.length ? prices[prices.length-1] : 0; }
  function getSmartEarlyMs() { return CFG.PREDICTIVE_FIRE_MS; }
  function schedulePredictiveEntry() {}
  function cancelPredictiveExecution() {
    if (_predictiveTimer) { clearTimeout(_predictiveTimer); _predictiveTimer=null; }
    if (_predictiveRAF)   { W.cancelAnimationFrame(_predictiveRAF); _predictiveRAF=null; }
  }
  function getAdaptiveCooldown() { return CFG.TRADE_COOLDOWN_MS; }
  function updateTickSize() {}
  function _etcCalibrate() {}
  function _etcStoreOpenPrice() {}

  // Stub engine objects
  const PatternStateMachine = {
    state: 'IDLE',
    evaluate() {},
    reset() {},
  };
  const TickVelocityEngine = {
    buf: [], velHistory: [],
    push() { return null; },
    reset() { this.buf = []; this.velHistory = []; },
  };
  const MicroTrendFilter = {
    validate(dir, asset) { return { allow: true, reason: '' }; },
  };
  const _sCandle = {
    isActive() { return false; },
    init() {},
    update() {},
    reset() {},
  };
  const _rollingATR = { seedFromCandles() {} };
  const ELACEngine = { getBias() { return 0; }, setIntended() {}, recordFire() {} };
  const LADEngine = { recordTick() {}, getServerDelta() { return 0; } };
  const OBIEngine = { update() {}, getScore() { return 0; } };
  const LSTMProxy = { push() {}, learn() {} };
  const RLEngine = { recordOutcome() {}, load() {} };
  const SessionGuard = { recordTrade() {} };
  const PyramidEngine = { onResult() {} };

  // Chat signal stubs
  let _chatBuyVotes = 0, _chatSellVotes = 0, _chatSignalTs = 0;

  // ══════════════════════════════════════════════════════════════════════
  // § 5  Timing Adj (stub for HUD)
  // ══════════════════════════════════════════════════════════════════════
  function _cbAdjTiming(delta) {
    _timingOffset += delta;
    const el = W.document.getElementById('cbTimingVal');
    if (el) {
      el.textContent = (_timingOffset >= 0 ? '+' : '') + _timingOffset + ' ms';
      el.className = 'cb-timing-val' + (_timingOffset < 0 ? ' neg' : '');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 6  MsgPack Decoder + Data Extractors
  // ══════════════════════════════════════════════════════════════════════
  function msgpackDecode(buffer) {
    const buf  = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const off  = buffer.byteOffset || 0;
    const view = new DataView(buf);
    const bytes= new Uint8Array(buf, off);
    let pos = 0;
    const rb   = () => bytes[pos++];
    const ru8  = () => bytes[pos++];
    const ru16 = () => { const v = view.getUint16(pos, false); pos += 2; return v; };
    const ru32 = () => { const v = view.getUint32(pos, false); pos += 4; return v; };
    const ri8  = () => { const v = view.getInt8(pos);          pos += 1; return v; };
    const ri16 = () => { const v = view.getInt16(pos, false);  pos += 2; return v; };
    const ri32 = () => { const v = view.getInt32(pos, false);  pos += 4; return v; };
    const rf32 = () => { const v = view.getFloat32(pos, false);pos += 4; return v; };
    const rf64 = () => { const v = view.getFloat64(pos, false);pos += 8; return v; };
    const ri64 = () => { const h = view.getInt32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const ru64 = () => { const h = view.getUint32(pos, false), l = view.getUint32(pos+4, false); pos += 8; return h*4294967296+l; };
    const rStr = (n) => { const s = new TextDecoder().decode(bytes.subarray(pos, pos+n)); pos += n; return s; };
    const rBin = (n) => { const b = bytes.subarray(pos, pos+n); pos += n; return b; };
    function decode() {
      const b = rb();
      if (b <= 0x7f) return b;
      if ((b&0xf0)===0x80) { const n=b&0xf; const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
      if ((b&0xf0)===0x90) { const n=b&0xf; const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
      if ((b&0xe0)===0xa0) return rStr(b&0x1f);
      if ((b&0xe0)===0xe0) return b-256;
      switch (b) {
        case 0xc0: return null;  case 0xc2: return false; case 0xc3: return true;
        case 0xc4: return rBin(ru8()); case 0xc5: return rBin(ru16()); case 0xc6: return rBin(ru32());
        case 0xca: return rf32(); case 0xcb: return rf64();
        case 0xcc: return ru8();  case 0xcd: return ru16(); case 0xce: return ru32(); case 0xcf: return ru64();
        case 0xd0: return ri8();  case 0xd1: return ri16(); case 0xd2: return ri32(); case 0xd3: return ri64();
        case 0xd9: return rStr(ru8()); case 0xda: return rStr(ru16()); case 0xdb: return rStr(ru32());
        case 0xdc: { const n=ru16(); const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xdd: { const n=ru32(); const a=[]; for(let i=0;i<n;i++) a.push(decode()); return a; }
        case 0xde: { const n=ru16(); const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
        case 0xdf: { const n=ru32(); const o={}; for(let i=0;i<n;i++){const k=decode(); o[k]=decode();} return o; }
        default: throw new Error('msgpack 0x'+b.toString(16));
      }
    }
    return decode();
  }

  function extractTickFromArray(arr) {
    if (!Array.isArray(arr)) return null;
    if (Array.isArray(arr[0]) && arr[0].length >= 3 && typeof arr[0][0]==='string' && typeof arr[0][2]==='number') {
      const price = arr[0][2]; if (price>0) return { asset: normalizeAsset(arr[0][0]), price, ts: arr[0][1] };
    }
    if (arr.length >= 3 && typeof arr[0]==='string' && typeof arr[2]==='number') {
      const price = arr[2]; if (price>0) return { asset: normalizeAsset(arr[0]), price, ts: arr[1] };
    }
    return null;
  }

  function extractChafor(decoded) {
    if (!Array.isArray(decoded) || !Array.isArray(decoded[0]) || decoded[0].length < 2) return null;
    const asset = String(decoded[0][0]).toUpperCase(), seconds = Number(decoded[0][1]);
    if (asset.length >= 3 && Number.isFinite(seconds) && seconds >= 0) return { asset, seconds };
    return null;
  }

  const Q1_SIG = {
    TICK_ARRAY: new Uint8Array([0x5b, 0x5b, 0x22]),
    SUCCESS   : new Uint8Array([0x73, 0x75, 0x63, 0x63, 0x65, 0x73, 0x73]),
  };
  function q1Match(bytes, sig, offset=0) {
    if (bytes.length < offset + sig.length) return false;
    for (let i=0; i<sig.length; i++) if (bytes[offset+i] !== sig[i]) return false;
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7  WebSocket Interception
  // ══════════════════════════════════════════════════════════════════════
  const NativeWS = W.WebSocket;

  function _isTradeSocket(urlStr) {
    if (urlStr.includes('po.market'))  return true;
    if (urlStr.includes('chat-po'))    return false;
    if (urlStr.includes('events-po'))  return false;
    if (urlStr.includes('socket.io') && urlStr.includes('api')) return true;
    return false;
  }

  function _probeForSIOManager() {
    if (_sioManager) return;
    const candidates = ['io','_io','__io','socket','_socket','sio','ioManager','socketManager'];
    for (const key of candidates) { const obj=W[key]; if(_isSIOManager(obj)){_sioManager=obj;return;} if(_isSIOSocket(obj)){_sioManager=obj.io||obj;return;} }
    try {
      for (const key of Object.keys(W)) {
        if (key.length>30||key.startsWith('webkit')||key.startsWith('on')) continue;
        const obj=W[key];
        if (obj&&typeof obj==='object'&&!Array.isArray(obj)) { if(_isSIOManager(obj)){_sioManager=obj;return;} if(_isSIOSocket(obj)){_sioManager=obj.io||obj;return;} }
      }
    } catch(_){}
  }
  function _isSIOManager(obj){ return obj&&typeof obj==='object'&&typeof obj.socket==='function'&&typeof obj.open==='function'&&obj.nsps!==undefined; }
  function _isSIOSocket(obj) { return obj&&typeof obj==='object'&&typeof obj.emit==='function'&&typeof obj.on==='function'&&obj.io!==undefined&&obj.nsp!==undefined; }

  function tryDecodeWithFragment(ws, buf) {
    const now = Date.now();
    let combined = buf;
    if (_fragBuffers.has(ws)) {
      const frag = _fragBuffers.get(ws);
      if (now - frag.ts > CFG.FRAG_BUFFER_TTL) { _fragBuffers.delete(ws); }
      else { const merged = new Uint8Array(frag.buf.byteLength+buf.byteLength); merged.set(new Uint8Array(frag.buf),0); merged.set(new Uint8Array(buf),frag.buf.byteLength); combined=merged.buffer; }
    }
    try { const decoded=msgpackDecode(combined); _fragBuffers.delete(ws); return { decoded, buffer:combined }; }
    catch(_){ _fragBuffers.set(ws,{buf:combined,ts:now}); return null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 7.1  Socket Pool Helper Functions
  // ══════════════════════════════════════════════════════════════════════
  function _promoteBestExecutor() {
    // من تجمع المقابس: اختر أفضل مقبس منفذ متاح (الأقدم = الأكثر استقراراً)
    if (!CFG.WS_EXEC_POOL_ENABLED) return;
    let best = null, bestAge = 0;
    for (const [ws, info] of _executorPool) {
      if (ws.readyState === 1 && info.authed) {
        const age = Date.now() - info.connectedAt;
        if (age > bestAge) { best = ws; bestAge = age; }
      }
    }
    if (best && (!tradeWS || tradeWS.readyState !== 1)) {
      const info = _executorPool.get(best);
      tradeWS = best;
      tradeWSOrig = info.origSend;
      _tradeSocketReady = true;
      // ✅ إعادة بناء cache المبلغ عند ترقية مقبس جديد
      _rebuildPayloadCache();
      addLog('🔌 [POOL] ترقية مقبس المنفذ: ' + (best._url || '').split('?')[0] + ' (عمر: ' + (bestAge/1000).toFixed(0) + 'ث)', 'signal');
      // تسجيل مع DualWSSManager
      if (typeof DualWSSManager !== 'undefined') {
        try { DualWSSManager.registerSocket(best, 'executor', info.origSend); } catch(_) {}
        // ✅ إعادة محاولة الإشارة المعلقة
        if (_pendingRetrySignal && autoTrade && !tradeExec) {
          const sig = _pendingRetrySignal;
          // تأكد أن الإشارة ليست قديمة (أقل من 5 ثواني)
          if (Date.now() - sig.timestamp < 5000) {
            _pendingRetrySignal = null;
            addLog('🔄 [POOL-RETRY] إعادة محاولة الإشارة: ' + sig.direction + ' | ' + sig.asset, 'signal');
            try { DualWSSManager.executeTrade(sig.direction, sig.asset, tradeAmount); } catch(_) {}
          } else {
            _pendingRetrySignal = null; // إشارة قديمة — تخلّص منها
          }
        }
      }
      if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.trackWS(best._url || '', 'promoted');
    }
  }

  function _throttledWsError(msg) {
    const now = Date.now();
    if (now - _lastWsErrorMsgTs >= CFG.WS_ERROR_THROTTLE_MS) {
      _lastWsErrorMsgTs = now;
      addLog(msg, 'error');
    }
  }

  function _startWSHealthMonitor() {
    if (_wsHealthTimer) return;
    _wsHealthTimer = _v11_setInterval(() => {
      // فحص صحة تجمع المقابس
      let aliveCount = 0;
      for (const [ws, info] of _executorPool) {
        if (ws.readyState === 1) {
          aliveCount++;
          const inactive = Date.now() - info.lastActivity;
          if (inactive > CFG.WS_HEALTH_TIMEOUT_MS) {
            addLog('⚠️ [WS-HEALTH] مقبس بدون نشاط منذ ' + (inactive/1000).toFixed(0) + 'ث: ' + (ws._url || '').split('?')[0], 'error');
          }
        }
      }
      // ✅ فحص tradeExec المعلق — حرّره إذا كان عالقاً أكثر من 30 ثانية
      if (tradeExec && lastTradeMs > 0 && (Date.now() - lastTradeMs > 30000)) {
        tradeExec = false;
        if (_tradeExecTimeout) { clearTimeout(_tradeExecTimeout); _tradeExecTimeout = null; }
        addLog('⏰ [WS-HEALTH] تحرير tradeExec معلق منذ ' + ((Date.now()-lastTradeMs)/1000).toFixed(0) + 'ث', 'signal');
        updateTradeBtn();
      }
      // ✅ محاولة إعادة الإشارة المعلقة إذا كان هناك مقبس متاح الآن
      if (_pendingRetrySignal && autoTrade && !tradeExec && tradeWS && tradeWS.readyState === 1) {
        const sig = _pendingRetrySignal;
        if (Date.now() - sig.timestamp < 8000) {  // الإشارة أقل من 8 ثواني
          _pendingRetrySignal = null;
          addLog('🔄 [WS-HEALTH] إعادة محاولة إشارة معلقة: ' + sig.direction + ' | ' + sig.asset, 'signal');
          try { DualWSSManager.executeTrade(sig.direction, sig.asset, tradeAmount); } catch(_) {}
        } else {
          _pendingRetrySignal = null;  // إشارة قديمة — تخلّص منها
        }
      } else if (_pendingRetrySignal && Date.now() - _pendingRetrySignal.timestamp >= 8000) {
        _pendingRetrySignal = null;  // إشارة قديمة — تخلّص منها
      }
      // فحص مقبس أوراكل
      if (typeof DualWSSManager !== 'undefined') {
        const isConnected = DualWSSManager.isConnected();
        if (!isConnected && autoTrade) {
          const now = Date.now();
          if (now - _lastWsErrorMsgTs >= CFG.WS_ERROR_THROTTLE_MS) {
            _lastWsErrorMsgTs = now;
            addLog('⚠️ [WS-HEALTH] لا يوجد مقبس تداول متاح — ' + aliveCount + ' في التجمع', 'error');
          }
        }
      }
      // تنظيف المقابس المغلقة من التجمع
      for (const [ws] of _executorPool) {
        if (ws.readyState !== 1 && ws.readyState !== 0) {
          _executorPool.delete(ws);
        }
      }
    }, 10000); // كل 10 ثواني
  }

  function _attachWSHooks(ws, urlStr) {
    ws._url = urlStr;
    const _origSend = ws.send.bind(ws);
    let _pingIntervalId = null;

    // ─── Dual-WSS: Socket role tagging ──────────────────────────────────
    if (urlStr.includes('events-po')) {
      ws._dualRole = 'oracle';
      addLog('🔮 [DUAL-WSS] مقبس أوراكل معترض: events-po', 'signal');
    }
    if (_isTradeSocket(urlStr)) {
      ws._dualRole = 'executor';

      // ═══ تجمع مقابس المنفذ ═══
      // إضافة المقبس إلى التجمع بدل استبدال tradeWS فوراً
      if (CFG.WS_EXEC_POOL_ENABLED) {
        _executorPool.set(ws, {
          origSend: _origSend,
          connectedAt: Date.now(),
          lastActivity: Date.now(),
          authed: false,
        });
        addLog('🔌 مقبس التداول: ' + urlStr.split('?')[0], 'info');
        if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.trackWS(urlStr, 'connected');
      } else {
        // الطريقة القديمة بدون تجمع
        const oldAlive = tradeWS && tradeWS.readyState === 1;
        if (!oldAlive) {
          tradeWS = ws; tradeWSOrig = _origSend;
          addLog('🔌 مقبس التداول: ' + urlStr.split('?')[0], 'info');
          if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.trackWS(urlStr, 'connected');
        }
      }

      // ═══ إصلاح استقرار المقابس ═══
      // المشكلة الرئيسية: إرسال PING مزدوج ('2') على مقابس تديرها منصة Socket.IO
      // المنصة ترسل PING بنفسها — PING الإضافي من عندنا يسبب رفض الخادم وانقطاع كل 8-15 ثانية
      // الحل: إيقاف PING الخاص بنا تماماً — المنصة تدير دورة PING/PONG
      if (CFG.WS_SELF_PING_ENABLED && CFG.DSO_WS_PING_MS > 0) {
        // PING معطل افتراضياً — يُفعّل فقط يدوياً للتصحيح
        let _lastPongTs = Date.now();
        let _pingSeq = 0;
        _pingIntervalId = _v11_setInterval(() => {
          if (ws.readyState === 1) {
            try {
              _origSend('2'); // Engine.IO PING
              _pingSeq++;
              if (Date.now() - _lastPongTs > 20000) {
                addLog('⚠️ [WS-HEALTH] لا PONG منذ 20ث — المقبس قد يكون ميتاً', 'error');
              }
            } catch(_) {}
          } else {
            clearInterval(_pingIntervalId); _pingIntervalId = null;
          }
        }, CFG.DSO_WS_PING_MS);
      }

      // ترقية المقبس بعد فترة — إذا نجا من الفلترة الأولية للمنصة
      if (CFG.WS_EXEC_POOL_ENABLED) {
        setTimeout(() => {
          if (ws.readyState === 1) {
            const info = _executorPool.get(ws);
            if (info) {
              info.authed = true;
              info.lastActivity = Date.now();
            }
            // إذا لم يكن هناك tradeWS فعال، رقّي هذا المقبس
            if (!tradeWS || tradeWS.readyState !== 1) {
              _promoteBestExecutor();
            }
          }
        }, CFG.WS_PROMOTE_AUTH_DELAY);
      }

      // Fallback: إذا لم تأتِ successauth خلال 5 ثواني، اعتبر المقبس جاهز
      setTimeout(() => {
        if (!_tradeSocketReady && ws.readyState === 1) {
          const info = _executorPool.get(ws);
          if (info) info.authed = true;
          if (!tradeWS || tradeWS.readyState !== 1) {
            _promoteBestExecutor();
          }
          if (ws === tradeWS) {
            _tradeSocketReady = true;
            addLog('✅ مقبس تلقائي — جاهز (fallback 5s)', 'signal');
          }
        }
      }, 5000);
    }

    // ─── Dual-WSS: Keepalive لمقبس أوراكل — معطل افتراضياً ═══
    // المنصة تدير PING/PONG لأوراكل أيضاً — لا حاجة لإرسال PING إضافي
    if (ws._dualRole === 'oracle' && CFG.WS_SELF_PING_ENABLED && CFG.DSO_WS_PING_MS > 0) {
      const _oraclePingId = _v11_setInterval(() => {
        if (ws.readyState === 1) { try { _origSend('2'); } catch(_){} }
        else { clearInterval(_oraclePingId); }
      }, CFG.DSO_WS_PING_MS);
      ws.addEventListener('close', () => { clearInterval(_oraclePingId); }, { once: true });
    }

    // Register oracle sockets immediately with DualWSSManager
    if (ws._dualRole === 'oracle' && typeof DualWSSManager !== 'undefined') {
      try { DualWSSManager.registerSocket(ws, ws._dualRole, _origSend); } catch(_) {}
    }
    // Executor sockets are registered with DualWSSManager only when promoted (see _promoteBestExecutor)
    ws.send = function (data) {
      // 🔬 DIAG: log outgoing packet
      try {
        if (typeof CoreDiagnostic !== 'undefined') {
          let evName = 'raw';
          if (typeof data === 'string' && data.startsWith('42')) {
            try { const arr = JSON.parse(data.slice(2)); if (Array.isArray(arr)) evName = arr[0]; } catch(_) {}
          }
          CoreDiagnostic.logPacket('OUT', typeof data, data, { evName });
          CoreDiagnostic.recordTraffic('OUT', evName, data.length || 0, null);
          CoreDiagnostic.recordNetStat('OUT', data.length || 0, 'send');
        }
      } catch(_) {}
      if (typeof data === 'string' && data.startsWith('42')) {
        try {
          const arr = JSON.parse(data.slice(2));
          if (Array.isArray(arr)) {
            const evName = arr[0], payload = arr[1] || {};
            if (evName==='changeSymbol' && payload?.asset) onActiveAsset(String(payload.asset), 'changeSymbol_send');
            if (evName==='saveCharts') {
              const s = payload.settings || {};
              const ft = parseInt(s.fastTimeframe, 10);
              if (Number.isFinite(ft) && ft >= 1) {
                _tradeDuration = ft;
                _rebuildPayloadCache();
                updateHUD();
              }
              if (s.symbol && s.symbol.length>=3) onActiveAsset(s.symbol, 'saveCharts');
              if (s.isDemo !== undefined) isDemo = s.isDemo ? 1 : 0;
              _extractFastCloseAt(s, payload);
            }
            if (evName==='openOrder' && payload.isDemo !== undefined) isDemo = payload.isDemo;
          }
        } catch (_) {}
      }
      return _origSend(data);
    };
    ws.addEventListener('message', (e) => {
      PERF.mark('packetRecv');
      const raw = e.data;

      // Dual-WSS: record message arrival timestamp for latency gap measurement
      if (ws._dualRole && typeof DualWSSManager !== 'undefined') {
        try { DualWSSManager.recordMsgTs(ws._dualRole); } catch(_) {}
      }
      // تحديث نشاط التجمع عند أي رسالة واردة
      const poolInfo = _executorPool.get(ws);
      if (poolInfo) poolInfo.lastActivity = Date.now();

      // ═══ معالجة PING/PONG Socket.IO ═══
      if (typeof raw === 'string' && raw === '2') {
        // Server PING → رد فوري بـ PONG
        try { _origSend('3'); } catch(_) {}
        return;
      }
      if (typeof raw === 'string' && raw === '3') {
        // Server PONG → تحديث نشاط التجمع
        const poolInfo = _executorPool.get(ws);
        if (poolInfo) poolInfo.lastActivity = Date.now();
        const actInfo = _wsLastActivity.get(ws);
        if (actInfo) actInfo.ts = Date.now();
        return;
      }
      // 🔬 DIAG: log incoming packet
      try {
        if (typeof CoreDiagnostic !== 'undefined') {
          const size = raw instanceof ArrayBuffer ? raw.byteLength : (raw instanceof Blob ? raw.size : (typeof raw === 'string' ? raw.length : 0));
          let evName = 'raw';
          if (_pendingEventMap.has(ws)) {
            const slot = _pendingEventMap.get(ws);
            if (slot && (Date.now() - slot.ts) <= _PENDING_EVENT_TTL_MS) evName = slot.name || 'raw';
          }
          CoreDiagnostic.logPacket('IN', typeof raw, raw, { evName });
          CoreDiagnostic.recordTraffic('IN', evName, size, null);
          CoreDiagnostic.recordNetStat('IN', size, evName);
        }
      } catch(_) {}
      if (raw instanceof ArrayBuffer || raw instanceof Blob) handleBinaryFrame(raw, urlStr, ws);
      else if (typeof raw === 'string') handleTextMessage(raw, ws);
    });
    ws.addEventListener('open',  () => {
      wsConnected = true;
      updateStatusDot();
      _probeForSIOManager();
      if (_isTradeSocket(urlStr) && _streamStalled) {
        _streamStalled = false;
        _lastTickMs = Date.now();
        _wsReconnectTs = Date.now();
        addLog('🔄 [WS-OPEN] استعاد الاتصال — إزالة STREAM STALL', 'signal');
        if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updatePlatformState('streamStalled', false);
      }
      if (_isTradeSocket(urlStr)) {
        _wsReconnectTs = Date.now();
        // ✅ إعادة بناء cache المبلغ عند إعادة الاتصال
        _rebuildPayloadCache();
      }
      if (_isTradeSocket(urlStr) && tradeExec && (Date.now() - lastTradeMs) > 15000) {
        if (_tradeExecLockTimer)  { clearTimeout(_tradeExecLockTimer);  _tradeExecLockTimer  = null; }
        if (_tradeExecResetTimer) { clearTimeout(_tradeExecResetTimer); _tradeExecResetTimer = null; }
        tradeExec = false;
        if (_tradeExecTimeout) { clearTimeout(_tradeExecTimeout); _tradeExecTimeout = null; }
        updateTradeBtn();
        addLog('🔄 [WS-OPEN] تحرير tradeExec المجمّد', 'signal');
      }
      // 🔬 DIAG: track WS state
      if (typeof CoreDiagnostic !== 'undefined') {
        CoreDiagnostic.trackWS(urlStr, 'open');
        CoreDiagnostic.updatePlatformState('wsConnected', true);
      }
    });
    ws.addEventListener('close', () => {
      wsConnected = false;
      if (_pingIntervalId !== null) { clearInterval(_pingIntervalId); _pingIntervalId = null; }
      // إزالة من تجمع المقابس
      _executorPool.delete(ws);
      _wsLastActivity.delete(ws);
      // إذا كان tradeWS الحالي هو الذي أُغلق، حاول ترقية بديل
      if (tradeWS === ws) {
        tradeWS = null; tradeWSOrig = null; _tradeSocketReady = false;
        // ✅ تحرير tradeExec فوراً إذا كان معلقاً — لا ننتظر 15 ثانية
        if (tradeExec) {
          tradeExec = false;
          if (_tradeExecTimeout) { clearTimeout(_tradeExecTimeout); _tradeExecTimeout = null; }
          addLog('🔄 [WS-CLOSE] تحرير tradeExec فوري — المقبس أُغلق أثناء صفقة', 'signal');
          updateTradeBtn();
        }
        // محاولة ترقية مقبس بديل من التجمع
        if (CFG.WS_EXEC_POOL_ENABLED && _executorPool.size > 0) {
          _promoteBestExecutor();
          if (tradeWS && tradeWS.readyState === 1) {
            addLog('🔄 [POOL] مقبس التداول غيّر — ترقية بديل فوري', 'signal');
            // ✅ إعادة بناء cache المبلغ عند تبديل المقبس
            _rebuildPayloadCache();
            // ✅ إعادة محاولة الإشارة المعلقة إذا وُجدت
            if (_pendingRetrySignal && autoTrade && !tradeExec) {
              const sig = _pendingRetrySignal;
              _pendingRetrySignal = null;
              addLog('🔄 [RETRY] إعادة محاولة الإشارة المعلقة: ' + sig.direction + ' | ' + sig.asset, 'signal');
              try { DualWSSManager.executeTrade(sig.direction, sig.asset, tradeAmount); } catch(_) {}
            }
          }
        }
        // تحذير فقط إذا لم يوجد بديل
        if (!tradeWS || tradeWS.readyState !== 1) {
          _throttledWsError('🔌 مقبس التداول انقطع — لا يوجد بديل في التجمع');
        }
      }
      // Dual-WSS: unregister socket on close — فقط إذا لم يوجد بديل
      if (ws._dualRole && typeof DualWSSManager !== 'undefined') {
        // لا تلغِ التسجيل إذا رقّينا بديلاً
        const stillConnected = (ws._dualRole === 'executor' && tradeWS && tradeWS.readyState === 1) ||
                               (ws._dualRole === 'oracle' && false); // oracle always unregister
        if (!stillConnected) {
          try { DualWSSManager.unregisterSocket(ws._dualRole); } catch(_) {}
        }
      }
      updateStatusDot();
      // 🔬 DIAG
      if (typeof CoreDiagnostic !== 'undefined') {
        CoreDiagnostic.trackWS(urlStr, 'closed');
        // لا تحديث wsConnected=false إذا لا يزال هناك مقابس في التجمع
        const anyAlive = [..._executorPool.values()].some(i => i.authed);
        CoreDiagnostic.updatePlatformState('wsConnected', anyAlive || (tradeWS && tradeWS.readyState === 1));
      }
    });
  }

  function _startAdaptiveSigmaDecay() {
    if (!CFG.ADAPTIVE_SIGMA_ENABLED) return;
    if (_adaptiveSigmaTimer_v100) return;
    _adaptiveSigmaActive = true;
    _adaptiveSigmaTimer_v100 = setInterval(() => {
      if (_currentSigma <= CFG.ADAPTIVE_SIGMA_FLOOR) { clearInterval(_adaptiveSigmaTimer_v100); _adaptiveSigmaTimer_v100 = null; return; }
      _currentSigma = Math.max(CFG.ADAPTIVE_SIGMA_FLOOR, _currentSigma - CFG.ADAPTIVE_SIGMA_DECAY_STEP);
    }, CFG.ADAPTIVE_SIGMA_DECAY_MS);
  }
  function _resetAdaptiveSigma() {
    if (_adaptiveSigmaTimer_v100) { clearInterval(_adaptiveSigmaTimer_v100); _adaptiveSigmaTimer_v100 = null; }
    _currentSigma = CFG.TVE_SIGMA_THRESHOLD; _adaptiveSigmaActive = false;
  }

  function _extractFastCloseAt(settings, fullPayload) {
    // ✅ [V14.3] التقط مدة المستخدم المختارة (زر S3/S15/...) من إعدادات الشارت أيضاً
    try {
      const ft = parseInt(settings && settings.fastTimeframe, 10);
      if (Number.isFinite(ft) && ft >= 1 && ft !== _tradeDuration) { _tradeDuration = ft; _rebuildPayloadCache(); }
    } catch(_) {}
    const fca = parseInt(settings.fastCloseAt || (fullPayload && fullPayload.fastCloseAt) || 0, 10);
    if (!Number.isFinite(fca) || fca <= 0) return;
    fastCloseAt = fca * 1000;
    if (CFG.CLOCK_SYNC_ENABLED) {
      const srv = parseInt((settings.serverTime||(fullPayload&&fullPayload.serverTime)||0),10)*1000;
      if (srv > 0) { clockOffset = srv - Date.now(); }
    }
  }

  function _startAdaptiveSigmaDecayTimerLocal() {
    if (!CFG.ADAPTIVE_SIGMA_ENABLED || !autoTrade) return;
    _resetAdaptiveSigma();
    setTimeout(() => { if ((Date.now()-lastTradeMs) >= CFG.ADAPTIVE_SIGMA_IDLE_MS) _startAdaptiveSigmaDecay(); }, CFG.ADAPTIVE_SIGMA_IDLE_MS);
  }

  // Bugsnag stealth
  (function _patchBugsnag() {
    const _tryPatch = () => {
      const B = W.Bugsnag || W.bugsnag;
      if (!B || !B.notify) return false;
      const orig = B.notify.bind(B);
      B.notify = function(err, ...args) {
        try {
          const stack = (err?.stack || err?.message || String(err)).toLowerCase();
          if (stack.includes('candle_v12') || stack.includes('supreme') ||
              stack.includes('cbroot') || stack.includes('cbpanel') ||
              stack.includes('executetrade') || stack.includes('_ppt') ||
              stack.includes('classifyvolatility') || stack.includes('_runmini') ||
              stack.includes('corediagnostic') || stack.includes('dualwss')) return;
        } catch(_) {}
        return orig(err, ...args);
      };
      return true;
    };
    if (!_tryPatch()) {
      const retry = () => _tryPatch();
      W.document.addEventListener('DOMContentLoaded', retry);
      setTimeout(retry, 2000);
      setTimeout(retry, 5000);
    }
  })();

  W.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) { const ws = new Target(...args); _attachWSHooks(ws, String(args[0]||'')); return ws; },
    apply(Target, thisArg, args)   { const ws = new Target(...args); _attachWSHooks(ws, String(args[0]||'')); return ws; },
    get(Target, prop, receiver) {
      if (prop==='CONNECTING') return 0; if (prop==='OPEN') return 1;
      if (prop==='CLOSING') return 2;    if (prop==='CLOSED') return 3;
      const val = Reflect.get(Target, prop, receiver);
      return typeof val === 'function' ? val.bind(Target) : val;
    },
  });

  // ══════════════════════════════════════════════════════════════════════
  // § 8  Frame Processing
  // ══════════════════════════════════════════════════════════════════════
  function handleBinaryFrame(rawData, urlStr, wsRef) {
    if (CFG.CRC_ENABLED && rawData instanceof ArrayBuffer) {
      if (_crcRejectFrame(rawData)) return;
    }
    const toBuffer = rawData instanceof Blob ? rawData.arrayBuffer() : Promise.resolve(rawData);
    toBuffer.then(buf => {
      PERF.mark('decodeStart');
      let evName = 'binary';
      if (wsRef && _pendingEventMap.has(wsRef)) {
        const slot = _pendingEventMap.get(wsRef);
        if (slot && (Date.now() - slot.ts) <= _PENDING_EVENT_TTL_MS) {
          evName = slot.name || 'binary';
        }
        _pendingEventMap.delete(wsRef);
      } else if (_pendingEvent) {
        evName = _pendingEvent;
      }
      _pendingEvent = null;

      if (CFG.Q1_SIG_ENABLED) {
        const bytes = new Uint8Array(buf);
        if (q1Match(bytes, Q1_SIG.TICK_ARRAY)) {
          try {
            const txt = new TextDecoder().decode(bytes), start = txt.indexOf('[[');
            if (start >= 0) { const arr = JSON.parse(txt.slice(start)); const tick = extractTickFromArray(arr); if (tick) { onTick(tick.asset, tick.price, tick.ts, wsRef && wsRef._dualRole); return; } }
          } catch (_) {}
        }
      }

      let decoded = null, combined = buf;
      if (wsRef) { const fr = tryDecodeWithFragment(wsRef, buf); if (!fr) return; decoded = fr.decoded; combined = fr.buffer; }
      else { try { decoded = msgpackDecode(buf); } catch (_) {} }

      if (decoded !== null && typeof decoded === 'object') {
        if (evName==='successauth') { if (wsRef && wsRef===tradeWS) { _tradeSocketReady = true; addLog('✅ مقبس مصادَق', 'signal'); _startAdaptiveSigmaDecayTimerLocal(); } return; }
        const tick = extractTickFromArray(decoded);
        if (tick) { onTick(tick.asset, tick.price, tick.ts, wsRef && wsRef._dualRole); return; }
        if (evName==='chafor') { const cf = extractChafor(decoded); if (cf) { onChafor(cf.asset, cf.seconds); return; } }
        if (evName==='updateCharts' && Array.isArray(decoded)) {
          for (const chart of decoded) {
            if (!chart || typeof chart !== 'object') continue;
            if (typeof chart.asset === 'string' && chart.asset.length >= 3) onActiveAsset(chart.asset, 'updateCharts');
            try { const s = typeof chart.settings==='string' ? JSON.parse(chart.settings) : (chart.settings||{}); const ft = parseInt(s?.fastTimeframe, 10); if (Number.isFinite(ft) && ft>=1) { _tradeDuration = ft; _rebuildPayloadCache(); } _extractFastCloseAt(s, chart); } catch(_){}
          }
        }
        if (evName==='updateAssets' && Array.isArray(decoded)) {
          processUpdateAssets(decoded);
        }
        return;
      }

      try {
        const text = new TextDecoder().decode(new Uint8Array(combined)), start = text.search(/[{\[]/);
        if (start < 0) return;
        const obj = JSON.parse(text.slice(start));
        if (evName==='updateHistoryNewFast' && obj.asset && Array.isArray(obj.history)) { processHistoryFast(obj.asset, obj.period, obj.history); return; }
        // ✅ [V14] أوراكل المنصة: قوة الإشارة الرقمية لكل زوج×فريم (المصدر الصحيح)
        if ((evName==='signals/update' || evName==='signals/load') && obj && Array.isArray(obj.signals)) {
          try { DualWSSManager.onSignalsUpdate(obj.signals); } catch(_){} return;
        }
        if (evName==='successcloseOrder'   && obj.deals) { processCloseOrder(obj); return; }
        if (evName==='failopenOrder' && obj.error) { onFailOrder(obj); return; }
        if (evName==='successupdateBalance' && obj.balance !== undefined) { onBalanceUpdate(obj); return; }
        if (evName==='successopenOrder' && obj.id) { onOpenOrderSuccess(obj); return; }
        const tick = extractTickFromArray(Array.isArray(obj) ? obj : [obj]);
        if (tick) { onTick(tick.asset, tick.price, tick.ts, wsRef && wsRef._dualRole); return; }
        if (evName==='chafor') { const cf = extractChafor(Array.isArray(obj)?obj:[obj]); if (cf) onChafor(cf.asset, cf.seconds); }
        if (evName==='saveCharts') { const s = obj.settings || obj; _extractFastCloseAt(s, obj); }
      } catch (_) {}
    }).catch(() => {});
  }

  function handleTextMessage(raw, wsRef) {
    if (!raw || raw==='2' || raw==='3') return;
    if (raw.startsWith('45')) {
      const d = raw.indexOf('-');
      if (d!==-1) {
        try {
          const arr = JSON.parse(raw.slice(d+1));
          if (Array.isArray(arr) && typeof arr[0]==='string') {
            const evN = arr[0];
            _pendingEvent = evN;
            if (wsRef) _pendingEventMap.set(wsRef, { name: evN, ts: Date.now() });
          }
        } catch(_){}
      }
      return;
    }
    if (!raw.startsWith('42')) return;
    let payload; try { payload = JSON.parse(raw.slice(2)); } catch { return; }
    if (!Array.isArray(payload) || payload.length < 2) return;
    const evName = payload[0], data = payload[1];
    if (evName==='successauth') { if (wsRef && wsRef===tradeWS) { _tradeSocketReady = true; addLog('✅ مقبس مصادَق', 'signal'); _startAdaptiveSigmaDecayTimerLocal(); } return; }
    if (['updateStream','tick','quote','stream'].includes(evName)) {
      const tick = extractTickFromArray(data); if (tick) { onTick(tick.asset, tick.price, tick.ts, wsRef && wsRef._dualRole); return; }
      if (Array.isArray(data)) { for (const item of data) { const t = extractTickFromArray(Array.isArray(item)?item:[item]); if (t) onTick(t.asset,t.price,t.ts, wsRef && wsRef._dualRole); } }
    }
    if (evName==='chafor') { const cf = extractChafor(Array.isArray(data)?data:[data]); if (cf) onChafor(cf.asset, cf.seconds); }
    // ✅ [V14] إشارة الشات الاتجاهية (UP2/DOWN2) — الأوراكل الاتجاهي الصريح
    if (evName==='chat_room_list_update' && data && data.message && data.message.message_content && data.message.message_content.signal) {
      try { DualWSSManager.onChatSignal(data.message.message_content.signal); } catch(_){}
    }
    if (evName==='chat_room_list' && data && Array.isArray(data.list)) {
      try { for (const it of data.list) { const s = it && it.message_content && it.message_content.signal; if (s) DualWSSManager.onChatSignal(s); } } catch(_){}
    }
    // ✅ [V14] بعض signals/update قد تصل نصاً 42 أيضاً
    if ((evName==='signals/update' || evName==='signals/load') && data && Array.isArray(data.signals)) {
      try { DualWSSManager.onSignalsUpdate(data.signals); } catch(_){}
    }
    if (evName==='changeSymbol' && data?.asset) onActiveAsset(data.asset, 'changeSymbol');
    if (evName==='saveCharts') { const s = (data&&data.settings)||data||{}; _extractFastCloseAt(s, data||{}); }

    // ─── معالجة إشارات signals من المنصة ──────────────────────────────────
    if (evName==='signals' && data) {
      // بيانات signals: ["#ASSET", [[1,1]], price] أو {asset, direction, ...}
      try {
        if (Array.isArray(data) && data.length >= 1) {
          // صيغة مصفوفة: signals من PO هي عادةً [[asset_name, direction_data, price]]
          const signalAsset = typeof data[0]==='string' ? normalizeAsset(data[0]) : activeAsset;
          const signalPrice = typeof data[2]==='number' ? data[2] : 0;
          const signalDir = Array.isArray(data[1]) ? (data[1][0] > 0 ? 'BUY' : 'SELL') : null;
          // ✅ [V13.5/المسار C] غذِّ مخزن الأوراكل بسعر signals (الفيد الأسرع يبثّه أساساً عبر هذا الحدث)
          if (signalPrice > 0 && wsRef && wsRef._dualRole === 'oracle' && typeof DualWSSManager !== 'undefined') {
            try { DualWSSManager.recordOracleTick(signalAsset, signalPrice); } catch(_) {}
          }
          if (signalDir) {
            if (typeof DualWSSManager !== 'undefined') {
              DualWSSManager.onPlatformSignal({ asset: signalAsset, direction: signalDir, price: signalPrice, confidence: 75 });
            }
          }
        } else if (typeof data === 'object' && data !== null) {
          if (typeof DualWSSManager !== 'undefined') {
            DualWSSManager.onPlatformSignal(data);
          }
        }
      } catch(_) {}
    }

    // SPY: Unknown event harvester
    const KNOWN_EVENTS = new Set([
      'updateStream','tick','quote','stream','chafor','changeSymbol','saveCharts',
      'successauth','updateAssets','updateCharts','successopenOrder','successcloseOrder',
      'successupdateBalance','failopenOrder','updateHistoryNewFast','platform','signals',
    ]);
    if (!KNOWN_EVENTS.has(evName) && wsRef) {
      const isChatWS  = !!(wsRef._url && wsRef._url.includes('chat-po'));
      const isEventWS = !!(wsRef._url && wsRef._url.includes('events-po'));
      const prefix = isChatWS ? '[WS#1-CHAT]' : isEventWS ? '[WS#2-EVT]' : '[WS-UNK]';
      const uid0 = (() => { try { return parseInt(data?.user_id||data?.userId||data?.message?.user_id||0,10); } catch(_){return 0;} })();
      _spyAdd(prefix, evName, uid0, data);
      if (!_chatSignalSeen.has(evName)) {
        _chatSignalSeen.add(evName);
        const preview = JSON.stringify(data).slice(0, 80);
        addLog('🔍 ' + prefix + ' "' + evName + '" → ' + preview + ' …[SPY↑]', 'info');
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 9  Event Processors (MINIMAL)
  // ══════════════════════════════════════════════════════════════════════
  function processHistoryFast(asset, period, history) {
    const a = normalizeAsset(asset);
    if (!Array.isArray(history) || history.length < 4) return;
    if (!candlePeriod && period && period>0) { candlePeriod = period; durSource = 'history'; updateHUD(); }
    const periodSec = candlePeriod || period || 5;
    const groups = {};
    for (const item of history) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const [ts, price] = item; const key = Math.floor(ts/periodSec)*periodSec;
      if (!groups[key]) groups[key] = []; groups[key].push(price);
    }
    const sortedKeys = Object.keys(groups).map(Number).sort((a,b) => a-b);
    if (!candleBuffers[a]) candleBuffers[a] = [];
    const newCandles = [];
    for (const key of sortedKeys) { const prices = groups[key]; if (prices.length<2) continue; const candle = buildCandle(prices,key*1000); if (candle) { candle.fromHistory=true; newCandles.push(candle); } }
    if (newCandles.length > 0) {
      candleBuffers[a] = newCandles.slice(-CFG.MAX_CANDLES);
      if (a===activeAsset) { addLog('📊 تاريخ: '+newCandles.length+' شمعة', 'signal'); renderCandleRow(); }
    }
  }

  function processUpdateAssets(decoded) {
    let parsed = 0;
    for (const item of decoded) {
      if (!Array.isArray(item) || item.length < 3) continue;
      let symbol = null, payout = null, isOpen = null;
      for (const f of item) {
        if (symbol === null && typeof f === 'string' && f.length >= 2 && f.length <= 32 && /^[A-Z0-9_/-]+$/i.test(f)) {
          symbol = f;
        } else if (payout === null && typeof f === 'number' && f >= 50 && f <= 100) {
          payout = f;
        } else if (isOpen === null && typeof f === 'boolean') {
          isOpen = f;
        }
      }
      if (symbol && payout !== null) {
        const a = normalizeAsset(symbol);
        _assetPayouts.set(a, payout / 100);
        if (isOpen !== null) _assetIsOpen.set(a, isOpen);
        parsed++;
        // 🔬 DIAG: update asset data
        if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updateAsset(a, { payout: payout / 100, isOpen });
      }
    }
    if (parsed > 0) {
      addLog('💰 [PAYOUT] قرأت ' + parsed + ' أصل من updateAssets', 'info');
      if (activeAsset && _assetPayouts.has(activeAsset)) {
        _dynamicPayout = _assetPayouts.get(activeAsset);
      }
    }
  }

  function getActiveAssetPayout() {
    if (activeAsset && _assetPayouts.has(activeAsset)) {
      const p = _assetPayouts.get(activeAsset);
      if (p > 0.5 && p < 1.5) return p;
    }
    return _dynamicPayout;
  }

  function processCloseOrder(data) {
    if (!data.deals || !data.deals[0]) return;
    const deal = data.deals[0];
    if (botOrderIds.size > 0 && !botOrderIds.has(deal.id)) { addLog('📊 صفقة منصة: '+(deal.profit>0?'+':'')+(deal.profit||0).toFixed(2)+'$','info'); return; }
    if (deal.id) botOrderIds.delete(deal.id);
    const win = deal.profit > 0;
    let rawPayout = null;
    if (typeof deal.percentProfit === 'number' && deal.percentProfit >= 50 && deal.percentProfit <= 100) {
      rawPayout = deal.percentProfit / 100;
    } else if (win && deal.profit && deal.amount && deal.amount > 0) {
      rawPayout = deal.profit / deal.amount;
    }
    if (rawPayout !== null && rawPayout > 0.5 && rawPayout < 2.0) {
      _dynamicPayout = rawPayout;
      if (deal.asset) _assetPayouts.set(normalizeAsset(deal.asset), rawPayout);
      if (win) addLog('📊 [PAYOUT] نسبة العائد: ' + Math.round(rawPayout * 100) + '%', 'info');
    }
    recordTrade(win, _lastTradeWasTVE);
    try { OracleLab.recordClose(_pendingTradeRecord, win, _pendingTradeRecord && _pendingTradeRecord.openPrice, deal.closePrice || deal.price || 0); } catch(_) {}  // [V16] ربط النتيجة بمصدر الأوراكل
    const sym = win ? '✅' : '❌', amount = win ? '+'+deal.profit?.toFixed(2)+'$' : '-'+deal.amount+'$';
    addLog(sym+' '+amount, win?'signal':'error');
    _lastTradeWasDouble = false; tradeExec = false; updateTradeBtn();
    // v12.11 [DB] Persist trade
    const _rec = _pendingTradeRecord || {};
    _dbPut('trades', {
      ..._rec,
      closeTs: Date.now(),
      orderId: _rec.orderId || deal.id,
      asset: _rec.asset || normalizeAsset(deal.asset || activeAsset || ''),
      result: win ? 'win' : 'loss',
      profit: deal.profit ?? 0,
      amount: _rec.amount || deal.amount || 0,
    });
    _pendingTradeRecord = null;
    setTimeout(() => _githubSync(false), 0);
  }

  function onFailOrder(data) {
    const errMap = { IncorrectMinAmount:'الحد الأدنى: $'+data.amount, IncorrectMaxAmount:'الحد الأقصى: $'+data.amount, InsufficientFunds:'رصيد غير كاف', TradingDisabled:'التداول معطّل', MarketClosed:'السوق مغلق' };
    addLog('❌ '+(errMap[data.error]||data.error||'خطأ'), 'error');
    _pendingTradeRecord = null;
    tradeExec = false; updateTradeBtn();
  }

  function onOpenOrderSuccess(data) {
    if (data.id) botOrderIds.add(data.id); lastOpenedOrder = data;
    addLog('📨 أُكِّد الأمر #'+data.id+' | '+(data.openPrice?.toFixed(5)||''), 'signal');
    if (_pendingTradeRecord) {
      _pendingTradeRecord.orderId   = data.id;
      _pendingTradeRecord.openPrice = data.openPrice ?? 0;
    }
  }

  function onBalanceUpdate(data) {
    accountBalance = data.balance;
    if (data.isDemo !== undefined) isDemo = data.isDemo;
    currentBalance = data.balance;
    const el = W.document.getElementById('cbBalance'), modeEl = W.document.getElementById('cbAccMode');
    if (el) el.textContent = '$'+(data.balance?.toFixed(2)||'–');
    if (modeEl) modeEl.textContent = data.isDemo ? 'ديمو' : 'حقيقي';
    // 🔬 DIAG
    if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updatePlatformState('balance', data.balance);
  }

  function onActiveAsset(str, source) {
    const a = normalizeAsset(str);
    if (a.length < 3 || a === activeAsset) return;
    activeAsset = a;
    fastCloseAt = 0; _tradeDuration = 0;
    cancelPredictiveExecution(); _rebuildPayloadCache();
    _candlesSinceAssetChange = 0;
    if (_assetPayouts.has(a)) {
      const newP = _assetPayouts.get(a);
      if (newP > 0.5 && newP < 1.5) _dynamicPayout = newP;
    }
    addLog('🎯 الزوج: '+activeAsset+' ('+source+')', 'asset'); updateHUD();
    // 🔬 DIAG
    if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updatePlatformState('activeAsset', a);
  }

  function onPlatformTimeframe(secs, source) {
    if (!Number.isFinite(secs) || secs<1 || secs>3600) return;
    if (secs === candlePeriod) return;
    candlePeriod = secs; durSource = source||'platform'; _lastDetectedPeriod = secs; _lastDetectedCount = CFG.PERIOD_TRUSTED_OVERRIDE;
    _periodLockUntil = Date.now() + 30000;
    _rebuildPayloadCache(); updateHUD();
  }

  function onTick(asset, price, serverTs, srcRole) {
    // Simplified: just record tick data, update HUD price, feed diagnostic engine
    PERF.mark('tickRecv');
    if (!asset || !price || isNaN(price)) return;
    const a = normalizeAsset(asset), now = Date.now();
    // ✅ [V13.5/المسار C] افصل تيكات الأوراكل (الفيد الأسرع) لفلتر التأكيد الكموني
    if (srcRole === 'oracle') {
      try { DualWSSManager.recordOracleTick(a, price); } catch(_) {}
    }
    _lastTickMs = now;
    if (_streamStalled) {
      _streamStalled = false;
      addLog('✅ [STREAM] استعاد التدفق', 'signal');
      if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updatePlatformState('streamStalled', false);
    }
    if (!tickBuffers[a]) tickBuffers[a] = [];
    tickBuffers[a].push(price);
    if (tickBuffers[a].length > 600) tickBuffers[a].shift();
    try { OracleLab.onTick(a, price, now); } catch(_) {}   // [V16] التقاط خام عالي الدقة
    try { if (a === activeAsset && typeof DualWSSManager !== 'undefined') DualWSSManager.fastEval(a); } catch(_) {}  // [V18] تقييم سريع داخل الشمعة
    totalTicks++;
    if (!activeAsset) onActiveAsset(a, 'firstTick');
    const cc = currentCandles[a];
    if (!cc) { currentCandles[a] = { open:price, high:price, low:price, prices:[price], startTime:now }; }
    else { cc.prices.push(price); if (price>cc.high) cc.high=price; if (price<cc.low) cc.low=price; }
    if (a === activeAsset) {
      updateLivePrice(price);
      if (totalTicks % 5 === 0) {
        addLog('📡 تيك #'+totalTicks+' | '+price.toFixed(5), 'tick', 'تيكات_شمعة:'+(cc?cc.prices.length:1));
      }
    }
    const tickEl = W.document.getElementById('cbTickCount');
    if (tickEl) tickEl.textContent = totalTicks;
    // 🔬 DIAG: update asset and platform state
    if (typeof CoreDiagnostic !== 'undefined') {
      CoreDiagnostic.updateAsset(a, { lastPrice: price, lastTick: now });
      CoreDiagnostic.updatePlatformState('lastTick', now);
    }
  }

  function onChafor(asset, seconds) {
    const a = normalizeAsset(asset);
    if (!chaforState[a]) chaforState[a] = { prev:null, resetAt:0 };
    const st = chaforState[a];

    // كشف إغلاق الشمعة: العد التنازلي أعيد (seconds > prev) — شمعة جديدة بدأت
    if (st.prev !== null && seconds > st.prev) {
      // Finalize current candle before reset
      const cc = currentCandles[a];
      if (cc && cc.prices && cc.prices.length >= 2) {
        const candle = buildCandle(cc.prices, cc.startTime);
        if (candle) {
          if (!candleBuffers[a]) candleBuffers[a] = [];
          candleBuffers[a].push(candle);
          if (candleBuffers[a].length > CFG.MAX_CANDLES) candleBuffers[a].shift();
          // Reset current candle for the new period
          currentCandles[a] = { open: cc.prices[cc.prices.length-1], high: cc.prices[cc.prices.length-1], low: cc.prices[cc.prices.length-1], prices: [cc.prices[cc.prices.length-1]], startTime: Date.now() };
          // Feed DualWSSManager candle close event
          if (typeof DualWSSManager !== 'undefined') {
            try { DualWSSManager.onCandleClose(a); } catch(_) {}
          }
        }
      }
    }

    st.prev = seconds;
    if (a === activeAsset) updateCountdownDisplay(seconds);
  }

  function resetTickCandleTimer(asset) {
    if (tickCandleTimer) clearTimeout(tickCandleTimer);
    tickCandleTimer = setTimeout(() => {
      tickCandleTimer = null;
    }, CFG.TICK_CANDLE_TIMEOUT);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 10  Stream Watchdog
  // ══════════════════════════════════════════════════════════════════════
  const _STREAM_GAP_MS = 5000;
  function _startStreamWatchdog() {
    _v11_setInterval(() => {
      if (!_lastTickMs) return;
      const gap = Date.now() - _lastTickMs;
      if (gap > _STREAM_GAP_MS && !_streamStalled) {
        _streamStalled = true;
        addLog('⚠️ [STREAM] انقطع التدفق منذ '+(gap/1000|0)+'ث — تم التعليق', 'error');
        if (typeof CoreDiagnostic !== 'undefined') CoreDiagnostic.updatePlatformState('streamStalled', true);
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 28  الواجهة الرسومية — v10.8 (Advanced Log)
  // ══════════════════════════════════════════════════════════════════════
  let logLines = [];
  let _logSeq  = 0;                  // رقم تسلسلي لكل سطر
  const MAX_LOG = 500;               // ⬆ من 25 → 500 سطر
  let _logPaused = false;            // إيقاف مؤقت للعرض (لا للتسجيل)

  // طابع زمني بالميللي ثانية
  function ts() {
    const d = new Date();
    return d.getHours().toString().padStart(2,'0') + ':' +
           d.getMinutes().toString().padStart(2,'0') + ':' +
           d.getSeconds().toString().padStart(2,'0') + '.' +
           d.getMilliseconds().toString().padStart(3,'0');
  }
  function fmtDur(s) { if(s<60) return s+'ث'; if(s<3600) return Math.floor(s/60)+'د'; return Math.floor(s/3600)+'س'; }

  // addLog الرئيسية — تقبل حقل extra اختياري للتفاصيل
  function addLog(msg, type='info', extra='') {
    _logSeq++;
    logLines.unshift({ msg, type, t: ts(), seq: _logSeq, extra });
    if (logLines.length > MAX_LOG) logLines.pop();
    if (!_logPaused) renderLog();
    // تحديث عداد السجل في الزر
    const badge = W.document.getElementById('cbLogCount');
    if (badge) badge.textContent = _logSeq;
    // ── Android / Server bridge (optional — only active inside APK) ──────────
    try { W.__SUPREME_BRIDGE__?.log?.(msg, type); } catch(_) {}
    // v12.11 [DB] Persist log entry to IndexedDB (fire-and-forget)
    if (CFG.DB_LOG_ENABLED) _dbPut('logs', { seq: _logSeq, msg, type, extra: extra || '' });
  }

  const HUD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');
  /* ══ ROOT ══ */
  #cbRoot{position:fixed;bottom:16px;left:16px;z-index:2147483647;font-family:'IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,sans-serif;direction:rtl;}
  /* ══ LAUNCHER ICON ══ */
  #cbIcon{width:50px;height:50px;border-radius:15px;background:#fff;border:1.5px solid #D1E8DC;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 18px rgba(30,58,47,0.14);transition:all 0.2s ease;}
  #cbIcon:hover{transform:scale(1.05);box-shadow:0 6px 24px rgba(30,58,47,0.20);}
  #cbIcon.buy{border-color:#86EFAC;box-shadow:0 4px 18px rgba(22,163,74,0.18);}
  #cbIcon.sell{border-color:#FCA5A5;box-shadow:0 4px 18px rgba(220,38,38,0.18);}
  #cbIconSig{font-size:20px;}
  #cbIconDot{width:6px;height:6px;border-radius:50%;background:#D1D5DB;margin-top:3px;transition:background 0.3s;}
  #cbIconDot.on{background:#16A34A;}
  /* ══ MAIN PANEL ══ */
  #cbPanel{position:fixed;bottom:76px;left:8px;width:300px;background:#F8F5F0;border:1px solid #E5DDD5;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,0.11);display:none;flex-direction:column;overflow:hidden;max-height:calc(100svh - 120px);touch-action:none;}
  #cbPanel.open{display:flex;}
  #cbPanel.minimized #cbScrollArea{display:none;}
  @media(max-width:480px){#cbPanel{width:calc(100vw - 16px);left:8px;bottom:72px;max-height:calc(100svh - 130px);}}
  @media(min-width:768px){#cbPanel{width:320px;}}
  /* ══ HEADER ══ */
  .cb-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px;cursor:grab;flex-shrink:0;background:#fff;border-bottom:1px solid #EDE8E2;border-radius:20px 20px 0 0;}
  .cb-hdr:active{cursor:grabbing;}
  .cb-hdr-dot{width:8px;height:8px;border-radius:50%;background:#D1D5DB;flex-shrink:0;transition:background 0.3s;}
  .cb-hdr-dot.on{background:#16A34A;box-shadow:0 0 0 3px rgba(22,163,74,0.15);}
  .cb-ttl{font-size:11px;font-weight:700;color:#1E3A2F;letter-spacing:0.3px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cb-hdr-actions{display:flex;gap:4px;flex-shrink:0;}
  .cb-icon-btn{width:24px;height:24px;border-radius:8px;background:#F3EDE7;border:1px solid #E5DDD5;color:#6B7280;font-family:inherit;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
  .cb-icon-btn:hover{background:#FFE4E4;border-color:#FCA5A5;color:#DC2626;}
  /* ══ SCROLL AREA ══ */
  #cbScrollArea{overflow-y:auto;flex:1;background:#F8F5F0;}
  #cbScrollArea::-webkit-scrollbar{width:3px;}
  #cbScrollArea::-webkit-scrollbar-thumb{background:#D1C8BE;border-radius:3px;}
  /* ══ STATS GRID ══ */
  .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:10px 10px 0;}
  .cb-stat{background:#fff;border:1px solid #EDE8E2;border-radius:10px;padding:7px 9px;border-right:3px solid #1E3A2F;}
  .cb-stat-lbl{display:block;font-size:8.5px;color:#9CA3AF;margin-bottom:3px;font-weight:500;}
  .cb-stat-val{font-size:11px;font-weight:700;color:#1A1A1A;}
  .cb-stat-val.w{color:#1E3A2F;}.cb-stat-val.g{color:#16A34A;}.cb-stat-val.y{color:#D97706;}
  /* ══ INDICATOR ROWS ══ */
  .cb-ind-row{display:flex;align-items:center;gap:6px;padding:5px 10px 0;font-size:9px;}
  .cb-ind-lbl{color:#6B7280;flex-shrink:0;min-width:52px;font-weight:500;}
  .cb-ind-val{font-family:'SF Mono',ui-monospace,monospace;color:#374151;font-size:9px;flex:1;}
  .cb-ind-badge{font-size:8px;font-weight:700;padding:2px 7px;border-radius:20px;background:#F3EDE7;border:1px solid #E5DDD5;color:#6B7280;flex-shrink:0;}
  .cb-ind-badge.up{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-ind-badge.dn{background:#FEF2F2;border-color:#FCA5A5;color:#DC2626;}
  .cb-ind-badge.yw{background:#FFFBEB;border-color:#FCD34D;color:#D97706;}
  /* ══ CONFIDENCE BAR ══ */
  .cb-conf-bar{display:flex;align-items:center;gap:6px;padding:8px 10px 0;font-size:9px;}
  .cb-conf-lbl{color:#6B7280;flex-shrink:0;font-weight:500;}
  .cb-conf-score{font-family:'SF Mono',ui-monospace,monospace;font-size:12px;font-weight:700;color:#1E3A2F;}
  .cb-conf-track{flex:1;height:5px;border-radius:3px;background:#E5DDD5;overflow:hidden;}
  .cb-conf-fill{height:100%;border-radius:3px;transition:width 0.3s,background 0.3s;}
  .cb-conf-detail{font-size:7.5px;color:#9CA3AF;padding:2px 10px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  /* ══ DOUBLE BADGE ══ */
  .cb-dbl-row{display:flex;align-items:center;gap:6px;padding:4px 10px 0;}
  .cb-dbl-badge{font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:#FFFBEB;border:1px solid #FCD34D;color:#D97706;opacity:0.6;}
  .cb-dbl-badge.active{opacity:1;background:#FEF3C7;border-color:#F59E0B;color:#B45309;animation:dblPulse 0.8s ease-in-out infinite;}
  @keyframes dblPulse{0%,100%{opacity:1;}50%{opacity:0.6;}}
  /* ══ PAUSE / VOL / BAD-SESSION ══ */
  .cb-pause-bar{display:none;align-items:center;justify-content:center;padding:6px 10px;background:#FEF2F2;border:1px solid #FCA5A5;margin:6px 10px 0;border-radius:10px;}
  .cb-pause-bar.active{display:flex;}
  .cb-pause-txt{font-size:9px;font-weight:700;color:#DC2626;}
  .cb-vol-bar{display:none;align-items:center;justify-content:center;gap:6px;padding:4px 10px;margin:4px 10px 0;border-radius:10px;font-size:9px;font-weight:700;}
  .cb-vol-bar.squeeze{display:flex;background:#EFF6FF;border:1px solid #BFDBFE;color:#2563EB;}
  .cb-vol-bar.explosive{display:flex;background:#FFF7ED;border:1px solid #FDBA74;color:#EA580C;}
  .cb-bad-sess{display:none;align-items:center;justify-content:center;padding:8px 10px;margin:6px 10px 0;border-radius:10px;font-size:10px;font-weight:800;background:#FEF2F2;border:1.5px solid #FCA5A5;color:#DC2626;}
  .cb-bad-sess.active{display:flex;animation:cbBadSessPulse 2s infinite;}
  @keyframes cbBadSessPulse{0%,100%{opacity:1;}50%{opacity:0.7;}}
  /* ══ WIN/LOSS STATS ══ */
  .cb-stats-bar{display:flex;gap:5px;padding:8px 10px 0;}
  .cb-stt{flex:1;background:#fff;border:1px solid #EDE8E2;border-radius:10px;padding:6px 7px;text-align:center;}
  .cb-stt-lbl{display:block;font-size:7.5px;color:#9CA3AF;margin-bottom:3px;font-weight:500;}
  .cb-stt-val{font-size:13px;font-weight:700;color:#1A1A1A;}
  .cb-stt-val.g{color:#16A34A;}.cb-stt-val.r{color:#DC2626;}.cb-stt-val.y{color:#D97706;}
  /* ══ SIGNAL BOX ══ */
  .cb-sig-wrap{padding:10px 10px 0;}
  .cb-sig-box{background:#fff;border:1.5px solid #EDE8E2;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;position:relative;overflow:hidden;}
  .cb-sig-box.buy{background:#F0FDF4;border-color:#1E3A2F;}
  .cb-sig-box.sell{background:#FEF2F2;border-color:#DC2626;}
  .cb-sig-main{font-size:18px;font-weight:800;letter-spacing:0.5px;color:#1A1A1A;}
  .cb-sig-main.BUY{color:#1E3A2F;}.cb-sig-main.SELL{color:#DC2626;}.cb-sig-main.HOLD{color:#9CA3AF;font-size:15px;font-weight:500;}
  .cb-sig-sub{font-size:10px;color:#6B7280;}
  .cb-sig-badge{font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:#F3EDE7;border:1px solid #E5DDD5;color:#6B7280;align-self:flex-start;}
  .cb-sig-badge.b5{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-sig-badge.b4{background:#F0FDF4;border-color:#BBF7D0;color:#22C55E;}
  .cb-sig-badge.b3{background:#FFFBEB;border-color:#FCD34D;color:#D97706;}
  .cb-sig-badge.tve{background:#FFFBEB;border-color:#FCD34D;color:#D97706;}
  /* ══ PATTERN PERFORMANCE ══ */
  .cb-ppt-sect{padding:8px 10px 0;}
  .cb-section-lbl{font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;display:flex;align-items:center;gap:6px;}
  .cb-section-lbl::after{content:'';flex:1;height:1px;background:#EDE8E2;}
  .cb-ppt-row{display:flex;align-items:center;gap:4px;padding:2px 0;font-size:8px;}
  .cb-ppt-name{flex:1;color:#6B7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cb-ppt-wr{font-family:'SF Mono',ui-monospace,monospace;min-width:28px;text-align:right;font-weight:700;}
  .cb-ppt-wr.good{color:#16A34A;}.cb-ppt-wr.mid{color:#D97706;}.cb-ppt-wr.bad{color:#DC2626;}
  /* ══ CANDLE ROW ══ */
  .cb-candle-sect{padding:10px 10px 0;}
  .cb-candle-row{display:flex;gap:4px;align-items:flex-end;flex-wrap:wrap;min-height:34px;}
  .cb-c{width:26px;height:26px;border-radius:6px;border:1.5px solid;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;}
  .cb-c.bull{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-c.bear{background:#FEF2F2;border-color:#FCA5A5;color:#DC2626;}
  .cb-c.hist{opacity:0.6;}.cb-c.forming{opacity:0.5;border-style:dashed;animation:formPulse 1.2s ease-in-out infinite;}
  @keyframes formPulse{0%,100%{opacity:0.4;}50%{opacity:0.8;}}
  /* ══ SEPARATOR ══ */
  .cb-sep{height:1px;background:#EDE8E2;margin:11px 0 0;}
  /* ══ AMOUNT ══ */
  .cb-amount-row{display:flex;align-items:center;gap:8px;padding:10px 10px 0;}
  .cb-amount-lbl{font-size:10px;color:#6B7280;flex-shrink:0;font-weight:600;}
  .cb-amount-inp{flex:1;background:#fff;border:1px solid #E5DDD5;border-radius:10px;padding:6px 10px;color:#1A1A1A;font-family:inherit;font-size:13px;font-weight:700;text-align:center;outline:none;transition:border-color 0.2s;}
  .cb-amount-inp:focus{border-color:#1E3A2F;}
  .cb-demo-badge{font-size:9px;font-weight:700;padding:3px 9px;border-radius:20px;background:#FFFBEB;border:1px solid #FCD34D;color:#D97706;flex-shrink:0;}
  .cb-demo-badge.real{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  /* ══ MANUAL BUY/SELL BUTTONS ══ */
  .cb-manual-row{display:flex;gap:8px;padding:8px 10px;}
  .cb-manual-btn{flex:1;padding:12px 8px;border-radius:50px;border:none;font-family:inherit;font-size:13px;font-weight:800;cursor:pointer;text-align:center;transition:all 0.15s ease;touch-action:manipulation;letter-spacing:0.5px;}
  .cb-manual-btn.buy{background:#1E3A2F;color:#fff;}
  .cb-manual-btn.buy:hover{background:#2D5540;transform:scale(0.98);}
  .cb-manual-btn.buy:active{transform:scale(0.95);}
  .cb-manual-btn.sell{background:#DC2626;color:#fff;}
  .cb-manual-btn.sell:hover{background:#B91C1C;transform:scale(0.98);}
  .cb-manual-btn.sell:active{transform:scale(0.95);}
  /* ══ AUTO TOGGLE ══ */
  .cb-auto-row{display:flex;align-items:center;gap:10px;padding:2px 10px 6px;}
  .cb-auto-lbl{font-size:10.5px;color:#4B5563;flex:1;font-weight:500;}
  .cb-toggle{appearance:none;width:40px;height:22px;border-radius:11px;cursor:pointer;background:#E5E7EB;border:none;position:relative;transition:all 0.25s;flex-shrink:0;touch-action:manipulation;}
  .cb-toggle::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:all 0.25s ease;}
  .cb-toggle:checked{background:#1E3A2F;}
  .cb-toggle:checked::after{transform:translateX(18px);}
  .cb-auto-badge{font-size:10px;font-weight:700;color:#9CA3AF;min-width:28px;text-align:center;}
  /* ══ TIMING OFFSET ROW ══ */
  .cb-timing-row{display:flex;align-items:center;gap:6px;padding:4px 10px 8px;}
  .cb-timing-lbl{font-size:10px;color:#6B7280;flex:1;font-weight:600;}
  .cb-timing-btn{width:26px;height:26px;border-radius:8px;border:1px solid #E5DDD5;background:#fff;color:#374151;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0;touch-action:manipulation;}
  .cb-timing-btn:hover{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-timing-val{font-size:11px;font-weight:700;color:#1E3A2F;min-width:64px;text-align:center;font-family:'SF Mono',ui-monospace,monospace;background:#F8F5F0;border:1px solid #E5DDD5;border-radius:8px;padding:3px 6px;}
  .cb-timing-val.neg{color:#DC2626;}
  /* ══ UTILITY BUTTONS ══ */
  .cb-reset-btn{display:block;margin:0 10px 8px;padding:8px;border-radius:12px;border:1px solid #E5DDD5;background:#fff;color:#6B7280;font-family:inherit;font-size:9.5px;font-weight:600;cursor:pointer;text-align:center;width:calc(100% - 20px);transition:all 0.15s;}
  .cb-reset-btn:hover{background:#FEF2F2;border-color:#FCA5A5;color:#DC2626;}
  /* ══ STATUS BAR ══ */
  #cbStatus{padding:7px 14px 9px;font-size:7.5px;color:#9CA3AF;font-family:'SF Mono',ui-monospace,monospace;border-top:1px solid #EDE8E2;letter-spacing:0.3px;flex-shrink:0;background:#fff;border-radius:0 0 20px 20px;text-align:center;}
  /* ══ LOG FLOAT PANEL ══ */
  #cbLogFloat{position:fixed;bottom:148px;left:6px;z-index:2147483646;width:360px;background:#fff;border:1px solid #E5DDD5;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.10);display:none;flex-direction:column;overflow:hidden;touch-action:none;max-height:calc(100svh - 160px);}
  #cbLogFloat.open{display:flex;}
  @media(max-width:480px){#cbLogFloat{width:calc(100vw - 12px);left:6px;}}
  #cbLogHdr{display:flex;align-items:center;gap:6px;padding:9px 10px 8px;border-bottom:1px solid #EDE8E2;cursor:grab;flex-shrink:0;background:#F8F5F0;border-radius:16px 16px 0 0;}
  .cb-log-title{font-size:10px;font-weight:800;color:#1E3A2F;text-transform:uppercase;letter-spacing:0.8px;flex:1;}
  .cb-log-hdr-btns{display:flex;gap:4px;flex-shrink:0;}
  .cb-log-hbtn{height:24px;padding:0 9px;border-radius:20px;background:#fff;border:1px solid #E5DDD5;color:#6B7280;cursor:pointer;font-size:9px;font-family:inherit;font-weight:700;display:flex;align-items:center;gap:3px;white-space:nowrap;transition:all 0.15s;}
  .cb-log-hbtn:hover{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-log-hbtn.copy-ok{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .cb-log-hbtn.pause-on{background:#FFF7ED;border-color:#FDBA74;color:#EA580C;}
  .cb-log-filters{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #EDE8E2;flex-wrap:wrap;flex-shrink:0;background:#fff;}
  .cb-log-filter{font-size:8px;padding:2px 9px;border-radius:20px;border:1px solid #E5DDD5;background:transparent;color:#9CA3AF;cursor:pointer;font-family:inherit;font-weight:600;transition:all 0.15s;}
  .cb-log-filter.active{border-color:#1E3A2F;color:#1E3A2F;background:#F0FDF4;}
  .cb-log-filter.f-signal.active{border-color:#86EFAC;color:#16A34A;background:#F0FDF4;}
  .cb-log-filter.f-error.active{border-color:#FCA5A5;color:#DC2626;background:#FEF2F2;}
  .cb-log-filter.f-tve.active{border-color:#FCD34D;color:#D97706;background:#FFFBEB;}
  .cb-log-filter.f-tick.active{border-color:#BFDBFE;color:#2563EB;background:#EFF6FF;}
  .cb-log-inner{overflow-y:auto;flex:1;padding-bottom:4px;background:#fff;}
  .cb-log-inner::-webkit-scrollbar{width:3px;}
  .cb-log-inner::-webkit-scrollbar-thumb{background:#D1C8BE;border-radius:2px;}
  .cb-log-line{font-size:9px;line-height:1.5;display:flex;flex-direction:column;padding:4px 10px;border-bottom:1px solid #F5F0EB;border-right:2px solid transparent;transition:background 0.1s;}
  .cb-log-line:hover{background:#F8F5F0;}
  .cb-log-line.new{animation:logSlide 0.3s ease-out;}
  @keyframes logSlide{from{opacity:0;transform:translateX(-8px);}to{opacity:1;transform:translateX(0);}}
  .cb-log-line.t-signal{border-right-color:#16A34A;}
  .cb-log-line.t-error{border-right-color:#DC2626;}
  .cb-log-line.t-tve{border-right-color:#D97706;}
  .cb-log-line.t-tick{border-right-color:#3B82F6;}
  .cb-log-line.t-asset{border-right-color:#D97706;}
  .cb-log-row1{display:flex;align-items:baseline;gap:5px;}
  .cb-log-seq{color:#D1C8BE;font-family:'SF Mono',ui-monospace,monospace;font-size:7px;min-width:26px;flex-shrink:0;}
  .cb-log-t{color:#9CA3AF;font-family:'SF Mono',ui-monospace,monospace;flex-shrink:0;font-size:7.5px;}
  .cb-log-m{color:#374151;font-weight:500;word-break:break-word;white-space:pre-wrap;flex:1;}
  .cb-log-m.signal{color:#16A34A;font-weight:700;}
  .cb-log-m.error{color:#DC2626;font-weight:600;}
  .cb-log-m.tve{color:#D97706;font-weight:600;}
  .cb-log-m.tick{color:#3B82F6;}
  .cb-log-m.asset{color:#D97706;font-weight:700;}
  .cb-log-m.info{color:#6B7280;}
  .cb-log-extra{font-size:7.5px;color:#9CA3AF;font-family:'SF Mono',ui-monospace,monospace;padding-right:31px;word-break:break-all;margin-top:1px;}
  /* ══ LOG TOGGLE BTN ══ */
  #cbLogToggle{position:fixed;bottom:100px;left:6px;z-index:2147483646;padding:6px 12px;border-radius:20px;background:#fff;border:1px solid #D1E8DC;color:#1E3A2F;font-family:'IBM Plex Sans Arabic',-apple-system,sans-serif;font-size:9px;font-weight:700;cursor:pointer;touch-action:manipulation;display:none;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(30,58,47,0.10);}
  #cbLogToggle.visible{display:flex;}
  #cbLogCount{background:#F0FDF4;color:#16A34A;border-radius:10px;padding:1px 6px;font-size:7.5px;min-width:16px;text-align:center;border:1px solid #86EFAC;}
  /* ══ SPY PANEL ══ */
  #cbSpyPanel{position:fixed;bottom:80px;right:8px;width:340px;max-width:calc(100vw - 16px);max-height:calc(100svh - 100px);background:#fff;border:1.5px solid #E5DDD5;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.10);display:none;flex-direction:column;overflow:hidden;z-index:2147483645;touch-action:none;direction:ltr;}
  #cbSpyPanel.open{display:flex;}
  @media(max-width:480px){#cbSpyPanel{width:calc(100vw - 16px);right:8px;}}
  #cbSpyHdr{display:flex;align-items:center;gap:7px;padding:10px 12px 9px;border-bottom:1px solid #EDE8E2;cursor:grab;background:#F8F5F0;flex-shrink:0;border-radius:16px 16px 0 0;}
  #cbSpyHdr:active{cursor:grabbing;}
  .spy-title{font-size:10px;font-weight:800;color:#1E3A2F;letter-spacing:0.6px;flex:1;}
  .spy-badge{font-size:8px;font-weight:700;padding:2px 8px;border-radius:10px;background:#F0FDF4;border:1px solid #86EFAC;color:#16A34A;}
  .spy-badge.ai{background:#F0FDF4;border-color:#4ADE80;color:#15803D;}
  .spy-hdr-btns{display:flex;gap:4px;flex-shrink:0;}
  .spy-btn{padding:3px 9px;border-radius:20px;border:1px solid #E5DDD5;background:#fff;color:#6B7280;font-size:8.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s;}
  .spy-btn:hover{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  .spy-btn.copy-ok{background:#F0FDF4;border-color:#86EFAC;color:#16A34A;}
  #cbSpyFilters{display:flex;gap:4px;padding:7px 10px 5px;flex-shrink:0;border-bottom:1px solid #EDE8E2;overflow-x:auto;background:#fff;}
  .spy-filter{padding:2px 11px;border-radius:20px;border:1px solid #E5DDD5;background:transparent;color:#9CA3AF;font-size:8px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all 0.15s;}
  .spy-filter.active{background:#F0FDF4;border-color:#1E3A2F;color:#1E3A2F;}
  #cbSpyScroll{overflow-y:auto;flex:1;padding:6px 0;}
  #cbSpyScroll::-webkit-scrollbar{width:3px;}
  #cbSpyScroll::-webkit-scrollbar-thumb{background:#D1C8BE;border-radius:3px;}
  .spy-entry{padding:6px 10px;border-bottom:1px solid #F5F0EB;font-family:'SF Mono',ui-monospace,monospace;}
  .spy-entry.ai-signal{background:#F0FDF4;border-right:3px solid #16A34A;}
  .spy-entry.uid-low{background:#FFFBEB;border-right:3px solid #D97706;}
  .spy-entry-hdr{display:flex;align-items:center;gap:5px;margin-bottom:3px;}
  .spy-ev-name{font-size:9px;font-weight:700;color:#1E3A2F;}
  .spy-ev-name.ai{color:#15803D;}
  .spy-ev-ts{font-size:7.5px;color:#9CA3AF;}
  .spy-ev-src{font-size:7px;padding:1px 5px;border-radius:5px;border:1px solid #E5DDD5;color:#6B7280;}
  .spy-ev-uid{font-size:8px;font-weight:800;padding:1px 6px;border-radius:6px;background:#FFFBEB;border:1px solid #FCD34D;color:#D97706;}
  .spy-ev-body{font-size:7.5px;color:#374151;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow-y:auto;line-height:1.4;}
  .spy-ev-body::-webkit-scrollbar{width:2px;}
  .spy-ev-body::-webkit-scrollbar-thumb{background:#D1C8BE;}
  .spy-ev-copy{font-size:7px;color:#9CA3AF;cursor:pointer;margin-top:2px;display:inline-block;}
  .spy-ev-copy:hover{color:#1E3A2F;}
  #cbSpyStats{padding:6px 10px;border-top:1px solid #EDE8E2;font-size:8px;color:#6B7280;font-family:'SF Mono',ui-monospace,monospace;flex-shrink:0;background:#F8F5F0;}
  /* ══ SPY BTN ══ */
  #cbSpyBtn{position:fixed;bottom:100px;right:8px;z-index:2147483646;padding:6px 12px;border-radius:20px;background:#fff;border:1px solid #D1E8DC;color:#1E3A2F;font-family:'IBM Plex Sans Arabic',-apple-system,sans-serif;font-size:9px;font-weight:700;cursor:pointer;touch-action:manipulation;display:none;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(30,58,47,0.10);}
  #cbSpyBtn.visible{display:flex;}
  #cbSpyCount{background:#F0FDF4;color:#16A34A;border-radius:10px;padding:1px 6px;font-size:7.5px;min-width:16px;text-align:center;border:1px solid #86EFAC;}
  /* ══ ANALYSIS PANEL ══ */
  #cbAnalBtn{position:fixed;bottom:132px;right:8px;z-index:2147483646;padding:6px 12px;border-radius:20px;background:#1E3A2F;border:1px solid #2d5c45;color:#fff;font-family:'IBM Plex Sans Arabic',-apple-system,sans-serif;font-size:9px;font-weight:700;cursor:pointer;touch-action:manipulation;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(30,58,47,0.25);}
  #cbAnalCount{background:rgba(255,255,255,0.2);color:#fff;border-radius:10px;padding:1px 6px;font-size:7.5px;min-width:16px;text-align:center;}
  #cbAnalPanel{position:fixed;bottom:80px;right:8px;width:380px;max-width:calc(100vw - 16px);max-height:calc(100svh - 100px);background:#fff;border:1.5px solid #D1E8DC;border-radius:16px;box-shadow:0 8px 32px rgba(30,58,47,0.15);display:none;flex-direction:column;overflow:hidden;z-index:2147483645;touch-action:none;direction:rtl;}
  #cbAnalPanel.open{display:flex;}
  @media(max-width:480px){#cbAnalPanel{width:calc(100vw - 16px);right:8px;}}
  #cbAnalHdr{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#1E3A2F;gap:6px;flex-shrink:0;}
  .cb-anal-title{color:#fff;font-size:10px;font-weight:700;flex:1;}
  .cb-anal-hdr-btns{display:flex;gap:4px;}
  .cb-anal-hbtn{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:6px;padding:3px 7px;font-size:8px;cursor:pointer;white-space:nowrap;font-family:inherit;}
  .cb-anal-hbtn:hover{background:rgba(255,255,255,0.28);}
  .cb-anal-hbtn.ok{background:#16A34A;border-color:#16A34A;}
  #cbAnalSummary{padding:8px 10px;background:#F0FDF4;border-bottom:1px solid #D1FAE5;font-size:9px;color:#065F46;font-family:'SF Mono',ui-monospace,monospace;flex-shrink:0;line-height:1.6;}
  .cb-anal-tabs{display:flex;gap:0;border-bottom:1px solid #E5DDD5;flex-shrink:0;background:#F8F5F0;}
  .cb-anal-tab{flex:1;padding:6px 4px;font-size:9px;font-weight:600;border:none;background:transparent;color:#6B7280;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;}
  .cb-anal-tab.active{color:#1E3A2F;border-bottom-color:#1E3A2F;background:#fff;}
  #cbAnalBody{flex:1;overflow-y:auto;font-size:8px;font-family:'SF Mono',ui-monospace,monospace;}
  .cb-anal-table{width:100%;border-collapse:collapse;}
  .cb-anal-table th{position:sticky;top:0;background:#F8F5F0;color:#374151;font-size:7.5px;font-weight:700;padding:4px 5px;border-bottom:1px solid #E5DDD5;text-align:center;white-space:nowrap;}
  .cb-anal-table td{padding:4px 5px;border-bottom:1px solid #F3EEE8;color:#374151;text-align:center;white-space:nowrap;cursor:pointer;}
  .cb-anal-table tr:hover td{background:#F0FDF4;}
  .cb-anal-table tr.win td{background:#F0FDF4;}
  .cb-anal-table tr.loss td{background:#FFF1F2;}
  .cb-anal-table td.up{color:#16A34A;font-weight:700;}
  .cb-anal-table td.dn{color:#DC2626;font-weight:700;}
  .cb-anal-table td.adj{color:#D97706;font-weight:700;}
  .cb-anal-empty{padding:20px;text-align:center;color:#9CA3AF;font-size:9px;}
  `;

  const HUD_HTML = `
  <style>${HUD_CSS}</style>
  <div id="cbIcon" title="استراتيجية الشموع v10.7 — Trend Guard Fix">
    <div id="cbIconSig">⚡</div>
    <div id="cbIconDot"></div>
  </div>
  <div id="cbPanel">
    <div class="cb-hdr" id="cbDragHdr">
      <div class="cb-hdr-dot" id="cbHdrDot"></div>
      <span class="cb-ttl" id="cbMainTitle">⚡ V12.5 SUPREME</span>
      <div class="cb-hdr-actions">
        <button class="cb-icon-btn" id="cbMinimize">−</button>
        <button class="cb-icon-btn" id="cbClose">✕</button>
      </div>
    </div>
    <div id="cbScrollArea">
      <div class="cb-grid">
        <div class="cb-stat"><span class="cb-stat-lbl">الزوج</span><span class="cb-stat-val w" id="cbAsset">جاري…</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">السعر</span><span class="cb-stat-val g" id="cbPrice">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">مدة الشمعة</span><span class="cb-stat-val y" id="cbPeriod">؟</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">⏱ وقت الصفقة</span><span class="cb-stat-val g" id="cbTradeDur">؟</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">العد التنازلي</span><span class="cb-stat-val y" id="cbCd">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">الرصيد</span><span class="cb-stat-val g" id="cbBalance">–</span></div>
        <div class="cb-stat"><span class="cb-stat-lbl">تيكات</span><span class="cb-stat-val" id="cbTickCount">0</span></div>
      </div>

      <div class="cb-ind-row">
        <span class="cb-ind-lbl">⚡ كمون</span>
        <span class="cb-ind-val" id="cbPerfVal">–</span>
        <span class="cb-ind-badge" id="cbPsmState">PSM: IDLE</span>
      </div>
      <div class="cb-ind-row" id="cbEtcRow" title="Execution Timing Calibrator — يعدّل وقت الإطلاق تلقائياً">
        <span class="cb-ind-lbl">🎯 ETC</span>
        <span class="cb-ind-val" id="cbEtcOffset">0ms</span>
        <span class="cb-ind-badge" id="cbEtcBadge" style="background:#1E3A2F;color:#fff">0 معايرة</span>
      </div>
      <div class="cb-ind-row" title="ELAC — تعويض تأخير خط التنفيذ تلقائياً">
        <span class="cb-ind-lbl">📡 ELAC</span>
        <span class="cb-ind-val" id="cbElacVal">جمع…</span>
        <span class="cb-ind-badge" id="cbLadBadge" style="background:#1E3A2F;color:#fff">LAD: –</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">TVE σ</span>
        <span class="cb-ind-val" id="cbTveSigma">–</span>
        <span class="cb-ind-badge" id="cbTveBadge">TVE: OFF</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">MACD</span>
        <span class="cb-ind-val" id="cbMacdVal">–</span>
        <span class="cb-ind-badge" id="cbMacdBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">BB %B</span>
        <span class="cb-ind-val" id="cbBBVal">–</span>
        <span class="cb-ind-badge" id="cbBBBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">StochRSI K</span>
        <span class="cb-ind-val" id="cbSrsiVal">–</span>
        <span class="cb-ind-badge" id="cbSrsiBadge">–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">الاتجاه</span>
        <span class="cb-ind-val" id="cbTrendVal">–</span>
        <span class="cb-ind-badge" id="cbMtfBadge">MTF–</span>
      </div>
      <div class="cb-ind-row">
        <span class="cb-ind-lbl">Kelly $</span>
        <span class="cb-ind-val" id="cbKellyVal">–</span>
        <span class="cb-ind-badge" id="cbKellyBadge">–</span>
      </div>
      <div class="cb-ind-row" title="🔮 Dual-WSS — نظام المراجحة المزدوج">
        <span class="cb-ind-lbl">🔮 أوراكل</span>
        <span class="cb-ind-val" id="cbDwOracle">–</span>
        <span class="cb-ind-badge" id="cbDwStatus" style="font-size:8px">🔴 مفصول</span>
      </div>
      <div class="cb-ind-row" title="🔮 Dual-WSS — كمون المنفذ والفجوة">
        <span class="cb-ind-lbl">⚡ منفذ</span>
        <span class="cb-ind-val" id="cbDwExec">–</span>
        <span class="cb-ind-badge" id="cbDwGap" style="font-size:8px">فجوة: –</span>
      </div>
      <div class="cb-ind-row" title="🔮 Dual-WSS — آخر إشارة">
        <span class="cb-ind-lbl">📡 إشارة</span>
        <span class="cb-ind-val" id="cbDwSignal">–</span>
        <span class="cb-ind-badge" id="cbDwModeBadge" style="font-size:8px;color:#D97706">DWSS</span>
      </div>

      <div class="cb-conf-bar">
        <span class="cb-conf-lbl">🎯 توافق</span>
        <span class="cb-conf-score" id="cbConfScore">–</span>
        <div class="cb-conf-track"><div class="cb-conf-fill" id="cbConfFill" style="width:0%;background:#E5DDD5;"></div></div>
        <span class="cb-ind-badge" id="cbDblBadge" style="font-size:9px;color:#D97706;opacity:0.5;">DBL–</span>
      </div>
      <div class="cb-conf-detail" id="cbConfDetail">–</div>

      <div class="cb-pause-bar" id="cbPauseBar">
        <span class="cb-pause-txt" id="cbPauseTxt">⛔ وقف مؤقت بسبب الخسائر</span>
      </div>

      <div class="cb-vol-bar" id="cbVolBar">
        <span id="cbVolState">NORMAL</span>
      </div>

      <div class="cb-bad-sess" id="cbBadSession">
        ⛔ جلسة سيئة — توقف عن التداول!
      </div>

      <div class="cb-stats-bar">
        <div class="cb-stt"><span class="cb-stt-lbl">ربح ✅</span><span class="cb-stt-val g" id="cbWins">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">خسارة ❌</span><span class="cb-stt-val r" id="cbLosses">0</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">% الفوز</span><span class="cb-stt-val y" id="cbWinRate">–</span></div>
        <div class="cb-stt"><span class="cb-stt-lbl">🔥🔥 مزدوج</span><span class="cb-stt-val y" id="cbDoubles">0</span></div>
      </div>
      <div class="cb-stats-bar" style="padding-top:4px;">
        <div class="cb-stt" style="flex:2;"><span class="cb-stt-lbl">نقطة التعادل (Breakeven)</span><span class="cb-stt-val y" id="cbBreakeven">–</span></div>
        <div class="cb-stt" style="flex:1;"><span class="cb-stt-lbl">التقلب</span><span class="cb-stt-val y" id="cbVolMini">–</span></div>
      </div>

      <div class="cb-sig-wrap">
        <div class="cb-sig-box" id="cbSigBox">
          <div class="cb-sig-main HOLD" id="cbSigMain">انتظار</div>
          <div class="cb-sig-sub"       id="cbSigSub">في انتظار الإشارة…</div>
          <div class="cb-sig-badge"     id="cbSigBadge">ثقة: –</div>
        </div>
      </div>

      <div class="cb-ppt-sect">
        <div class="cb-section-lbl">أفضل الأنماط 🏆</div>
        <div id="cbPPTRows"></div>
      </div>

      <div class="cb-candle-sect">
        <div class="cb-section-lbl">آخر الشموع</div>
        <div class="cb-candle-row" id="cbCandleRow"></div>
      </div>

      <div class="cb-sep"></div>
      <div class="cb-amount-row">
        <span class="cb-amount-lbl">المبلغ $</span>
        <input type="number" class="cb-amount-inp" id="cbAmountInp" value="1" min="1" step="0.01" title="اضغط مرتين لإعادة حساب Kelly">
        <span class="cb-demo-badge" id="cbAccMode">ديمو</span>
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
      <div class="cb-conf-slider-row" style="display:flex;align-items:center;gap:6px;padding:4px 10px;">
        <span style="font-size:10px;color:#9CA3AF;min-width:58px;">🎯 ثقة ≥</span>
        <input type="range" id="cbConfSlider" min="50" max="95" value="75" style="flex:1;accent-color:#00d264;height:4px;">
        <span style="font-size:11px;font-weight:700;color:#00d264;min-width:28px;text-align:right;" id="cbConfSliderVal">75%</span>
      </div>
      <div class="cb-timing-row">
        <span class="cb-timing-lbl">⚡ توقيت التنفيذ</span>
        <button class="cb-timing-btn" id="cbTimingMinus" onclick="window._cbAdjTiming&&window._cbAdjTiming(-50)">−</button>
        <span class="cb-timing-val" id="cbTimingVal">+0 ms</span>
        <button class="cb-timing-btn" id="cbTimingPlus" onclick="window._cbAdjTiming&&window._cbAdjTiming(50)">+</button>
      </div>
      <div style="display:flex;gap:6px;margin:0 10px 8px;">
        <button class="cb-reset-btn" id="cbResetStats" style="margin:0;flex:1;">إعادة تعيين</button>
        <button class="cb-reset-btn" id="cbCopyStats"  style="margin:0;flex:1;border-color:#BFDBFE;color:#2563EB;">📋 نسخ</button>
      </div>
      <div style="margin:0 10px 4px;font-size:9px;color:#9CA3AF;text-align:right;" id="cbDbStats">🗄 جاري تحميل إحصاءات قاعدة البيانات…</div>
      <div style="display:flex;gap:6px;margin:0 10px 8px;align-items:center;">
        <input type="password" id="cbGhToken" placeholder="ghp_... GitHub Token" style="flex:1;background:#fff;border:1px solid #E5DDD5;border-radius:8px;color:#374151;font-size:10px;padding:5px 8px;outline:none;">
        <button class="cb-reset-btn" id="cbGhSync" style="margin:0;flex:0 0 auto;border-color:#86EFAC;color:#16A34A;">☁️ مزامنة</button>
      </div>
      <div style="margin:0 10px 6px;font-size:9px;color:#16A34A;text-align:right;" id="cbGhStatus">☁️ لم يتم المزامنة بعد</div>
    </div>
    <div id="cbStatus">v13.0 | OBI+LAD+LSTM+RL | IMDB: 70%→×2 | 85%→×3 | 94%→×4</div>
  </div>
  <div id="cbLogFloat">
    <div id="cbLogHdr">
      <span class="cb-log-title">⚡ السجل الحي</span>
      <div class="cb-log-hdr-btns">
        <button class="cb-log-hbtn" id="cbLogCopy"  onclick="window._cbCopyLog&&window._cbCopyLog()">📋 نسخ</button>
        <button class="cb-log-hbtn" id="cbLogPause" onclick="window._cbPauseLog&&window._cbPauseLog()">⏸ وقفة</button>
        <button class="cb-log-hbtn" id="cbLogClear" onclick="window._cbClearLog&&window._cbClearLog()">🗑 مسح</button>
        <button class="cb-log-hbtn" id="cbLogClose" onclick="window._cbCloseLog&&window._cbCloseLog()">✕</button>
      </div>
    </div>
    <div class="cb-log-filters">
      <button class="cb-log-filter active" data-filter="all"    onclick="window._cbLogFilter&&window._cbLogFilter('all',this)">الكل</button>
      <button class="cb-log-filter f-signal" data-filter="signal" onclick="window._cbLogFilter&&window._cbLogFilter('signal',this)">🟢 صفقات</button>
      <button class="cb-log-filter f-error"  data-filter="error"  onclick="window._cbLogFilter&&window._cbLogFilter('error',this)">🔴 رفض</button>
      <button class="cb-log-filter f-tve"    data-filter="tve"    onclick="window._cbLogFilter&&window._cbLogFilter('tve',this)">⚡ TVE</button>
      <button class="cb-log-filter f-tick"   data-filter="tick"   onclick="window._cbLogFilter&&window._cbLogFilter('tick',this)">📡 تيك</button>
      <button class="cb-log-filter"          data-filter="info"   onclick="window._cbLogFilter&&window._cbLogFilter('info',this)">ℹ معلومات</button>
    </div>
    <div class="cb-log-inner" id="cbLogInner"></div>
  </div>
  <button id="cbLogToggle" onclick="window._cbToggleLog&&window._cbToggleLog()">📋 السجل <span id="cbLogCount">0</span></button>
  <button id="cbSpyBtn" onclick="window._cbToggleSpy&&window._cbToggleSpy()">🔍 SPY <span id="cbSpyCount">0</span></button>
  <div id="cbSpyPanel">
    <div id="cbSpyHdr">
      <span class="spy-title">🔍 SPY — WS#1/WS#2 Raw Data</span>
      <span class="spy-badge" id="cbSpyAiCount">AI:0</span>
      <div class="spy-hdr-btns">
        <button class="spy-btn" id="cbSpyCopyAll">⎘ Copy All</button>
        <button class="spy-btn" id="cbSpyCopyAI">★ Copy AI</button>
        <button class="spy-btn" id="cbSpyClear">✕ Clear</button>
        <button class="spy-btn" id="cbSpyClose" onclick="window._cbCloseSpy&&window._cbCloseSpy()">✕</button>
      </div>
    </div>
    <div id="cbSpyFilters">
      <button class="spy-filter active" data-f="all">All</button>
      <button class="spy-filter" data-f="ai">uid≤20 ★</button>
      <button class="spy-filter" data-f="update">chat_update</button>
      <button class="spy-filter" data-f="ws1">WS#1</button>
      <button class="spy-filter" data-f="ws2">WS#2</button>
    </div>
    <div id="cbSpyScroll"></div>
    <div id="cbSpyStats">إدخالات: 0 | AI: 0 | WR-10s: – | WR-30s: –</div>
  </div>

  <!-- ═══ HYBRID ANALYSIS PANEL ═══ -->
  <button id="cbAnalBtn" onclick="window._cbToggleAnal&&window._cbToggleAnal()">📊 تحليل <span id="cbAnalCount">0</span></button>
  <div id="cbAnalPanel">
    <div id="cbAnalHdr">
      <span class="cb-anal-title">📊 تحليل ETC — سجل الصفقات التفصيلي</span>
      <div class="cb-anal-hdr-btns">
        <button class="cb-anal-hbtn" id="cbAnalExport" onclick="window._cbAnalExportJson&&window._cbAnalExportJson()">📤 تصدير JSON</button>
        <button class="cb-anal-hbtn" id="cbAnalExportTxt" onclick="window._cbAnalExportTxt&&window._cbAnalExportTxt()">📋 تصدير نص</button>
        <button class="cb-anal-hbtn" id="cbAnalClear" onclick="window._cbAnalClear&&window._cbAnalClear()">🗑 مسح</button>
        <button class="cb-anal-hbtn" id="cbAnalClose" onclick="window._cbCloseAnal&&window._cbCloseAnal()">✕</button>
      </div>
    </div>
    <div id="cbAnalSummary"></div>
    <div class="cb-anal-tabs">
      <button class="cb-anal-tab active" data-t="etc" onclick="window._cbAnalTab&&window._cbAnalTab('etc',this)">⚡ ETC (${ETC_MAX_HIST})</button>
      <button class="cb-anal-tab" data-t="log" onclick="window._cbAnalTab&&window._cbAnalTab('log',this)">📋 سجل الصفقات</button>
      <button class="cb-anal-tab" data-t="pat" onclick="window._cbAnalTab&&window._cbAnalTab('pat',this)">🏆 الأنماط</button>
    </div>
    <div id="cbAnalBody"></div>
  </div>
  `;

  // ══════════════════════════════════════════════════════════════════════
  // § 27.5  v12.7 — SPY PANEL logic
  // ══════════════════════════════════════════════════════════════════════

  function _spyAdd(src, evName, uid, payload) {
    const isAI = uid > 0 && uid <= 20;
    if (isAI) _spyAICount++;

    const entry = {
      ts: Date.now(),
      src,          // 'WS#1-CHAT' | 'WS#2-EVT' | 'WS-UNK'
      evName,
      uid,
      isAI,
      payload,      // raw object — NO truncation
      payloadStr: JSON.stringify(payload, null, 2),
    };
    _spyEntries.unshift(entry);
    if (_spyEntries.length > 300) _spyEntries.length = 300;

    // Update counter badge
    const cnt = W.document.getElementById('cbSpyCount');
    if (cnt) cnt.textContent = _spyEntries.length;
    const aiCnt = W.document.getElementById('cbSpyAiCount');
    if (aiCnt) { aiCnt.textContent = 'AI:' + _spyAICount; aiCnt.className = 'spy-badge' + (_spyAICount > 0 ? ' ai' : ''); }

    // Re-render if panel is open
    const panel = W.document.getElementById('cbSpyPanel');
    if (panel && panel.classList.contains('open')) _spyRender();
  }

  function _spyRender() {
    const scroll = W.document.getElementById('cbSpyScroll');
    const stats  = W.document.getElementById('cbSpyStats');
    if (!scroll) return;

    const filtered = _spyEntries.filter(e => {
      if (_spyFilter === 'all')    return true;
      if (_spyFilter === 'ai')     return e.isAI;
      if (_spyFilter === 'update') return e.evName.includes('update') || e.evName.includes('message');
      if (_spyFilter === 'ws1')    return e.src.includes('CHAT');
      if (_spyFilter === 'ws2')    return e.src.includes('EVT');
      return true;
    });

    const frag = W.document.createDocumentFragment();
    for (const e of filtered.slice(0, 80)) {
      const d = W.document.createElement('div');
      d.className = 'spy-entry' + (e.isAI ? ' ai-signal' : e.uid > 0 && e.uid <= 100 ? ' uid-low' : '');

      const t = new Date(e.ts);
      const tsStr = t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0') + ':' + t.getSeconds().toString().padStart(2,'0') + '.' + t.getMilliseconds().toString().padStart(3,'0');

      d.innerHTML =
        '<div class="spy-entry-hdr">' +
          '<span class="spy-ev-name' + (e.isAI ? ' ai' : '') + '">' + e.evName + '</span>' +
          '<span class="spy-ev-ts">' + tsStr + '</span>' +
          '<span class="spy-ev-src">' + e.src + '</span>' +
          (e.uid ? '<span class="spy-ev-uid">uid:' + e.uid + (e.isAI ? ' ★' : '') + '</span>' : '') +
        '</div>' +
        '<pre class="spy-ev-body">' + e.payloadStr.replace(/</g,'&lt;') + '</pre>' +
        '<span class="spy-ev-copy" data-idx="' + _spyEntries.indexOf(e) + '">⎘ copy this entry</span>';

      frag.appendChild(d);
    }
    scroll.innerHTML = '';
    scroll.appendChild(frag);

    // Bind copy-entry buttons
    scroll.querySelectorAll('.spy-ev-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const e = _spyEntries[idx];
        if (!e) return;
        const txt = '=== ' + e.evName + ' [' + e.src + '] uid:' + (e.uid||'-') + ' ts:' + new Date(e.ts).toISOString() + ' ===\n' + e.payloadStr;
        _spyCopy(txt, btn);
      });
    });

    // Update stats
    if (stats) {
      const wr10 = (_aiLogStats.w10+_aiLogStats.l10)>0 ? Math.round(_aiLogStats.w10/(_aiLogStats.w10+_aiLogStats.l10)*100)+'%' : '–';
      const wr30 = (_aiLogStats.w30+_aiLogStats.l30)>0 ? Math.round(_aiLogStats.w30/(_aiLogStats.w30+_aiLogStats.l30)*100)+'%' : '–';
      stats.textContent = 'إدخالات:' + _spyEntries.length + ' | AI:' + _spyAICount + ' | WR-10s:' + wr10 + ' | WR-30s:' + wr30;
    }
  }

  function _spyCopy(text, btn) {
    try {
      if (W.navigator.clipboard?.writeText) {
        W.navigator.clipboard.writeText(text).then(() => { if(btn){btn.textContent='✅ Copied!'; btn.classList.add('copy-ok'); setTimeout(()=>{btn.textContent=btn.dataset.orig||'⎘ Copy All';btn.classList.remove('copy-ok');},1500);} });
      } else {
        const ta = W.document.createElement('textarea');
        ta.value = text; ta.style.cssText='position:fixed;top:-999px;left:-999px;opacity:0;';
        W.document.body.appendChild(ta); ta.select(); W.document.execCommand('copy');
        W.document.body.removeChild(ta);
        if(btn){btn.textContent='✅ Copied!';btn.classList.add('copy-ok');setTimeout(()=>{btn.textContent=btn.dataset.orig||'⎘ Copy';btn.classList.remove('copy-ok');},1500);}
      }
    } catch(_) {}
  }

  function _initSpyPanel() {
    const spyBtn   = W.document.getElementById('cbSpyBtn');
    const spyPanel = W.document.getElementById('cbSpyPanel');
    const spyClose = W.document.getElementById('cbSpyClose');
    const copAll   = W.document.getElementById('cbSpyCopyAll');
    const copAI    = W.document.getElementById('cbSpyCopyAI');
    const clrBtn   = W.document.getElementById('cbSpyClear');
    const filters  = W.document.querySelectorAll('#cbSpyFilters .spy-filter');
    const spyHdr   = W.document.getElementById('cbSpyHdr');

    if (!spyBtn || !spyPanel) return;

    // Show spy button when main panel is open
    W.document.getElementById('cbIcon')?.addEventListener('click', () => {
      const main = W.document.getElementById('cbPanel');
      setTimeout(() => { if (spyBtn) spyBtn.classList.toggle('visible', !!(main && main.classList.contains('open'))); }, 50);
    });

    // V13: expose on window for reliable onclick on Android mobile
    W._cbToggleSpy = function() {
      spyPanel.classList.toggle('open');
      if (spyPanel.classList.contains('open')) { spyBtn.classList.add('visible'); _spyRender(); }
    };
    W._cbCloseSpy = function() { spyPanel.classList.remove('open'); };

    // Copy All
    copAll?.addEventListener('click', () => {
      const lines = _spyEntries.map(e => '=== ' + e.evName + ' [' + e.src + '] uid:' + (e.uid||'-') + ' ts:' + new Date(e.ts).toISOString() + ' ===\n' + e.payloadStr).join('\n\n');
      copAll.dataset.orig = '⎘ Copy All';
      _spyCopy(lines, copAll);
    });
    // Copy AI only (uid ≤ 20)
    copAI?.addEventListener('click', () => {
      const lines = _spyEntries.filter(e=>e.isAI).map(e => '=== AI uid:' + e.uid + ' ' + e.evName + ' ts:' + new Date(e.ts).toISOString() + ' ===\n' + e.payloadStr).join('\n\n');
      copAI.dataset.orig = '★ Copy AI';
      _spyCopy(lines || '(لا توجد إشارات AI بعد)', copAI);
    });
    // Clear
    clrBtn?.addEventListener('click', () => { _spyEntries.length = 0; _spyAICount = 0; const c=W.document.getElementById('cbSpyCount'); if(c) c.textContent='0'; _spyRender(); });

    // Filters
    filters.forEach(f => {
      f.addEventListener('click', () => {
        filters.forEach(x => x.classList.remove('active'));
        f.classList.add('active');
        _spyFilter = f.dataset.f;
        _spyRender();
      });
    });

    // Drag
    let _dx=0, _dy=0, _dragging=false;
    spyHdr?.addEventListener('pointerdown', e => { _dragging=true; _dx=e.clientX-spyPanel.getBoundingClientRect().left; _dy=e.clientY-spyPanel.getBoundingClientRect().top; spyHdr.setPointerCapture(e.pointerId); });
    spyHdr?.addEventListener('pointermove', e => { if(!_dragging) return; spyPanel.style.right='auto'; spyPanel.style.bottom='auto'; spyPanel.style.left=(e.clientX-_dx)+'px'; spyPanel.style.top=(e.clientY-_dy)+'px'; });
    spyHdr?.addEventListener('pointerup', () => _dragging=false);
  }

  // ══════════════════════════════════════════════════════════════════════
  // § HYBRID — Analysis Panel (ETC Journal + Export)
  // ══════════════════════════════════════════════════════════════════════
  let _analCurrentTab = 'etc';
  // سجل الصفقات المفصّل — يملأ كل بيانات الصفقة من DB + ETC
  const _tradeJournal = []; // [{ts, time, asset, dir, amount, result, profit, openPrice, closePrice, pattern, conf, delay, slippage, etcAdj, etcOffsetAfter}]

  function _analAddTrade(rec) {
    _tradeJournal.push(rec);
    if (_tradeJournal.length > 200) _tradeJournal.shift();
    const badge = W.document.getElementById('cbAnalCount');
    if (badge) badge.textContent = _tradeJournal.length;
  }

  function _analSummaryHtml() {
    const total = STATS.wins + STATS.losses;
    const wr    = total > 0 ? ((STATS.wins / total) * 100).toFixed(1) : '–';
    const etcAvgDelay = _etcHistory.length
      ? (_etcHistory.reduce((s,r) => s + r.delay, 0) / _etcHistory.length).toFixed(1)
      : '–';
    const etcLosses = _etcHistory.filter(r => !r.win).length;
    const etcWins   = _etcHistory.filter(r => r.win).length;
    return [
      `فوز: <b>${STATS.wins}</b> | خسارة: <b>${STATS.losses}</b> | معدل: <b>${wr}%</b>`,
      `ETC offset: <b>${_etcOffset.toFixed(0)}ms</b> | متوسط تأخير: <b>${etcAvgDelay}ms</b> | معايرات: <b>${_etcHistory.filter(r=>r.adj>0).length}</b>`,
      `ETC wins: <b>${etcWins}</b> | ETC losses: <b>${etcLosses}</b>`,
    ].join('<br>');
  }

  function _analRenderEtcTab() {
    if (_etcHistory.length === 0) return '<div class="cb-anal-empty">لا توجد صفقات بعد — انتظر أول صفقة</div>';
    let cumulOffset = 0;
    const rows = _etcHistory.slice().reverse().map(r => {
      cumulOffset = 0; // نعيد حساب التراكمي
      const t = new Date(r.ts).toLocaleTimeString('ar');
      const winCls = r.win ? 'win' : 'loss';
      const resCls = r.win ? 'up' : 'dn';
      const adjCls = r.adj > 0 ? 'adj' : '';
      const slip   = r.slippage !== null && r.slippage !== undefined ? r.slippage.toFixed(1) + 'p' : '–';
      return `<tr class="${winCls}">
        <td>${t}</td>
        <td class="${resCls}">${r.win ? '✅ WIN' : '❌ LOSS'}</td>
        <td>${r.delay}ms</td>
        <td>${slip}</td>
        <td>${r.conf}%</td>
        <td class="${adjCls}">${r.adj > 0 ? '+' + r.adj : r.adj < 0 ? r.adj : '–'}</td>
      </tr>`;
    }).join('');
    return `<table class="cb-anal-table">
      <thead><tr>
        <th>الوقت</th><th>النتيجة</th><th>تأخير</th><th>انزلاق</th><th>ثقة</th><th>تعديل</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _analRenderLogTab() {
    // آخر 60 صفقة من logLines (نوع signal/error)
    const trades = logLines.filter(l => l.type === 'signal' || (l.type === 'error' && l.msg.includes('❌')));
    if (trades.length === 0) return '<div class="cb-anal-empty">لا توجد صفقات في السجل بعد</div>';
    const rows = trades.slice(0, 60).map(l => {
      const isWin  = l.msg.includes('✅');
      const isFail = l.msg.includes('❌');
      const cls    = isWin ? 'win' : isFail ? 'loss' : '';
      const resCls = isWin ? 'up' : isFail ? 'dn' : '';
      const seq    = String(l.seq).padStart(4,'0');
      const msg    = l.msg.length > 60 ? l.msg.slice(0,60) + '…' : l.msg;
      return `<tr class="${cls}" title="${l.msg}" onclick="_analCopyRow(this,'${l.msg.replace(/'/g,"\\'")}')">
        <td>#${seq}</td>
        <td>${l.t}</td>
        <td class="${resCls}" style="text-align:right;max-width:220px;overflow:hidden;text-overflow:ellipsis;">${msg}</td>
      </tr>`;
    }).join('');
    return `<table class="cb-anal-table">
      <thead><tr><th>#</th><th>الوقت</th><th style="text-align:right">الحدث</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _analRenderPatTab() {
    const pats = getTopPatterns(20);
    if (pats.length === 0) return '<div class="cb-anal-empty">لا يوجد بيانات أنماط بعد</div>';
    const rows = pats.map(p => {
      const wr   = (p.wr * 100).toFixed(1);
      const cls  = p.wr >= 0.56 ? 'win' : p.wr >= 0.50 ? '' : 'loss';
      const vCls = p.wr >= 0.56 ? 'up' : p.wr < 0.50 ? 'dn' : '';
      return `<tr class="${cls}">
        <td style="text-align:right;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${p.name}</td>
        <td class="${vCls}">${wr}%</td>
        <td>${p.wins}</td>
        <td>${p.total - p.wins}</td>
        <td>${p.total}</td>
      </tr>`;
    }).join('');
    return `<table class="cb-anal-table">
      <thead><tr><th style="text-align:right">النمط</th><th>WR%</th><th>فوز</th><th>خسارة</th><th>مجموع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _analRender() {
    const sum  = W.document.getElementById('cbAnalSummary');
    const body = W.document.getElementById('cbAnalBody');
    if (sum)  sum.innerHTML  = _analSummaryHtml();
    if (!body) return;
    if (_analCurrentTab === 'etc') body.innerHTML = _analRenderEtcTab();
    else if (_analCurrentTab === 'log') body.innerHTML = _analRenderLogTab();
    else if (_analCurrentTab === 'pat') body.innerHTML = _analRenderPatTab();
  }

  // دالة مساعدة لنسخ صف عند الضغط عليه
  W._analCopyRow = function(el, text) {
    navigator.clipboard.writeText(text).catch(() => {});
    const orig = el.style.background;
    el.style.background = '#D1FAE5';
    setTimeout(() => { el.style.background = orig; }, 600);
  };

  function _analExportJSON() {
    const payload = {
      exportedAt:  new Date().toISOString(),
      session: {
        asset: activeAsset, period: candlePeriod, isDemo,
        wins: STATS.wins, losses: STATS.losses,
        winRate: (STATS.wins + STATS.losses > 0
          ? ((STATS.wins / (STATS.wins + STATS.losses)) * 100).toFixed(2)
          : null),
      },
      etc: {
        currentOffset: _etcOffset,
        calibrations: _etcHistory.length,
        history: _etcHistory,
      },
      patterns: getTopPatterns(30).map(p => ({
        name: p.name, wr: +(p.wr * 100).toFixed(1),
        wins: p.wins, total: p.total,
      })),
      tradeLog: logLines
        .filter(l => l.type === 'signal' || (l.type === 'error' && l.msg.includes('❌')))
        .slice(0, 200)
        .map(l => ({ seq: l.seq, t: l.t, msg: l.msg, type: l.type })),
    };
    return JSON.stringify(payload, null, 2);
  }

  function _analExportText() {
    const wr = (STATS.wins + STATS.losses > 0
      ? ((STATS.wins / (STATS.wins + STATS.losses)) * 100).toFixed(1)
      : '–');
    const lines = [
      '══════════════════════════════════════════════════',
      '  HYBRID Analysis Export — ' + new Date().toLocaleString('ar'),
      '══════════════════════════════════════════════════',
      '',
      '【 ملخص الجلسة 】',
      '  الزوج  : ' + (activeAsset || '–'),
      '  الفريم : ' + (candlePeriod ? fmtDur(candlePeriod) : '؟'),
      '  فوز    : ' + STATS.wins + ' | خسارة: ' + STATS.losses + ' | WR: ' + wr + '%',
      '  الحساب : ' + (isDemo ? 'ديمو' : '⚠️ حقيقي'),
      '',
      '【 ETC — معايرة التوقيت 】',
      '  offset الحالي  : ' + _etcOffset.toFixed(0) + 'ms',
      '  عدد المعايرات  : ' + _etcHistory.filter(r => r.adj > 0).length,
      '  متوسط التأخير  : ' + (_etcHistory.length
        ? (_etcHistory.reduce((s,r) => s + r.delay, 0) / _etcHistory.length).toFixed(1) + 'ms'
        : '–'),
      '',
      '  الوقت         | نتيجة | تأخير  | انزلاق | ثقة  | تعديل',
      '  ' + '─'.repeat(56),
      ..._etcHistory.slice(-20).reverse().map(r => {
        const t   = new Date(r.ts).toLocaleTimeString('ar');
        const res = r.win ? 'WIN ✅ ' : 'LOSS❌';
        const adj = r.adj > 0 ? '+' + r.adj : r.adj < 0 ? String(r.adj) : '  0 ';
        const slip = r.slippage !== null && r.slippage !== undefined ? r.slippage.toFixed(1) + 'p' : '  – ';
        return `  ${t.padEnd(13)} | ${res} | ${String(r.delay+'ms').padStart(6)} | ${slip.padStart(6)} | ${String(r.conf+'%').padStart(4)} | ${adj}ms`;
      }),
      '',
      '【 أفضل / أسوأ الأنماط 】',
      ...getTopPatterns(10).map(p =>
        `  ${p.name.padEnd(24)} WR:${(p.wr*100).toFixed(1).padStart(5)}%  (${p.wins}/${p.total})`
      ),
      '',
      '【 آخر 30 صفقة من السجل 】',
      ...logLines
        .filter(l => l.type === 'signal' || (l.type === 'error' && l.msg.includes('❌')))
        .slice(0, 30)
        .map(l => `  [${l.t}] ${l.msg}`),
      '',
      '══════════════════════════════════════════════════',
    ];
    return lines.join('\n');
  }

  function _initAnalPanel() {
    const btn    = W.document.getElementById('cbAnalBtn');
    const panel  = W.document.getElementById('cbAnalPanel');
    const closeB = W.document.getElementById('cbAnalClose');
    const expJ   = W.document.getElementById('cbAnalExport');
    const expT   = W.document.getElementById('cbAnalExportTxt');
    const clrBtn = W.document.getElementById('cbAnalClear');
    if (!btn || !panel) return;

    // V13: all buttons use window._ globals via inline onclick (reliable on Android)
    W._cbToggleAnal    = function() { panel.classList.toggle('open'); if (panel.classList.contains('open')) _analRender(); };
    W._cbCloseAnal     = function() { panel.classList.remove('open'); };
    W._cbAnalTab       = function(t, el) { panel.querySelectorAll('.cb-anal-tab').forEach(x=>x.classList.remove('active')); if(el) el.classList.add('active'); _analCurrentTab=t; _analRender(); };
    W._cbAnalExportJson = function() {
      const json=_analExportJSON();
      navigator.clipboard.writeText(json).then(()=>{if(expJ){expJ.textContent='✅ تم النسخ';expJ.classList.add('ok');setTimeout(()=>{expJ.textContent='📤 تصدير JSON';expJ.classList.remove('ok');},2500);}}).catch(()=>{if(expJ){expJ.textContent='❌ خطأ';setTimeout(()=>{expJ.textContent='📤 تصدير JSON';},2000);}});
    };
    W._cbAnalExportTxt = function() {
      const txt=_analExportText();
      navigator.clipboard.writeText(txt).then(()=>{if(expT){expT.textContent='✅ تم النسخ';expT.classList.add('ok');setTimeout(()=>{expT.textContent='📋 تصدير نص';expT.classList.remove('ok');},2500);}}).catch(()=>{if(expT){expT.textContent='❌ خطأ';setTimeout(()=>{expT.textContent='📋 تصدير نص';},2000);}});
    };
    W._cbAnalClear = function() {
      _etcHistory.length=0; _etcOffset=0;
      const el=W.document.getElementById('cbEtcOffset'), bd=W.document.getElementById('cbEtcBadge');
      if(el) el.textContent='0ms';
      if(bd) { bd.textContent='0 معايرة'; bd.style.background='#6b7280'; }
      _analRender();
    };

    // تحديث تلقائي كل 5 ثوانٍ إذا مفتوح
    setInterval(() => {
      if (panel.classList.contains('open')) _analRender();
    }, 5000);
  }

  // ─── دوال تحديث الواجهة ─────────────────────────────────────────────
  function updateStatusDot() {
    // خذ بعين الاعتبار تجمع المقابس — متصل إذا يوجد أي مقبس نشط
    const poolAlive = CFG.WS_EXEC_POOL_ENABLED
      ? [..._executorPool.values()].some(i => i.authed)
      : false;
    const effectiveConnected = wsConnected || poolAlive || (tradeWS && tradeWS.readyState === 1);
    const dot=W.document.getElementById('cbHdrDot'), ico=W.document.getElementById('cbIconDot');
    if (dot) dot.classList.toggle('on', effectiveConnected);
    if (ico) ico.classList.toggle('on', effectiveConnected);
  }

  function updateHUD() {
    const aEl=W.document.getElementById('cbAsset'), pEl=W.document.getElementById('cbPeriod');
    const tdEl=W.document.getElementById('cbTradeDur');
    if (aEl) aEl.textContent = activeAsset || '–';
    if (pEl) pEl.textContent = candlePeriod ? fmtDur(candlePeriod)+'('+durSource+')' : '؟';
    if (tdEl) tdEl.textContent = _tradeDuration > 0 ? fmtDur(_tradeDuration) : '؟ (تلقائي)';
  }

  function updateLivePrice(price) {
    const el=W.document.getElementById('cbPrice'); if(el) el.textContent=price.toFixed(5);
    // تحديث مؤشرات الوقت الحقيقي عند كل تيك (كل N تيك)
    if (totalTicks % 10 === 0 && activeAsset && candleBuffers[activeAsset]) {
      _updateLiveIndicators(candleBuffers[activeAsset]);
    }
  }

  function updateCountdownDisplay(secs) { const el=W.document.getElementById('cbCd'); if(el) el.textContent=secs+'ث'; }

  function _updateTVEDisplay() {
    const buf=TickVelocityEngine.buf, vh=TickVelocityEngine.velHistory;
    const sEl=W.document.getElementById('cbTveSigma'), bEl=W.document.getElementById('cbTveBadge');
    const psmEl=W.document.getElementById('cbPsmState');
    if (psmEl) psmEl.textContent='PSM: '+PatternStateMachine.state;
    if (!sEl||!bEl) return;
    if (vh.length < 5) { sEl.textContent='–'; bEl.textContent='TVE: جمع…'; bEl.style.color=''; return; }
    const now=Date.now(), cutoff=now-CFG.TVE_STD_WINDOW_MS;
    const recent=vh.filter(v=>v.ts>=cutoff);
    if (recent.length < 3) { sEl.textContent='< 3'; bEl.textContent='TVE: قليل'; bEl.style.color=''; return; }
    const vals=recent.map(v=>v.accel), mean=vals.reduce((s,v)=>s+v,0)/vals.length;
    const vari=vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length, std=Math.sqrt(vari);
    if (std<1e-15) { sEl.textContent='0σ'; bEl.textContent='TVE: ثابت'; return; }
    const lastAccel=vh[vh.length-1].accel, sigma=(lastAccel-mean)/std;
    sEl.textContent=Math.abs(sigma).toFixed(2)+'σ';
    if (Math.abs(sigma)>=CFG.TVE_SIGMA_THRESHOLD) {
      const dir=sigma>0?'↑ BUY':'↓ SELL';
      bEl.textContent='TVE: '+dir; bEl.style.color=sigma>0?'#00d264':'#ff3755';
    } else {
      bEl.textContent='TVE: '+Math.abs(sigma).toFixed(1)+'σ/'+CFG.TVE_SIGMA_THRESHOLD+'σ';
      bEl.style.color=Math.abs(sigma)>=CFG.TVE_SIGMA_THRESHOLD*0.7?'#ffb020':'';
    }
  }

  // 🆕 تحديث مؤشرات MACD + BB + StochRSI + MTF الحية
  function _updateLiveIndicators(candles) {
    if (!candles || candles.length < 5) return;

    // MACD
    const macdData = computeMACD(candles);
    const macdEl   = W.document.getElementById('cbMacdVal'), macdBEl = W.document.getElementById('cbMacdBadge');
    if (macdEl && macdData) {
      macdEl.textContent = macdData.histogram.toFixed(5);
      if (macdBEl) { macdBEl.textContent = macdData.histogram>0?'↑ BUY':'↓ SELL'; macdBEl.className='cb-ind-badge '+(macdData.histogram>0?'up':'dn'); }
    }

    // BB
    const bbData = computeBB(candles);
    const bbEl   = W.document.getElementById('cbBBVal'), bbBEl = W.document.getElementById('cbBBBadge');
    if (bbEl && bbData) {
      bbEl.textContent = (bbData.percentB*100).toFixed(1)+'%';
      if (bbBEl) {
        if (bbData.squeeze) { bbBEl.textContent='⏸ SQUEEZE'; bbBEl.className='cb-ind-badge yw'; }
        else if (bbData.percentB<=0.1) { bbBEl.textContent='↑ LOWER'; bbBEl.className='cb-ind-badge up'; }
        else if (bbData.percentB>=0.9) { bbBEl.textContent='↓ UPPER'; bbBEl.className='cb-ind-badge dn'; }
        else { bbBEl.textContent=bbData.percentB.toFixed(2); bbBEl.className='cb-ind-badge'; }
      }
    }

    // StochRSI
    const srsi   = computeStochRSI(candles);
    const srsiEl = W.document.getElementById('cbSrsiVal'), srsiBEl = W.document.getElementById('cbSrsiBadge');
    if (srsiEl && srsi) {
      srsiEl.textContent = 'K='+srsi.k.toFixed(1)+' D='+srsi.d.toFixed(1);
      if (srsiBEl) { srsiBEl.textContent=srsi.signal||'–'; srsiBEl.className='cb-ind-badge '+(srsi.signal==='BUY'?'up':srsi.signal==='SELL'?'dn':''); }
    }

    // MTF
    const htf    = getHigherTFTrend(candles);
    const mtfBEl = W.document.getElementById('cbMtfBadge');
    if (mtfBEl && htf) {
      mtfBEl.textContent = 'MTF: '+htf.label;
      mtfBEl.className   = 'cb-ind-badge '+(htf.trend.startsWith('UP')?'up':htf.trend.startsWith('DO')?'dn':'');
    }
  }

  // 🆕 تحديث عرض Kelly — ✅ v10.9: لا تُعيد الضبط إذا المستخدم غيّر يدوياً
  function _updateKellyDisplay() {
    const el=W.document.getElementById('cbKellyVal'), bEl=W.document.getElementById('cbKellyBadge'), inp=W.document.getElementById('cbAmountInp');
    if (el) el.textContent = '$'+tradeAmount.toFixed(2);
    if (bEl) {
      const mode = _manualAmountOverride ? 'يدوي' : (CFG.KELLY_ENABLED ? 'Kelly' : 'ثابت');
      bEl.textContent = mode;
      bEl.className='cb-ind-badge '+(_manualAmountOverride ? '' : 'yw');
    }
    // ✅ v10.9: فقط حدّث قيمة الحقل إذا لم يتم التجاوز اليدوي
    if (inp && !_manualAmountOverride) inp.value = tradeAmount;
  }

  // 🆕 تحديث عرض PPT
  function _updatePPTDisplay() {
    const container=W.document.getElementById('cbPPTRows'); if (!container) return;
    const top = getTopPatterns(5);
    if (top.length === 0) { container.innerHTML='<div style="font-size:8px;color:rgba(255,255,255,0.15);padding:4px 0;">لا بيانات كافية بعد</div>'; return; }
    container.innerHTML = top.map(p => {
      const pct = Math.round(p.wr*100);
      const cls = pct>=70?'good':pct>=50?'mid':'bad';
      return `<div class="cb-ppt-row"><span class="cb-ppt-name">${p.name}</span><span class="cb-ppt-wr ${cls}">${pct}%</span><span style="font-size:7px;color:rgba(255,255,255,0.18);margin-right:4px;">(${p.total})</span></div>`;
    }).join('');
  }

  function updateSignalDisplay(result) {
    const box=W.document.getElementById('cbSigBox'), main=W.document.getElementById('cbSigMain');
    const sub=W.document.getElementById('cbSigSub'),  badge=W.document.getElementById('cbSigBadge');
    const icon=W.document.getElementById('cbIcon'),    iconS=W.document.getElementById('cbIconSig');
    if (!box) return;
    if (!result) {
      box.className='cb-sig-box'; main.className='cb-sig-main HOLD'; main.textContent='انتظار';
      sub.textContent='في انتظار الإشارة…'; badge.className='cb-sig-badge'; badge.textContent='ثقة: –';
      icon.className='cbIcon'; iconS.textContent='⚡';
      _updateConfDisplay(null); return;
    }
    const isBuy = result.signal==='BUY';
    box.className='cb-sig-box '+(isBuy?'buy':'sell');
    main.className='cb-sig-main '+result.signal;
    main.textContent = isBuy ? '↑ شراء' : '↓ بيع';
    sub.textContent  = result.reason || result.case || '';
    const c=result.confidence||1, tveTag=result.isTVE?' tve':'';
    badge.className='cb-sig-badge b'+Math.min(5,c)+tveTag;
    badge.textContent=(result.isTVE?'TVE ':'')+'ثقة: '+c+'/5'+(result.sigma?' σ='+Math.abs(result.sigma).toFixed(1):'');
    icon.className='cbIcon '+(isBuy?'buy':'sell');
    iconS.textContent=isBuy?'BUY':'SEL';
    if (result.trendInfo) {
      const tEl=W.document.getElementById('cbTrendVal');
      if (tEl) { tEl.textContent=result.trendInfo.label||''; }
    }
    const pEl=W.document.getElementById('cbPsmState'); if(pEl) pEl.textContent='PSM: '+PatternStateMachine.state;
    _updateConfDisplay(result.confluence);
    // 🔴 PRED-BAR: تحريك زر الشراء/البيع عند ظهور إشارة قوية
    const _apexBoost = (_PS.direction === result.signal && _PS.confidence > 0.55)
                       ? 1.0
                       : (result.confidence || 0.5);
    _animatePlatformButton(result.signal, _apexBoost);
  }

  function _updateConfDisplay(conf) {
    const scoreEl=W.document.getElementById('cbConfScore'), fillEl=W.document.getElementById('cbConfFill'), detEl=W.document.getElementById('cbConfDetail');
    const dblEl=W.document.getElementById('cbDblBadge');
    if (!conf) {
      if (scoreEl) scoreEl.textContent='–';
      if (fillEl)  fillEl.style.cssText='width:0%;background:#444;';
      if (detEl)   detEl.textContent='–';
      if (dblEl)   { dblEl.textContent='DBL–'; dblEl.className='cb-ind-badge'; }
      return;
    }
    const maxScore = 8.5, pct = Math.min(100, (conf.score/maxScore)*100);
    const color = conf.score>=CFG.CONFLUENCE_AUTO_MIN?'#00d264':conf.score>=CFG.CONFLUENCE_MIN_SCORE?'#ffb020':'#ff3755';
    if (scoreEl) { scoreEl.textContent=conf.score.toFixed(1)+'/8.5'; scoreEl.style.color=color; }
    if (fillEl)  { fillEl.style.width=pct+'%'; fillEl.style.background=color; }
    if (detEl)   detEl.textContent=conf.breakdown.join(' ');
    // 🔥🔥 مؤشر الصفقة المزدوجة — ✅ v10.10: يعرض tier IMDB
    if (dblEl) {
      const _spC  = _PS.spConf ?? 0;
      const tier  = getIMDBTier(_spC);
      const pct   = Math.round(_spC);
      if (tier >= 4) {
        dblEl.textContent='💎×4 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (tier === 3) {
        dblEl.textContent='🔥×3 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (tier === 2) {
        dblEl.textContent='🔥×2 ('+pct+'%)'; dblEl.className='cb-ind-badge active';
      } else if (_spC >= CFG.SUPREME_MIN_CONF) {
        dblEl.textContent='🔥 TRADE'; dblEl.className='cb-ind-badge active';
      } else {
        dblEl.textContent='🔴 BLOCKED'; dblEl.className='cb-ind-badge';
      }
    }
  }

  // v12.3 — volatility HUD updater (called from Guard 0c)
  function _updateVolatilityHUD(state) {
    const bar  = W.document.getElementById('cbVolBar');
    const mini = W.document.getElementById('cbVolMini');
    const lbl  = W.document.getElementById('cbVolState');
    if (bar) {
      bar.className = 'cb-vol-bar' + (state === 'SQUEEZE' ? ' squeeze' : state === 'EXPLOSIVE' ? ' explosive' : '');
      if (lbl) lbl.textContent = state === 'SQUEEZE' ? '📉 SQUEEZE — هدوء' : state === 'EXPLOSIVE' ? '🌋 EXPLOSIVE — تقلب شديد' : 'NORMAL';
    }
    if (mini) {
      mini.textContent = state === 'SQUEEZE' ? '📉' : state === 'EXPLOSIVE' ? '🌋' : '✅';
      mini.className   = 'cb-stt-val ' + (state === 'NORMAL' ? 'g' : 'y');
    }
  }

  // v12.3 — bad-session banner (shown when session WR < breakeven for ≥ BAD_SESSION_MIN_TRADES)
  function _updateBadSessionHUD() {
    const banner = W.document.getElementById('cbBadSession');
    if (!banner) return;
    const total = STATS.wins + STATS.losses;
    if (total < CFG.BAD_SESSION_MIN_TRADES) { banner.classList.remove('active'); return; }
    const liveP   = (typeof getActiveAssetPayout === 'function') ? getActiveAssetPayout() : null;
    const payout  = (liveP !== null && liveP > 0) ? liveP : (_dynamicPayout ?? 0.85);
    const breakeven = 1 / (1 + payout); // minimum WR to be profitable
    const sessWR  = STATS.wins / total;
    banner.classList.toggle('active', sessWR < breakeven + CFG.BAD_SESSION_WR_THRESH);
  }

  function updateStatsUI() {
    const w=W.document.getElementById('cbWins'), l=W.document.getElementById('cbLosses'), r=W.document.getElementById('cbWinRate'), dbl=W.document.getElementById('cbDoubles');
    if (w) w.textContent=STATS.wins;
    if (l) l.textContent=STATS.losses;
    if (r) { r.textContent=winRate()+'%'; r.className='cb-stt-val '+(winRate()>=70?'g':winRate()>=55?'y':'r'); }
    if (dbl) dbl.textContent=(STATS.doubles||0);
    // v12.3 — breakeven % display
    const be = W.document.getElementById('cbBreakeven');
    if (be) {
      const liveP = (typeof getActiveAssetPayout === 'function') ? getActiveAssetPayout() : null;
      const payout = (liveP !== null && liveP > 0) ? liveP : (_dynamicPayout ?? 0.85);
      const beVal  = Math.round((1 / (1 + payout)) * 1000) / 10;
      be.textContent = beVal + '%';
    }
    _updateBadSessionHUD();
    _updatePPTDisplay();
  }

  function updateTradeBtn() {
    const buy=W.document.getElementById('cbManualBuy'), sell=W.document.getElementById('cbManualSell');
    if (buy) buy.disabled=tradeExec; if (sell) sell.disabled=tradeExec;
  }

  function updatePauseDisplay(active) { const bar=W.document.getElementById('cbPauseBar'); if(bar) bar.classList.toggle('active',active); }

  function _applyAmount() {
    const inp = W.document.getElementById('cbAmountInp');
    if (!inp) return;
    const raw = parseFloat(String(inp.value || '').trim());
    if (!Number.isFinite(raw) || raw <= 0) {
      inp.value = String(CFG.DEFAULT_AMOUNT);
      return;
    }
    const safe = _safeAmount(raw);
    const changed = !Number.isFinite(tradeAmount) || Math.abs((tradeAmount || 0) - safe) > 1e-9;
    tradeAmount = safe;
    _manualAmountOverride = true;
    _rebuildPayloadCache();
    _updateKellyDisplay();
    if (changed) addLog('💵 مبلغ يدوي: $' + tradeAmount.toFixed(2), 'info');
  }

  let _logFilter = 'all';

  function renderLog() {
    const el = W.document.getElementById('cbLogInner'); if (!el) return;
    const lines = _logFilter === 'all' ? logLines : logLines.filter(l => l.type === _logFilter);
    el.innerHTML = lines.map((l, i) => {
      const extraHtml = l.extra
        ? `<div class="cb-log-extra">${l.extra}</div>`
        : '';
      return `<div class="cb-log-line t-${l.type}${i===0&&_logFilter==='all'?' new':''}">` +
        `<div class="cb-log-row1">` +
        `<span class="cb-log-seq">#${l.seq}</span>` +
        `<span class="cb-log-t">${l.t}</span>` +
        `<span class="cb-log-m ${l.type}">${l.msg}</span>` +
        `</div>` +
        extraHtml +
        `</div>`;
    }).join('');
  }

  // ── V13: window-exposed log functions — onclick on mobile is reliable,
  //         addEventListener('click') can be swallowed on Android WebView  ──
  W._cbToggleLog = function() {
    const lf = W.document.getElementById('cbLogFloat');
    if (!lf) return;
    lf.classList.toggle('open');
    if (lf.classList.contains('open')) renderLog();
  };
  W._cbCloseLog = function() {
    const lf = W.document.getElementById('cbLogFloat');
    if (lf) lf.classList.remove('open');
  };
  W._cbCopyLog = function() {
    const btn = W.document.getElementById('cbLogCopy');
    const header = ['══════════════════════════════════════════',
      '  سجل البوت V13 — ' + new Date().toLocaleString('ar'),
      '  الزوج: '+(activeAsset||'–')+' | الفريم: '+(candlePeriod?fmtDur(candlePeriod):'؟'),
      '  فوز: '+STATS.wins+' | خسارة: '+STATS.losses+' | معدل: '+winRate()+'%',
      '══════════════════════════════════════════'].join('\n');
    const body = logLines.slice().reverse().map(l =>
      '#'+String(l.seq).padStart(4,'0')+' ['+l.t+'] ['+l.type.toUpperCase().padEnd(6)+'] '+l.msg+(l.extra?' ← '+l.extra:'')
    ).join('\n');
    navigator.clipboard.writeText(header+'\n'+body)
      .then(()=>{ if(btn){btn.textContent='✅ تم النسخ';btn.classList.add('copy-ok');setTimeout(()=>{btn.textContent='📋 نسخ';btn.classList.remove('copy-ok');},2500);} })
      .catch(()=>{ if(btn){btn.textContent='❌ خطأ';setTimeout(()=>{btn.textContent='📋 نسخ';},2000);} });
  };
  W._cbPauseLog = function() {
    _logPaused = !_logPaused;
    const btn = W.document.getElementById('cbLogPause');
    if (btn) { btn.textContent = _logPaused ? '▶ استئناف' : '⏸ وقفة'; btn.classList.toggle('pause-on', _logPaused); }
    if (!_logPaused) renderLog();
  };
  W._cbClearLog = function() {
    if (!W.confirm('مسح السجل؟')) return;
    logLines = []; _logSeq = 0; renderLog();
    addLog('🗑 السجل مُمسح', 'info');
  };
  W._cbLogFilter = function(type, btn) {
    _logFilter = type;
    W.document.querySelectorAll('.cb-log-filter').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderLog();
  };


  function renderCandleRow() {
    const el=W.document.getElementById('cbCandleRow'); if(!el||!activeAsset) return;
    const candles=(candleBuffers[activeAsset]||[]).slice(-8);
    const cc=currentCandles[activeAsset];
    let html=candles.map(c=>`<div class="cb-c ${c.isBullish?'bull':'bear'} hist">${c.isBullish?'↑':'↓'}</div>`).join('');
    if (cc&&cc.prices.length>=1) { const forming=buildCandle(cc.prices,cc.startTime); if(forming) html+=`<div class="cb-c ${forming.isBullish?'bull':'bear'} forming">${forming.isBullish?'↑':'↓'}</div>`; }
    el.innerHTML=html;
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 29  تهيئة الواجهة
  // ══════════════════════════════════════════════════════════════════════
  function initUI() {
    const root = W.document.createElement('div');
    root.id='cbRoot'; root.innerHTML=HUD_HTML;
    W.document.body.appendChild(root);

    const icon   = W.document.getElementById('cbIcon');
    const panel  = W.document.getElementById('cbPanel');
    const close  = W.document.getElementById('cbClose');
    const mini   = W.document.getElementById('cbMinimize');
    const toggle = W.document.getElementById('cbAutoToggle');
    const badge  = W.document.getElementById('cbAutoBadge');
    const reset  = W.document.getElementById('cbResetStats');
    const amtInp = W.document.getElementById('cbAmountInp');
    const manBuy = W.document.getElementById('cbManualBuy');
    const manSel = W.document.getElementById('cbManualSell');
    const dragHdr= W.document.getElementById('cbDragHdr');

    // ✅ v10.4 FIX#1: مزامنة الـ toggle مع autoTrade=true
    if (toggle) { toggle.checked = autoTrade; }
    if (badge)  { badge.textContent = autoTrade ? 'ON' : 'OFF'; }

    // v12.4: update title to reflect account type (AppData read before initUI)
    const titleEl = W.document.getElementById('cbMainTitle');
    if (titleEl) {
      const badges = [];
      if (_isIslamicAccount) badges.push('🕌');
      if (_aiTradingMode)    badges.push('🤖');
      if (_platformId === 9) badges.push('📱');
      titleEl.textContent = '⚡ V13 QUANTUM' + (badges.length ? ' ' + badges.join('') : '');
    }

    // ✅ v10.4 FIX#5: بعد 3 ثوانٍ اجعل المقبس جاهزاً حتى لو لم يأتِ successauth
    setTimeout(() => {
      if (!_tradeSocketReady && tradeWS && tradeWS.readyState === 1) {
        _tradeSocketReady = true;
        addLog('✅ مقبس تلقائي — جاهز (fallback)', 'signal');
      }
    }, 3000);

    icon.addEventListener('click', () => { panel.classList.toggle('open'); panel.classList.remove('minimized'); const lt=W.document.getElementById('cbLogToggle'); if(lt) lt.classList.toggle('visible',panel.classList.contains('open')); });
    close.addEventListener('click', () => { panel.classList.remove('open'); const lt=W.document.getElementById('cbLogToggle'); if(lt) lt.classList.remove('visible'); const lf=W.document.getElementById('cbLogFloat'); if(lf) lf.classList.remove('open'); });
    mini.addEventListener('click', () => panel.classList.toggle('minimized'));

    toggle.addEventListener('change', () => {
      autoTrade = toggle.checked; badge.textContent = autoTrade?'ON':'OFF';
      addLog(autoTrade?'🤖 تداول تلقائي: مُفعَّل':'⏸ تداول تلقائي: متوقف','signal');
      if (autoTrade && fastCloseAt && fastCloseAt>Date.now()+100) schedulePredictiveEntry();
    });

    // ═══ سلايدر حد الثقة الأدنى ═══
    const confSlider = W.document.getElementById('cbConfSlider');
    const confSliderVal = W.document.getElementById('cbConfSliderVal');
    if (confSlider) {
      // تهيئة من القيمة المحفوظة
      const savedConf = parseInt(localStorage.getItem('cb_min_conf') || '75', 10);
      confSlider.value = savedConf;
      _minConfThreshold = savedConf;
      if (typeof DualWSSManager !== 'undefined') DualWSSManager.setMinConfidence(savedConf);
      if (confSliderVal) confSliderVal.textContent = savedConf + '%';
      confSlider.addEventListener('input', () => {
        const v = parseInt(confSlider.value, 10);
        _minConfThreshold = v;
        if (typeof DualWSSManager !== 'undefined') DualWSSManager.setMinConfidence(v);
        if (confSliderVal) confSliderVal.textContent = v + '%';
        localStorage.setItem('cb_min_conf', String(v));
      });
    }
;
    amtInp.addEventListener('input',  _applyAmount);
    amtInp.addEventListener('change', _applyAmount);
    amtInp.addEventListener('blur',   _applyAmount);
    // زر إعادة Kelly — النقر المزدوج على الحقل يعيد Kelly
    amtInp.addEventListener('dblclick', () => {
      _manualAmountOverride = false;
      if (CFG.KELLY_ENABLED && accountBalance) {
        tradeAmount = computeKellyAmount(accountBalance);
      } else {
        tradeAmount = CFG.DEFAULT_AMOUNT;
      }
      _rebuildPayloadCache();
      _updateKellyDisplay();
      addLog('♻ تم إعادة Kelly — $' + tradeAmount, 'info');
    });

    manBuy.addEventListener('click',  () => { _lastTradeWasTVE=false; _manualExecTrigger=true; try { executeTrade('BUY',  activeAsset); } finally { _manualExecTrigger=false; } });
    manSel.addEventListener('click',  () => { _lastTradeWasTVE=false; _manualExecTrigger=true; try { executeTrade('SELL', activeAsset); } finally { _manualExecTrigger=false; } });

    reset.addEventListener('click', () => {
      if (!confirm('إعادة تعيين الإحصائيات؟')) return;
      Object.assign(STATS, { wins:0,losses:0,total:0,lossStreak:0,bestStreak:0,winStreak:0,tveWins:0,tveLosses:0,confWins:0,confLosses:0,doubles:0,doubleWins:0 });
      patternStats = {}; _savePatternStats();
      saveStats(); updateStatsUI(); addLog('🔄 إحصائيات مُعادة','info');
    });

    const copyBtn=W.document.getElementById('cbCopyStats');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const wr=winRate();
        const text=['══ إحصائيات v10.3 — Zero-Delay Fix ══',
          'الزوج: '+(activeAsset||'–')+' | المدة: '+(candlePeriod?fmtDur(candlePeriod):'؟'),
          'فوز: '+STATS.wins+' | خسارة: '+STATS.losses+' | معدل: '+wr+'%',
          'صفقات مزدوجة: '+(STATS.doubles||0)+' | فوز مزدوج: '+(STATS.doubleWins||0),
          '─── أفضل الأنماط ───',
          ...getTopPatterns(5).map(p=>'  '+p.name+': '+Math.round(p.wr*100)+'% ('+p.total+')'),
          '─── المحركات ───',
          'CONF_AUTO='+CFG.CONFLUENCE_AUTO_MIN+' | DBL_MIN='+CFG.DOUBLE_MIN_CONFLUENCE,
          'MACD('+CFG.MACD_FAST+','+CFG.MACD_SLOW+','+CFG.MACD_SIGNAL+') | BB('+CFG.BB_PERIOD+','+CFG.BB_STD+')',
          'StochRSI('+CFG.SRSI_PERIOD+','+CFG.SRSI_K+','+CFG.SRSI_D+') | Kelly='+CFG.KELLY_ENABLED,
        ].join('\n');
        navigator.clipboard.writeText(text).then(()=>{copyBtn.textContent='✅ تم النسخ';setTimeout(()=>{copyBtn.textContent='📋 نسخ';},2000);}).catch(()=>{copyBtn.textContent='❌';setTimeout(()=>{copyBtn.textContent='📋 نسخ';},2000);});
      });
    }

    // V13: Log + timing buttons use window._ globals + inline onclick (reliable on Android)
    _cbAdjTiming(0); // render initial timing value

    // v12.11 [DB] GitHub token input + manual sync button
    const ghTokenInp = W.document.getElementById('cbGhToken');
    const ghSyncBtn  = W.document.getElementById('cbGhSync');
    const ghStatusEl = W.document.getElementById('cbGhStatus');
    if (ghTokenInp) {
      // Pre-fill from localStorage or CFG
      const saved = W.localStorage.getItem('_sb_gh_token') || CFG.GH_TOKEN || '';
      if (saved) { ghTokenInp.value = saved; ghTokenInp.placeholder = '✅ توكن محفوظ'; }
      ghTokenInp.addEventListener('change', () => {
        const tok = ghTokenInp.value.trim();
        if (tok) { W.localStorage.setItem('_sb_gh_token', tok); CFG.GH_TOKEN = tok; addLog('🔑 [GH] تم حفظ التوكن', 'info'); }
      });
    }
    if (ghSyncBtn) {
      ghSyncBtn.addEventListener('click', () => {
        if (ghTokenInp?.value?.trim()) CFG.GH_TOKEN = ghTokenInp.value.trim();
        ghSyncBtn.textContent = '☁️ جاري…'; ghSyncBtn.disabled = true;
        _githubSync(true).finally(() => { ghSyncBtn.textContent = '☁️ مزامنة'; ghSyncBtn.disabled = false; });
      });
    }
    // Refresh DB stats every 30s
    _dbUpdateStats();
    _v11_setInterval(_dbUpdateStats, 30000);
    // Periodic GitHub auto-sync
    _v11_setInterval(() => _githubSync(false), CFG.GH_SYNC_INTERVAL_MS);
    // Prune old records at startup
    setTimeout(_dbPrune, 10000);
    // Sync on page unload
    W.addEventListener('beforeunload', () => _githubSync(true));

    _makeDraggable(panel, dragHdr);
    _makeDraggable(W.document.getElementById('cbLogFloat'), W.document.getElementById('cbLogHdr'));

    _updateKellyDisplay();
    _updatePPTDisplay();
    addLog('🚀 v10.10 — تهيأ! IMDB: 70%→×2 | 85%→×3 | 94%→×4 | نفس الثانية', 'signal');
    updateStatsUI();

    // 🔴 PRED-BAR: تهيئة شريط التنبؤ المنفصل
    _initPredictionBar();
  }

  function _makeDraggable(el, handle) {
    if (!el||!handle) return;
    let ox=0,oy=0,dragging=false;
    const onStart=(e)=>{
      if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return;
      dragging=true; el.classList.add('dragging');
      const rect=el.getBoundingClientRect();
      const cx=e.touches?.[0]?.clientX??e.clientX, cy=e.touches?.[0]?.clientY??e.clientY;
      ox=cx-rect.left; oy=cy-rect.top; e.preventDefault();
    };
    const onMove=(e)=>{
      if(!dragging) return;
      const cx=e.touches?.[0]?.clientX??e.clientX, cy=e.touches?.[0]?.clientY??e.clientY;
      el.style.left=Math.max(0,Math.min(W.innerWidth-el.offsetWidth,cx-ox))+'px';
      el.style.top=Math.max(0,Math.min(W.innerHeight-el.offsetHeight,cy-oy))+'px';
      el.style.bottom='auto';
    };
    const onEnd=()=>{ dragging=false; el.classList.remove('dragging'); };
    handle.addEventListener('mousedown', onStart,{passive:false});
    handle.addEventListener('touchstart',onStart,{passive:false});
    W.document.addEventListener('mousemove',onMove);
    W.document.addEventListener('touchmove',onMove,{passive:true});
    W.document.addEventListener('mouseup', onEnd);
    W.document.addEventListener('touchend',onEnd);
  }


  // ─── rAF scheduler — batches DOM updates to the paint frame (Directive 4) ─
  // Multiple ticks can arrive before the next frame; only the latest snapshot
  // is painted, keeping the trading computation loop at zero DOM overhead.
  let _predBarRafPending = false;
  function _predBarScheduleUI() {
    if (_predBarRafPending) return;
    _predBarRafPending = true;
    W.requestAnimationFrame(() => {
      _predBarRafPending = false;
      _predBarRefreshUI();
    });
  }

  // ─── تحديث واجهة شريط التنبؤ SUPREME-PRED v2 ───────────────────
  function _predBarRefreshUI() {
    const bar = W.document.getElementById('pb-bar');
    if (!bar) return;
    const st = _PS;
    const spConf = st.spConf || 0;
    const regime = st.snap?.regime || 'RANGE';
    const snap   = st.snap || {};

    // ── النسب والأرقام الأساسية ────────────────────────────────────────
    const bEl    = W.document.getElementById('pb-buy-pct');
    const sEl    = W.document.getElementById('pb-sell-pct');
    const fillEl = W.document.getElementById('pb-fill');
    const dirEl  = W.document.getElementById('pb-direction');

    if (bEl) bEl.textContent = st.buyPct + '%';
    if (sEl) sEl.textContent = st.sellPct + '%';

    if (fillEl) {
      fillEl.style.width = st.buyPct + '%';
      if (st.direction==='BUY')      fillEl.style.background = 'linear-gradient(90deg,#00d264,#00a850)';
      else if (st.direction==='SELL') fillEl.style.background = 'linear-gradient(90deg,#ff3755,#c8001c)';
      else                            fillEl.style.background = 'linear-gradient(90deg,#ffb020,#ff8c00)';
    }
    if (dirEl) {
      const arrows={BUY:'▲',SELL:'▼',NEUTRAL:'◆'}, colors={BUY:'#00d264',SELL:'#ff3755',NEUTRAL:'#ffb020'};
      dirEl.textContent=(arrows[st.direction]||'◆')+' '+st.direction;
      dirEl.style.color=colors[st.direction]||'#ffb020';
    }

    // ── السهمان المتوهجان: تنبؤ مبكر ≥55% قبل الحدث بـ~5 ثوانٍ ──────
    const arrowUp = W.document.getElementById('pb-arrow-up');
    const arrowDn = W.document.getElementById('pb-arrow-dn');
    if (arrowUp && arrowDn) {
      arrowUp.className = '';
      arrowDn.className = '';
      if (st.direction === 'BUY') {
        arrowUp.className = spConf >= 70 ? 'pba-fire' : spConf >= 55 ? 'pba-soft' : '';
      } else if (st.direction === 'SELL') {
        arrowDn.className = spConf >= 70 ? 'pba-fire' : spConf >= 55 ? 'pba-soft' : '';
      }
    }

    // ── [SUPREME] مقياس الثقة مع اللون التكيفي ────────────────────────
    const confGaugeEl = W.document.getElementById('pb-conf-gauge');
    const confTextEl  = W.document.getElementById('pb-conf-text');
    const confBarEl   = W.document.getElementById('pb-conf-bar');
    if (confGaugeEl) confGaugeEl.style.width = spConf + '%';
    if (confBarEl) {
      // اللون: أحمر <60% | أصفر 60-69% | أخضر 70%+
      confBarEl.style.background = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
      confBarEl.style.width = spConf + '%';
    }
    if (confTextEl) {
      confTextEl.textContent = 'ثقة: ' + spConf + '%';
      confTextEl.style.color = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
    }
    // إنشاء عناصر الثقة إذا لم تكن موجودة
    if (!confBarEl) {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-conf-row')) {
        const row = W.document.createElement('div');
        row.id = 'pb-conf-row';
        row.style.cssText = 'margin-top:5px;display:flex;align-items:center;gap:5px;';
        const txt = W.document.createElement('span');
        txt.id = 'pb-conf-text';
        txt.style.cssText = 'font-size:10px;font-weight:700;min-width:65px;';
        txt.textContent = 'ثقة: ' + spConf + '%';
        txt.style.color = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
        const track = W.document.createElement('div');
        track.style.cssText = 'flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.1);overflow:hidden;';
        const bar2 = W.document.createElement('div');
        bar2.id = 'pb-conf-bar';
        bar2.style.cssText = 'height:100%;border-radius:3px;transition:width 0.15s,background 0.3s;';
        bar2.style.width = spConf + '%';
        bar2.style.background = spConf >= 70 ? '#00d264' : spConf >= 60 ? '#ffb020' : '#ff3755';
        track.appendChild(bar2);
        row.appendChild(txt); row.appendChild(track);
        pbBar.appendChild(row);
      }
    }

    // ── [SUPREME] مؤشر TRADE BLOCKED ──────────────────────────────────
    const blockedEl = W.document.getElementById('pb-blocked');
    if (blockedEl) {
      const isBlocked = spConf < CFG.SUPREME_MIN_CONF || st.direction === 'NEUTRAL';
      blockedEl.style.display = isBlocked ? 'block' : 'none';
      blockedEl.textContent   = '🔴 TRADE BLOCKED (' + spConf + '% < ' + CFG.SUPREME_MIN_CONF + '%)';
    } else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-blocked')) {
        const bl = W.document.createElement('div');
        bl.id = 'pb-blocked';
        bl.style.cssText = 'font-size:9px;font-weight:700;color:#ff3755;text-align:center;margin-top:4px;letter-spacing:0.4px;display:none;';
        pbBar.appendChild(bl);
      }
    }

    // ── [SUPREME] Regime + معدل الفوز ───────────────────────────────
    const regimeEl = W.document.getElementById('pb-regime');
    const rStats   = st.regimeStats?.[regime] || {wins:0,total:0};
    const rWR      = rStats.total >= 5 ? Math.round(rStats.wins/rStats.total*100) : null;
    const regimeLbl = regime==='TREND' ? '📈 TREND' : regime==='VOLATILE' ? '⚡ VOLATILE' : '↔ RANGE';
    const regimeColor = regime==='TREND' ? '#00d264' : regime==='VOLATILE' ? '#ff8c00' : '#ffb020';
    const regimeText  = regimeLbl + (rWR!==null ? ' ' + rWR + '%' : '');
    if (regimeEl) { regimeEl.textContent = regimeText; regimeEl.style.color = regimeColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const rEl = W.document.createElement('div');
        rEl.id = 'pb-regime';
        rEl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.5px;margin-top:3px;';
        rEl.textContent = regimeText; rEl.style.color = regimeColor;
        pbBar.appendChild(rEl);
      }
    }

    // ── [SUPREME] توزيع أصوات الخوارزميات ──────────────────────────
    const agreeEl = W.document.getElementById('pb-agree');
    const vA=st.groupVotes?.A||{bull:0,bear:0,total:0};
    const vB=st.groupVotes?.B||{bull:0,bear:0,total:0};
    const vC=st.groupVotes?.C||{bull:0,bear:0,total:0};
    const vD=st.groupVotes?.D||{bull:0,bear:0,total:0};
    const totalAlgos=(vA.total||0)+(vB.total||0)+(vC.total||0)+(vD.total||0);
    const bullAlgos =(vA.bull||0)+(vB.bull||0)+(vC.bull||0)+(vD.bull||0);
    const agreeStr  = bullAlgos + '/' + totalAlgos + ' ✓';
    if (agreeEl) {
      agreeEl.textContent = agreeStr;
      const ap = totalAlgos>0?bullAlgos/totalAlgos:0;
      agreeEl.style.color = ap>=0.7?'#00d264':ap>=0.5?'#ffb020':'rgba(255,255,255,0.35)';
    } else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const aEl = W.document.createElement('span');
        aEl.id = 'pb-agree';
        aEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        aEl.textContent = agreeStr;
        const ap=totalAlgos>0?bullAlgos/totalAlgos:0;
        aEl.style.color=ap>=0.7?'#00d264':ap>=0.5?'#ffb020':'rgba(255,255,255,0.35)';
        pbBar.appendChild(aEl);
      }
    }

    // ── [SUPREME] توزيع المجموعات A/B/C/D ─────────────────────────────
    const groupEl = W.document.getElementById('pb-groups');
    const gText = 'A:' + (vA.bull||0) + '/' + (vA.total||0) +
                  ' B:' + (vB.bull||0) + '/' + (vB.total||0) +
                  ' C:' + (vC.bull||0) + '/' + (vC.total||0) +
                  ' D:' + (vD.bull||0) + '/' + (vD.total||0);
    if (groupEl) { groupEl.textContent = gText; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-groups')) {
        const gEl = W.document.createElement('div');
        gEl.id = 'pb-groups';
        gEl.style.cssText = 'font-size:8px;color:rgba(255,255,255,0.45);margin-top:2px;letter-spacing:0.4px;font-family:monospace;';
        gEl.textContent = gText;
        pbBar.appendChild(gEl);
      }
    }

    // ── [SUPREME] Hurst H + تصنيف النظام ─────────────────────────────
    const hurstEl = W.document.getElementById('pb-hurst');
    const hurstVal = typeof st.hurst_h==='number' ? st.hurst_h : 0.5;
    const hurstLbl = hurstVal > CFG.SUPREME_HURST_TREND ? 'TREND' : hurstVal < CFG.SUPREME_HURST_RANGE ? 'RANGE' : 'RAND';
    const hurstColor = hurstVal > CFG.SUPREME_HURST_TREND ? '#00d264' : hurstVal < CFG.SUPREME_HURST_RANGE ? '#ffb020' : 'rgba(255,255,255,0.4)';
    if (hurstEl) { hurstEl.textContent = 'H:' + hurstVal.toFixed(2) + ' ' + hurstLbl; hurstEl.style.color = hurstColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar) {
        const hEl = W.document.createElement('span');
        hEl.id = 'pb-hurst';
        hEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        hEl.textContent = 'H:' + hurstVal.toFixed(2) + ' ' + hurstLbl;
        hEl.style.color = hurstColor;
        pbBar.appendChild(hEl);
      }
    }

    // ── [SUPREME] Kalman predicted direction ──────────────────────────
    const kalmanEl = W.document.getElementById('pb-kalman');
    const kDir = st.kalmanPredDir || 0;
    const kMag = st.kalmanMagnitude || 0;
    const kText = kDir > 0 ? ('↑ +'+(kMag*100).toFixed(0)+'σ') : kDir < 0 ? ('↓ -'+(kMag*100).toFixed(0)+'σ') : '— flat';
    const kColor = kDir > 0 ? '#00d264' : kDir < 0 ? '#ff3755' : 'rgba(255,255,255,0.3)';
    if (kalmanEl) { kalmanEl.textContent = 'KF:' + kText; kalmanEl.style.color = kColor; }
    else {
      const pbBar = W.document.getElementById('pb-bar');
      if (pbBar && !W.document.getElementById('pb-kalman')) {
        const kEl = W.document.createElement('span');
        kEl.id = 'pb-kalman';
        kEl.style.cssText = 'font-size:9px;font-weight:700;margin-left:6px;';
        kEl.textContent = 'KF:' + kText;
        kEl.style.color = kColor;
        pbBar.appendChild(kEl);
      }
    }

    // ── Glow effect ─────────────────────────────────────────────────
    if (spConf >= CFG.SUPREME_MIN_CONF) {
      const glowColor = st.direction==='BUY' ? 'rgba(0,210,100,0.4)' : 'rgba(255,55,85,0.4)';
      bar.style.boxShadow = `0 0 20px ${glowColor}, 0 8px 32px rgba(0,0,0,0.8)`;
    } else {
      bar.style.boxShadow = '0 8px 32px rgba(0,0,0,0.8)';
    }
  }

  // ─── تحريك زر الشراء/البيع على المنصة ─────────────────────────
  let _btnAnimTimer = null;
  function _animatePlatformButton(signal, confidence) {
    if (!signal || signal === 'HOLD') return;
    if (confidence < 3) return; // فقط إشارات قوية
    // ابحث عن الزر
    const buttons = W.document.querySelectorAll('button,[role="button"]');
    let target = null;
    for (const btn of buttons) {
      const txt = (btn.textContent||btn.innerText||'').trim();
      if (signal === 'BUY'  && (txt.includes('شراء')||txt.toLowerCase().includes('buy')||txt.toLowerCase().includes('higher')||txt.includes('↑'))) { target = btn; break; }
      if (signal === 'SELL' && (txt.includes('بيع')||txt.toLowerCase().includes('sell')||txt.toLowerCase().includes('lower')||txt.includes('↓')))  { target = btn; break; }
    }
    if (!target) return;

    // أضف كلاس التحريك
    const animClass = signal === 'BUY' ? 'cb-btn-pulse-buy' : 'cb-btn-pulse-sell';
    target.classList.add(animClass);

    // أزل التحريك بعد 3 ثوانٍ
    if (_btnAnimTimer) clearTimeout(_btnAnimTimer);
    _btnAnimTimer = setTimeout(() => {
      target.classList.remove('cb-btn-pulse-buy', 'cb-btn-pulse-sell');
    }, 3000);
  }

  // ─── تهيئة شريط التنبؤ المنفصل ────────────────────────────────
  function _initPredictionBar() {
    // حذف إذا موجود
    const existing = W.document.getElementById('pb-root');
    if (existing) existing.remove();

    const CSS = `
    @keyframes pb-pulse-buy  { 0%,100%{box-shadow:0 0 0 0 rgba(0,210,100,0.7);}50%{box-shadow:0 0 0 12px rgba(0,210,100,0);} }
    @keyframes pb-pulse-sell { 0%,100%{box-shadow:0 0 0 0 rgba(255,55,85,0.7);} 50%{box-shadow:0 0 0 12px rgba(255,55,85,0);}  }
    @keyframes pb-dir-flash  { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
    @keyframes pb-arr-up-soft {
      0%,100%{ text-shadow:0 0 8px rgba(0,210,100,0.5); transform:translateY(0) scale(1); }
      50%    { text-shadow:0 0 22px rgba(0,210,100,0.9),0 0 40px rgba(0,210,100,0.4); transform:translateY(-3px) scale(1.08); }
    }
    @keyframes pb-arr-up-fire {
      0%,100%{ text-shadow:0 0 16px #00d264,0 0 32px rgba(0,210,100,0.7),0 0 64px rgba(0,210,100,0.3); transform:translateY(-2px) scale(1.12); }
      50%    { text-shadow:0 0 30px #00ff88,0 0 60px rgba(0,255,136,0.9),0 0 100px rgba(0,210,100,0.5); transform:translateY(-6px) scale(1.25); }
    }
    @keyframes pb-arr-dn-soft {
      0%,100%{ text-shadow:0 0 8px rgba(255,55,85,0.5); transform:translateY(0) scale(1); }
      50%    { text-shadow:0 0 22px rgba(255,55,85,0.9),0 0 40px rgba(255,55,85,0.4); transform:translateY(3px) scale(1.08); }
    }
    @keyframes pb-arr-dn-fire {
      0%,100%{ text-shadow:0 0 16px #ff3755,0 0 32px rgba(255,55,85,0.7),0 0 64px rgba(255,55,85,0.3); transform:translateY(2px) scale(1.12); }
      50%    { text-shadow:0 0 30px #ff6680,0 0 60px rgba(255,102,128,0.9),0 0 100px rgba(255,55,85,0.5); transform:translateY(6px) scale(1.25); }
    }
    #pb-arrows {
      display:flex; justify-content:space-between; align-items:center;
      padding:2px 4px 6px; margin-bottom:2px;
    }
    #pb-arrow-up, #pb-arrow-dn {
      font-size:40px; line-height:1; cursor:default;
      transition:color 0.3s, opacity 0.4s, text-shadow 0.3s;
    }
    #pb-arrow-up { color:rgba(0,210,100,0.12); opacity:0.25; }
    #pb-arrow-dn { color:rgba(255,55,85,0.12);  opacity:0.25; }
    #pb-arrow-up.pba-soft { color:rgba(0,210,100,0.75); opacity:0.85; animation:pb-arr-up-soft 1.1s ease-in-out infinite; }
    #pb-arrow-up.pba-fire { color:#00ff88; opacity:1;    animation:pb-arr-up-fire 0.45s ease-in-out infinite; }
    #pb-arrow-dn.pba-soft { color:rgba(255,55,85,0.75);  opacity:0.85; animation:pb-arr-dn-soft 1.1s ease-in-out infinite; }
    #pb-arrow-dn.pba-fire { color:#ff6680; opacity:1;    animation:pb-arr-dn-fire 0.45s ease-in-out infinite; }

    /* ══════════════════════════════════════════════════════════
       V13.1 — QUANTUM PHANTOM GLOW — directional + overdrive
       ══════════════════════════════════════════════════════════ */
    #pb-phantom-flash {
      display:inline-block; font-size:15px; font-weight:900;
      color:transparent; letter-spacing:1px; margin-left:4px;
      pointer-events:none; will-change:transform,opacity,text-shadow;
      transition:color 0.05s, text-shadow 0.05s;
    }

    /* ── BULLISH: emerald cascade ── */
    #pb-phantom-flash.pb-ph-bull {
      color:#00ff88;
      text-shadow:
        0 0  8px #00ff88,
        0 0 18px #00d264,
        0 0 32px #00ff88,
        0 0 55px rgba(0,255,136,0.55),
        0 0 90px rgba(0,255,136,0.25);
      animation: pb-ph-bull-rise 3s ease-in-out forwards;
    }
    @keyframes pb-ph-bull-rise {
      0%   { transform:translateY(0)   scale(1.6); opacity:1; }
      15%  { transform:translateY(-6px) scale(1.4);
             text-shadow: 0 0 12px #00ff88, 0 0 28px #00ff88,
                          0 0 52px #00d264, 0 0 90px rgba(0,255,136,0.7),
                          0 0 140px rgba(0,255,136,0.35); }
      50%  { transform:translateY(-3px) scale(1.2); opacity:0.95; }
      85%  { transform:translateY(-1px) scale(1.05); opacity:0.7; }
      100% { transform:translateY(0)   scale(1.0);  opacity:0; }
    }

    /* ── BEARISH: crimson cascade ── */
    #pb-phantom-flash.pb-ph-bear {
      color:#ff2244;
      text-shadow:
        0 0  8px #ff2244,
        0 0 18px #cc0022,
        0 0 32px #ff2244,
        0 0 55px rgba(255,34,68,0.55),
        0 0 90px rgba(255,34,68,0.25);
      animation: pb-ph-bear-sink 3s ease-in-out forwards;
    }
    @keyframes pb-ph-bear-sink {
      0%   { transform:translateY(0)  scale(1.6); opacity:1; }
      15%  { transform:translateY(6px) scale(1.4);
             text-shadow: 0 0 12px #ff2244, 0 0 28px #ff2244,
                          0 0 52px #cc0022, 0 0 90px rgba(255,34,68,0.7),
                          0 0 140px rgba(255,34,68,0.35); }
      50%  { transform:translateY(3px) scale(1.2); opacity:0.95; }
      85%  { transform:translateY(1px) scale(1.05); opacity:0.7; }
      100% { transform:translateY(0)  scale(1.0);  opacity:0; }
    }

    /* ── OVERDRIVE: extra corona + micro-shake (weight ≥ 1.3) ── */
    #pb-phantom-flash.pb-ph-od {
      filter: brightness(1.35) saturate(1.6);
      animation-duration: 2s !important;   /* faster pulse in overdrive */
    }
    #pb-phantom-flash.pb-ph-bull.pb-ph-od {
      text-shadow:
        0 0  6px #00ffcc, 0 0 14px #00ff88, 0 0 28px #00ff88,
        0 0 52px #00d264, 0 0 90px rgba(0,255,136,0.8),
        0 0 160px rgba(0,255,200,0.5), 0 0 240px rgba(0,255,136,0.2);
      animation-name: pb-ph-bull-od;
    }
    @keyframes pb-ph-bull-od {
      0%   { transform:translateY(0)    scale(1.9);  opacity:1; }
      8%   { transform:translateY(-10px) scale(1.6);
             text-shadow: 0 0 20px #00ffcc, 0 0 50px #00ff88,
                          0 0 100px #00d264, 0 0 180px rgba(0,255,200,0.9),
                          0 0 280px rgba(0,255,136,0.4); }
      20%  { transform:translateY(-7px) scale(1.35); }
      40%  { transform:translateY(-4px) scale(1.2);  opacity:0.95; }
      70%  { transform:translateY(-2px) scale(1.1);  opacity:0.75; }
      100% { transform:translateY(0)    scale(1.0);  opacity:0; }
    }
    #pb-phantom-flash.pb-ph-bear.pb-ph-od {
      text-shadow:
        0 0  6px #ff6688, 0 0 14px #ff2244, 0 0 28px #ff2244,
        0 0 52px #cc0022, 0 0 90px rgba(255,34,68,0.8),
        0 0 160px rgba(255,0,50,0.5), 0 0 240px rgba(255,34,68,0.2);
      animation-name: pb-ph-bear-od;
    }
    @keyframes pb-ph-bear-od {
      0%   { transform:translateY(0)   scale(1.9);  opacity:1; }
      8%   { transform:translateY(10px) scale(1.6);
             text-shadow: 0 0 20px #ff6688, 0 0 50px #ff2244,
                          0 0 100px #cc0022, 0 0 180px rgba(255,34,68,0.9),
                          0 0 280px rgba(255,0,50,0.4); }
      20%  { transform:translateY(7px) scale(1.35); }
      40%  { transform:translateY(4px) scale(1.2);  opacity:0.95; }
      70%  { transform:translateY(2px) scale(1.1);  opacity:0.75; }
      100% { transform:translateY(0)   scale(1.0);  opacity:0; }
    }

    @keyframes cb-btn-glow-buy  {
      0%  { box-shadow: 0 0 0 0 rgba(0,210,100,0.9), inset 0 0 0 0 rgba(0,210,100,0.2); transform: scale(1); }
      30% { box-shadow: 0 0 20px 6px rgba(0,210,100,0.7), inset 0 0 12px 0 rgba(0,210,100,0.3); transform: scale(1.04); }
      60% { box-shadow: 0 0 10px 2px rgba(0,210,100,0.4), inset 0 0 6px 0 rgba(0,210,100,0.15); transform: scale(1.01); }
      100%{ box-shadow: 0 0 0 0 rgba(0,210,100,0), inset 0 0 0 0 rgba(0,210,100,0); transform: scale(1); }
    }
    @keyframes cb-btn-glow-sell {
      0%  { box-shadow: 0 0 0 0 rgba(255,55,85,0.9), inset 0 0 0 0 rgba(255,55,85,0.2); transform: scale(1); }
      30% { box-shadow: 0 0 20px 6px rgba(255,55,85,0.7), inset 0 0 12px 0 rgba(255,55,85,0.3); transform: scale(1.04); }
      60% { box-shadow: 0 0 10px 2px rgba(255,55,85,0.4), inset 0 0 6px 0 rgba(255,55,85,0.15); transform: scale(1.01); }
      100%{ box-shadow: 0 0 0 0 rgba(255,55,85,0), inset 0 0 0 0 rgba(255,55,85,0); transform: scale(1); }
    }
    .cb-btn-pulse-buy  { animation: cb-btn-glow-buy  0.65s ease-in-out 4 !important; }
    .cb-btn-pulse-sell { animation: cb-btn-glow-sell 0.65s ease-in-out 4 !important; }

    #pb-root {
      position: fixed;
      top: 50%;
      right: 14px;
      transform: translateY(-50%);
      z-index: 2147483645;
      direction: ltr;
      font-family: 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, sans-serif;
      touch-action: none;
      user-select: none;
    }
    #pb-bar {
      background: rgba(8,10,16,0.97);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 18px;
      padding: 10px 14px;
      width: 260px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8);
      transition: box-shadow 0.4s;
      cursor: grab;
    }
    #pb-bar:active { cursor: grabbing; }
    #pb-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    #pb-title {
      font-size: 9px;
      font-weight: 700;
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      flex: 1;
    }
    #pb-direction {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #ffb020;
      transition: color 0.2s;
      animation: pb-dir-flash 0.8s ease-in-out infinite;
    }
    #pb-signal {
      font-size: 9px;
      font-weight: 600;
      color: rgba(255,255,255,0.3);
      transition: color 0.3s;
    }
    #pb-bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #pb-buy-pct {
      font-size: 15px;
      font-weight: 800;
      color: #00d264;
      min-width: 38px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      transition: color 0.2s;
    }
    #pb-sell-pct {
      font-size: 15px;
      font-weight: 800;
      color: #ff3755;
      min-width: 38px;
      text-align: left;
      font-variant-numeric: tabular-nums;
      transition: color 0.2s;
    }
    #pb-track {
      flex: 1;
      height: 10px;
      border-radius: 5px;
      background: rgba(255,55,85,0.25);
      overflow: hidden;
      position: relative;
    }
    #pb-fill {
      height: 100%;
      border-radius: 5px;
      width: 50%;
      transition: width 0.15s cubic-bezier(0.4,0,0.2,1), background 0.3s;
      background: linear-gradient(90deg,#00d264,#00a850);
    }
    #pb-drag-hint {
      font-size: 7px;
      color: rgba(255,255,255,0.08);
      text-align: center;
      margin-top: 5px;
      letter-spacing: 0.5px;
    }
    #pb-close {
      width: 18px; height: 18px;
      border-radius: 5px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      color: rgba(255,255,255,0.25);
      font-size: 10px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #pb-close:hover { background: rgba(255,55,85,0.15); color: #ff3755; }
    #pb-conf-row {
      display: flex; align-items: center; gap: 6px; margin-top: 6px;
    }
    #pb-conf-text {
      font-size: 10px; font-weight: 700; color: #ffb020;
      min-width: 40px; text-align: right;
      font-variant-numeric: tabular-nums;
    }
    #pb-conf-track {
      flex: 1; height: 6px; border-radius: 3px;
      background: rgba(255,255,255,0.07); overflow: hidden;
    }
    #pb-conf-bar {
      height: 100%; border-radius: 3px; width: 0%;
      transition: width 0.2s, background 0.3s;
      background: #ff3755;
    }
    #pb-blocked {
      font-size: 9px; font-weight: 700; color: #ff3755;
      text-align: center; margin-top: 4px; display: none;
      letter-spacing: 0.5px;
    }
    #pb-regime, #pb-agree, #pb-groups, #pb-hurst, #pb-kalman {
      font-size: 8px; color: rgba(255,255,255,0.38);
      margin-top: 3px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    `;

    const styleEl = W.document.createElement('style');
    styleEl.textContent = CSS;
    W.document.head.appendChild(styleEl);

    const root = W.document.createElement('div');
    root.id = 'pb-root';
    root.innerHTML = `
      <div id="pb-bar">
        <div id="pb-arrows">
          <span id="pb-arrow-up">▲</span>
          <span id="pb-arrow-dn">▼</span>
          <span id="pb-phantom-flash"></span>
        </div>
        <div id="pb-header">
          <span id="pb-title">🔥 SUPREME-PRED v2 V13</span>
          <span id="pb-direction">◆ NEUTRAL</span>
          <span id="pb-signal">ثقة: 0%</span>
          <button id="pb-close" title="إخفاء">✕</button>
        </div>
        <div id="pb-bar-row">
          <span id="pb-buy-pct">50%</span>
          <div id="pb-track"><div id="pb-fill"></div></div>
          <span id="pb-sell-pct">50%</span>
        </div>
        <div id="pb-conf-row">
          <span id="pb-conf-text">ثقة: 0%</span>
          <div id="pb-conf-track"><div id="pb-conf-bar"></div></div>
        </div>
        <div id="pb-blocked"></div>
        <div id="pb-regime">RANGE | WR: –%</div>
        <div id="pb-agree">algos: 0/0</div>
        <div id="pb-groups">A:0/0 B:0/0 C:0/0 D:0/0</div>
        <div id="pb-hurst">H:– –</div>
        <div id="pb-kalman">KF: –</div>
        <div id="pb-drag-hint">اسحب للتحريك</div>
      </div>
    `;
    W.document.body.appendChild(root);

    // زر الإغلاق
    W.document.getElementById('pb-close').addEventListener('click', () => {
      root.style.display = 'none';
    });

    // جعله قابلاً للسحب
    _makeDraggable(root, W.document.getElementById('pb-bar'));
  }

  // ══════════════════════════════════════════════════════════════════════
  // § 30  الإقلاع
  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════
  // § DB  v12.11 — IndexedDB persistent storage + GitHub batch sync
  // ══════════════════════════════════════════════════════════════════════
  const _SESSION_ID = Date.now().toString(36);
  let   _idb        = null;
  const _IDB_NAME   = 'supremebot_v1';
  const _IDB_VER    = 1;
  const _IDB_STORES = ['trades', 'signals', 'logs', 'candles'];

  function _idbOpen() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const req = W.indexedDB.open(_IDB_NAME, _IDB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        for (const name of _IDB_STORES) {
          if (db.objectStoreNames.contains(name)) continue;
          const s = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          s.createIndex('ts',      'ts',      { unique: false });
          s.createIndex('session', 'session', { unique: false });
          if (name !== 'logs') s.createIndex('asset', 'asset', { unique: false });
        }
      };
      req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Fire-and-forget DB write — never blocks the trading loop
  function _dbPut(storeName, obj) {
    _idbOpen().then(db => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).add({ ...obj, ts: obj.ts || Date.now(), session: _SESSION_ID });
      } catch(_) {}
    }).catch(() => {});
  }

  function _dbGetBySession(storeName, sid) {
    return _idbOpen().then(db => new Promise(resolve => {
      const idx = db.transaction(storeName, 'readonly').objectStore(storeName).index('session');
      const req = idx.getAll(IDBKeyRange.only(sid || _SESSION_ID));
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = () => resolve([]);
    })).catch(() => []);
  }

  function _dbGetAll(storeName) {
    return _idbOpen().then(db => new Promise(resolve => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = () => resolve([]);
    })).catch(() => []);
  }

  function _dbCount(storeName) {
    return _idbOpen().then(db => new Promise(resolve => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).count();
      req.onsuccess = e => resolve(e.target.result || 0);
      req.onerror   = () => resolve(0);
    })).catch(() => 0);
  }

  // Prune records older than 30 days to keep storage lean
  function _dbPrune() {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    _idbOpen().then(db => {
      for (const name of _IDB_STORES) {
        try {
          const idx = db.transaction(name, 'readwrite').objectStore(name).index('ts');
          const req = idx.openCursor(IDBKeyRange.upperBound(cutoff));
          req.onsuccess = e => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
        } catch(_) {}
      }
    }).catch(() => {});
  }

  // ── GitHub Sync ─────────────────────────────────────────────────────────────
  let _ghLastSyncMs = 0;
  let _ghSyncing    = false;

  async function _githubSync(force) {
    if (_ghSyncing) return;
    // Read token from CFG or localStorage (user sets once via console)
    const token = CFG.GH_TOKEN || W.localStorage.getItem('_sb_gh_token') || '';
    if (!token) { if (force) addLog('⚠️ [GH] أضف التوكن: localStorage.setItem("_sb_gh_token","ghp_...")', 'error'); return; }
    const now = Date.now();
    if (!force && now - _ghLastSyncMs < CFG.GH_SYNC_INTERVAL_MS) return;
    _ghSyncing = true; _ghLastSyncMs = now;
    try {
      const [trades, signals] = await Promise.all([
        _dbGetBySession('trades'),
        _dbGetBySession('signals'),
      ]);
      const dateStr = new Date().toISOString().slice(0, 10);
      const path    = 'data/sessions/' + dateStr + '/' + _SESSION_ID + '.json';
      const payload = {
        sessionId: _SESSION_ID, sessionDate: dateStr, exportedAt: new Date().toISOString(),
        summary: {
          trades: trades.length,
          wins:   trades.filter(t => t.result === 'win').length,
          losses: trades.filter(t => t.result === 'loss').length,
          signals: signals.length, balance: accountBalance,
          isDemo,
        },
        trades, signals,
      };
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
      let sha = '';
      try {
        const r = await fetch('https://api.github.com/repos/' + CFG.GH_REPO + '/contents/' + path, {
          headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
        });
        if (r.ok) sha = (await r.json()).sha || '';
      } catch(_) {}
      const body = { message: 'data: session ' + _SESSION_ID + ' @ ' + dateStr, content: b64, branch: CFG.GH_BRANCH };
      if (sha) body.sha = sha;
      const r2 = await fetch('https://api.github.com/repos/' + CFG.GH_REPO + '/contents/' + path, {
        method: 'PUT',
        headers: { Authorization: 'token ' + token, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
        body: JSON.stringify(body),
      });
      if (r2.ok) {
        addLog('☁️ [GH] ✓ ' + trades.length + ' صفقة | ' + signals.length + ' إشارة → ' + path, 'signal');
        const el = W.document.getElementById('cbGhStatus');
        if (el) el.textContent = '☁️ ' + new Date().toLocaleTimeString('ar');
      } else {
        const err = await r2.json().catch(() => ({}));
        addLog('⚠️ [GH] خطأ ' + r2.status + ': ' + (err.message || ''), 'error');
      }
    } catch(e) {
      addLog('⚠️ [GH] فشل: ' + e.message, 'error');
    } finally { _ghSyncing = false; }
  }

  // DB stats helper for HUD display
  async function _dbUpdateStats() {
    const [t, s, l, c] = await Promise.all(_IDB_STORES.map(n => _dbCount(n)));
    const el = W.document.getElementById('cbDbStats');
    if (el) el.textContent = '🗄 صفقات:' + t + ' | إشارات:' + s + ' | سجل:' + l + ' | شموع:' + c;
  }


  // ════════════════════════════════════════════════════════════════════════════
  // V13 §A  CRC32 PACKET INTEGRITY
  // ════════════════════════════════════════════════════════════════════════════
  const _CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function _crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = _CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const _crcSeen = new Map(); // crc → ts
  function _crcRejectFrame(ab) {
    try {
      const u8 = new Uint8Array(ab);
      const crc = _crc32(u8);
      const key = crc + '_' + u8.length;
      const now = Date.now();
      if (_crcSeen.has(key) && (now - _crcSeen.get(key)) < 100) return true; // duplicate
      _crcSeen.set(key, now);
      if (_crcSeen.size > 200) { const oldest = [..._crcSeen.keys()][0]; _crcSeen.delete(oldest); }
    } catch(_) {}
    return false;
  }
  // ════════════════════════════════════════════════════════════════════════════
  // V13 §I  DOM SELF-HEALING
  // ════════════════════════════════════════════════════════════════════════════
  const DOMHealer = (() => {
    let _observer = null;
    let _debounce = null;
    let _healCount = 0;
    function start() {
      if (!W.MutationObserver || _observer) return;
      _observer = new W.MutationObserver(() => {
        clearTimeout(_debounce);
        _debounce = setTimeout(_check, 500);
      });
      _observer.observe(W.document.body, { childList: true, subtree: false });
    }
    function _check() {
      const root = W.document.getElementById('cbRoot');
      if (!root && _healCount < 5) {
        _healCount++;
        addLog('[HEAL] cbRoot missing — reinserting UI (×' + _healCount + ')', 'error');
        try { initUI(); } catch(_) {}
      }
    }
    function stop() { if (_observer) { _observer.disconnect(); _observer = null; } }
    return { start, stop };
  })();

  // ══════════════════════════════════════════════════════════════════════
  // 🔬 CORE_DIAGNOSTIC_ENGINE — Layer تشخيص شامل
  // ══════════════════════════════════════════════════════════════════════
  const CoreDiagnostic = (() => {
    // ─── Packet Logger ───────────────────────────────────────────────
    const _packets = [];
    const MAX_PACKETS = CFG.DIAG_MAX_PACKETS || 1000;

    function logPacket(direction, type, data, meta) {
      const entry = {
        id: _packets.length + 1,
        ts: Date.now(),
        direction, // 'IN' | 'OUT'
        type,      // 'binary' | 'text' | 'json' | 'socketio'
        size: data instanceof ArrayBuffer ? data.byteLength : (typeof data === 'string' ? data.length : JSON.stringify(data).length),
        meta: meta || {},
        rawData: null,
        parsedData: null,
      };
      if (typeof data === 'string') {
        entry.rawData = data.slice(0, 2000);
        try { entry.parsedData = JSON.parse(data); } catch(_) {}
      } else if (data instanceof ArrayBuffer) {
        entry.rawData = '[Binary ' + data.byteLength + 'B]';
      }
      _packets.push(entry);
      if (_packets.length > MAX_PACKETS) _packets.shift();
      _updateTimeline(entry);
      return entry;
    }

    // ─── WebSocket Inspector ─────────────────────────────────────────
    const _wsStates = new Map();
    function trackWS(url, state) {
      _wsStates.set(url, { url, state, lastActivity: Date.now(), msgCount: 0, ...(_wsStates.get(url) || {}) });
    }
    function getWSStates() { return Array.from(_wsStates.values()); }

    // ─── Message Decoder ─────────────────────────────────────────────
    function decodeMessage(raw) {
      if (typeof raw === 'string') {
        if (raw === '2') return { type: 'EIO4_PING', decoded: null };
        if (raw === '3') return { type: 'EIO4_PONG', decoded: null };
        if (raw.startsWith('45')) {
          const d = raw.indexOf('-');
          if (d !== -1) {
            try { return { type: 'SOCKETIO_EVENT_PREFIX', decoded: JSON.parse(raw.slice(d+1)) }; } catch(_) {}
          }
          return { type: 'SOCKETIO_BINARY_PREFIX', decoded: null };
        }
        if (raw.startsWith('42')) {
          try { return { type: 'SOCKETIO_EVENT', decoded: JSON.parse(raw.slice(2)) }; } catch(_) {}
        }
        try { return { type: 'JSON', decoded: JSON.parse(raw) }; } catch(_) {}
        return { type: 'TEXT', decoded: raw };
      }
      if (raw instanceof ArrayBuffer || (typeof Blob !== 'undefined' && raw instanceof Blob)) {
        try { const d = msgpackDecode(raw); return { type: 'MSGPACK', decoded: d }; } catch(_) {}
        try { const t = new TextDecoder().decode(raw); return { type: 'BINARY_TEXT', decoded: t }; } catch(_) {}
        return { type: 'BINARY_UNKNOWN', decoded: null };
      }
      return { type: 'UNKNOWN', decoded: null };
    }

    // ─── Traffic Recorder ────────────────────────────────────────────
    const _trafficLog = [];
    const MAX_TRAFFIC = 2000;
    function recordTraffic(direction, eventType, size, parsed) {
      _trafficLog.push({ ts: Date.now(), direction, eventType, size, summary: _summarize(parsed) });
      if (_trafficLog.length > MAX_TRAFFIC) _trafficLog.shift();
    }
    function getTrafficLog() { return _trafficLog; }
    function _summarize(obj) {
      if (!obj) return 'null';
      if (typeof obj === 'string') return obj.slice(0, 100);
      if (Array.isArray(obj)) return '[' + obj.slice(0,3).map(_summarize).join(',') + (obj.length>3?',...':'') + ']';
      if (typeof obj === 'object') {
        const keys = Object.keys(obj).slice(0, 5);
        return '{' + keys.join(',') + (Object.keys(obj).length > 5 ? ',...' : '') + '}';
      }
      return String(obj).slice(0, 100);
    }

    // ─── Asset Monitor ───────────────────────────────────────────────
    const _assets = new Map();
    function updateAsset(name, data) { _assets.set(name, { name, ...data, lastUpdate: Date.now() }); }
    function getAssets() { return Array.from(_assets.values()); }
    function getAsset(name) { return _assets.get(name); }

    // ─── Platform State Monitor ──────────────────────────────────────
    const _platformState = {
      wsConnected: false,
      activeAsset: '',
      candlePeriod: 0,
      balance: 0,
      isDemo: false,
      streamStalled: false,
      lastTick: null,
      reconnectCount: 0,
      uptime: Date.now(),
    };
    function updatePlatformState(key, val) { _platformState[key] = val; }
    function getPlatformState() { return { ..._platformState }; }

    // ─── Event Timeline ──────────────────────────────────────────────
    const _timeline = [];
    const MAX_TIMELINE = 500;
    function _updateTimeline(entry) {
      _timeline.push({ id: entry.id, ts: entry.ts, dir: entry.direction, type: entry.type, size: entry.size, meta: entry.meta });
      if (_timeline.length > MAX_TIMELINE) _timeline.shift();
    }
    function getTimeline() { return _timeline; }

    // ─── Network Statistics ───────────────────────────────────────────
    const _netStats = {
      totalIn: 0, totalOut: 0,
      bytesIn: 0, bytesOut: 0,
      msgTypes: {},
      errors: 0,
      startTime: Date.now(),
    };
    function recordNetStat(direction, size, type) {
      if (direction === 'IN') { _netStats.totalIn++; _netStats.bytesIn += size; }
      else { _netStats.totalOut++; _netStats.bytesOut += size; }
      _netStats.msgTypes[type] = (_netStats.msgTypes[type] || 0) + 1;
    }
    function getNetStats() { return { ..._netStats, uptime: Date.now() - _netStats.startTime }; }

    // ─── Raw Message Archive ─────────────────────────────────────────
    const _archive = [];
    const MAX_ARCHIVE = CFG.DIAG_MAX_ARCHIVE || 500;
    function archiveMessage(raw, decoded, direction) {
      _archive.push({ ts: Date.now(), direction, raw: typeof raw === 'string' ? raw.slice(0,5000) : '[Binary]', decoded: decoded ? JSON.stringify(decoded).slice(0,5000) : null });
      if (_archive.length > MAX_ARCHIVE) _archive.shift();
    }
    function getArchive() { return _archive; }

    // ─── JSON Viewer ──────────────────────────────────────────────────
    function viewJSON(index) {
      const pkt = _packets[index];
      if (!pkt) return null;
      return { raw: pkt.rawData, parsed: pkt.parsedData, meta: pkt.meta };
    }

    // ─── Export System ────────────────────────────────────────────────
    function exportData(format) {
      const data = {
        exportTime: new Date().toISOString(),
        platform: 'PocketOption',
        botVersion: 'V13 QUANTUM SKELETON',
        netStats: getNetStats(),
        assets: getAssets(),
        platformState: getPlatformState(),
        timeline: getTimeline(),
        trafficLog: getTrafficLog(),
        archive: getArchive(),
      };
      if (format === 'csv') {
        let csv = 'timestamp,direction,eventType,size,summary\n';
        for (const r of _trafficLog) {
          csv += `${new Date(r.ts).toISOString()},${r.direction},${r.eventType},${r.size},"${String(r.summary).replace(/"/g,'""')}"\n`;
        }
        return csv;
      }
      return JSON.stringify(data, null, 2);
    }

    function downloadExport(format) {
      const data = exportData(format || CFG.DIAG_EXPORT_FORMAT);
      const blob = new Blob([data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `diag_export_${Date.now()}.${format || CFG.DIAG_EXPORT_FORMAT}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return {
      logPacket, trackWS, getWSStates, decodeMessage,
      recordTraffic, getTrafficLog, updateAsset, getAssets, getAsset,
      updatePlatformState, getPlatformState, getTimeline,
      recordNetStat, getNetStats, archiveMessage, getArchive,
      viewJSON, exportData, downloadExport,
    };
  })();

  // ══════════════════════════════════════════════════════════════════════
  // 🔮 Dual-WSS Latency Arbitrage Manager — مدير المراجحة زمنية الاستجابة
  // يعتمد على المقابس المعترضة من المنصة — لا ينشئ اتصالات جديدة
  // ══════════════════════════════════════════════════════════════════════

  const DualWSSManager = (() => {
    // ─── الحالة الداخلية ─────────────────────────────────────────────
    let _oracleSocket   = null;   // مقبس أوراكل المعترض (events-po.com)
    let _executorSocket = null;   // مقبس المنفذ المعترض (po.market) — نفس tradeWS
    let _latencyGap     = 0;      // الفجوة الزمنية بين المقابس (مللي ثانية)
    let _oracleMsgTs    = 0;      // آخر طابع زمني لرسالة من أوراكل
    let _executorMsgTs  = 0;      // آخر طابع زمني لرسالة من المنفذ
    let _lastSignal     = null;   // آخر إشارة مكتشفة
    let _cooldownUntil  = 0;      // وقت انتهاء التهدئة
    let _running        = false;  // هل النظام يعمل؟
    let _signalQueue    = null;   // طابور الإشارات (إشارة واحدة فقط في كل مرة)
    let _queueTimer     = null;   // مؤقت معالجة الطابور
    let _entryTimer     = null;   // [V17] مؤقت محرّك توقيت الدخول (ETE)
    let _signalCount    = 0;      // عدد الإشارات المكتشفة
    let _tradeCount     = 0;      // عدد الصفقات المنفذة عبر النظام
    let _ghostCount     = 0;      // عدد الصفقات الوهمية
    let _consecutiveSameDir = 0;  // عدد الصفقات المتتالية في نفس الاتجاه
    let _lastTradeDirection = null; // اتجاه آخر صفقة منفذة
    let _lastTradePrice  = 0;     // سعر آخر صفقة
    let _priceRunPips   = 0;     // مقدار تحرك السعر منذ آخر انعكاس (نقاط)
    let _lastExecutedPattern = null; // آخر نمط نُفّذ
    let _lastExecutedPatternTs = 0; // وقت آخر تنفيذ نمط
    let _tradeWindowCount = 0;   // عدد الصفقات في النافذة الزمنية
    let _tradeWindowStart = 0;   // بداية نافذة العد
    const _oracleTicks  = {};    // ✅ [V13.5/C] تيكات الأوراكل لكل زوج: { asset: [{p,t}, ...] }

    // ─── تهيئة النظام ──────────────────────────────────────────────────
    function init() {
      if (!CFG.DUAL_WSS_ENABLED) return;
      addLog('🔮 [DUAL-WSS] تهيئة نظام المراجحة المزدوج (اعتراض المقابس)', 'signal');
      _running = true;
      _refreshDualWSSHUD();
    }

    // ─── تسجيل مقبس معترض ──────────────────────────────────────────────
    function registerSocket(ws, role, origSend) {
      if (role === 'oracle') {
        _oracleSocket = ws;
        addLog('🔮 [DUAL-WSS] تسجيل مقبس أوراكل (events-po) ✓', 'signal');
      } else if (role === 'executor') {
        _executorSocket = ws;
        addLog('⚡ [DUAL-WSS] تسجيل مقبس المنفذ (po.market) ✓', 'signal');
      }
      _refreshDualWSSHUD();
    }

    // ─── إلغاء تسجيل مقبس ──────────────────────────────────────────────
    function unregisterSocket(role) {
      if (role === 'oracle') {
        _oracleSocket = null;
        _oracleMsgTs = 0;
        _throttledWsError('🔮 [DUAL-WSS] مقبس أوراكل غير متاح');
      } else if (role === 'executor') {
        _executorSocket = null;
        _executorMsgTs = 0;
        _throttledWsError('⚡ [DUAL-WSS] مقبس المنفذ غير متاح');
      }
      _refreshDualWSSHUD();
    }

    // ─── تسجيل طابع زمني لرسالة واردة (قياس الفجوة) ──────────────────
    function recordMsgTs(role) {
      const now = Date.now();
      if (role === 'oracle') {
        _oracleMsgTs = now;
      } else if (role === 'executor') {
        _executorMsgTs = now;
        if (_oracleMsgTs > 0) {
          const gap = Math.abs(now - _oracleMsgTs);
          if (gap < 3000) {
            _latencyGap = _latencyGap === 0 ? gap : _latencyGap * 0.85 + gap * 0.15;
          }
        }
      }
    }

    // ✅ [V13.5/المسار C] تسجيل تيك أوراكل (الفيد الأسرع) في مخزن مستقل
    function recordOracleTick(asset, price) {
      const a = normalizeAsset(asset);
      const buf = _oracleTicks[a] || (_oracleTicks[a] = []);
      const now = Date.now();
      buf.push({ p: price, t: now });
      // قصّ النافذة الزمنية + سقف طول
      const cutoff = now - Math.max(CFG.ORACLE_CONFIRM_WINDOW_MS, 4000);
      while (buf.length && buf[0].t < cutoff) buf.shift();
      if (buf.length > 60) buf.shift();
    }

    // ══════════════════════════════════════════════════════════════════════
    // ✅ [V14 — إصلاح الأوراكل] الأوراكل الحقيقي = إشارات المنصة (لا events-po)
    //   اكتشاف SPY: events-po خادم إشعارات بلا أسعار. المصدر الصحيح:
    //   • signals/update (رقمي، قوة 0-4 لكل زوج×فريم) — على المقبس الرئيسي
    //   • إشارة غرفة الشات (UP2/DOWN2 = اتجاه صريح) — على chat-po
    // ══════════════════════════════════════════════════════════════════════
    const _platSig = {};   // asset -> { tf:{[sec]:code}, ts }  (قوة من signals/update)
    const _chatSig = {};   // asset -> { dir:'BUY'|'SELL', tf, price, ts }  (اتجاه من الشات)

    // signals/update | signals/load: [[asset,[[tf,code],...],price], ...]
    function onSignalsUpdate(signals) {
      if (!Array.isArray(signals)) return;
      const now = Date.now();
      for (const row of signals) {
        if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
        const a = normalizeAsset(row[0]);
        const pairs = Array.isArray(row[1]) ? row[1] : [];
        const rec = _platSig[a] || (_platSig[a] = { tf: {}, ts: now });
        rec.ts = now;
        for (const p of pairs) { if (Array.isArray(p) && p.length >= 2) rec.tf[p[0]] = p[1]; }
      }
      try { _tryGenerate(activeAsset); } catch(_) {}   // [V16] قوة المنصة قد تُولّد صفقة
    }
    // إشارة الشات: forecast UP2/DOWN2, timeframe "M1".. → اتجاه صريح
    function onChatSignal(sig) {
      try {
        if (!sig || !sig.symbol || !sig.forecast) return;
        const a = normalizeAsset(sig.symbol);
        const dir = /UP/i.test(sig.forecast) ? 'BUY' : (/DOWN/i.test(sig.forecast) ? 'SELL' : null);
        if (!dir) return;
        _chatSig[a] = { dir, tf: sig.timeframe || '?', price: sig.price || 0, ts: Date.now() };
        _tryGenerate(a);   // [V16] محاولة توليد صفقة (شات + منصة + ميل)
      } catch(_) {}
    }
    // ─── [V16] محرّك إشارات المنصة (PSE) — مولّد من 3 مصادر ──────────────────
    //   اتجاه: الشات (إن وُجد) أو ميل التيك (أجزاء الأجزاء) | قوة: signals/update
    function _tryGenerate(asset) {
      if (!CFG.PSE_ENABLED || !_running) return;
      const a = normalizeAsset(asset);
      if (a !== normalizeAsset(activeAsset)) return;   // الزوج النشط فقط
      if (_signalQueue || tradeExec) return;           // عند الخمول فقط
      const cs = _chatSig[a];
      const freshChat = cs && (Date.now() - cs.ts) < CFG.ORACLE_SIG_TTL_MS;
      const st = platformStrength(a);
      let dir = null, basis = null;
      if (freshChat) { dir = cs.dir; basis = 'chat'; }            // ① اتجاه الشات الرسمي
      else if (CFG.PSE_USE_SLOPE) {                                // ② ميل التيك اللحظي
        const sl = OracleLab.microSlope(a, CFG.PSE_SLOPE_MS);
        if (sl && Math.abs(sl.rel) >= CFG.PSE_SLOPE_MIN_REL) { dir = sl.rel > 0 ? 'BUY' : 'SELL'; basis = 'slope'; }
      }
      if (!dir) return;
      // بوابة القوة: الشات يكفي وحده؛ غير ذلك يلزم قوة منصة كافية
      if (basis !== 'chat' && !(CFG.PSE_USE_PLAT && st >= CFG.ORACLE_MIN_STRENGTH)) return;
      const conf = Math.min(95, CFG.PSE_CONF + (st >= 4 ? 4 : st >= 3 ? 2 : 0));
      addLog('🛰️ [PSE] مولّد: ' + dir + ' | ' + a + ' | أساس:' + basis + ' | قوة المنصة:' + st + ' | ثقة:' + conf, 'signal');
      _enqueueSignal({
        direction: dir, asset: a,
        price: (_lastTradePrice || 0),
        confidence: conf,
        pattern: 'platform_' + basis,
        timestamp: Date.now(),
      });
    }
    // أقصى قوة منصة على فريمات السكالب (≤ مدة الصفقة)
    function platformStrength(asset) {
      const rec = _platSig[normalizeAsset(asset)];
      if (!rec || (Date.now() - rec.ts) > CFG.ORACLE_SIG_TTL_MS) return 0;
      const dur = _tradeDuration || candlePeriod || 5;
      let best = 0;
      for (const k in rec.tf) { if (Number(k) <= Math.max(dur, 5) + 0.5) best = Math.max(best, rec.tf[k] || 0); }
      return best; // 0-4
    }

    // ✅ [V14] الأوراكل الجديد — يجمع: اتجاه الشات (veto) + قوة المنصة (تأكيد)
    function oracleAgrees(direction, asset) {
      if (!CFG.ORACLE_CONFIRM_ENABLED) return { agree: true, reason: 'disabled' };
      const a = normalizeAsset(asset);
      const now = Date.now();

      // (1) إشارة الشات الاتجاهية الصريحة — أقوى مصدر
      const cs = _chatSig[a];
      if (cs && (now - cs.ts) <= CFG.ORACLE_CHAT_TTL_MS) {
        if (cs.dir !== direction) return { agree: false, reason: 'chat-contradict', oracleDir: cs.dir };
        return { agree: true, reason: 'chat-confirm', oracleDir: cs.dir };
      }

      // (2) قوة المنصة الرقمية على فريم السكالب (اتجاه مجهول → لا تحجب، لكن سجّل القوة)
      const st = platformStrength(a);
      if (st >= CFG.ORACLE_MIN_STRENGTH) return { agree: true, reason: 'plat-strength', strength: st };

      // (3) احتياط: ميل الأوراكل القديم إن توفّر (نادراً)
      const all = _oracleTicks[a] || [];
      const win = all.filter(x => x.t >= now - CFG.ORACLE_CONFIRM_WINDOW_MS);
      if (win.length >= CFG.ORACLE_CONFIRM_MIN_TICKS) {
        const slope = win[win.length - 1].p - win[0].p;
        let noise = 0, k = 0;
        for (let i = 1; i < win.length; i++) { noise += Math.abs(win[i].p - win[i-1].p); k++; }
        noise = (k ? noise / k : 0) || 1e-9;
        if (Math.abs(slope) >= CFG.ORACLE_CONFIRM_K * noise) {
          const oracleDir = slope > 0 ? 'BUY' : 'SELL';
          return { agree: oracleDir === direction, reason: oracleDir === direction ? 'confirm' : 'contradict', oracleDir };
        }
      }
      return { agree: true, reason: 'no-oracle' }; // fail-open
    }

    // ══════════════════════════════════════════════════════════════════════
    // فلتر الاتجاه (Trend Filter) — منع التداول عكس الاتجاه العام
    // محسّن: 7 شموع + مقارنة EMA قصيرة/طويلة + قوة الاتجاه
    // ══════════════════════════════════════════════════════════════════════
    // ✅ [V13.4] كشف اتجاه مُطبّع بالتقلب (ATR) — يحل العطل الرياضي القديم
    //   المشكلة السابقة: نافذة 7 شموع + عتبة نسبية 0.0002 (≈370 نقطة/7ث) = NEUTRAL دائماً
    //   على أزواج OTC البطيئة → الفلتر مفتوح والصفقات المعاكسة تمر. الحل: نافذة أطول +
    //   ميل مُقاس بوحدات ATR (scale-invariant) + استثناء آخر شمعة كي لا يُفسد نمط الانعكاس القراءة.
    function _detectTrend(candles) {
      const W = CFG.TREND_WINDOW_CANDLES;
      if (!candles || candles.length < Math.min(12, W)) return 'NEUTRAL';
      const n = Math.min(candles.length, W);
      // استثناء آخر شمعة (هي شمعة النمط/الانعكاس) حتى لا تُحرّف الاتجاه
      const win = candles.slice(-n, -1);
      if (win.length < 6) return 'NEUTRAL';

      const closes = win.map(c => c.close);
      const half = Math.floor(closes.length / 2);
      const avgOlder = closes.slice(0, half).reduce((s, p) => s + p, 0) / half;
      const avgNewer = closes.slice(-half).reduce((s, p) => s + p, 0) / half;
      const slope = avgNewer - avgOlder;                       // فرق مطلق بالسعر

      // ATR ≈ متوسط مدى الشمعة (تطبيع يجعل العتبة صالحة لأي زوج/فريم)
      let atr = 0;
      for (const c of win) atr += (c.high - c.low);
      atr = (atr / win.length) || 1e-9;
      const z = slope / atr;                                    // كم ATR تحرّك المتوسط

      // تأكيد ثانوي: غلبة اتجاه الشموع (مرونة — لا نشترط 55% صارمة)
      const bullRatio = win.filter(c => c.isBullish).length / win.length;
      const thr = CFG.TREND_ATR_Z_THRESHOLD;
      if (z >  thr && bullRatio >= 0.45) return 'UP';
      if (z < -thr && bullRatio <= 0.55) return 'DOWN';
      return 'NEUTRAL';
    }

    function _trendAllows(signalDir) {
      if (!CFG.TREND_FILTER_ENABLED) return true;
      const trend = _lastTrendDirection;
      if (trend === 'NEUTRAL') return true;  // اتجاه محايد → مسموح
      if (signalDir === 'BUY' && trend === 'UP') return true;   // شراء مع صعود ✓
      if (signalDir === 'SELL' && trend === 'DOWN') return true; // بيع مع هبوط ✓
      return false;  // عكس الاتجاه → ممنوع
    }

    // ✅ [V13.4] بوابة الثقة التكيفية — تتعلم من النتائج الحية لكل نمط
    //   bump: زيادة عتبة الثقة المطلوبة (تتناسب مع صافي خسائر النمط)
    //   disabled: تعطيل النمط مؤقتاً إذا نزل معدل فوزه الحي تحت العتبة بعد عينات كافية
    function _adaptiveConfGate(pattern) {
      if (!CFG.ADAPTIVE_CONF_ENABLED || !pattern) return { bump: 0, disabled: false };
      const s = _patternWL[pattern];
      if (!s) return { bump: 0, disabled: false };
      const total = s.w + s.l;
      if (total < CFG.ADAPTIVE_MIN_SAMPLES) return { bump: 0, disabled: false };
      const wr = s.w / total;
      const disabled = wr < CFG.ADAPTIVE_DISABLE_WR;
      const netLoss = Math.max(0, s.l - s.w);                 // كم خسارة صافية للنمط
      const bump = Math.min(20, netLoss * CFG.ADAPTIVE_CONF_PER_LOSS); // سقف +20%
      return { bump, disabled };
    }

    // ✅ [V13.4] تسجيل نتيجة نمط (يُستدعى من recordTrade)
    function _recordPatternResult(pattern, win) {
      if (!pattern) return;
      const s = _patternWL[pattern] || (_patternWL[pattern] = { w: 0, l: 0 });
      if (win) s.w++; else s.l++;
    }

    // ══════════════════════════════════════════════════════════════════════
    // آليات الحماية المتقدمة
    // ══════════════════════════════════════════════════════════════════════

    // ─── قفل الشمعة — منع التداول مرتين في نفس الشمعة ─────────────────
    function _getCandleKey(asset) {
      const a = normalizeAsset(asset);
      const buf = candleBuffers[a];
      if (!buf || buf.length === 0) return null;
      const last = buf[buf.length - 1];
      return a + '_' + last.open + '_' + last.startTime;
    }

    function _isCandleLocked(asset) {
      if (!CFG.CANDLE_LOCK_ENABLED) return false;
      const key = _getCandleKey(asset);
      if (!key) return false;
      return key === _lastTradeCandleKey;
    }

    // ─── التهدئة التكيفية — حسب مدة الشمعة ────────────────────────────
    function getAdaptiveCooldown() {
      // ✅ [V14.5] التهدئة تتبع مدة الصفقة (سكالبينغ) لا مدة الشمعة الطويلة → أسرع بكثير
      const durMs = (_snapTradeDuration(_tradeDuration || candlePeriod || 3)) * 1000;
      const cd = Math.max(CFG.TRADE_COOLDOWN_FLOOR_MS, Math.round(durMs * CFG.TRADE_COOLDOWN_RATIO));
      const variance = cd * 0.2 * (Math.random() - 0.5) * 2;
      return Math.round(cd + variance);
    }

    function isCooldownActive() {
      return Date.now() < _cooldownUntil;
    }

    // ─── Ghost Trade — صفقة وهمية بعد خسارة (بأسعار حقيقية) ──────────────
    // المستوحاة من BACKUP_bot.js: يقارن سعر الدخول مع السعر الحالي بعد انتهاء المدة
    function _isGhostTradeActive() {
      if (!CFG.GHOST_TRADE_ENABLED) return false;
      // ✅ [V13.6] حد أقصى للصفقات الوهمية المتتالية (قابل للضبط — أقل = أسرع)
      if (_ghostConsecutive >= CFG.GHOST_MAX_CONSECUTIVE) {
        _ghostTradeActive = false;
        _ghostConsecutive = 0;
        addLog('👻 [GHOST] اكتمل التحقق — العودة للتداول الحقيقي', 'signal');
        return false;
      }
      // ✅ [V13.6] فعّل Ghost فقط بعد عتبة خسائر متتالية (2 بدل 1 — لا نُبطئ بعد خسارة مفردة)
      if (STATS.lossStreak >= CFG.GHOST_TRIGGER_STREAK && !_ghostWatching) {
        _ghostTradeActive = true;
        addLog('👻 [GHOST] تفعيل صفقة وهمية — ' + STATS.lossStreak + ' خسائر متتالية', 'info');
      }
      return _ghostTradeActive;
    }

    function _executeGhostTrade(direction, asset, amount) {
      _ghostCount++;
      _ghostConsecutive++;  // ✅ زيادة عداد الصفقات الوهمية المتتالية
      _ghostWatching = true;
      const entryPrice = _lastSignal ? _lastSignal.price : 0;
      const tradeSec = _snapTradeDuration(_tradeDuration || (candlePeriod || 3));
      addLog('👻 [GHOST-EXEC] محاكاة ' + direction + ' | ' + asset + ' @ ' + (entryPrice ? entryPrice.toFixed(5) : '?') + ' | $' + amount + ' | بدون رهان حقيقي', 'signal');
      // مقارنة سعر حقيقي بعد انتهاء مدة الصفقة — مثل النسخة الاحتياطية
      const expireMs = Math.max(tradeSec * 1000, 5000);
      setTimeout(() => {
        if (!_ghostWatching) return;
        _ghostWatching = false;
        const a = normalizeAsset(asset);
        const ticks = tickBuffers[a] || [];
        const currentPrice = ticks.length ? ticks[ticks.length - 1] : 0;
        if (currentPrice === 0 || entryPrice === 0) {
          // لا بيانات سعر — أعد تفعيل الصفقة الوهمية
          _ghostTradeActive = true;
          addLog('👻 [GHOST] لا بيانات سعر — إعادة المحاولة', 'info');
          return;
        }
        // مقارنة حقيقية: هل تحرك السعر لصالح الاتجاه؟
        const ghostWon = direction === 'BUY' ? currentPrice > entryPrice : currentPrice < entryPrice;
        if (ghostWon) {
          addLog('👻 [GHOST] ✅ فوز وهمي — السوق جاهز | ' + direction + ' @ ' + entryPrice.toFixed(5) + ' → ' + currentPrice.toFixed(5), 'signal');
          _ghostTradeActive = false;
          // ✅ إعادة تعيين عداد الاتجاه المتتالي — السوق أثبت الاتجاه
          _consecutiveSameDir = 0;
          _lastTradeDirection = null;
        } else {
          addLog('👻 [GHOST] ❌ خسارة وهمية — السوق غير مستقر | ' + direction + ' @ ' + entryPrice.toFixed(5) + ' → ' + currentPrice.toFixed(5), 'info');
          _ghostTradeActive = true; // صفقة وهمية أخرى
          // ✅ إعادة تعيين عداد الاتجاه المتتالي — الاتجاه فشل
          _consecutiveSameDir = 0;
          _lastTradeDirection = null;
        }
      }, expireMs);
    }

    // ─── إعادة المعايرة — بعد N خسائر متتالية ──────────────────────────
    // محسّنة: شرط خروج مزدوج — إما انتهاء المهلة أو ظهور اتجاه واضح
    // المستوحاة من BACKUP_bot.js: Hurst H > 0.6 ← نستخدم اتجاه واضح كبديل
    function _isRecalibrating() {
      if (STATS.lossStreak >= CFG.RECALIBRATE_ON_STREAK) {
        if (!_recalibrating) {
          _recalibrating = true;
          _recalibrateUntil = Date.now() + CFG.RECALIBRATE_DURATION_MS;
          _signalQueue = null;
          _lastSignal = null;
          addLog('🔄 [RECALIBRATE] إعادة معايرة — ' + STATS.lossStreak + ' خسائر متتالية | وقف حتى اتجاه واضح أو ' + (CFG.RECALIBRATE_DURATION_MS/1000) + 'ث', 'error');
          // مؤقت أمان — إنهاء بعد المدة القصوى
          setTimeout(() => {
            if (_recalibrating) {
              _recalibrating = false;
              addLog('🔄 [RECALIBRATE] انتهت المهلة القصوى — استئناف التداول', 'signal');
            }
          }, CFG.RECALIBRATE_DURATION_MS);
        }
      }
      if (!_recalibrating) return false;
      // شرط الخروج المبكر: اتجاه واضح (3 شموع متتالية في نفس الاتجاه)
      const a = normalizeAsset(activeAsset);
      const candles = candleBuffers[a];
      if (candles && candles.length >= CFG.RECALIBRATE_MIN_TREND_CANDLES) {
        const last = candles.slice(-CFG.RECALIBRATE_MIN_TREND_CANDLES);
        const allBull = last.every(c => c.isBullish);
        const allBear = last.every(c => !c.isBullish);
        if (allBull || allBear) {
          _recalibrating = false;
          addLog('🔄 [RECALIBRATE] ✅ اتجاه واضح (' + (allBull ? 'صعودي' : 'هبوطي') + ') — استئناف التداول', 'signal');
          return false;
        }
      }
      // تحقق من المهلة
      if (Date.now() >= _recalibrateUntil) {
        _recalibrating = false;
        addLog('🔄 [RECALIBRATE] انتهت إعادة المعايرة — استئناف التداول', 'signal');
        return false;
      }
      return true;
    }

    // ─── [V18] تقييم سريع داخل الشمعة — لا ينتظر إغلاقها (لتسريع التداول) ────
    //   يبني الشمعة المتشكّلة من تيكات اللحظة ويُلحقها مؤقتاً بالشموع المغلقة، ثم
    //   يستدعي onCandleClose نفسه → يعيد استخدام كل بوابات الأمان (أوراكل/اتجاه/
    //   ثقة/استنفاد/ETE) دون تكرارها. القفل والتهدئة يمنعان التكرار في نفس الشمعة.
    let _lastFastEval = 0;
    function fastEval(asset) {
      if (!CFG.FAST_EVAL_ENABLED || !_running) return;
      const a = normalizeAsset(asset);
      if (a !== activeAsset) return;
      if (tradeExec || _signalQueue || _entryTimer) return;      // مشغول/ينتظر دخولاً
      if (Date.now() < _cooldownUntil) return;
      const now = Date.now();
      if (now - _lastFastEval < CFG.FAST_EVAL_MS) return;
      const cc = currentCandles[a];
      if (!cc || !cc.prices || cc.prices.length < CFG.FAST_EVAL_MIN_TICKS) return;
      const buf = candleBuffers[a];
      if (!buf || buf.length < 3) return;
      const forming = buildCandle(cc.prices, cc.startTime);
      if (!forming) return;
      _lastFastEval = now;
      buf.push(forming);                       // ألحق الشمعة المتشكّلة مؤقتاً
      try { onCandleClose(a); } catch(_) {} finally { buf.pop(); }   // قيّم ثم أزلها
    }

    // ─── كشف إشارة عند إغلاق شمعة ─────────────────────────────────────
    function onCandleClose(asset) {
      if (!_running) return;
      const a = normalizeAsset(asset);
      if (a !== activeAsset) return;
      const candles = candleBuffers[a];
      if (!candles || candles.length < 3) return;

      // تحديث الاتجاه العام
      _lastTrendDirection = _detectTrend(candles);
      _updateTrendHUD();

      // ═══ فحص استنفاد الاتجاه ═══
      // ✅ [V14.2] لم يعد يحجب كل شيء (كان يبطئ ~دقيقتين). يسجّل اتجاه الاستنفاد فقط،
      //   ثم بوابة EXHAUST-COOL أدناه تمنع اتجاه الاستمرار فقط وتسمح بالانعكاس → أسرع.
      if (_isTrendExhausted(candles)) {
        const _wExh = candles.slice(-Math.min(candles.length, 12));
        const _exhUp = _wExh[_wExh.length - 1].close >= _wExh[0].close;
        _exhaustDir   = _exhUp ? 'UP' : 'DOWN';
        _exhaustUntil = Date.now() + CFG.EXHAUSTION_COOLDOWN_MS;
        if (Date.now() - _lastExhaustLogTs > CFG.EXHAUSTION_COOLDOWN_MS) {
          _lastExhaustLogTs = Date.now();
          addLog('🛑 [EXHAUSTION] استنفاد ' + _exhaustDir + ' — تحرّك ' + _priceRunPips.toFixed(1) + ' نقطة. منع الاستمرار فقط (الانعكاس مسموح)', 'info');
        }
        // لا return — نكمل لتقييم النمط؛ بوابة الاستنفاد الاتجاهي تتكفّل بالباقي
      }

      // ═══ فحص تكرار النمط — منع نفس النمط من التكرار بسرعة ═══
      // ✅ [V13.4] مرّر تاريخاً كافياً لتفعيل فحص القمة/القاع (كان slice(-5) يُعطّله)
      const signal = _evaluateCandlePattern(candles.slice(-(CFG.THREE_CANDLE_PEAK_WINDOW + 5)));
      if (signal) {
        if (_isPatternFatigued(signal)) {
          addLog('🔄 [PATTERN-FATIGUE] نمط ' + signal.pattern + ' مكرر — حاجز إعادة التسليح نشط', 'info');
          return;
        }

        // ✅ [V13.4] بوابة الاستنفاد الاتجاهي — امنع اتجاه الاستمرار فقط بعد رالي مستنفد
        //   (يمنع شراء القمة / بيع القاع مثل الخسارة #3) دون منع صفقات الارتداد الرابحة
        if (Date.now() < _exhaustUntil) {
          const contDir = _exhaustDir === 'UP' ? 'BUY' : (_exhaustDir === 'DOWN' ? 'SELL' : null);
          if (contDir && signal.direction === contDir) {
            addLog('🛑 [EXHAUST-COOL] ' + signal.direction + ' ممنوع — استمرار بعد استنفاد ' + _exhaustDir, 'info');
            return;
          }
        }

        // ✅ [V13.4] ثقة تكيفية — ارفع عتبة القبول للأنماط الخاسرة حياً، وعطّل الضعيف جداً
        const _adapt = _adaptiveConfGate(signal.pattern);
        const _effThreshold = _minConfThreshold + _adapt.bump;
        if (_adapt.disabled) {
          addLog('🚫 [PATTERN-OFF] ' + signal.pattern + ' معطّل مؤقتاً — معدل فوز حي منخفض', 'info');
          return;
        }

        // ✅ [V13.6] فلتر الاتجاه — وضعان: 'hard'=حظر تام | 'soft'=خصم ثقة (يبقى السكالبينغ سريعاً)
        let _effConf = signal.confidence;
        let _counterTrend = false;
        if (!_trendAllows(signal.direction)) {
          if (CFG.TREND_FILTER_MODE === 'hard') {
            addLog('🚫 [TREND-BLOCK] ' + signal.direction + ' ممنوع — الاتجاه: ' + _lastTrendDirection, 'info');
            return;
          }
          _counterTrend = true;
          // soft: اخصم من الثقة فقط — الإشارة المعاكسة القوية تمر، الضعيفة تُرفض بالعتبة
          _effConf -= CFG.TREND_SOFT_PENALTY;
          addLog('⚠️ [TREND-SOFT] ' + signal.direction + ' عكس الاتجاه ' + _lastTrendDirection + ' — خصم ' + CFG.TREND_SOFT_PENALTY + '% (ثقة: ' + _effConf + '%)', 'info');
        }

        // فلتر ثقة أدنى — يتحكم به سلايدر الواجهة (+ تعديل تكيفي + خصم الاتجاه الناعم)
        if (_effConf < _effThreshold) {
          addLog('🔮 [SIGNAL-DISCARD] ' + signal.direction + ' | ثقة: ' + _effConf + '% < ' + _effThreshold + '% | نمط: ' + signal.pattern, 'info');
          return;
        }

        // ✅ [V14] فلتر تأكيد الأوراكل — إشارات المنصة الحقيقية (شات اتجاه + قوة رقمية)
        const _orc = oracleAgrees(signal.direction, signal.asset);
        if (!_orc.agree) {
          addLog('🔮 [ORACLE-VETO] ' + signal.direction + ' مرفوض — إشارة المنصة ' + _orc.oracleDir + ' (' + _orc.reason + ')', 'info');
          return;
        }
        // ✅ [V14] تشخيص تغطية الأوراكل — لقياس كم مرة توجد إشارة منصة فعلية (لقرار المسار D)
        const _oracleConfirmed = (_orc.reason === 'chat-confirm' || _orc.reason === 'plat-strength');
        if (_oracleConfirmed) {
          addLog('🔮 [ORACLE-OK] ' + signal.direction + ' مؤكَّد — ' + _orc.reason + (_orc.strength ? ' قوة:' + _orc.strength : '') + ' | قوة المنصة الآن: ' + (DualWSSManager.platformStrength ? DualWSSManager.platformStrength(signal.asset) : '?'), 'info');
        }

        // ✅ [V14.6] قاعدة مدعومة بالبيانات: المعاكس للاتجاه + بلا تأكيد منصة = ملف الخسارة.
        //   (كل خسائر سجلك كانت كذلك؛ وكل صفقة أكّدها الأوراكل ربحت). نشترط ثقة عالية هنا.
        if (CFG.COUNTERTREND_NEEDS_ORACLE && _counterTrend && !_oracleConfirmed &&
            signal.confidence < CFG.COUNTERTREND_MIN_CONF) {
          addLog('🛡️ [CT-GUARD] ' + signal.direction + ' مرفوض — معاكس للاتجاه بلا تأكيد منصة وثقة ' + signal.confidence + '% < ' + CFG.COUNTERTREND_MIN_CONF + '%', 'info');
          return;
        }

        // ═══ فحص الصفقات المتتالية في نفس الاتجاه ═══
        if (signal.direction === _lastTradeDirection && _consecutiveSameDir >= CFG.MAX_CONSEC_SAME_DIR) {
          addLog('🚫 [CONSEC-LIMIT] ' + signal.direction + ' ممنوع — ' + _consecutiveSameDir + ' صفقات متتالية في نفس الاتجاه (حد: ' + CFG.MAX_CONSEC_SAME_DIR + ')', 'info');
          return;
        }

        _signalCount++;
        _enqueueSignal(signal);
      }
    }

    // ─── معالجة إشارة signals من المنصة ─────────────────────────────────
    function onPlatformSignal(signalData) {
      if (!_running || !signalData) return;
      try {
        const asset = signalData.asset || signalData[0] || activeAsset;
        const direction = signalData.direction || signalData.action || null;
        if (!direction) return;
        const dir = (direction === 'call' || direction === 'BUY' || direction === 'up') ? 'BUY' :
                    (direction === 'put' || direction === 'SELL' || direction === 'down') ? 'SELL' : null;
        if (!dir) return;
        const conf = signalData.confidence || signalData.probability || 70;
        const signal = {
          direction: dir,
          asset: normalizeAsset(asset),
          price: signalData.price || 0,
          confidence: Math.min(conf, 95),
          pattern: 'platform_signal',
          timestamp: Date.now(),
        };
        // فلتر ثقة
        if (signal.confidence < _minConfThreshold) {
          addLog('🔮 [SIGNAL-DISCARD] ' + dir + ' | ثقة منخفضة: ' + signal.confidence + '% < ' + _minConfThreshold + '%', 'info');
          return;
        }
        // فلتر اتجاه
        if (!_trendAllows(dir)) {
          addLog('🚫 [TREND-BLOCK] ' + dir + ' ممنوع — الاتجاه: ' + _lastTrendDirection, 'info');
          return;
        }
        _signalCount++;
        addLog('📡 [PLATFORM-SIGNAL] ' + dir + ' | ' + signal.asset + ' | ثقة: ' + signal.confidence + '%', 'signal');
        _enqueueSignal(signal);
      } catch(_) {}
    }

    // ─── فحص استنفاد الاتجاه — منع الدخول بعد رالي طويل ═════════════
    function _isTrendExhausted(candles) {
      if (!CFG.EXHAUSTION_ENABLED) return false;

      // ═══ نافذة ديناميكية حسب الفريم — تضمن 60 ثانية على الأقل ═══
      const period = candlePeriod > 0 ? candlePeriod : 15;
      const minCandles = Math.max(CFG.EXHAUSTION_MIN_CANDLES, Math.round(60 / period));
      const lookback = Math.min(candles.length, minCandles);
      if (lookback < 5) return false;

      // حساب المدى السعري على النافذة الكاملة
      const recent = candles.slice(-lookback);
      const prices = recent.map(c => c.close);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const range = maxP - minP;

      if (range <= 0) return false;

      const lastPrice = prices[prices.length - 1];
      const a = normalizeAsset(activeAsset);
      const ticks = tickBuffers[a] || [];
      const currentPrice = ticks.length ? ticks[ticks.length - 1] : lastPrice;

      // حساب نسبة موقع السعر الحالي من المدى
      const position = (currentPrice - minP) / range;

      // ═══ كشف الرالي: نسبة الشموع الصاعدة/الهابطة من النافذة الكاملة ═══
      const bullCount = recent.filter(c => c.isBullish).length;
      const bearCount = recent.filter(c => !c.isBullish).length;
      const bullRatio = bullCount / lookback;
      const bearRatio = bearCount / lookback;

      // رالي صاعد: 65%+ شموع صاعدة + السعر فوق 80% من المدى
      if (bullRatio >= CFG.EXHAUSTION_BULL_RATIO && position > CFG.EXHAUSTION_PEAK_THRESHOLD) {
        _priceRunPips = (currentPrice - minP) * 100000;
        return true;
      }
      // رالي هابط: 65%+ شموع هابطة + السعر تحت 20% من المدى
      if (bearRatio >= CFG.EXHAUSTION_BULL_RATIO && position < (1 - CFG.EXHAUSTION_PEAK_THRESHOLD)) {
        _priceRunPips = (maxP - currentPrice) * 100000;
        return true;
      }

      // ═══ كشف استنفاد بالزخم: الشموع تصغر بسرعة (نفس الاتجاه) ═══
      if (candles.length >= 6) {
        const c1 = candles[candles.length - 6];
        const c2 = candles[candles.length - 4];
        const c3 = candles[candles.length - 1];
        const body1 = Math.abs(c1.close - c1.open);
        const body2 = Math.abs(c2.close - c2.open);
        const body3 = Math.abs(c3.close - c3.open);
        // إذا كان جسم الشمعة الأخيرة < 30% من جسم الشمعة الوسطى ← الزخم يضعف
        if (body2 > 0 && body3 / body2 < 0.3 && body1 > 0 && body2 / body1 < 0.7) {
          const allSameDir = (c1.isBullish && c2.isBullish && c3.isBullish) ||
                            (!c1.isBullish && !c2.isBullish && !c3.isBullish);
          if (allSameDir) {
            _priceRunPips = Math.abs(currentPrice - c1.open) * 100000;
            return true;
          }
        }
      }

      return false;
    }

    // ─── فحص إرهاق النمط — منع نفس النمط من التكرار بسرعة ═════════════
    function _isPatternFatigued(signal) {
      if (!CFG.PATTERN_REARM_ENABLED) return false;
      const key = signal.pattern + ':' + signal.asset;
      const now = Date.now();
      // نافذة إعادة التسليح: الأكبر من (2× مدة الشمعة) أو (الحد الأدنى 15 ثانية)
      const frameBased = (candlePeriod > 0 ? candlePeriod : 15) * 1000 * 2;
      const rearmWindow = Math.max(CFG.PATTERN_REARM_MIN_MS, frameBased);
      if (_lastExecutedPattern === key && (now - _lastExecutedPatternTs) < rearmWindow) {
        return true; // لا يزال في فترة الحماية
      }
      return false;
    }

    // ─── تقييم نمط الشموع ─────────────────────────────────────────────
    function _evaluateCandlePattern(candles) {
      if (candles.length < 3) return null;

      const last3 = candles.slice(-3);
      const bodySizes = last3.map(c => Math.abs(c.close - c.open));
      const avgBody = bodySizes.reduce((s, b) => s + b, 0) / bodySizes.length;

      // نمط 1: 3 شموع متتالية في نفس الاتجاه
      const allBullish = last3.every(c => c.isBullish);
      const allBearish = last3.every(c => !c.isBullish);

      if (allBullish && avgBody > 0) {
        // ═══ فحص موقع السعر — رفض الشراء عند القمة ═══
        if (candles.length >= 10) {
          const recentPrices = candles.slice(-CFG.THREE_CANDLE_PEAK_WINDOW).map(c => c.close);
          const recentMin = Math.min(...recentPrices);
          const recentMax = Math.max(...recentPrices);
          const recentRange = recentMax - recentMin;
          const lastClose = last3[last3.length-1].close;
          if (recentRange > 0) {
            const posInrange = (lastClose - recentMin) / recentRange;
            if (posInrange > CFG.THREE_CANDLE_PEAK_REJECT) {
              // السعر عند القمة — رفض النمط
              return null;
            }
          }
        }
        // ═══ فحص التسارع — الشموع يجب أن تتسارع (أجسام متزايدة) ═══
        const body0 = bodySizes[0];
        const body2 = bodySizes[2];
        if (body0 > 0 && body2 / body0 < CFG.THREE_CANDLE_MIN_ACCEL) {
          // أجسام متناقصة = زخم يضعف — رفض
          return null;
        }

        const consistency = _calcConsistency(last3, 'bull');
        let confAdj = Math.min(Math.round(consistency * 100), 95);
        if (_lastTradeDirection === 'BUY') {
          confAdj -= (_consecutiveSameDir + 1) * CFG.CONSEC_CONF_PENALTY;
          confAdj = Math.max(50, confAdj);
        }
        return {
          direction: 'BUY',
          asset: activeAsset,
          price: last3[last3.length-1].close,
          confidence: confAdj,
          pattern: '3bullish',
          timestamp: Date.now(),
        };
      }

      if (allBearish && avgBody > 0) {
        // ═══ فحص موقع السعر — رفض البيع عند القاع ═══
        if (candles.length >= 10) {
          const recentPrices = candles.slice(-CFG.THREE_CANDLE_PEAK_WINDOW).map(c => c.close);
          const recentMin = Math.min(...recentPrices);
          const recentMax = Math.max(...recentPrices);
          const recentRange = recentMax - recentMin;
          const lastClose = last3[last3.length-1].close;
          if (recentRange > 0) {
            const posInRange = (lastClose - recentMin) / recentRange;
            if (posInRange < (1 - CFG.THREE_CANDLE_PEAK_REJECT)) {
              // السعر عند القاع — رفض النمط
              return null;
            }
          }
        }
        // ═══ فحص التسارع — الشموع الهابطة يجب أن تتسارع ═══
        const body0 = bodySizes[0];
        const body2 = bodySizes[2];
        if (body0 > 0 && body2 / body0 < CFG.THREE_CANDLE_MIN_ACCEL) {
          return null;
        }

        const consistency = _calcConsistency(last3, 'bear');
        let confAdj = Math.min(Math.round(consistency * 100), 95);
        if (_lastTradeDirection === 'SELL') {
          confAdj -= (_consecutiveSameDir + 1) * CFG.CONSEC_CONF_PENALTY;
          confAdj = Math.max(50, confAdj);
        }
        return {
          direction: 'SELL',
          asset: activeAsset,
          price: last3[last3.length-1].close,
          confidence: confAdj,
          pattern: '3bearish',
          timestamp: Date.now(),
        };
      }

      // نمط 2: ابتلاع صعودي/هبوطي (engulfing) — ثقة محسّنة
      if (candles.length >= 2) {
        const prev = candles[candles.length-2];
        const curr = candles[candles.length-1];
        const prevBody = Math.abs(prev.close - prev.open);
        const currBody = Math.abs(curr.close - curr.open);

        // ✅ [V14.5] موقع السعر في المدى الأخير — لرفض شراء القمة/بيع القاع (سبب خسائر الابتلاع)
        let _posIR = 0.5;
        if (candles.length >= 10) {
          const _rp = candles.slice(-CFG.THREE_CANDLE_PEAK_WINDOW).map(c => c.close);
          const _mn = Math.min(..._rp), _mx = Math.max(..._rp), _rg = _mx - _mn;
          if (_rg > 0) _posIR = (curr.close - _mn) / _rg;
        }

        if (!prev.isBullish && curr.isBullish && currBody > prevBody * 1.2) {
          // ✅ [V14.5] لا تشترِ ابتلاعاً صعودياً عند قمة المدى
          if (_posIR > CFG.THREE_CANDLE_PEAK_REJECT) return null;
          const trendBonus = _lastTrendDirection === 'UP' ? CFG.ENGULFING_TREND_BONUS : (_lastTrendDirection === 'DOWN' ? -15 : 0);
          // مكافأة حجم الابتلاع — إذا كان جسم الشمعة > 2× السابقة
          const sizeBonus = currBody > prevBody * 2 ? CFG.ENGULFING_SIZE_BONUS : 0;
          const conf = Math.max(55, Math.min(95, CFG.ENGULFING_BASE_CONF + trendBonus + sizeBonus));
          return {
            direction: 'BUY',
            asset: activeAsset,
            price: curr.close,
            confidence: conf,
            pattern: 'bullish_engulfing',
            timestamp: Date.now(),
          };
        }

        if (prev.isBullish && !curr.isBullish && currBody > prevBody * 1.2) {
          // ✅ [V14.5] لا تبِع ابتلاعاً هبوطياً عند قاع المدى
          if (_posIR < (1 - CFG.THREE_CANDLE_PEAK_REJECT)) return null;
          const trendBonus = _lastTrendDirection === 'DOWN' ? CFG.ENGULFING_TREND_BONUS : (_lastTrendDirection === 'UP' ? -15 : 0);
          const sizeBonus = currBody > prevBody * 2 ? CFG.ENGULFING_SIZE_BONUS : 0;
          const conf = Math.max(55, Math.min(95, CFG.ENGULFING_BASE_CONF + trendBonus + sizeBonus));
          return {
            direction: 'SELL',
            asset: activeAsset,
            price: curr.close,
            confidence: conf,
            pattern: 'bearish_engulfing',
            timestamp: Date.now(),
          };
        }
      }

      // نمط 3: دوچي بعد اتجاه (doji reversal) — ثقة أعلى مع تأكيد الاتجاه
      if (candles.length >= 3) {
        const prev2 = candles[candles.length-3];
        const prev1 = candles[candles.length-2];
        const curr = candles[candles.length-1];
        const currBody = Math.abs(curr.close - curr.open);
        const currRange = curr.high - curr.low;

        if (currRange > 0 && currBody / currRange < 0.1) {
          if (prev1.isBullish && prev2.isBullish) {
            const trendBonus = _lastTrendDirection === 'DOWN' ? 15 : (_lastTrendDirection === 'UP' ? -10 : 0);
            const conf = Math.max(50, Math.min(95, 55 + trendBonus));
            return {
              direction: 'SELL',
              asset: activeAsset,
              price: curr.close,
              confidence: conf,
              pattern: 'doji_reversal',
              timestamp: Date.now(),
            };
          }
          if (!prev1.isBullish && !prev2.isBullish) {
            const trendBonus = _lastTrendDirection === 'UP' ? 15 : (_lastTrendDirection === 'DOWN' ? -10 : 0);
            const conf = Math.max(50, Math.min(95, 55 + trendBonus));
            return {
              direction: 'BUY',
              asset: activeAsset,
              price: curr.close,
              confidence: conf,
              pattern: 'doji_reversal',
              timestamp: Date.now(),
            };
          }
        }
      }

      return null;
    }

    // ─── حساب ثبات الاتجاه ─────────────────────────────────────────────
    function _calcConsistency(candles, dir) {
      if (candles.length === 0) return 0;
      const bodies = candles.map(c => Math.abs(c.close - c.open));
      const maxBody = Math.max(...bodies);
      if (maxBody === 0) return 0;
      const avgBody = bodies.reduce((s, b) => s + b, 0) / bodies.length;
      const sizeScore = avgBody / maxBody;
      const trendScore = dir === 'bull'
        ? (candles.every(c => c.close > c.open) ? 1 : 0.5)
        : (candles.every(c => c.close < c.open) ? 1 : 0.5);
      return (sizeScore * 0.4 + trendScore * 0.6);
    }

    // ─── طابور الإشارات (آخر إشارة فقط) ────────────────────────────────
    function _enqueueSignal(signal) {
      if (Date.now() - signal.timestamp > CFG.DUAL_WSS_MAX_SIGNAL_AGE) return;

      if (_lastSignal && _lastSignal.direction === signal.direction &&
          Date.now() - _lastSignal.timestamp < 2000) return;

      _signalQueue = signal;
      _lastSignal = signal;

      addLog('🔮 [SIGNAL] ' + signal.direction + ' | ' + signal.asset + ' @ ' +
             signal.price.toFixed(5) + ' | ثقة: ' + signal.confidence + '% | نمط: ' + signal.pattern, 'signal');

      _processQueue();
    }

    // ─── معالجة الطابور ────────────────────────────────────────────────
    function _processQueue() {
      if (!_signalQueue) return;
      if (!_running) return;

      const signal = _signalQueue;
      _signalQueue = null;

      // ═══ فحوصات الحماية المتقدمة (بدون فلتر بشري) ═══

      // 1. إعادة المعايرة — حظر كامل
      if (_isRecalibrating()) {
        addLog('🔄 [RECALIBRATE] إشارة مرفوضة — جاري إعادة المعايرة', 'info');
        return;
      }

      // 2. وقف الخسائر المتتالية
      if (Date.now() < _lossStreakPauseUntil) {
        addLog('⛔ [LOSS-PAUSE] إشارة مرفوضة — وقف خسائر متتالية', 'info');
        return;
      }

      // 3. التهدئة التكيفية
      if (isCooldownActive()) {
        addLog('⏳ [COOLDOWN] إشارة مرفوضة — تهدهة نشطة', 'info');
        return;
      }

      // 4. قفل الشمعة
      if (_isCandleLocked(signal.asset)) {
        addLog('🔒 [CANDLE-LOCK] إشارة مرفوضة — نفس الشمعة', 'info');
        return;
      }

      // 5. Ghost Trade — صفقة وهمية بدل حقيقية
      if (_isGhostTradeActive()) {
        const amt = tradeAmount;
        // ✅ تحديث عداد الاتجاه المتتالي للصفقات الوهمية أيضاً
        if (_lastTradeDirection === signal.direction) {
          _consecutiveSameDir++;
        } else {
          _consecutiveSameDir = 1;
        }
        _lastTradeDirection = signal.direction;
        _lastExecutedPattern = signal.pattern + ':' + signal.asset;
        _lastExecutedPatternTs = Date.now();
        _executeGhostTrade(signal.direction, signal.asset, amt);
        _cooldownUntil = Date.now() + getAdaptiveCooldown();
        return;
      }

      // ═══ تنفيذ حقيقي ═══

      // فحص النافذة الزمنية — أقصى عدد صفقات خلال فترة محددة
      const _now = Date.now();
      if (_now - _tradeWindowStart > CFG.TRADE_WINDOW_MS) {
        _tradeWindowCount = 0;
        _tradeWindowStart = _now;
      }
      if (_tradeWindowCount >= CFG.MAX_TRADES_PER_WINDOW) {
        addLog('⏱️ [WINDOW-LIMIT] حد الصفقات في النافذة — ' + _tradeWindowCount + '/' + CFG.MAX_TRADES_PER_WINDOW + ' في ' + (CFG.TRADE_WINDOW_MS/1000) + 'ث', 'info');
        return;
      }

      // تحديث عداد الصفقات المتتالية في نفس الاتجاه
      if (_lastTradeDirection === signal.direction) {
        _consecutiveSameDir++;
      } else {
        _consecutiveSameDir = 1; // اتجاه جديد — إعادة تعيين العداد
      }
      _lastTradeDirection = signal.direction;

      // تحديث عداد النافذة الزمنية
      _tradeWindowCount++;

      // تحديث آخر نمط نُفّذ
      _lastExecutedPattern = signal.pattern + ':' + signal.asset;
      _lastExecutedPatternTs = _now;

      // حساب التأخير الاصطناعي
      const synthDelay = _getSyntheticDelay();
      const jitter = Math.round((Math.random() - 0.5) * 2 * CFG.DUAL_WSS_JITTER_MS);
      const totalDelay = Math.max(0, synthDelay + jitter);

      if (totalDelay > 0) {
        addLog('🔮 [DELAY] تأخير اصطناعي: ' + totalDelay + 'مللي ثانية (فجوة: ' +
               Math.abs(_latencyGap).toFixed(0) + 'ms)', 'info');
        if (_queueTimer) clearTimeout(_queueTimer);
        _queueTimer = setTimeout(() => {
          _queueTimer = null;
          _timedExecute(signal.direction, signal.asset, tradeAmount);
        }, totalDelay);
      } else {
        _timedExecute(signal.direction, signal.asset, tradeAmount);
      }
    }

    // ─── تنفيذ الصفقة عبر مقبس المنفذ المعترض ─────────────────────────
    // ═══ [V17] محرّك توقيت الدخول (ETE) ════════════════════════════════════
    //   المشكلة: البوت يعرف الاتجاه لكن يدخل في اللحظة الخطأ (قبل أن يتحرك السعر)
    //   الحل: لا تدخل إلا حين يوافق الزخم اللحظي (الميل) اتجاه الصفقة — وإلا انتظر
    //   حتى يوافق ضمن مهلة قصيرة (جزء من عمر الصفقة)، أو ألغِ لتجنّب توقيت سيّئ.
    function _entryAligned(asset, direction) {
      const sl = OracleLab.microSlope(normalizeAsset(asset), CFG.ETE_SLOPE_MS);
      if (!sl) return { ok: true, reason: 'no-data' };   // لا بيانات → لا تعطّل
      const min = CFG.ETE_MIN_REL;
      if (direction === 'BUY') {
        if (sl.rel >=  min) return { ok: true,  reason: 'صاعد✓', sl };
        if (sl.rel <= -min) return { ok: false, reason: 'هابط✗', sl };
      } else {
        if (sl.rel <= -min) return { ok: true,  reason: 'هابط✓', sl };
        if (sl.rel >=  min) return { ok: false, reason: 'صاعد✗', sl };
      }
      return { ok: true, reason: 'مسطّح', sl };           // محايد → اسمح
    }
    // مهلة الانتظار = نسبة من عمر الصفقة المحدّد في time (مع حدّ أدنى/أقصى)
    function _eteMaxWait() {
      if (CFG.ETE_MAX_WAIT_MS > 0) return CFG.ETE_MAX_WAIT_MS;   // override يدوي إن ضُبط
      const durSec = _snapTradeDuration(_tradeDuration || (candlePeriod || 5));
      const ms = Math.round(durSec * 1000 * CFG.ETE_WAIT_FRAC);
      return Math.max(CFG.ETE_WAIT_MIN_MS, Math.min(CFG.ETE_WAIT_MAX_MS, ms));
    }
    function _timedExecute(direction, asset, amount) {
      if (!CFG.ENTRY_TIMING_ENABLED) { _executeDualTrade(direction, asset, amount); return; }
      if (_entryTimer) { clearInterval(_entryTimer); _entryTimer = null; }
      const maxWait = _eteMaxWait();
      const durSec = _snapTradeDuration(_tradeDuration || (candlePeriod || 5));
      const deadline = Date.now() + maxWait;
      const first = _entryAligned(asset, direction);
      if (first.ok) {
        if (first.sl) addLog('🎯 [ENTRY] دخول فوري — الزخم ' + first.reason + ' يوافق ' + direction, 'signal');
        _executeDualTrade(direction, asset, amount); return;
      }
      addLog('⏳ [ENTRY] انتظار توقيت — الزخم ' + first.reason + ' يعاكس ' + direction + ' | مهلة ' + maxWait + 'ms (' + Math.round(CFG.ETE_WAIT_FRAC*100) + '% من ' + durSec + 'ث)', 'info');
      _entryTimer = setInterval(() => {
        if (!_running || tradeExec) { clearInterval(_entryTimer); _entryTimer = null; return; }
        const c = _entryAligned(asset, direction);
        if (c.ok && c.reason !== 'مسطّح') {
          clearInterval(_entryTimer); _entryTimer = null;
          addLog('🎯 [ENTRY] الزخم توافق (' + c.reason + ') — دخول ' + direction, 'signal');
          _executeDualTrade(direction, asset, amount);
        } else if (Date.now() >= deadline) {
          clearInterval(_entryTimer); _entryTimer = null;
          if (CFG.ETE_ON_TIMEOUT === 'enter') {
            addLog('🎯 [ENTRY] انتهت المهلة — دخول رغم عدم التوافق ' + direction, 'info');
            _executeDualTrade(direction, asset, amount);
          } else {
            addLog('🚫 [ENTRY] انتهت المهلة دون توافق — إلغاء ' + direction + ' (تجنّب توقيت سيّئ)', 'info');
          }
        }
      }, CFG.ETE_POLL_MS);
    }

    function _executeDualTrade(direction, asset, overrideAmount) {
      if (!autoTrade) return;
      if (tradeExec) return;
      if (!tradeWSOrig || !tradeWS || tradeWS.readyState !== 1) {
        // ✅ حفظ الإشارة المعلقة لإعادة المحاولة عند إعادة الاتصال
        _pendingRetrySignal = { direction, asset, timestamp: Date.now() };
        addLog('⚠️ [DUAL-WSS] لا يوجد مقبس — الإشارة محفوظة لإعادة المحاولة: ' + direction + ' | ' + asset, 'error');
        return;
      }
      const action = direction === 'BUY' ? 'call' : 'put';
      const amt = overrideAmount || tradeAmount;
      const safeAmt = _safeAmount(amt);
      const tradeSec = _snapTradeDuration(_tradeDuration || (candlePeriod || 3));
      const rid = _nextReqId();

      if (!_payloadCache.prefixCall) _rebuildPayloadCache();
      const prefix = action === 'call' ? _payloadCache.prefixCall : _payloadCache.prefixPut;
      const suffix = action === 'call' ? _payloadCache.suffixCall : _payloadCache.suffixPut;
      const msg = prefix + rid + suffix;

      try {
        tradeWSOrig(msg);
        tradeExec = true;
        lastTradeMs = Date.now();
        // ✅ تحرير تلقائي لـ tradeExec بعد مدة الصفقة + 5 ثواني أمان
        if (_tradeExecTimeout) clearTimeout(_tradeExecTimeout);
        _tradeExecTimeout = setTimeout(() => {
          if (tradeExec) {
            tradeExec = false;
            addLog('⏰ [DUAL-EXEC] تحرير تلقائي — لم تأتِ نتيجة خلال ' + (tradeSec + 5) + 'ث', 'info');
            updateTradeBtn();
          }
        }, (tradeSec + 5) * 1000);
        // تهدهة تكيفية حسب مدة الشمعة
        _cooldownUntil = Date.now() + getAdaptiveCooldown();
        // قفل الشمعة الحالية
        _lastTradeCandleKey = _getCandleKey(asset);
        PERF.mark('orderSent');
        _tradeCount++;
        _pendingTradeRecord = { asset: asset || activeAsset, direction, amount: safeAmt, openTs: Date.now(), source: 'dualWSS' };
        try { const _la = normalizeAsset(asset || activeAsset); const _tb = tickBuffers[_la]; _pendingTradeRecord.lab = OracleLab.snapshot(_la, direction); _pendingTradeRecord.openPrice = (_tb && _tb.length) ? _tb[_tb.length-1] : 0; } catch(_) {}  // [V16] لقطة مختبر الأوراكل (مسار DUAL)
        // ✅ تحديث سعر آخر صفقة
        _lastTradePrice = _lastSignal ? _lastSignal.price : 0;
        // ✅ مسح الإشارة المعلقة بعد التنفيذ الناجح
        _pendingRetrySignal = null;
        addLog('⚡ [DUAL-EXEC] ' + direction + ' | ' + (asset || activeAsset) + ' | $' + safeAmt + ' | ' + tradeSec + 'ث', 'signal');
        updateTradeBtn();
      } catch(err) {
        addLog('❌ [DUAL-WSS] فشل إرسال الأمر: ' + err.message, 'error');
        // ✅ حفظ الإشارة للإعادة
        _pendingRetrySignal = { direction, asset, timestamp: Date.now() };
      }
    }

    // ─── حساب التأخير الاصطناعي ────────────────────────────────────────
    function _getSyntheticDelay() {
      if (_latencyGap >= CFG.DUAL_WSS_MIN_GAP_MS) return 0;
      return Math.round(CFG.DUAL_WSS_SYNTHETIC_DELAY * 0.3);
    }

    // ─── تحديث اتجاه HUD ──────────────────────────────────────────────
    function _updateTrendHUD() {
      const trendEl = W.document.getElementById('cbTrendVal');
      if (trendEl) {
        const labels = { 'UP': 'صعود ↑', 'DOWN': 'هبوط ↓', 'NEUTRAL': 'محايد ↔' };
        const colors = { 'UP': '#00d264', 'DOWN': '#ff3755', 'NEUTRAL': '#ffb020' };
        trendEl.textContent = labels[_lastTrendDirection] || '–';
        trendEl.style.color = colors[_lastTrendDirection] || '#999';
      }
    }

    // ─── تحديث واجهة Dual-WSS في HUD ──────────────────────────────────
    function _refreshDualWSSHUD() {
      const oracleEl = W.document.getElementById('cbDwOracle');
      const execEl = W.document.getElementById('cbDwExec');
      const gapEl = W.document.getElementById('cbDwGap');
      const statusEl = W.document.getElementById('cbDwStatus');
      const signalEl = W.document.getElementById('cbDwSignal');

      if (oracleEl) {
        const oracleOk = !!_oracleSocket && _oracleSocket.readyState === 1;
        oracleEl.textContent = oracleOk ? 'متصل' : '–';
        oracleEl.style.color = oracleOk ? '#00d264' : '#999';
      }
      if (execEl) {
        // مع تجمع المقابس: اعرض العدد النشط
        if (CFG.WS_EXEC_POOL_ENABLED) {
          const aliveCount = [..._executorPool.values()].filter(i => i.authed).length;
          const execOk = !!_executorSocket && _executorSocket.readyState === 1;
          execEl.textContent = execOk ? 'متصل (' + aliveCount + ')' : (aliveCount > 0 ? aliveCount + ' في الانتظار' : '–');
          execEl.style.color = execOk ? '#00d264' : (aliveCount > 0 ? '#ffb020' : '#999');
        } else {
          const execOk = !!_executorSocket && _executorSocket.readyState === 1;
          execEl.textContent = execOk ? 'متصل' : '–';
          execEl.style.color = execOk ? '#00d264' : '#999';
        }
      }
      if (gapEl) {
        const absGap = Math.abs(_latencyGap);
        gapEl.textContent = absGap > 0 ? absGap.toFixed(0) + 'ms' : '–';
        gapEl.style.color = _latencyGap >= CFG.DUAL_WSS_MIN_GAP_MS ? '#00d264' : '#ff3755';
      }
      if (statusEl) {
        const oracleOk = _oracleSocket && _oracleSocket.readyState === 1;
        const execOk = _executorSocket && _executorSocket.readyState === 1;
        if (oracleOk && execOk) {
          statusEl.textContent = '🟢 متصل';
          statusEl.style.color = '#00d264';
        } else if (oracleOk || execOk) {
          statusEl.textContent = '🟡 جزئي';
          statusEl.style.color = '#ffb020';
        } else {
          // تحقق من التجمع قبل الإعلان عن انقطاع كامل
          const poolAlive = CFG.WS_EXEC_POOL_ENABLED && [..._executorPool.values()].some(i => i.authed);
          if (poolAlive) {
            statusEl.textContent = '🟡 تجمع';
            statusEl.style.color = '#ffb020';
          } else {
            statusEl.textContent = '🔴 مفصول';
            statusEl.style.color = '#ff3755';
          }
        }
      }
      if (signalEl) {
        signalEl.textContent = _lastSignal ? (_lastSignal.direction + ' ' + _lastSignal.confidence + '%') : '–';
        signalEl.style.color = _lastSignal ? (_lastSignal.direction === 'BUY' ? '#00d264' : '#ff3755') : '#999';
      }
    }

    // ─── إيقاف النظام ──────────────────────────────────────────────────
    function shutdown() {
      _running = false;
      if (_queueTimer) { clearTimeout(_queueTimer); _queueTimer = null; }
      if (_entryTimer) { clearInterval(_entryTimer); _entryTimer = null; }
      _signalQueue = null;
      addLog('🔮 [DUAL-WSS] تم إيقاف النظام', 'info');
    }

    // ─── واجهة عامة ────────────────────────────────────────────────────
    return {
      init,
      shutdown,
      executeTrade: _executeDualTrade,
      getAdaptiveCooldown,
      isCooldownActive,
      registerSocket,
      unregisterSocket,
      recordMsgTs,
      recordOracleTick,
      oracleAgrees,
      onSignalsUpdate,
      onChatSignal,
      platformStrength,
      // [V16] حالة الأوراكل الخام لزوج (لمختبر الأوراكل والمولّد)
      oracleState: (asset) => {
        const a = normalizeAsset(asset);
        const cs = _chatSig[a], ps = _platSig[a], now = Date.now();
        return {
          chatDir: cs ? cs.dir : null,
          chatTf:  cs ? cs.tf : null,
          chatAge: cs ? (now - cs.ts) : null,
          platBest: platformStrength(a),
          platTf:  ps ? Object.assign({}, ps.tf) : {},
          platAge: ps ? (now - ps.ts) : null,
        };
      },
      onCandleClose,
      fastEval,
      onPlatformSignal,
      getLatencyGap:     () => _latencyGap,
      getLastSignal:     () => _lastSignal,
      getSignalCount:    () => _signalCount,
      getTradeCount:     () => _tradeCount,
      getGhostCount:     () => _ghostCount,
      isRecalibrating:   () => _recalibrating,
      isGhostActive:     () => _ghostTradeActive,
      getTrend:          () => _lastTrendDirection,
      isConnected:       () => (_oracleSocket && _oracleSocket.readyState === 1) && (_executorSocket && _executorSocket.readyState === 1),
      refreshHUD:        () => _refreshDualWSSHUD(),
      setMinConfidence:  (v) => { _minConfThreshold = Math.max(50, Math.min(95, v)); },
      getMinConfidence:  () => _minConfThreshold,
      // ═══ واجهة إدارة عدادات الحماية ═══
      getConsecutiveSameDir: () => _consecutiveSameDir,
      resetConsecutiveOnLoss: () => { _consecutiveSameDir = 0; _lastTradeDirection = null; },
      onTradeResult: (win, direction) => {
        // ✅ [V13.4] سجّل نتيجة النمط الحي للثقة التكيفية (النمط متاح في هذا النطاق)
        try {
          const _pat = (typeof _lastExecutedPattern === 'string' && _lastExecutedPattern)
            ? _lastExecutedPattern.split(':')[0] : null;
          if (_pat) {
            _recordPatternResult(_pat, win);
            const s = _patternWL[_pat];
            addLog('📊 [PATTERN-WL] ' + _pat + ' → ' + (win ? 'فوز' : 'خسارة') +
                   ' | الحي: ' + s.w + 'ف/' + s.l + 'خ', 'info');
          }
        } catch(_) {}
        if (!win) {
          // خسارة → إعادة تعيين العداد المتتالي (لأن الاتجاه فشل)
          _consecutiveSameDir = 0;
          _lastTradeDirection = null;
          addLog('📊 [CONSEC-RESET] إعادة تعيين العداد المتتالي — خسارة في اتجاه ' + (direction || '?'), 'info');
        }
        // فوز: لا نعيد التعيين — العداد يُحدّث في _processQueue
      },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════
  // § FINAL  Init Function (minimal)
  // ══════════════════════════════════════════════════════════════════════
  function _loadBrain() {} // stub — no prediction engine to load

  function init() {
    _loadBrain(); // stub - will be empty

    const boot = () => {
      if (boot.done) return; boot.done = true;
      initUI();
      DOMHealer.start();
      _startStreamWatchdog();
      _startWSHealthMonitor();  // ✅ مراقبة صحة المقابس السلبية
      if (CFG.DUAL_WSS_ENABLED) {
        DualWSSManager.init();
      }
      addLog('🔬 V13 QUANTUM SKELETON — Diagnostic Mode Active', 'signal');
      addLog('📡 WebSocket interception active — monitoring all traffic', 'info');
      addLog('🛡️ Socket Pool: ON | Self-PING: OFF | Health Monitor: ON', 'info');
      addLog('🔬 CoreDiagnostic engine running — ' + (CFG.DIAG_MAX_PACKETS || 1000) + ' packet buffer', 'info');
    };

    if (W.document.body) boot();
    else if (W.document.readyState !== 'loading') boot();
    else W.document.addEventListener('DOMContentLoaded', boot);
    setTimeout(boot, 1500);
  }

  init();

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
