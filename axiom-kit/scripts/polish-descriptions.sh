#!/usr/bin/env bash
# Axiom Brain — تحسين أوصاف المهارات
# يمر على كل مهارة، ويكتشف أي وصف ناقص أو ضعيف، ويقترح وصفاً أفضل
# باستخدام محتوى SKILL.md نفسه (بلا اتصال بالنموذج — تحليل نصي محلي).
# اختياري: مرّر --auto لتطبيق الاقتراحات تلقائياً، افتراضياً يقترح فقط.
set -u

MODE="${1:-review}"   # review | auto
MIN_LEN=40

fix_one() {
  local skill_dir="$1"
  local file="$skill_dir/SKILL.md"
  [ -f "$file" ] || return
  local name=$(basename "$skill_dir")

  # استخراج الوصف الحالي (نفس منطق build-skill-index — يدعم القيم متعددة الأسطر)
  local desc=$(awk '
    /^---[[:space:]]*$/ { fm++; if (fm==2) { if (buf) print buf; exit }; next }
    fm==1 && block {
      if ($0 ~ /^[[:space:]]+[^[:space:]]/) { line=$0; gsub(/^[[:space:]]+/,"",line); buf = buf (buf?" ":"") line; next }
      else { print buf; exit }
    }
    fm==1 && /^description:[[:space:]]*[>|]/ { block=1; next }
    fm==1 && /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit
    }
  ' "$file")

  local len=${#desc}
  local reason=""
  if [ -z "$desc" ]; then reason="بدون وصف"
  elif [ "$len" -lt "$MIN_LEN" ]; then reason="وصف قصير جداً ($len حرف)"
  else return
  fi

  # استخراج بديل من محتوى الملف: أول سطر H1 + أول فقرة معنوية
  local body_desc=$(awk '
    BEGIN { fm=0 }
    /^---[[:space:]]*$/ { fm++; next }
    fm >= 2 {
      if ($0 ~ /^#/) { sub(/^#+[[:space:]]*/,""); print; exit }
    }
  ' "$file" | head -c 200)

  local first_para=$(awk '
    BEGIN { fm=0 }
    /^---[[:space:]]*$/ { fm++; next }
    fm >= 2 && NF > 5 && !/^#/ && !/^```/ { print; exit }
  ' "$file" | head -c 300)

  cat <<EOF

── $name  ($reason) ──
  الوصف الحالي: ${desc:-(فارغ)}
  اقتراح مبني على محتوى الملف:
    العنوان في الملف : ${body_desc:-(لا يوجد)}
    أول فقرة        : ${first_para:-(لا يوجد)}
EOF

  if [ "$MODE" = "auto" ] && [ -n "$first_para$body_desc" ]; then
    # ادمج العنوان مع أول فقرة لوصف أكثر ثراءً
    local new_desc
    if [ -n "$body_desc" ] && [ -n "$first_para" ]; then
      new_desc="$body_desc — $first_para"
    else
      new_desc="${body_desc:-$first_para}"
    fi
    # قصّ عند حد معقول
    if [ ${#new_desc} -gt 250 ]; then new_desc="${new_desc:0:250}…"; fi
    # كتابة الوصف الجديد كسلسلة قصيرة صالحة لـ YAML
    local tmp=$(mktemp)
    awk -v D="$new_desc" '
      BEGIN { fm=0; written=0 }
      /^---[[:space:]]*$/ { fm++; print; next }
      fm==1 && /^description:/ && !written {
        gsub(/"/,"\\\"",D); print "description: \"" D "\""; written=1
        # تخطي أي أسطر تكملة قديمة
        while (getline line) {
          if (line ~ /^[[:space:]]+/) continue
          if (line ~ /^---[[:space:]]*$/) { fm++; print line; break }
          print line
        }
        next
      }
      { print }
    ' "$file" > "$tmp" && mv "$tmp" "$file"
    echo "  ✅ طُبِّق"
  fi
}

SKILL_ROOTS=(
  "$HOME/.claude/skills"
  "$HOME/.claude/core/skills"
)

echo "Axiom — تحسين أوصاف المهارات (المسار: $MODE)"
[ "$MODE" = "auto" ] || echo "لتطبيق الاقتراحات: bash $0 auto"

count=0
for root in "${SKILL_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    fix_one "$d"
    count=$((count+1))
  done
done

echo
echo "تم فحص $count مهارة."
if [ "$MODE" = "auto" ]; then
  echo "أعد بناء الفهرس الآن: bash \$HOME/.claude/axiom/scripts/build-skill-index.sh"
fi
