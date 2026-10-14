#!/usr/bin/env bash
# 호스팅 Supabase Auth 에 커스텀 SMTP + 한국어 OTP 메일 템플릿 + 비밀번호 정책(8자 이상, 영문+숫자)
# + 비밀번호 변경 재인증 + IP 단위 rate limit 을 적용한다(supabase/config.toml 과 같은 값).
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
  # 이메일 코드는 가입(기존 계정)·비밀번호 재설정에서만 나간다 — 흐름 중립 문구
  "mailer_subjects_magic_link": "[슥터디] 인증 코드",
  "mailer_templates_magic_link_content": read("supabase/templates/magic_link.html"),
  "mailer_subjects_confirmation": "[슥터디] 가입 인증 코드",
  "mailer_templates_confirmation_content": read("supabase/templates/confirmation.html"),
  # /me 비밀번호 변경: reauthenticate() → 이메일 코드 → updateUser({ password, nonce }) (config.toml secure_password_change = true).
  # GoTrue 는 24시간 안에 만든 세션은 nonce 없이도 허용한다(가입·재설정 직후 비밀번호 저장이 그래서 된다)
  "security_update_password_require_reauthentication": True,
  "mailer_subjects_reauthentication": "[슥터디] 본인 확인 코드",
  "mailer_templates_reauthentication_content": read("supabase/templates/reauthentication.html"),
  # IP 단위 한도(5분당) — config.toml [auth.rate_limit] 와 같은 값. 기본값에 기대지 않고 명시한다
  "rate_limit_otp": 30,            # sign_in_sign_ups: 비밀번호 로그인·가입·코드 발송 요청
  "rate_limit_verify": 30,         # token_verifications: 코드 확인(verifyOtp)
  "rate_limit_token_refresh": 150, # token_refresh
  # config.toml minimum_password_length = 8 / password_requirements = "letters_digits" 와 같은 값.
  # Management API 는 문자 집합을 ':' 로 구분해 받는다(집합마다 한 자 이상) — CLI 가 letters_digits 를 이 값으로 바꾼다
  "password_min_length": 8,
  "password_required_characters": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
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
print("password:", d.get("password_min_length"), "chars, required sets:", d.get("password_required_characters"))
print("password change requires reauthentication:", d.get("security_update_password_require_reauthentication"))
print("rate limits — email_sent/h:", d.get("rate_limit_email_sent"), "| per 5 min per IP: otp(sign-in/sign-up):", d.get("rate_limit_otp"),
      "verify:", d.get("rate_limit_verify"), "token_refresh:", d.get("rate_limit_token_refresh"))
print("captcha:", d.get("security_captcha_enabled"), d.get("security_captcha_provider") or "", "(출시 전 켜기 — README)")
tpl = ("mailer_templates_magic_link_content", "mailer_templates_confirmation_content", "mailer_templates_reauthentication_content")
print("templates carry code:", all("{{ .Token }}" in (d.get(k) or "") for k in tpl))'
