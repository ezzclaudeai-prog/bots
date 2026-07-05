#!/usr/bin/env bash
# Axiom Brain — البحث عن مهارات في مصادر خارجية موثوقة
# التشغيل:  discover-skills.sh "<وصف قصير للمهارة المطلوبة>"
# يعود بأفضل التطابقات (repo + مسار + سطرين وصف) دون تثبيت شيء —
# التثبيت الفعلي عبر install-skill.sh مع مراجعة المحتوى قبل الاعتماد.
set -u

QUERY="${*:-}"
if [ -z "$QUERY" ]; then
  echo "الاستخدام: $0 <وصف قصير لما تحتاجه>"
  echo "مثال:   $0 pdf export markdown"
  exit 2
fi

AXIOM_DIR="$HOME/.claude/axiom"
SOURCES="$AXIOM_DIR/sources.txt"
CACHE_DIR="$AXIOM_DIR/discovery-cache"
mkdir -p "$CACHE_DIR"

# مصادر افتراضية موثوقة — يعدلها المستخدم في sources.txt
if [ ! -f "$SOURCES" ]; then
  cat > "$SOURCES" <<'EOF'
# مصادر مهارات موثوقة — سطر لكل مستودع بصيغة owner/repo
# سيبحث فيها discover-skills.sh عن SKILL.md المطابقة لطلبك
# احذف/أضف حسب ثقتك — كل ما تضيفه تُقبل مهاراته للتثبيت التلقائي

anthropics/skills
obra/superpowers
hesreallyhim/awesome-claude-code
davila7/claude-code-templates
zebbern/claude-code-guide
EOF
fi

sources=$(grep -vE '^[[:space:]]*(#|$)' "$SOURCES")
[ -n "$sources" ] || { echo "❌ sources.txt فارغ — أضف مستودعات موثوقة"; exit 1; }

echo "🔍 البحث عن مهارة تطابق: \"$QUERY\""
echo "المصادر المُفحوصة:"
printf '  • %s\n' $sources
echo

# ── 1) بحث سريع عبر gh CLI (يشمل كل GitHub، ليس فقط sources.txt) ────────
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "── نتائج البحث الشامل عبر GitHub Code Search ──"
  gh api -X GET search/code \
    -f "q=path:SKILL.md $QUERY" \
    --jq '.items[] | "  📦 \(.repository.full_name)/\(.path)"' 2>/dev/null | head -8
  echo
fi

# ── 2) فحص المصادر الموثوقة سطراً سطراً (يعمل بلا gh أيضاً) ─────────────
echo "── تطابقات في المصادر الموثوقة ──"

# قسّم الطلب إلى كلمات مفيدة (≥ 3 حروف)
kw_pattern=$(printf '%s\n' $QUERY | awk 'length($0) >= 3' | tr '[:upper:]' '[:lower:]' | paste -sd'|')
[ -n "$kw_pattern" ] || { echo "الطلب قصير جداً للبحث"; exit 0; }

hits=0
for repo in $sources; do
  cache_file="$CACHE_DIR/$(echo "$repo" | tr '/' '_').txt"
  # حدّث الكاش إذا مضى أكثر من 6 ساعات
  if [ ! -f "$cache_file" ] || [ -n "$(find "$cache_file" -mmin +360 2>/dev/null)" ]; then
    # اسحب قائمة المسارات + رأس كل SKILL.md دون استنساخ كامل
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh api -X GET "repos/$repo/git/trees/HEAD?recursive=1" \
        --jq '.tree[] | select(.path | endswith("SKILL.md")) | .path' 2>/dev/null > "$cache_file" || true
    else
      # بديل بلا gh — من raw GitHub API
      default_branch=$(curl -sSL "https://api.github.com/repos/$repo" | grep -o '"default_branch":"[^"]*' | head -1 | cut -d'"' -f4)
      [ -n "$default_branch" ] || default_branch=main
      curl -sSL "https://api.github.com/repos/$repo/git/trees/$default_branch?recursive=1" 2>/dev/null \
        | grep -oE '"path":"[^"]*SKILL\.md"' | cut -d'"' -f4 > "$cache_file" || true
    fi
  fi

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    # اسم المهارة من اسم المجلد
    skill_name=$(basename "$(dirname "$path")")
    # طابق مع كلمات الطلب
    lower_path=$(echo "$repo/$path $skill_name" | tr '[:upper:]' '[:lower:]')
    if echo "$lower_path" | grep -qE "$kw_pattern"; then
      hits=$((hits+1))
      echo "  ✨ $repo — $skill_name"
      echo "     $path"
      echo "     تثبيت:  bash $AXIOM_DIR/scripts/install-skill.sh $repo \"$(dirname "$path")\""
      echo
      [ "$hits" -ge 8 ] && break 2
    fi
  done < "$cache_file"
done

if [ "$hits" -eq 0 ]; then
  echo "  لم يُعثر على تطابقات في المصادر الموثوقة."
  echo "  فكرة: أضف مستودعاً جديداً إلى $SOURCES ثم أعد المحاولة."
fi

echo
echo "⚠️ قبل التثبيت: راجع SKILL.md من رابط GitHub لكل مهارة — الكود من"
echo "   طرف خارجي وسيعمل داخل جلستك."
