#!/usr/bin/env bash
# Axiom Brain — UserPromptSubmit hook (الراوتر الذكي)
# يعمل مع كل طلب تكتبه:
#   1. أول طلب في الجلسة: يحقن فهرس المهارات الكامل + سياسة التوجيه التلقائي.
#   2. كل طلب: يحسب أفضل المهارات المرشحة لطلبك ويقترحها على كلود فوراً.
# الذكاء الفعلي في الاختيار يبقى عند كلود نفسه — الهوك يضمن فقط أن الفهرس
# أمام عينه دائماً وأن المرشحين الأقرب مُبرَزون، بدل ما تناديه بالاسم.
set -u

BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
IDX_TSV="$BRAIN_DIR/skills-index.tsv"
IDX_MD="$BRAIN_DIR/SKILLS-INDEX.md"

command -v jq >/dev/null 2>&1 || exit 0
[ -f "$IDX_TSV" ] || exit 0

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty')
session=$(printf '%s' "$input" | jq -r '.session_id // "nosession"')
[ -n "$prompt" ] || exit 0

marker="${TMPDIR:-/tmp}/axiom-router-${session}"

# ── 1) حقن الفهرس الكامل مرة واحدة لكل جلسة ─────────────────────────────
if [ ! -f "$marker" ]; then
  : > "$marker"
  echo "[Axiom Router] سياسة إلزامية لهذه الجلسة:"
  echo "قبل تنفيذ أي طلب، حلل نيّته وقارنها بفهرس المهارات أدناه."
  echo "إذا طابقت مهارةٌ نيةَ الطلب — استدعها فوراً عبر أداة Skill دون أن"
  echo "يذكر المستخدم اسمها. لا تنفذ يدوياً عملاً توجد له مهارة جاهزة."
  echo "إذا لم تطابق أي مهارة، تابع طبيعياً بدون ذكر الفهرس."
  echo
  cat "$IDX_MD" 2>/dev/null
  echo
fi

# ── 2) ترشيح أفضل 3 مهارات لهذا الطلب (مطابقة كلمات خفيفة وسريعة) ────────
# نفصل كلمات الطلب (عربي/إنجليزي)، نتجاهل القصيرة، ونحسب كم كلمة تظهر
# في اسم/وصف كل مهارة. هذا ترشيح أولي فقط — القرار النهائي لكلود.
prompt_lc=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]' | head -c 2000)

shortlist=$(awk -v P="$prompt_lc" -F'\t' '
  BEGIN {
    n = split(P, w, /[^[:alnum:]\x80-\xFF]+/)
  }
  {
    line = tolower($1 " " $2)
    s = 0
    for (i = 1; i <= n; i++) {
      if (length(w[i]) >= 4 && index(line, w[i]) > 0) s++
    }
    if (s > 0) {
      d = $2
      if (length(d) > 110) d = substr(d, 1, 110) "…"
      printf "%d\t%s — %s\n", s, $1, d
    }
  }
' "$IDX_TSV" | sort -t$'\t' -k1,1 -rn | head -3 | cut -f2-)

if [ -n "$shortlist" ]; then
  echo "[Axiom Router] مهارات مرشحة لهذا الطلب — قيّمها، وإن ناسبت إحداها استدعها عبر أداة Skill الآن:"
  printf '%s\n' "$shortlist" | sed 's/^/  • /'
else
  # لا مطابقة محلية — لمّح لكلود بإمكانية البحث الخارجي (بدون فرض)
  # المفتاح: طلب متعدد الخطوات ذو بنية "مهارة" يستحق البحث. الاستفسارات
  # القصيرة والأسئلة العابرة لا تستحق.
  wc=$(printf '%s' "$prompt" | wc -w)
  if [ "$wc" -ge 8 ]; then
    echo "[Axiom Router] لا مهارة محلية تطابق. إن بدا الطلب متكرر البنية،"
    echo "  فكّر باستدعاء مهارة axiom-skill-scout للبحث عن مهارة جاهزة على GitHub."
  fi
fi

exit 0
