#!/usr/bin/env bash
# 테스트 마스터 계정 만들기/지우기. 실오픈 전에 `delete --hosted` 로 지운다(README "테스트 마스터 계정").
#
# 값(.env.local, 커밋 금지):
#   MASTER_EMAIL     기본 sgtudy-master@example.com (example.com 은 예약 도메인 — 메일이 실제로 가지 않는다)
#   MASTER_PASSWORD  없으면 create 가 28자 무작위로 만들어 .env.local 에 덧붙인다
#   SUPABASE_PROJECT_REF  --hosted 대상 (기본 neqlsvufmdxgqnwtevau)
# .env.local 은 실행(source)하지 않고 위 세 키만 읽는다. 같은 이름의 환경변수가 있으면 그 값이 먼저다.
#
# 안전장치 — 이 스크립트가 만든 계정에만 손댄다:
#   create 는 app_metadata.sgtudy_master = true 를 붙인다(service role 만 쓸 수 있다).
#   create·delete 모두 이 표식이 없는 기존 사용자를 찾으면 아무것도 바꾸지 않고 거절한다.
#   --hosted 는 @example.com 이 아닌 주소를 거절한다. 정말 필요하면 --force-email 을 붙이고 y 로 확인한다.
# 서비스 롤 키는 실행할 때만 읽고 디스크에 쓰지 않는다:
#   --local   `supabase status -o env`
#   --hosted  `supabase projects api-keys --project-ref $SUPABASE_PROJECT_REF -o json`
#
# 사용: scripts/master-user.sh create [--local|--hosted [--force-email]]
#       scripts/master-user.sh delete [--local|--hosted [--force-email]]
# 출력에는 이메일만 나온다(비밀번호는 .env.local 에서 본다).
set -euo pipefail
cd "$(dirname "$0")/.."

USAGE="usage: $0 create|delete [--local|--hosted [--force-email]]"
CMD="${1:-}"; TARGET="${2:---local}"; FORCE="${3:-}"
case "$CMD" in create|delete) ;; *) echo "$USAGE" >&2; exit 2;; esac
case "$TARGET" in --local|--hosted) ;; *) echo "$USAGE" >&2; exit 2;; esac
case "$FORCE" in ""|--force-email) ;; *) echo "$USAGE" >&2; exit 2;; esac
[ "$#" -le 3 ] || { echo "$USAGE" >&2; exit 2; }

# .env.local 에서 KEY=값 한 줄만 읽는다(따옴표 한 겹은 벗긴다). 셸로 실행하지 않는다
env_local() {
  [ -f .env.local ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1=//p" .env.local | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
MASTER_EMAIL="${MASTER_EMAIL:-$(env_local MASTER_EMAIL)}"
MASTER_EMAIL="${MASTER_EMAIL:-sgtudy-master@example.com}"
MASTER_PASSWORD="${MASTER_PASSWORD:-$(env_local MASTER_PASSWORD)}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-$(env_local SUPABASE_PROJECT_REF)}"

# 호스팅은 예약 도메인(@example.com)만 — 다른 주소는 --force-email + 대화형 확인
if [ "$TARGET" = --hosted ]; then
  lower=$(printf '%s' "$MASTER_EMAIL" | tr '[:upper:]' '[:lower:]')
  case "$lower" in
    *@example.com) ;;
    *)
      if [ "$FORCE" != --force-email ]; then
        echo "refusing: --hosted 는 @example.com 주소만 다뤄요 (MASTER_EMAIL=$MASTER_EMAIL). 정말이면 --force-email 을 붙이세요" >&2; exit 1
      fi
      { : < /dev/tty; } 2>/dev/null || { echo "refusing: --force-email 은 대화형 확인이 필요해요(터미널 없음)" >&2; exit 1; }
      printf '호스팅에서 %s 계정을 %s 합니다. 계속할까요? [y/N] ' "$MASTER_EMAIL" "$CMD" > /dev/tty
      read -r ans < /dev/tty || ans=""
      case "$ans" in y|Y) ;; *) echo "취소했어요" >&2; exit 1;; esac
      ;;
  esac
elif [ -n "$FORCE" ]; then
  echo "--force-email 은 --hosted 에서만 써요" >&2; exit 2
fi

if [ "$CMD" = create ] && [ -z "$MASTER_PASSWORD" ]; then
  # 영문+숫자 정책(8자 이상, 영문·숫자 각 1자 이상)을 확실히 만족하는 28자
  MASTER_PASSWORD=$(python3 -c '
import secrets, string
a = string.ascii_letters + string.digits
while True:
    p = "".join(secrets.choice(a) for _ in range(28))
    if any(c.isalpha() for c in p) and any(c.isdigit() for c in p): print(p); break')
  touch .env.local
  { [ -s .env.local ] && [ "$(tail -c1 .env.local)" != "" ] && echo; \
    echo "# 테스트 마스터 계정 (scripts/master-user.sh) — 실오픈 전 delete --hosted"; \
    grep -q '^MASTER_EMAIL=' .env.local || echo "MASTER_EMAIL=$MASTER_EMAIL"; \
    echo "MASTER_PASSWORD=$MASTER_PASSWORD"; } >> .env.local
  echo "MASTER_PASSWORD 를 새로 만들어 .env.local 에 저장했어요"
fi

# CLI 오류는 가리지 않는다 — 실패하면 CLI 가 낸 메시지를 그대로 보여 준다(키가 든 stdout 은 변수에만)
if [ "$TARGET" = --local ]; then
  ENV=$(supabase status -o env) || { echo "supabase status failed — local supabase is not running? (see the CLI error above)" >&2; exit 1; }
  SB_URL=$(printf '%s\n' "$ENV" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
  SB_ANON=$(printf '%s\n' "$ENV" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
  SB_SERVICE=$(printf '%s\n' "$ENV" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
else
  REF="${SUPABASE_PROJECT_REF:-neqlsvufmdxgqnwtevau}"
  KEYS=$(supabase projects api-keys --project-ref "$REF" -o json) || { echo "cannot read api keys for $REF — see the CLI error above (supabase login?)" >&2; exit 1; }
  SB_URL="https://$REF.supabase.co"
  SB_ANON=$(printf '%s' "$KEYS" | python3 -c 'import sys,json;print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="anon"))')
  SB_SERVICE=$(printf '%s' "$KEYS" | python3 -c 'import sys,json;print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="service_role"))')
fi
[ -n "$SB_URL" ] && [ -n "$SB_ANON" ] && [ -n "$SB_SERVICE" ] || { echo "missing Supabase URL/keys" >&2; exit 1; }

# 키·비밀번호는 환경변수로만 넘긴다(명령줄 인자·파일에 남기지 않는다)
export SB_URL SB_ANON SB_SERVICE MASTER_EMAIL MASTER_PASSWORD CMD TARGET
exec python3 - <<'PY'
import json, os, sys, urllib.error, urllib.request

URL, ANON, SERVICE = os.environ["SB_URL"], os.environ["SB_ANON"], os.environ["SB_SERVICE"]
EMAIL, PASSWORD = os.environ["MASTER_EMAIL"].strip().lower(), os.environ["MASTER_PASSWORD"]
CMD, TARGET = os.environ["CMD"], os.environ["TARGET"].lstrip("-")
NICK = "마스터"
MARK = "sgtudy_master"  # app_metadata — 이 스크립트가 만든 계정 표식(service role 만 쓸 수 있다)

def call(method, path, body=None, token=SERVICE, key=SERVICE):
    req = urllib.request.Request(URL + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")

def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

def find_user():
    page = 1
    while True:
        code, d = call("GET", f"/auth/v1/admin/users?page={page}&per_page=1000")
        if code != 200: die(f"list users failed ({code}): {d}")
        users = d.get("users") or []
        for u in users:
            if (u.get("email") or "").lower() == EMAIL: return u
        if len(users) < 1000: return None
        page += 1

def require_mark(u):
    """표식 없는 기존 사용자 = 이 스크립트가 만든 계정이 아니다 → 아무것도 바꾸지 않고 거절"""
    if (u.get("app_metadata") or {}).get(MARK) is not True:
        die(
            f"[{TARGET}] refusing: {EMAIL} 은(는) 이미 있는 계정인데 app_metadata.{MARK} 표식이 없어요 — "
            "이 스크립트가 만든 마스터 계정이 아니에요. MASTER_EMAIL 이 맞는지 확인하세요(실제 사용자 주소면 절대 계속하지 마세요)."
        )

if CMD == "create":
    u = find_user()
    if u:
        require_mark(u)
        # user_metadata·app_metadata 는 통째로 바꾸지 않고 필요한 키만 더한다
        meta = {**(u.get("user_metadata") or {}), "has_password": True}  # src/components/auth/flow.ts HAS_PASSWORD_KEY
        app = {**(u.get("app_metadata") or {}), MARK: True}
        code, d = call("PUT", f"/auth/v1/admin/users/{u['id']}", {"password": PASSWORD, "email_confirm": True, "user_metadata": meta, "app_metadata": app})
        if code != 200: die(f"update user failed ({code}): {d}")
        state = "이미 있어 비밀번호를 .env.local 값으로 맞췄어요"
    else:
        body = {"email": EMAIL, "password": PASSWORD, "email_confirm": True, "user_metadata": {"has_password": True}, "app_metadata": {MARK: True}}
        code, d = call("POST", "/auth/v1/admin/users", body)
        if code not in (200, 201): die(f"create user failed ({code}): {d}")
        state = "만들었어요"
    # 닉네임은 본인 세션으로 me_update — 앱과 같은 검증(금칙어·중복)을 탄다. 옵션 알림 메일은 끈다(예약 도메인 반송 방지)
    code, tok = call("POST", "/auth/v1/token?grant_type=password", {"email": EMAIL, "password": PASSWORD}, token=ANON, key=ANON)
    if code != 200: die(f"password sign-in failed ({code}): {tok}")
    code, d = call("POST", "/rest/v1/rpc/me_update", {"p_nickname": NICK, "p_optional_mail_enabled": False}, token=tok["access_token"], key=ANON)
    if code != 200: die(f"user {EMAIL} {state}, but nickname failed ({code}): {d}")
    print(f"[{TARGET}] master {EMAIL} {state} · 닉네임 {NICK} · 비밀번호는 .env.local MASTER_PASSWORD")
    sys.exit(0)

# delete — profiles 는 auth.users ON DELETE CASCADE, 알림은 CASCADE, 메일 대기열은 SET NULL.
# 나머지(방·멤버·초대·과제·제출·파일)는 NO ACTION 이라 남아 있으면 삭제가 막힌다 → 먼저 세어 보고 거절한다.
u = find_user()
if not u:
    print(f"[{TARGET}] master {EMAIL} 없음 — 지울 것이 없어요")
    sys.exit(0)
require_mark(u)
uid = u["id"]
refs = [
    ("rooms", "leader_id", "slug,title"),
    ("room_members", "user_id", "room_id,status"),
    ("room_members", "decided_by", "room_id,user_id"),
    ("room_invites", "created_by", "room_id"),
    ("task_assignments", "user_id", "id"),
    ("submissions", "user_id", "id"),
    ("files", "owner_user_id", "id"),
]
left = []
for table, col, cols in refs:
    code, rows = call("GET", f"/rest/v1/{table}?{col}=eq.{uid}&select={cols}&limit=20")
    if code != 200:
        left.append(f"  {table}.{col}: 확인 실패 ({code}) {rows}")
    elif rows:
        left.append(f"  {table}.{col}: {len(rows)}{'+' if len(rows) == 20 else ''}건 예) {rows[:3]}")
if left:
    die(
        f"[{TARGET}] master {EMAIL} 를 지울 수 없어요 — 마스터가 만든/참가한 데이터가 남아 있어요(FK):\n" + "\n".join(left) +
        "\n먼저 정리하세요: 마스터가 리더인 방은 앱에서 삭제, 남의 방 참가는 탈퇴,"
        "\n제출·파일·초대는 그 방을 지우면 함께 지워져요. 정리 뒤 다시 실행하세요."
    )
code, d = call("DELETE", f"/auth/v1/admin/users/{uid}")
if code != 200:
    die(f"[{TARGET}] delete failed ({code}): {d}\n(FK 로 막혔다면 위 표의 테이블에서 user_id={uid} 행을 정리한 뒤 다시 실행하세요)")
print(f"[{TARGET}] master {EMAIL} 를 지웠어요 (프로필·알림도 함께). .env.local 의 MASTER_* 줄은 직접 지워도 돼요")
PY
