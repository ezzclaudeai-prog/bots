#!/usr/bin/env bash
# Axiom Brain — Stop hook (بوابة التعلم)
# يعمل بعد كل رد يُنهيه كلود. لا يعطّل تجربتك إطلاقاً: كل ما يفعله هو إطلاق
# عملية "تأمل" (reflection) في الخلفية تقرأ المحادثة وتحدّث العقل الثاني.
set -u

AXIOM_DIR="$HOME/.claude/axiom"

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

# لا تتأمل داخل جلسة تأمل (حماية من حلقة لا نهائية)
[ -n "${AXIOM_REFLECTING:-}" ] && exit 0

stop_active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
[ "$stop_active" = "true" ] && exit 0

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')
[ -f "$transcript" ] || exit 0

mkdir -p "$AXIOM_DIR/logs"
nohup "$AXIOM_DIR/scripts/reflect.sh" "$transcript" "$session" \
  >> "$AXIOM_DIR/logs/reflect.log" 2>&1 &

exit 0
