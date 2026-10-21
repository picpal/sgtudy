/* 〔C#9·#5〕 SQL 응답 계약 — supabase/tests/api-invoke-sql.test.ts 가 실제 api_invoke 응답을 정규화해 쓴 fixture 를
   포맷터에 그대로 넣는다. 손으로 만든 format.test.ts fixture 가 실제 모양과 어긋나는 것을 막는다.
   계약을 바꾸는 SQL 변경 → `UPDATE_CONTRACT=1 npm run test:db` 로 fixture 갱신 후 이 테스트를 다시 돌린다(같은 커밋) */
import { describe, expect, it } from "vitest";
import contract from "./__fixtures__/api-contract.json";
import {
  formatApply, formatCurriculum, formatPersonalResult, formatPreview, formatRemoveResult, formatStudies, formatTasks, weekWindow,
} from "./format";
import type { ApplyData, PersonalCreateData, PreviewData, StudiesData, WhoamiData } from "./format";
import type { GatewayCurriculum } from "./tree";
import type { ScheduleResponse } from "@/lib/api/types";

const cur = contract.curriculum_get as unknown as GatewayCurriculum;
const preview = contract.curriculum_plan_preview as unknown as PreviewData;
const undo = contract.curriculum_plan_preview_undo as unknown as PreviewData;
const apply = contract.curriculum_plan_apply as unknown as ApplyData;
const slug = cur.study.slug;

function clean(text: string) {
  expect(text).not.toMatch(/undefined|null|NaN|\[object Object\]/);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(text).not.toMatch(/\bu\d+\b/);                       // 정규화된 userId(u1…)도 응답에 나오지 않는다
}

describe("api-contract → formatters", () => {
  it("curriculum_get 개요 · mine = isMine 인 지은 목표만", () => {
    const outline = formatCurriculum(cur, { detail: "outline", personal: "mine" });
    clean(outline);
    expect(outline.split("\n")[0]).toMatch(new RegExp(`^${slug} \\| `));
    expect(outline).toContain("← 현재");
    const full = formatCurriculum(cur, { detail: "full", rounds: "current", personal: "mine" });
    clean(full);
    expect(full).toContain("[내 목표] n8 지은 목표 · n9 지은 목표 2");
    expect(full).not.toContain("철수 목표");
  });
  it("detail full 트리: 묶음 아래 과제가 들여쓰기로 이어진다(부모 참조 보존) · all 은 남의 목표를 닉네임으로", () => {
    const full = formatCurriculum(cur, { detail: "full", rounds: `1-${cur.nodes.filter((n) => n.depth === 2).length}`, personal: "all" });
    clean(full);
    const lines = full.split("\n");
    const bundle = lines.findIndex((l) => /^ {2}\S+ \[묶음\] /.test(l));
    expect(bundle).toBeGreaterThan(0);
    expect(lines[bundle + 1]).toMatch(/^ {4}\S+ \[(공통|지정: [^\]]+)\] /);
    expect(full).toContain("[철수의 목표] n7 철수 목표");
    expect(full).toMatch(/\[지정: [^\]]+\]/);
  });
  it("미리보기: + · ~ · ↪ 줄 각 1개 이상 · 경고는 한국어 문구 · 담당 닉네임 · 되돌리기 줄", () => {
    const t = formatPreview(preview, { slug });
    clean(t);
    const lines = t.split("\n");
    expect(lines[0]).toMatch(new RegExp(`^미리보기 · ${slug} \\(아직 적용 전\\)`));
    for (const mark of ["+ ", "~ ", "↪ "]) expect(lines.some((l) => l.trimStart().startsWith(mark))).toBe(true);
    expect(t).toContain("[지정: 지은]");
    const warn = lines.filter((l) => l.startsWith("경고"));
    expect(warn.length).toBe(preview.warnings.length);
    for (const w of warn) expect(w).toMatch(/: .*[가-힣]/);
    expect(t).toMatch(/^되돌리기 가능: 일정 \d+건/m);
    expect(t).toMatch(/→ 다음: 사용자 승인 후 apply_curriculum_plan\(previewId:"pv_[0-9a-f]{12}"\)$/);
  });
  it("되돌리기 미리보기: ↩ 줄 · restore 건수만큼", () => {
    const t = formatPreview(undo, { slug });
    clean(t);
    expect(t.split("\n").filter((l) => l.startsWith("↩ 날짜 복원 "))).toHaveLength(undo.diff.length);
    expect(t).toContain(`되돌리기 ${undo.undoOf}`);
  });
  it("적용 결과: 링크 · 되돌리기 안내 · 웹에서만 안내", () => {
    const t = formatApply(apply, { slug, origin: "https://sgtudy.app" });
    clean(t);
    expect(t).toContain(`https://sgtudy.app${apply.link}`);
    expect(t).toContain(`preview_curriculum_plan(study:"${slug}", undo:"${apply.previewId}")`);
    expect(t).toContain("웹에서");
  });
  it("개인 목표 추가·삭제 결과 한 줄", () => {
    const add = formatPersonalResult(contract.personal_create_many as unknown as PersonalCreateData);
    clean(add);
    expect(add).toMatch(/^\d+개 추가\(.+, 남은 자리 \d+\) · 건너뜀\(중복\) 1: /);
    expect(add).toContain("경고 n9: 상위 항목 기간 밖이에요");
    expect(add.split("\n")).toHaveLength(1);
    const rm = formatRemoveResult(contract.personal_delete_many);
    expect(rm).toBe(`${contract.personal_delete_many.deleted}개 삭제 · 이미 없음 ${contract.personal_delete_many.skipped.length}개`);
  });
  it("내 스터디 · 내 할 일", () => {
    const studies = formatStudies(contract.me_studies as unknown as StudiesData, contract.whoami as unknown as WhoamiData);
    clean(studies);
    expect(studies).toMatch(/^나: 지은 · 토큰 "test" · 권한 /);
    expect(studies.split("\n")[1]).toMatch(new RegExp(`^${slug} \\| .+ \\| 멤버 \\| .+ \\| 현재 2주차 `));
    const sched = contract.me_schedule as unknown as ScheduleResponse;
    const tasks = formatTasks(sched, weekWindow(sched.today, "this_week"));
    clean(tasks);
    expect(tasks).toMatch(/^이번 주 /);
    expect(tasks).toContain("[내 목표]");
  });
});
