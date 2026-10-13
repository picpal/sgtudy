// supabase/tests/_submit.ts — submission_upsert 호출 헬퍼 (submissions·files·notifications·deactivate·jobs 테스트 공용)
import { one, uuids, type Q } from "./_fixtures.ts";

/** text[] 리터럴. 큰따옴표만 이스케이프 */
export const sqlArr = (xs: string[]) => "{" + xs.map((x) => '"' + x.replace(/"/g, '\\"') + '"').join(",") + "}";

/** 현재 app.uid 사용자로 제출. 반환: Submission DTO */
export const submit = async (q: Q, node: string, body = "제출 본문", links: string[] = [], files: string[] = []) =>
  (await one(q, "select public.submission_upsert($1::bigint, $2, $3::text[], $4::uuid[]) as s", [node, body, sqlArr(links), uuids(files)])).s;
