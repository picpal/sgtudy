import { assert, assertEquals } from "@std/assert";
import { anon, dbTest, service, testUser } from "./_testenv.ts";

// scripts/master-user.sh 안전장치 smoke — 로컬(--local)에서만. 스크립트는 `supabase status` 로 로컬 키를 읽으므로
// SUPABASE_URL 이 로컬일 때만 돈다. 표식(app_metadata.sgtudy_master) 없는 기존 사용자는 create·delete 모두 거절하고 아무것도 바꾸지 않는다.
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(Deno.env.get("SUPABASE_URL") ?? "");
const script = new URL("../../scripts/master-user.sh", import.meta.url).pathname;

async function run(args: string[], email: string) {
  // MASTER_PASSWORD 를 넘겨 .env.local 에 새 비밀번호를 쓰지 않게 한다
  const out = await new Deno.Command("bash", {
    args: [script, ...args],
    env: { MASTER_EMAIL: email, MASTER_PASSWORD: "smokeOnly123" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

const localTest = (name: string, fn: () => Promise<void>) => (isLocal ? dbTest(name, fn) : Deno.test({ name: "db: " + name, ignore: true, fn }));

localTest("master-user.sh refuses create/delete for an existing user without the sgtudy_master marker", async () => {
  const u = await testUser(1);
  for (const cmd of ["create", "delete"]) {
    const r = await run([cmd, "--local"], u.email);
    assertEquals(r.code, 1, `${cmd}: ${r.err}`);
    assert(r.err.includes("sgtudy_master"), `${cmd}: ${r.err}`);
  }
  // 그대로 남아 있고 비밀번호도 안 바뀌었다
  const { data } = await service().auth.admin.getUserById(u.id);
  assertEquals(data.user?.email, u.email);
  assertEquals(data.user?.app_metadata?.sgtudy_master, undefined);
  const { error } = await anon().auth.signInWithPassword({ email: u.email, password: u.password });
  assertEquals(error, null);
});

localTest("master-user.sh --hosted refuses non-example.com addresses before touching the network", async () => {
  const r = await run(["delete", "--hosted"], "someone@sgtudy.local");
  assertEquals(r.code, 1);
  assert(r.err.includes("@example.com"), r.err);
  // --force-email 의 y/N 확인은 /dev/tty 로 묻기 때문에 여기서는 부르지 않는다(터미널에서 돌리면 멈춘다)
});
