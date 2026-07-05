#!/usr/bin/env bash
# Axiom Brain — بناء فهرس المهارات
# يمسح كل مجلدات المهارات (الشخصية + الإضافات) ويستخرج الاسم والوصف من
# الفرونت ماتر في SKILL.md ثم يكتب فهرساً مضغوطاً يستخدمه الراوتر.
set -u

BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
OUT_TSV="$BRAIN_DIR/skills-index.tsv"
OUT_MD="$BRAIN_DIR/SKILLS-INDEX.md"
MAX_DESC=280   # حد أقصى لطول الوصف في الفهرس حتى يبقى خفيفاً على السياق

mkdir -p "$BRAIN_DIR"
tmp="$(mktemp)"

# مواقع المهارات: الشخصية + المشاريع + الإضافات + core (يظهر في نسخة أكسيوم)
{
  find "$HOME/.claude/skills"      -maxdepth 3 -name 'SKILL.md' 2>/dev/null
  find "$HOME/.claude/core/skills" -maxdepth 3 -name 'SKILL.md' 2>/dev/null
  find "$HOME/.claude/plugins"     -maxdepth 8 -path '*/skills/*/SKILL.md' 2>/dev/null
} | sort -u | while IFS= read -r f; do
  # استخراج name و description من الفرونت ماتر (يدعم القيم متعددة الأسطر >- و |)
  name=$(awk '
    /^---[[:space:]]*$/ { fm++; if (fm==2) exit; next }
    fm==1 && /^name:[[:space:]]*/ { sub(/^name:[[:space:]]*/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit }
  ' "$f")
  desc=$(awk '
    /^---[[:space:]]*$/ { fm++; if (fm==2) { if (buf) print buf; exit }; next }
    fm==1 && block {
      if ($0 ~ /^[[:space:]]+[^[:space:]]/) { line=$0; gsub(/^[[:space:]]+/,"",line); buf = buf (buf?" ":"") line; next }
      else { print buf; exit }
    }
    fm==1 && /^description:[[:space:]]*[>|]/ { block=1; next }
    fm==1 && /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/,""); gsub(/^["'\'']|["'\'']$/,""); print; exit
    }
  ' "$f")

  [ -n "$name" ] || name=$(basename "$(dirname "$f")")
  [ -n "$desc" ] || desc="(بدون وصف — يُنصح بإضافة description لهذه المهارة)"

  # قصّ الوصف الطويل
  if [ "${#desc}" -gt "$MAX_DESC" ]; then
    desc="${desc:0:$MAX_DESC}…"
  fi
  # إزالة أي تابات حتى لا تكسر صيغة TSV
  name=${name//$'\t'/ }
  desc=${desc//$'\t'/ }
  printf '%s\t%s\t%s\n' "$name" "$desc" "$f"
done > "$tmp"

mv "$tmp" "$OUT_TSV"

{
  echo "# فهرس المهارات — يُبنى تلقائياً عند بداية كل جلسة"
  echo
  echo "عدد المهارات: $(wc -l < "$OUT_TSV" | tr -d ' ')"
  echo
  while IFS=$'\t' read -r n d _; do
    echo "- **$n** — $d"
  done < "$OUT_TSV"
} > "$OUT_MD"

echo "تم بناء الفهرس: $(wc -l < "$OUT_TSV" | tr -d ' ') مهارة → $OUT_MD"
