#!/usr/bin/env bash
# Axiom Brain — SessionStart hook (نسخة موفّرة للتوكن)
# مُحسَّن لـ Anthropic Prompt Caching:
# الترتيب مهم: الأكثر ثباتاً أولاً، الأكثر تغيراً أخيراً — الكاش يحفظ
# أطول prefix متطابق byte-by-byte عبر الجلسات.
set -u

BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
AXIOM_DIR="$HOME/.claude/axiom"

cat > /dev/null  # استهلاك JSON من Claude Code

# 1) مزامنة العقل من GitHub (مهلة قصيرة)
if [ -d "$BRAIN_DIR/.git" ]; then
  (cd "$BRAIN_DIR" && timeout 10 git pull --rebase --quiet 2>/dev/null) || true
fi

# 2) بناء ذكي لفهرس المهارات — لا نعيد البناء إلا إذا تغير SKILL.md فعلياً
IDX_TSV="$BRAIN_DIR/skills-index.tsv"
need_rebuild=1
if [ -f "$IDX_TSV" ]; then
  idx_mtime=$(stat -c %Y "$IDX_TSV" 2>/dev/null || stat -f %m "$IDX_TSV" 2>/dev/null || echo 0)
  # ابحث عن أي SKILL.md أحدث من الفهرس (خروج فوراً عند أول تطابق)
  newer=$(find "$HOME/.claude/skills" "$HOME/.claude/core/skills" "$HOME/.claude/plugins" \
    -name 'SKILL.md' -newer "$IDX_TSV" -print -quit 2>/dev/null)
  [ -z "$newer" ] && need_rebuild=0
fi
if [ "$need_rebuild" = "1" ]; then
  "$AXIOM_DIR/scripts/build-skill-index.sh" >/dev/null 2>&1 || true
fi

# 3) تنظيف markers قديمة (>1 يوم) — لا نتركها تتراكم
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'axiom-router-*' -mtime +1 -delete 2>/dev/null || true

# ────────────────────────────────────────────────────────────────────────
# ⚡ ترتيب الحقن مُحسَّن لـ Prompt Caching:
#    ثابت أولاً (Header) → مستقر (USER) → مستقر (MEMORY) → متغير (HISTORY)
#    الجزء المتغير في النهاية → cache prefix أطول → توفير 70-90%.
# ────────────────────────────────────────────────────────────────────────

# — الترويسة (ثابتة عبر كل الجلسات) —
cat <<'HDR'
═══ Axiom Brain — ذاكرة محقونة تلقائياً من العقل الثاني ═══

هذه ذاكرة دائمة من جلسات سابقة. اعتبرها حقائق ثابتة عن المستخدم
ودروساً مؤكدة — لا تعيد التساؤل عنها.

HDR

# — USER.md (ثابت نسبياً — يتغير ~مرة/أسبوع) —
if [ -f "$BRAIN_DIR/USER.md" ]; then
  echo "--- USER.md (ملف المستخدم) ---"
  head -c 4000 "$BRAIN_DIR/USER.md"
  echo
fi

# — MEMORY.md (شبه ثابت — يتغير ~مرة/جلسة) —
if [ -f "$BRAIN_DIR/MEMORY.md" ]; then
  echo "--- MEMORY.md (دروس دائمة) ---"
  head -c 6000 "$BRAIN_DIR/MEMORY.md"
  echo
fi

# — HISTORY (متغير كل جلسة — في النهاية عمداً لعدم إبطال الكاش) —
if [ -d "$BRAIN_DIR/HISTORY" ]; then
  recent=$(ls -1t "$BRAIN_DIR/HISTORY"/*.md 2>/dev/null | head -3)
  if [ -n "$recent" ]; then
    echo "--- آخر جلسات (سياق حديث) ---"
    for f in $recent; do
      echo "• $(basename "$f" .md):"
      head -c 800 "$f"
      echo
    done
  fi
fi

echo "═══ نهاية ذاكرة Axiom Brain ═══"
exit 0
