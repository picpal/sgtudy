#!/usr/bin/env bash
# 테스트 마스터 계정 만들기/지우기. 실오픈 전에 `delete --hosted` 로 지운다(README "테스트 마스터 계정").
#
# 값(.env.local, 커밋 금지):
#   MASTER_EMAIL     기본 sgtudy-master@example.com (example.com 은 예약 도메인 — 메일이 실제로 가지 않는다)
#   MASTER_PASSWORD  없으면 create 가 24자+ 무작위로 만들어 .env.local 에 덧붙인다
# 서비스 롤 키는 실행할 때만 읽고 디스크에 쓰지 않는다:
#   --local   `supabase status -o env`
#   --hosted  `supabase projects api-keys --project-ref $SUPABASE_PROJECT_REF -o json`
#
# 사용: scripts/master-user.sh create [--local|--hosted]
#       scripts/master-user.sh delete [--local|--hosted]
# 출력에는 이메일만 나온다(비밀번호는 .env.local 에서 본다).
set -euo pipefail
cd "$(dirname "$0")/.."

CMD="${1:-}"; TARGET="${2:---local}"
case "$CMD" in create|delete) ;; *) echo "usage: $0 create|delete [--local|--hosted]" >&2; exit 2;; esac
case "$TARGET" in --local|--hosted) ;; *) echo "usage: $0 create|delete [--local|--hosted]" >&2; exit 2;; esac

if [ -f .env.local ]; then
  set -a; # shellcheck disable=SC1091
  . ./.env.local; set +a
fi
MASTER_EMAIL="${MASTER_EMAIL:-sgtudy-master@example.com}"

if [ "$CMD" = create ] && [ -z "${MASTER_PASSWORD:-}" ]; then
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

if [ "$TARGET" = --local ]; then
  ENV=$(supabase status -o env 2>/dev/null) || { echo "local supabase is not running" >&2; exit 1; }
  SB_URL=$(printf '%s\n' "$ENV" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
  SB_ANON=$(printf '%s\n' "$ENV" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
  SB_SERVICE=$(printf '%s\n' "$ENV" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
else
  REF="${SUPABASE_PROJECT_REF:-neqlsvufmdxgqnwtevau}"
  KEYS=$(supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null) || { echo "cannot read api keys for $REF (supabase login?)" >&2; exit 1; }
  SB_URL="https://$REF.supabase.co"
  SB_ANON=$(printf '%s' "$KEYS" | python3 -c 'import sys,json;print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="anon"))')
  SB_SERVICE=$(printf '%s' "$KEYS" | python3 -c 'import sys,json;print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="service_role"))')
fi
[ -n "$SB_URL" ] && [ -n "$SB_ANON" ] && [ -n "$SB_SERVICE" ] || { echo "missing Supabase URL/keys" >&2; exit 1; }

# 키·비밀번호는 환경변수로만 넘긴다(명령줄 인자·파일에 남기지 않는다)
export SB_URL SB_ANON SB_SERVICE MASTER_EMAIL MASTER_PASSWORD="${MASTER_PASSWORD:-}" CMD TARGET
exec python3 - <<'PY'
import json, os, sys, urllib.error, urllib.request

URL, ANON, SERVICE = os.environ["SB_URL"], os.environ["SB_ANON"], os.environ["SB_SERVICE"]
EMAIL, PASSWORD = os.environ["MASTER_EMAIL"].strip().lower(), os.environ["MASTER_PASSWORD"]
CMD, TARGET = os.environ["CMD"], os.environ["TARGET"].lstrip("-")
NICK = "마스터"

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

if CMD == "create":
    meta = {"has_password": True}  # src/components/auth/flow.ts HAS_PASSWORD_KEY
    u = find_user()
    if u:
        code, d = call("PUT", f"/auth/v1/admin/users/{u['id']}", {"password": PASSWORD, "email_confirm": True, "user_metadata": meta})
        if code != 200: die(f"update user failed ({code}): {d}")
        state = "이미 있어 비밀번호를 .env.local 값으로 맞췄어요"
    else:
        code, d = call("POST", "/auth/v1/admin/users", {"email": EMAIL, "password": PASSWORD, "email_confirm": True, "user_metadata": meta})
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
