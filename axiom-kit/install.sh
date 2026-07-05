#!/usr/bin/env bash
# Axiom Brain Kit — المثبّت
# يثبت نظام الذاكرة + الراوتر الذكي على Claude Code المحلي.
# التشغيل:  bash install.sh
# متغيرات اختيارية:
#   AXIOM_BRAIN_REMOTE=<رابط مستودع GitHub خاص>  لاستنساخ عقل موجود مسبقاً
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
AXIOM_DIR="$HOME/.claude/axiom"
BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
SETTINGS="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

command -v jq >/dev/null 2>&1 || {
  echo "❌ هذا النظام يتطلب jq. ثبّته أولاً:"
  echo "   macOS:  brew install jq    |    Linux: sudo apt install jq"
  exit 1
}
command -v git >/dev/null 2>&1 || { echo "❌ يتطلب git"; exit 1; }

# ── 1) نسخ ملفات النظام ──────────────────────────────────────────────────
say "تثبيت ملفات Axiom في $AXIOM_DIR"
mkdir -p "$AXIOM_DIR" "$HOME/.claude/skills"
cp -r "$KIT_DIR/hooks"   "$AXIOM_DIR/"
cp -r "$KIT_DIR/scripts" "$AXIOM_DIR/"
chmod +x "$AXIOM_DIR"/hooks/*.sh "$AXIOM_DIR"/scripts/*.sh

# نسخ ميتا-مهارة الاستكشاف الخارجي (يستدعيها كلود تلقائياً عبر الراوتر)
if [ -d "$KIT_DIR/skill-templates" ]; then
  for tmpl in "$KIT_DIR/skill-templates"/*/; do
    tmpl_name=$(basename "$tmpl")
    dest="$HOME/.claude/skills/$tmpl_name"
    if [ ! -d "$dest" ]; then
      cp -r "$tmpl" "$dest"
      echo "  📦 مهارة مثبتة: $tmpl_name"
    fi
  done
fi

# ── 2) تجهيز العقل الثاني ────────────────────────────────────────────────
if [ -d "$BRAIN_DIR/.git" ]; then
  say "العقل الثاني موجود مسبقاً في $BRAIN_DIR — لن يُلمس"
elif [ -n "${AXIOM_BRAIN_REMOTE:-}" ]; then
  say "استنساخ العقل الثاني من $AXIOM_BRAIN_REMOTE"
  git clone "$AXIOM_BRAIN_REMOTE" "$BRAIN_DIR"
else
  say "إنشاء عقل ثانٍ جديد في $BRAIN_DIR"
  mkdir -p "$BRAIN_DIR/HISTORY"
  cp -n "$KIT_DIR/brain-template/MEMORY.md" "$BRAIN_DIR/" 2>/dev/null || true
  cp -n "$KIT_DIR/brain-template/USER.md"   "$BRAIN_DIR/" 2>/dev/null || true
  git -C "$BRAIN_DIR" init -q -b main 2>/dev/null || git -C "$BRAIN_DIR" init -q
  git -C "$BRAIN_DIR" add -A
  git -C "$BRAIN_DIR" commit -q -m "brain: initial" 2>/dev/null || true

  if command -v gh >/dev/null 2>&1; then
    say "إنشاء مستودع خاص على GitHub باسم axiom-brain"
    if gh repo create axiom-brain --private --source "$BRAIN_DIR" --push 2>/dev/null; then
      echo "✅ تم الربط مع GitHub"
    else
      echo "⚠️ تعذر الإنشاء التلقائي (ربما المستودع موجود). اربطه يدوياً — انظر الخطوة الأخيرة."
    fi
  else
    echo "⚠️ gh غير مثبت — أنشئ مستودعاً خاصاً باسم axiom-brain على github.com ثم:"
    echo "   git -C $BRAIN_DIR remote add origin git@github.com:<USERNAME>/axiom-brain.git"
    echo "   git -C $BRAIN_DIR push -u origin main"
  fi
fi

# ── 3) دمج الهوكات في settings.json دون المساس بهوكاتك الحالية ──────────
say "دمج الهوكات في $SETTINGS"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.backup-axiom-$(date +%s)"

jq --slurpfile kit "$KIT_DIR/settings-hooks.json" '
  .hooks = (.hooks // {}) |
  reduce ($kit[0].hooks | to_entries[]) as $e (.;
    .hooks[$e.key] = (((.hooks[$e.key] // []) + $e.value) | unique_by(tojson))
  )
' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"

# تحذير من راوتر قديم مكرر — يفحص كل مسارات التخزين الشائعة للراوتر
old_routers=$(jq -r '[.hooks.UserPromptSubmit[]?.hooks[]?.command] | join("\n")' "$SETTINGS" \
   | grep -iv axiom | grep -iE 'router|skill.router|skill-router' || true)
if [ -n "$old_routers" ]; then
  echo "⚠️ اكتُشف راوتر قديم في settings.json (سيتعارض مع Axiom Router — عطّله يدوياً):"
  echo "$old_routers" | sed 's/^/     /'
  echo "   لتعطيله بسرعة: احذف السطر الخاص به من '$SETTINGS' ثم افتح جلسة جديدة."
fi

# ── 4) إضافة السياسات إلى CLAUDE.md ──────────────────────────────────────
say "إضافة سياسات Axiom إلى $CLAUDE_MD"
touch "$CLAUDE_MD"
if grep -q 'AXIOM-BRAIN:BEGIN' "$CLAUDE_MD"; then
  echo "موجودة مسبقاً — تخطي"
else
  cat "$KIT_DIR/claude-md-snippet.md" >> "$CLAUDE_MD"
fi

# ── 5) بناء فهرس المهارات لأول مرة ──────────────────────────────────────
say "بناء فهرس المهارات"
"$AXIOM_DIR/scripts/build-skill-index.sh"

say "اكتمل التثبيت ✅"
echo "افتح جلسة Claude Code جديدة وستلاحظ حقن الذاكرة والفهرس تلقائياً."
echo "سجلات التعلم: tail -f $AXIOM_DIR/logs/reflect.log"
