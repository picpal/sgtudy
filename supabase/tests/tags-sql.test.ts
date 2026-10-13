import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";
import { sqlArr } from "./_submit.ts";

const db = await openDb();
await applySeed(db);
const tagsOf = async (q: Q, slug: string) =>
  q("select rt.tag_slug as slug, rt.source from public.room_tags rt join public.rooms r on r.id = rt.room_id where r.slug = $1 order by rt.sort_order, rt.created_at, rt.tag_slug", [slug]);
const put = async (q: Q, slug: string, slugs: string[], free: string[] = []) =>
  (await one(q, "select public.room_tags_put($1, $2::text[], $3::text[]) as r", [slug, sqlArr(slugs), sqlArr(free)])).r;
const autoselect = async (q: Q, room: string) => Number((await one(q, "select public.tag_autoselect($1::bigint) as n", [room])).n);

cases("tags", db, [
  { name: "dictionary: 19 curated tags with palette tones; aws room tags from seed", run: async (q) => {
    const t = await q("select slug, label, tone, kind from public.tags where kind = 'CURATED' order by slug");
    assertEquals(t.length, 19);
    const by = Object.fromEntries(t.map((x) => [x.label, x.tone]));
    assertEquals(by["AWS"], "mint"); assertEquals(by["클라우드"], "blue"); assertEquals(by["자격증"], "peach");
    assertEquals(by["Spring"], "lav"); assertEquals(by["알고리즘"], "slate"); assertEquals(by["Kubernetes"], "lav");
    const aws = (await one(q, "select public.room_tags_get('aws') as r")).r;
    assertEquals(aws.items.map((x: { label: string; auto: boolean }) => [x.label, x.auto]), [["AWS", true], ["클라우드", true], ["자격증", false]]);
    assertEquals(typeof aws.today, "string");
    await expectFail(q("select public.room_tags_get('nope')"), "ROOM_NOT_FOUND");
    await asAnon(q);
    await expectFail(q("select public.room_tags_get('spring')"), "ROOM_NOT_FOUND");   // 비공개 방
  } },

  { name: "tag_autoselect(aws): AWS, 자격증, 클라우드 lead; ≤5; AUTO replaced, MANUAL kept", run: async (q) => {
    const aws = await roomId(q, "aws");
    await q("delete from public.room_tags where room_id = $1::bigint", [aws]);
    await q("insert into public.room_tags (room_id, tag_slug, source, sort_order) values ($1::bigint, 'interview', 'MANUAL', 0), ($1::bigint, 'toeic', 'AUTO', 1)", [aws]);
    const n = await autoselect(q, aws);
    assertEquals(n, 4);                                                        // B11: 시드 기준 정확히 4 (aws·certificate·cloud·data)
    const t = await tagsOf(q, "aws");
    const auto = t.filter((x) => x.source === "AUTO").map((x) => x.slug);
    assertEquals(auto.slice(0, 3), ["aws", "certificate", "cloud"]);
    assertEquals([...auto].sort(), ["aws", "certificate", "cloud", "data"]);
    assert(!auto.includes("toeic"));                                           // 옛 AUTO 는 교체
    assertEquals(t.filter((x) => x.source === "MANUAL").map((x) => x.slug), ["interview"]);
    assertEquals(await autoselect(q, aws), n);                                 // 멱등
    assertEquals((await tagsOf(q, "aws")).length, t.length);
  } },

  { name: "suppression: removing an AUTO tag via room_tags_put keeps it away from autoselect; adding it back lifts suppression (Review Focus 5)", run: async (q) => {
    const aws = await roomId(q, "aws");
    await asUser(q, await uidOf(q, "민수"));
    await autoselect(q, aws);
    let r = await put(q, "aws", ["certificate"]);                            // AWS·클라우드 AUTO 제거
    assertEquals(r.items.map((x: { slug: string }) => x.slug), ["certificate"]);
    const sup = await q("select tag_slug from public.room_tag_suppressions where room_id = $1::bigint order by 1", [aws]);
    assert(sup.map((x) => x.tag_slug).includes("aws"));
    assert(sup.map((x) => x.tag_slug).includes("cloud"));
    await autoselect(q, aws);
    const after = (await tagsOf(q, "aws")).map((x) => x.slug);
    assert(!after.includes("aws")); assert(!after.includes("cloud"));
    assert(after.includes("certificate"));
    r = await put(q, "aws", ["certificate", "aws"]);                         // 수동으로 다시 넣으면 억제 해제, MANUAL
    assertEquals((await tagsOf(q, "aws")).find((x) => x.slug === "aws")?.source, "MANUAL");
    assertEquals((await q("select 1 from public.room_tag_suppressions where room_id = $1::bigint and tag_slug = 'aws'", [aws])).length, 0);
    await put(q, "aws", ["certificate"]);                                    // MANUAL 을 빼는 건 억제가 아니다
    assertEquals((await q("select 1 from public.room_tag_suppressions where room_id = $1::bigint and tag_slug = 'aws'", [aws])).length, 0);
  } },

  { name: "room_tags_put: limit 8, CUSTOM free labels (reuse by label), VALIDATION_FAILED, NOT_LEADER, usage_count", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(put(q, "aws", ["aws", "cloud", "certificate", "english", "toeic", "spring", "backend", "java", "sql"]), "TAG_LIMIT_EXCEEDED");
    await expectFail(put(q, "aws", ["aws"], ["a".repeat(21)]), "VALIDATION_FAILED");
    await expectFail(put(q, "aws", ["aws"], ["   "]), "VALIDATION_FAILED");
    await expectFail(put(q, "aws", ["not-a-tag"]), "NOT_FOUND");
    const r = await put(q, "aws", ["aws"], ["나만의 태그", "spring"]);          // "spring" 은 라벨 Spring 과 같아 재사용
    assertEquals(r.items.map((x: { label: string; auto: boolean }) => [x.label, x.auto]), [["AWS", false], ["나만의 태그", false], ["Spring", false]]);
    const custom = await one(q, "select slug, kind, tone, usage_count from public.tags where label = '나만의 태그'");
    assertEquals(custom.kind, "CUSTOM");
    assert(String(custom.slug).startsWith("c-"));
    assertEquals(custom.usage_count, 1);
    assertEquals((await one(q, "select usage_count from public.tags where slug = 'cloud'")).usage_count,
                 Number((await one(q, "select count(*)::int as n from public.room_tags where tag_slug = 'cloud'")).n));
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(put(q, "aws", ["aws"]), "NOT_LEADER");
    await asUser(q, await uidOf(q, "현우"));
    await expectFail(put(q, "algo", ["aws"]), "ROOM_NOT_EDITABLE");           // ENDED
  } },

  { name: "tag_term_hit: 2-char ASCII terms need a word boundary; Korean and ≥3 chars match as substring", run: async (q) => {
    const hit = async (t: string, term: string) => (await one(q, "select public.tag_term_hit($1, $2) as v", [t, term])).v;
    assertEquals(await hit("AWS docs 읽기", "cs"), false);                       // 'cs' ⊂ 'docs' 오탐 제거
    assertEquals(await hit("CS 면접 대비", "cs"), true);
    assertEquals(await hit("EC2·S3 정리", "s3"), true);                          // '·' 는 경계
    assertEquals(await hit("SAA-C03 합격까지", "합격"), true);                   // 한글은 조사가 붙으므로 부분 일치 유지(aws 자격증 점수 근거)
    assertEquals(await hit("SAA-C03 합격까지", "saa"), true);                    // 3자 이상은 부분 일치
    assertEquals(await hit("고가용성 아키텍처", "고가용성"), true);
  } },

  { name: "grants: public tag RPCs only (B4)", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    for (const fn of ["public.tag_term_hit(text, text)", "public.tag_slug_for(text)",
                      "public.tag_apply_auto(bigint, text[])", "public.tag_autoselect(bigint)"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), false, fn);
    }
    assertEquals(await can("anon", "public.tags_search(text)"), true);
    assertEquals(await can("anon", "public.room_tags_get(text)"), true);
    assertEquals(await can("anon", "public.room_tags_put(text, text[], text[])"), false);
    assertEquals(await can("authenticated", "public.room_tags_put(text, text[], text[])"), true);
    assertEquals(await can("authenticated", "public.room_tags_suggest(text)"), true);
    assertEquals(await can("service_role", "public.tag_apply_auto(bigint, text[])"), true);
    // D7: 실제 역할로 실행
    await asAnon(q);
    await q("set local role anon");
    assertEquals((await one(q, "select public.tags_search('aws') as r")).r.items[0].slug, "aws");
    assertEquals((await one(q, "select public.room_tags_get('aws') as r")).r.items.length, 3);
    await expectFail(q("select public.room_tags_put('aws', '{}'::text[], '{}'::text[])"), "permission denied");
    await q("reset role");
    await asUser(q, await uidOf(q, "민수"));
    await q("set local role authenticated");
    assert((await one(q, "select public.room_tags_suggest('aws') as r")).r.items.length >= 1);
    await q("reset role");
  } },

  { name: "tags_search: label/alias ILIKE, top 20 by usage, empty q lists all (≤20)", run: async (q) => {
    const s = (await one(q, "select public.tags_search('클라') as r")).r;
    assertEquals(s.items.map((x: { slug: string }) => x.slug), ["cloud"]);
    const a = (await one(q, "select public.tags_search('쿠버') as r")).r;       // alias
    assertEquals(a.items[0].slug, "kubernetes");
    assertEquals(a.items[0].auto, false);
    const all = (await one(q, "select public.tags_search('') as r")).r;
    assert(all.items.length >= 19 && all.items.length <= 20);
    assertEquals((await one(q, "select public.tags_search('zzzz') as r")).r.items, []);
    assertEquals((await one(q, "select public.tags_search('%') as r")).r.items, []);   // C4: % 는 글자 그대로
  } },

  { name: "new room: 0 AUTO tags right after room_create (no hook); room_tags_suggest fills them (S6)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    const d = (await one(q, "select public.room_create('도커 컨테이너 입문 Docker 101', '도커와 컨테이너 기초를 함께', '2026-11-02'::date, '2026-11-29'::date, 6, true, 'direct') as d")).d;
    // room_create 에는 훅이 없다(0004 를 다시 만들지 않는다) → AUTO 0개
    assertEquals((await tagsOf(q, d.slug)).filter((x) => x.source === "AUTO").length, 0);
    const r = (await one(q, "select public.room_tags_suggest($1) as r", [d.slug])).r;
    assert(r.items.some((x: { slug: string; auto: boolean }) => x.slug === "docker" && x.auto), JSON.stringify(r.items));
  } },

  { name: "autoselect uses CURATED tags only: a CUSTOM label from another room is never auto-applied", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await put(q, "aws", ["aws"], ["입문"]);
    assertEquals((await one(q, "select kind from public.tags where label = '입문'")).kind, "CUSTOM");
    await q("update public.rooms set title = title || ' 입문 과정' where slug = 'algo'");
    const algo = await roomId(q, "algo");
    await autoselect(q, algo);
    const t = await tagsOf(q, "algo");
    assert(!t.some((x) => x.source === "AUTO" && x.slug.startsWith("c-")), JSON.stringify(t));
    const n = await one(q, "select count(*)::int as n from public.room_tags where room_id = $1::bigint and tag_slug = (select slug from public.tags where label = '입문')", [algo]);
    assertEquals(n.n, 0);
  } },

  { name: "tag_apply_auto: unknown room -> ROOM_NOT_FOUND; CUSTOM slug ignored", run: async (q) => {
    await expectFail(q("select public.tag_apply_auto(999999999::bigint, array['aws']::text[])"), "ROOM_NOT_FOUND");
    await asUser(q, await uidOf(q, "민수"));
    await put(q, "aws", ["aws"], ["입문"]);
    const slug = (await one(q, "select slug from public.tags where label = '입문'")).slug;
    const algo = await roomId(q, "algo");
    await q("select public.tag_apply_auto($1::bigint, array[$2]::text[])", [algo, slug]);
    assertEquals((await tagsOf(q, "algo")).some((x) => x.slug === slug), false);
  } },

  { name: "archived room: room_tags_put and room_tags_suggest -> ROOM_NOT_EDITABLE", run: async (q) => {
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(put(q, "aws", ["aws"]), "ROOM_NOT_EDITABLE");
    await expectFail(q("select public.room_tags_suggest('aws')"), "ROOM_NOT_EDITABLE");
  } },

  { name: "node_update in plan 03 re-runs tag_autoselect (hook guard present)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "민수"));
    await autoselect(q, aws);
    assert(!(await tagsOf(q, "aws")).some((x) => x.slug === "docker"));
    await q(`select public.node_update('aws', $1::bigint, '{"title":"EC2 인스턴스 유형 정리 (도커 컨테이너 실습)"}'::jsonb)`, [ec2]);
    const t = await tagsOf(q, "aws");
    assert(t.some((x) => x.slug === "docker" && x.source === "AUTO"), JSON.stringify(t));
  } },
]);
