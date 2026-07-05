#!/usr/bin/env bash
# Axiom Brain — SessionStart hook
# يسحب أحدث نسخة من العقل الثاني (مستودع GitHub) ويحقن الذاكرة الدائمة
# وملف المستخدم وفهرس المهارات في سياق الجلسة الجديدة.
set -u

BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
AXIOM_DIR="$HOME/.claude/axiom"

# استهلاك مدخلات stdin (JSON من Claude Code) حتى لا يعلق الهوك
cat > /dev/null

# 1) مزامنة العقل من GitHub (بمهلة قصيرة حتى لا تتأخر الجلسة لو النت بطيء)
if [ -d "$BRAIN_DIR/.git" ]; then
  (cd "$BRAIN_DIR" && timeout 10 git pull --rebase --quiet 2>/dev/null) || true
fi

# 2) إعادة بناء فهرس المهارات (يلتقط أي مهارة جديدة أُضيفت أو تعلمها بنفسه)
"$AXIOM_DIR/scripts/build-skill-index.sh" >/dev/null 2>&1 || true

# 3) حقن الذاكرة في السياق — أي شيء يُطبع هنا يُضاف لسياق الجلسة
echo "═══ Axiom Brain — ذاكرة محقونة تلقائياً من العقل الثاني ═══"
echo

if [ -f "$BRAIN_DIR/MEMORY.md" ]; then
  echo "--- MEMORY.md (دروس تعلمتها من جلسات سابقة — التزم بها) ---"
  head -c 6000 "$BRAIN_DIR/MEMORY.md"
  echo
fi

if [ -f "$BRAIN_DIR/USER.md" ]; then
  echo "--- USER.md (ملف تعريف المستخدم — افهمه وتصرف وفقه) ---"
  head -c 4000 "$BRAIN_DIR/USER.md"
  echo
fi

# آخر 3 ملخصات جلسات (ذاكرة حدثية قريبة)
if [ -d "$BRAIN_DIR/HISTORY" ]; then
  recent=$(ls -1t "$BRAIN_DIR/HISTORY"/*.md 2>/dev/null | head -3)
  if [ -n "$recent" ]; then
    echo "--- آخر الجلسات (للسياق) ---"
    for f in $recent; do
      echo "• $(basename "$f" .md):"
      head -c 800 "$f"
      echo
    done
  fi
fi

echo "═══ نهاية ذاكرة Axiom Brain ═══"
exit 0
