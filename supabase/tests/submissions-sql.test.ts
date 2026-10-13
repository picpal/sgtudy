import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);
const NOW = "2026-10-12T03:00:00Z";   // KST 10/12 12:00

cases("submission", db, [
  { name: "upsert: first submit fixes firstSubmittedAt/isLate, second keeps them and replaces links", run: async (q) => {
    await setNow(q, NOW);
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");          // 10-08 ~ 10-14, 철수 O(미제출)
    const a = await submit(q, ec2, "첫 제출", ["https://a.example/1", "http://b.example/2"]);
    assertEquals(a.isLate, false);
    assertEquals(a.firstSubmittedAt, "2026-10-12T03:00:00.000Z");
    assertEquals(a.links, ["https://a.example/1", "http://b.example/2"]);
    assertEquals(a.files, []);
    assertEquals(a.bodyMd, "첫 제출");

    await setNow(q, "2026-10-16T03:00:00Z");                                // 마감 뒤에 고쳐도 지각으로 바뀌지 않는다
    const b = await submit(q, ec2, "고친 본문", ["https://c.example/3"]);
    assertEquals(b.id, a.id);
    assertEquals(b.firstSubmittedAt, a.firstSubmittedAt);
    assertEquals(b.isLate, false);
    assertEquals(b.bodyMd, "고친 본문");
    assertEquals(b.links, ["https://c.example/3"]);
    assert(b.updatedAt >= a.updatedAt);                                     // 같은 트랜잭션 안의 now() 는 고정값이라 '같음'도 정상
    const n = await one(q, "select count(*)::int as n from public.submissions where node_id = $1::bigint", [ec2]);
    assertEquals(n.n, 2);                                                   // 지은(시드 D) + 철수
  } },

  { name: "is_late boundary: KST 00:00:30 after deadline → late (Review Focus 1)", run: async (q) => {
    await setNow(q, "2026-10-03T15:00:30Z");                                // = KST 10/04 00:00:30, 마감 10/03
    await asUser(q, await uidOf(q, "하나"));
    const s = await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));     // 하나 M(미제출)
    assertEquals(s.isLate, true);
  } },

  { name: "is_late boundary: KST 23:59:59 on the end date → on time", run: async (q) => {
    await setNow(q, "2026-10-03T14:59:59Z");
    await asUser(q, await uidOf(q, "하나"));
    const s = await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));
    assertEquals(s.isLate, false);
  } },

  { name: "guards: ROOM_NOT_ACTIVE / TASK_ARCHIVED / NODE_NOT_LEAF / TASK_NOT_ASSIGNED / TASK_NOT_STARTED / AUTH_REQUIRED", run: async (q) => {
    await setNow(q, NOW);
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");       // 하나만 지정
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");                  // 10-15 시작
    const vpc = await nodeId(q, "aws", "VPC 실습");
    const round2 = await nodeId(q, "aws", "EC2·S3");                        // EC2·S3 회차(비리프)

    await asUser(q, await uidOf(q, "가은"));                                 // sqld 그룹장, RECRUIT
    await expectFail(submit(q, await nodeId(q, "sqld", "데이터 모델링 요약 노트")), "ROOM_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "현우"));                                 // algo 그룹장, ENDED
    await expectFail(submit(q, await nodeId(q, "algo", "1주차 문제 풀이")), "ROOM_NOT_ACTIVE");

    await asUser(q, await uidOf(q, "철수"));
    await expectFail(submit(q, s3), "TASK_NOT_ASSIGNED");
    await expectFail(submit(q, alb), "TASK_NOT_STARTED");
    await expectFail(submit(q, round2), "NODE_NOT_LEAF");
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [vpc]);
    await expectFail(submit(q, vpc), "TASK_ARCHIVED");
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [round2]);
    await expectFail(submit(q, round2), "PARENT_ARCHIVED");

    await asUser(q, await uidOf(q, "도윤"));                                 // aws INACTIVE
    await expectFail(submit(q, ec2), "TASK_NOT_ASSIGNED");
    await asUser(q, await uidOf(q, "가은"));                                 // 비멤버
    await expectFail(submit(q, ec2), "TASK_NOT_ASSIGNED");
    await expectFail(submit(q, "999999"), "NODE_NOT_FOUND");
    await asAnon(q);
    await expectFail(submit(q, ec2), "AUTH_REQUIRED");                       // superuser path; real anon = 42501 (GRANT layer, D7 case)
  } },

  { name: "limits: body 50k, INVALID_LINK (scheme / count), FILE_LIMIT_EXCEEDED, FILE_NOT_READY", run: async (q) => {
    await setNow(q, NOW);
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await expectFail(submit(q, ec2, "a".repeat(50001)), "VALIDATION_FAILED");
    await expectFail(submit(q, ec2, "x", ["ftp://nope"]), "INVALID_LINK");
    await expectFail(submit(q, ec2, "x", ["javascript:alert(1)"]), "INVALID_LINK");
    await expectFail(one(q, "select public.submission_upsert($1::bigint, 'x', array['https://ok.example', null]::text[], '{}'::uuid[])", [ec2]), "INVALID_LINK");   // NULL 원소는 raw 23502 가 아니다
    await expectFail(submit(q, ec2, "x", Array.from({ length: 21 }, (_, i) => `https://l.example/${i}`)), "INVALID_LINK");
    await expectFail(submit(q, ec2, "x", [], Array.from({ length: 6 }, () => crypto.randomUUID())), "FILE_LIMIT_EXCEEDED");

    const pending = crypto.randomUUID();
    await q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status)
             values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'ATTACHMENT', $5, 'a.png', 'image/png', 10, 'PENDING')`,
            [pending, cheolsu, await roomId(q, "aws"), ec2, `${await roomId(q, "aws")}/${ec2}/${cheolsu}/${pending}.png`]);
    await expectFail(submit(q, ec2, "x", [], [pending]), "FILE_NOT_READY");
    await expectFail(submit(q, ec2, "x", [], [crypto.randomUUID()]), "NOT_FOUND");
    // 담당자 아닌 사람의 파일 id 를 끼워 넣어도 NOT_FOUND
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(submit(q, ec2, "x", [], [pending]), "NOT_FOUND");
  } },

  { name: "stats: 1주차 stays 5/8 after a resubmission; 하나 submitting IAM makes it 6/8", run: async (q) => {
    await setNow(q, NOW);
    const stat = async () => one(q, `select coalesce(sum(ls.asg), 0)::int as asg, coalesce(sum(ls.sub), 0)::int as sub
      from public.room_leaf_stats($1::bigint) ls join public.goal_nodes rd on rd.id = ls.round_id where rd.label = '1주차'`, [await roomId(q, "aws")]);
    assertEquals(await stat(), { asg: 8, sub: 5 });
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, await nodeId(q, "aws", "IAM 정책 이해"), "다시 제출");   // 철수는 이미 D → 갱신
    assertEquals(await stat(), { asg: 8, sub: 5 });
    await asUser(q, await uidOf(q, "하나"));
    await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));
    assertEquals(await stat(), { asg: 8, sub: 6 });
  } },
]);
