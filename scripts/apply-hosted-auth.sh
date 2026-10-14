#!/usr/bin/env bash
# 호스팅 Supabase Auth 에 커스텀 SMTP + 한국어 OTP 메일 템플릿을 적용한다.
#
# 필요한 값(.env.local, 커밋 금지):
#   SUPABASE_PROJECT_REF   호스팅 프로젝트 ref (기본: neqlsvufmdxgqnwtevau)
#   SMTP_HOST, SMTP_PORT   예) smtp-relay.brevo.com / 587
#   SMTP_USER, SMTP_PASS   발송 전용 SMTP 로그인·키 (메일함 비밀번호 금지)
#   SMTP_SENDER_EMAIL      발신 주소 (발송 서비스에서 인증한 주소)
#   SMTP_SENDER_NAME       표시 이름 (기본: 슥터디)
#   AUTH_EMAIL_RATE_PER_HOUR  시간당 인증 메일 상한 (기본: 30)
# 접근 토큰: SUPABASE_ACCESS_TOKEN, 없으면 macOS 키체인의 Supabase CLI 로그인 토큰.
#
# 사용: scripts/apply-hosted-auth.sh --dry-run   # 보낼 설정 확인(비밀번호 가림)
#       scripts/apply-hosted-auth.sh             # 적용
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

if [ -f .env.local ]; then
  set -a; # shellcheck disable=SC1091
  . ./.env.local; set +a
fi

REF="${SUPABASE_PROJECT_REF:-neqlsvufmdxgqnwtevau}"
for v in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_EMAIL; do
  [ -n "${!v:-}" ] || { echo "missing $v in .env.local" >&2; exit 1; }
done

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ] && command -v security >/dev/null; then
  TOKEN=$(security find-generic-password -s "Supabase CLI" -a supabase -w 2>/dev/null || true)
  case "$TOKEN" in go-keyring-base64:*) TOKEN=$(printf '%s' "${TOKEN#go-keyring-base64:}" | base64 -d);; esac
fi
[ -n "$TOKEN" ] || { echo "no access token: set SUPABASE_ACCESS_TOKEN or run supabase login" >&2; exit 1; }

BODY=$(python3 - <<'PY'
import json, os
def read(p): return open(p, encoding="utf-8").read()
print(json.dumps({
  "smtp_host": os.environ["SMTP_HOST"],
  "smtp_port": os.environ["SMTP_PORT"],
  "smtp_user": os.environ["SMTP_USER"],
  "smtp_pass": os.environ["SMTP_PASS"],
  "smtp_admin_email": os.environ["SMTP_SENDER_EMAIL"],
  "smtp_sender_name": os.environ.get("SMTP_SENDER_NAME") or "슥터디",
  "smtp_max_frequency": 60,
  "rate_limit_email_sent": int(os.environ.get("AUTH_EMAIL_RATE_PER_HOUR") or 30),
  "mailer_otp_length": 6,
  "mailer_otp_exp": 600,
  "mailer_subjects_magic_link": "[슥터디] 로그인 인증 코드",
  "mailer_templates_magic_link_content": read("supabase/templates/magic_link.html"),
  "mailer_subjects_confirmation": "[슥터디] 가입 인증 코드",
  "mailer_templates_confirmation_content": read("supabase/templates/confirmation.html"),
}))
PY
)

if [ "$DRY" = 1 ]; then
  printf '%s' "$BODY" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["smtp_pass"]="***";[d.update({k:f"<{len(v)} chars>"}) for k,v in list(d.items()) if k.startswith("mailer_templates")];print(json.dumps(d,ensure_ascii=False,indent=1))'
  echo "(dry run — project $REF, nothing sent)"; exit 0
fi

API="https://api.supabase.com/v1/projects/$REF/config/auth"
CODE=$(printf '%s' "$BODY" | curl -s -o /tmp/apply-hosted-auth.out -w '%{http_code}' -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data @- "$API")
if [ "$CODE" != 200 ]; then echo "PATCH failed ($CODE): $(cat /tmp/apply-hosted-auth.out)" >&2; rm -f /tmp/apply-hosted-auth.out; exit 1; fi
rm -f /tmp/apply-hosted-auth.out

curl -s -H "Authorization: Bearer $TOKEN" "$API" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("smtp_host:", d.get("smtp_host"), "| sender:", d.get("smtp_admin_email"), "| otp:", d.get("mailer_otp_length"), d.get("mailer_otp_exp"), "s")
print("templates carry code:", all("{{ .Token }}" in (d.get(k) or "") for k in ("mailer_templates_magic_link_content", "mailer_templates_confirmation_content")))'
