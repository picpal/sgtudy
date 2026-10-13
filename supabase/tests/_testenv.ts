import { createClient, type SupabaseClient } from "supabase-js";

// 로컬 supabase(supabase start) 또는 호스팅 DB 를 향한 테스트. 환경변수가 없으면 dbTest 가 전부 ignore.
//   eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
// 테스트는 자기 테스트 사용자(sgtudy-test-<n>@example.com)와 실행 태그 RUN 으로 만든 행만 만지고, 시드 행은 읽기만 한다.
const URL = Deno.env.get("SUPABASE_URL");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const hasEnv = Boolean(URL && ANON && SERVICE);
export const RUN = "t" + crypto.randomUUID().slice(0, 6);

const OPTS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const service = (): SupabaseClient => createClient(URL!, SERVICE!, OPTS);
export const anon = (): SupabaseClient => createClient(URL!, ANON!, OPTS);

export type TestUser = { id: string; email: string; password: string };
const cache = new Map<string, Promise<TestUser>>();

export function testUser(n = 1): Promise<TestUser> {
  const email = `sgtudy-test-${n}@example.com`;
  let p = cache.get(email);
  if (!p) {
    p = (async () => {
      const password = crypto.randomUUID() + "Aa1!";
      const admin = service();
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error("listUsers " + error.message);
      const found = data.users.find((u) => u.email === email);
      if (found) {
        const up = await admin.auth.admin.updateUserById(found.id, { password });
        if (up.error) throw new Error("updateUser " + up.error.message);
        return { id: found.id, email, password };
      }
      const cr = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (cr.error || !cr.data.user) throw new Error("createUser " + cr.error?.message);
      return { id: cr.data.user.id, email, password };
    })();
    cache.set(email, p);
  }
  return p;
}

export async function userClient(n = 1): Promise<{ u: TestUser; c: SupabaseClient }> {
  const u = await testUser(n);
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("signin " + error.message);
  return { u, c };
}

export function dbTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name: "db: " + name, fn, ignore: !hasEnv, sanitizeResources: false, sanitizeOps: false });
}
