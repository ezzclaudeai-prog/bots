#!/usr/bin/env bash
# Axiom Brain Kit — إلغاء التثبيت الآمن
# يستعيد settings.json من آخر نسخة احتياطية أخذها المثبّت، ويحذف ملفات
# النظام، ويحافظ على مستودع العقل الثاني (المستخدم يحذفه يدوياً إن أراد).
set -u

AXIOM_DIR="$HOME/.claude/axiom"
BRAIN_DIR="${AXIOM_BRAIN_DIR:-$HOME/.claude/brain}"
SETTINGS="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

say "استعادة settings.json من أحدث نسخة احتياطية"
latest_backup=$(ls -1t "$SETTINGS.backup-axiom-"* 2>/dev/null | head -1)
if [ -n "$latest_backup" ]; then
  cp "$SETTINGS" "$SETTINGS.pre-uninstall-$(date +%s)"
  cp "$latest_backup" "$SETTINGS"
  echo "✅ استُعيد من $latest_backup"
  echo "   (نسخة ما قبل الإلغاء محفوظة كـ .pre-uninstall-*)"
else
  echo "⚠️ لم أجد نسخة احتياطية — إزالة هوكات Axiom يدوياً من $SETTINGS"
  if command -v jq >/dev/null 2>&1; then
    jq '
      .hooks |= (
        with_entries(
          .value |= map(
            .hooks |= map(select(.command | test("axiom") | not))
          ) | map(select(.hooks | length > 0))
        )
      )
    ' "$SETTINGS" > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
    echo "✅ أُزيلت هوكات Axiom من settings.json"
  fi
fi

say "إزالة قسم Axiom من CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q 'AXIOM-BRAIN:BEGIN' "$CLAUDE_MD"; then
  awk '/AXIOM-BRAIN:BEGIN/{skip=1} !skip; /AXIOM-BRAIN:END/{skip=0; next}' "$CLAUDE_MD" > "$CLAUDE_MD.tmp"
  mv "$CLAUDE_MD.tmp" "$CLAUDE_MD"
  echo "✅ أُزيل قسم السياسة"
fi

say "حذف ملفات نظام Axiom في $AXIOM_DIR"
if [ -d "$AXIOM_DIR" ]; then
  # نقل بدل الحذف — يمكن استرجاعه إن اقتضى الأمر
  mv "$AXIOM_DIR" "$AXIOM_DIR.removed-$(date +%s)"
  echo "✅ نُقلت إلى $AXIOM_DIR.removed-* (احذفها يدوياً عندما تتأكد)"
fi

say "إزالة مهارة axiom-skill-scout إن كانت مثبّتة"
scout="$HOME/.claude/skills/axiom-skill-scout"
if [ -d "$scout" ]; then
  mv "$scout" "$scout.removed-$(date +%s)"
  echo "✅ نُقلت"
fi

say "العقل الثاني في $BRAIN_DIR — لم يُلمس"
echo "   بياناتك محفوظة. لحذفها: rm -rf $BRAIN_DIR"
echo "   لحذف المستودع من GitHub: gh repo delete <USERNAME>/axiom-brain"

echo
echo "✅ اكتمل إلغاء التثبيت. افتح جلسة جديدة للتحقق."
