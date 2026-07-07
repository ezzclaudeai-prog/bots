#!/usr/bin/env bash
# Axiom Brain — التأمل التفاضلي (Delta Reflection)
# نسخة Claude Code من حلقة التعلم في Hermes Agent، محسّنة:
# لا يعيد قراءة الترانسكربت من الصفر — فقط الجزء الجديد منذ آخر تأمل.
# يوفّر ~60% من تكلفة Haiku مقارنة بالنسخة التي تعيد قراءة كل شيء.
set -u

# ⚡ إصلاح Termux/proot: PATH فارغ في الهوكات الخلفية — أعده صريحاً
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"

TRANSCRIPT="${1:-}"
SESSION="${2:-unknown}"
AXIOM_DIR="$HOME/.claude/axiom"
BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
LOCK="$AXIOM_DIR/reflect.lock"
STATE_DIR="$AXIOM_DIR/state"
MODEL="${AXIOM_REFLECT_MODEL:-haiku}"   # نموذج رخيص وسريع للتأمل
MIN_NEW_BYTES=8000                       # لا تتأمل إلا إذا نما الحوار بما يكفي

[ -f "$TRANSCRIPT" ] || exit 0
command -v jq     >/dev/null 2>&1 || exit 0
command -v claude >/dev/null 2>&1 || exit 0
[ -d "$BRAIN_DIR" ] || exit 0

# قفل ذري: تأمل واحد فقط في نفس الوقت
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# ── التأمل التفاضلي: اقرأ فقط ما هو جديد منذ آخر تأمل ─────────────────
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/${SESSION}.last"
size=$(wc -c < "$TRANSCRIPT")
last_offset=$(cat "$STATE_FILE" 2>/dev/null | awk 'NR==1' || echo 0)
last_offset=${last_offset:-0}
delta=$((size - last_offset))
[ "$delta" -lt "$MIN_NEW_BYTES" ] && exit 0

echo "[$(date '+%F %T')] reflect: session=$SESSION delta=$delta/$size"

# اقرأ فقط الأسطر الجديدة (الترانسكربت JSONL — سطر لكل حدث)
new_lines=$(tail -c "$delta" "$TRANSCRIPT" 2>/dev/null)

# احفظ الحجم الجديد لهذه الجلسة (سيصبح offset التأمل التالي)
echo "$size" > "$STATE_FILE"

# استخرج فقط أسطر المحادثة الجديدة
convo=$(printf '%s' "$new_lines" | jq -r '
  select(.type == "user" or .type == "assistant") |
  (if .type == "user" then "👤 المستخدم: " else "🤖 كلود: " end) +
  ( .message.content
    | if type == "array"
      then map(select(.type? == "text") | .text) | join("\n")
      elif type == "string" then .
      else "" end )
' 2>/dev/null | grep -v '^\(👤 المستخدم: \|🤖 كلود: \)$' | tail -c 24000)

[ -n "$convo" ] || exit 0

skills_index=$(head -c 8000 "$BRAIN_DIR/skills-index.tsv" 2>/dev/null || echo "")

# ── مطالبة التأمل ────────────────────────────────────────────────────────
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" <<EOF
أنت "وحدة التعلم" في نظام Axiom Brain. أمامك مقتطف من محادثة بين المستخدم
وكلود كود. مهمتك تحديث ملفات العقل الثاني في المجلد الحالي ($BRAIN_DIR).

نفّذ التالي بدقة وباستخدام أدوات Read/Write/Edit فقط:

1. **MEMORY.md** — اقرأه ثم ادمج فيه أي "درس دائم" جديد من المحادثة:
   تصحيح صحّحه المستخدم، طريقة عمل فضّلها، خطأ تكرر وحلّه، قرار تقني ثابت.
   قواعد: سطر واحد لكل درس، لا تكرار، احذف الأقدم إذا تجاوز الملف 60 سطراً،
   لا تسجل تفاصيل عابرة تخص مهمة واحدة فقط.

2. **USER.md** — حدّثه فقط إذا ظهرت معلومة ثابتة عن المستخدم نفسه:
   لغته، أسلوبه المفضل، مشاريعه، أدواته، مستواه التقني. حد أقصى 40 سطراً.

3. **HISTORY/$(date +%Y-%m-%d-%H%M)-${SESSION:0:8}.md** — أنشئه وفيه ملخص
   من 5-10 أسطر: ماذا طلب المستخدم، ماذا أُنجز، أهم القرارات، وأي شيء
   ناقص يجب تذكره في جلسة قادمة.

4. **مهارة جديدة (اختياري وبتحفظ)** — فقط إذا احتوت المحادثة سير عمل
   متعدد الخطوات نجح ويُرجَّح تكراره، وغير مغطى بأي مهارة في الفهرس أدناه:
   أنشئ $HOME/.claude/skills/learned-<اسم-قصير-بالإنجليزية>/SKILL.md
   بفرونت ماتر فيه name و description (اكتب الوصف بالعربية والإنجليزية معاً
   مع كلمات مفتاحية تساعد على تفعيلها تلقائياً)، ثم أقسام:
   "متى تُستخدم"، "الخطوات"، "أخطاء شائعة"، "التحقق من النجاح".
   لا تنشئ مهارة لعمل بسيط أو لمرة واحدة.

5. **ممنوع منعاً باتاً**: كتابة أي أسرار أو توكنات أو مفاتيح API أو كلمات
   مرور في أي ملف، حتى لو ظهرت في المحادثة.

فهرس المهارات الحالي (اسم<TAB>وصف):
${skills_index}

مقتطف المحادثة:
=======================
${convo}
=======================

إذا لم يوجد شيء يستحق الحفظ في بند ما، اتركه دون تغيير. اعمل بصمت.
EOF

# ── تشغيل التأمل ─────────────────────────────────────────────────────────
cd "$BRAIN_DIR" || exit 0
AXIOM_REFLECTING=1 claude -p "$(cat "$PROMPT_FILE")" \
  --model "$MODEL" \
  --allowedTools "Read,Write,Edit" \
  >/dev/null 2>&1
rm -f "$PROMPT_FILE"

# ── المزامنة مع GitHub (العقل الثاني) ────────────────────────────────────
if [ -d "$BRAIN_DIR/.git" ]; then
  cd "$BRAIN_DIR"
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m "brain: reflection $(date '+%F %H:%M') [${SESSION:0:8}]"
    if git remote get-url origin >/dev/null 2>&1; then
      for delay in 2 4 8 16; do
        git pull --rebase -q 2>/dev/null
        git push -q origin HEAD && break
        sleep "$delay"
      done
    fi
  fi
fi

echo "[$(date '+%F %T')] reflect: done"
