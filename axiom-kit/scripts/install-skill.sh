#!/usr/bin/env bash
# Axiom Brain — مثبّت مهارات آمن من GitHub
# التشغيل:  install-skill.sh <owner/repo> [<subpath>]
# يستنسخ مجلد مهارة واحداً فقط (sparse-checkout) بعد:
#   1. التأكد أن المستودع في sources.txt الموثوقة (أو يطلب موافقة)
#   2. عرض SKILL.md للمراجعة
#   3. تثبيته في ~/.claude/skills/external-<repo>-<skill>/
#   4. إعادة بناء الفهرس فوراً
set -u

REPO="${1:-}"
SUBPATH="${2:-}"
if [ -z "$REPO" ]; then
  echo "الاستخدام: $0 <owner/repo> [<subpath>]"
  echo "مثال:    $0 anthropics/skills docx-editor"
  echo "         $0 anthropics/skills skills/document-creation/xlsx"
  exit 2
fi

AXIOM_DIR="$HOME/.claude/axiom"
SOURCES="$AXIOM_DIR/sources.txt"
SKILLS_ROOT="$HOME/.claude/skills"
mkdir -p "$SKILLS_ROOT"

# ── 1) فحص الثقة ─────────────────────────────────────────────────────────
trusted=0
if [ -f "$SOURCES" ] && grep -qxF "$REPO" "$SOURCES"; then
  trusted=1
fi

if [ "$trusted" -eq 0 ]; then
  echo "⚠️ المستودع $REPO ليس في مصادرك الموثوقة ($SOURCES)"
  echo "المصادر الموثوقة حالياً:"
  grep -vE '^[[:space:]]*(#|$)' "$SOURCES" 2>/dev/null | sed 's/^/  • /'
  echo
  read -r -p "هل تثق بهذا المستودع وتريد التثبيت؟ [y/N/add] " ans
  case "$ans" in
    [Yy]*) : ;;
    add|ADD)
      echo "$REPO" >> "$SOURCES"
      echo "✅ أُضيف إلى sources.txt"
      ;;
    *) echo "أُلغي التثبيت."; exit 1 ;;
  esac
fi

# ── 2) استنساخ مبعثر ─────────────────────────────────────────────────────
tmp_clone=$(mktemp -d)
trap 'rm -rf "$tmp_clone"' EXIT

echo "📥 استنساخ $REPO (مبعثر — فقط ما تحتاج)"
if ! git clone --filter=blob:none --no-checkout --depth=1 \
     "https://github.com/$REPO.git" "$tmp_clone" 2>/dev/null; then
  echo "❌ فشل الاستنساخ. تحقق من اسم المستودع أو الاتصال."
  exit 1
fi

cd "$tmp_clone"
git sparse-checkout init --cone 2>/dev/null || git sparse-checkout init

# لو ما تُحدَّد subpath، حاول اكتشاف أول مجلد فيه SKILL.md
if [ -z "$SUBPATH" ]; then
  git ls-tree --name-only -r HEAD | grep -m1 'SKILL\.md$' > /tmp/axf_sk.$$ || true
  first_skill=$(cat /tmp/axf_sk.$$ 2>/dev/null); rm -f /tmp/axf_sk.$$
  if [ -z "$first_skill" ]; then
    echo "❌ لا يوجد SKILL.md في $REPO"
    exit 1
  fi
  SUBPATH=$(dirname "$first_skill")
fi

git sparse-checkout set "$SUBPATH" 2>/dev/null
git checkout HEAD -- "$SUBPATH" 2>/dev/null || {
  echo "❌ المسار $SUBPATH غير موجود في $REPO"
  exit 1
}

skill_src="$tmp_clone/$SUBPATH"
skill_md="$skill_src/SKILL.md"
if [ ! -f "$skill_md" ]; then
  echo "❌ $SUBPATH لا يحتوي SKILL.md"
  exit 1
fi

# ── 3) عرض SKILL.md للمراجعة ─────────────────────────────────────────────
echo
echo "═══ SKILL.md من $REPO/$SUBPATH ═══"
head -80 "$skill_md"
echo "..."
echo "═══════════════════════════════════════"
echo

read -r -p "تثبيت هذه المهارة؟ [y/N] " ans
[ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ] || { echo "أُلغي."; exit 0; }

# ── 4) نسخ إلى ~/.claude/skills/ ─────────────────────────────────────────
skill_name=$(basename "$SUBPATH")
repo_slug=$(echo "$REPO" | tr '/' '-')
dest="$SKILLS_ROOT/external-${repo_slug}-${skill_name}"

if [ -d "$dest" ]; then
  read -r -p "المهارة موجودة مسبقاً ($dest) — استبدال؟ [y/N] " ans
  [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ] || { echo "أُلغي."; exit 0; }
  rm -rf "$dest"
fi

cp -r "$skill_src" "$dest"
echo "✅ ثُبِّتت في $dest"

# ── 5) أعد بناء الفهرس ──────────────────────────────────────────────────
"$AXIOM_DIR/scripts/build-skill-index.sh" >/dev/null 2>&1 && \
  echo "✅ فهرس المهارات محدَّث."

echo
echo "المهارة جاهزة للاستخدام في الجلسة التالية."
