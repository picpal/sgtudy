// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExamQuestion, WrongNoteExam, WrongNoteItem, WrongNotePractice } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import type { PracticeOutcome } from "./useWrongNote";
import { mergePractice, setMastered, type NoteStudy } from "./wrongNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const { WrongNoteList } = await import("./WrongNoteList");

const q = (id: string, o: Partial<ExamQuestion> = {}): ExamQuestion => ({
  id, ord: Number(id) - 1, type: "single", prompt: `문제 ${id}`, choices: ["가", "나", "다"], points: 2, answer: 0, explanation: `해설 **${id}**`, ...o,
});
const item = (id: string, o: Partial<WrongNoteItem> = {}): WrongNoteItem => ({ question: q(id), no: Number(id), mine: 1, practice: null, mastered: false, ...o });
const P = (lastCorrect: boolean): WrongNotePractice => ({ lastCorrect, correctCount: lastCorrect ? 1 : 0, wrongCount: lastCorrect ? 0 : 1, lastAnswer: 0, lastAt: "2026-10-17T00:00:00.000Z" });
const exam = (nodeId: string, items: WrongNoteItem[], o: Partial<WrongNoteExam> = {}): WrongNoteExam => ({
  nodeId, title: `시험 ${nodeId}`, endDate: "2026-10-21", reveal: "after_submit", score: 1, maxScore: 5, correctCount: 1, questionCount: 4, locked: false, items, ...o,
});
const locked = (nodeId: string, n: number): WrongNoteExam => {
  const ex = exam(nodeId, [], { title: "종합 시험", reveal: "after_deadline", locked: true, lockedCount: n, unlockDate: "2026-10-28", endDate: "2026-10-28", score: 4, maxScore: 10 });
  delete ex.items;
  return ex;
};
const AWS = (o: Partial<NoteStudy> = {}): NoteStudy => ({
  slug: "aws", hasExam: true,
  rounds: [
    { id: "3", title: "3주차", exams: [exam("31", [item("1"), item("2", { question: q("2", { type: "multi", answer: [0, 2] }), mine: [0], practice: P(true) }), item("3", { mine: null, question: q("3", { explanation: "" }) })])] },
    { id: "4", title: "4주차", exams: [locked("41", 6)] },
  ],
  ...o,
});
const SPRING: NoteStudy = { slug: "spring", title: "Spring 스터디", tone: "blue", hasExam: true, rounds: [{ id: "9", title: "1주차", exams: [exam("91", [item("11")])] }] };

let root: Root | null = null;
const flush = () => act(async () => {});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

type Opt = { studies?: NoteStudy[]; scope?: "room" | "all"; pending?: boolean; studyFilter?: string; practice?: (slug: string, a: { questionId: string; answer: unknown }[]) => PracticeOutcome };
function mount(o: Opt = {}) {
  const onPractice = vi.fn(async (slug: string, answers: { questionId: string; answer: unknown }[]): Promise<PracticeOutcome> => o.practice?.(slug, answers) ?? { ok: false });
  const onMaster = vi.fn<(slug: string, id: string, on: boolean) => Promise<boolean>>(async () => true);
  // 부모(useWrongNote)처럼 응답을 목록에 합친다
  function H() {
    const [studies, setStudies] = useState(o.studies ?? [AWS()]);
    return createElement(WrongNoteList, {
      studies, scope: o.scope ?? "room", pending: o.pending, studyFilter: o.studyFilter, busy: false,
      onPractice: async (slug, answers) => {
        const r = await onPractice(slug, answers);
        if (r.ok) setStudies((s) => mergePractice(s, r.results));
        return r;
      },
      onMaster: async (slug, id, on) => {
        await onMaster(slug, id, on);
        setStudies((s) => setMastered(s, id, on));
        return true;
      },
    });
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(H)));
  return { host, onPractice, onMaster };
}

const text = (el: Element | null) => el?.textContent ?? "";
const btn = (scope: ParentNode, label: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const itemEl = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-wn-item="${id}"]`)!;
const tags = (scope: ParentNode, t: string) => [...scope.querySelectorAll("span")].filter((s) => s.textContent === t).length;
const openDetails = (d: HTMLDetailsElement) => act(() => {
  d.open = true;
  d.dispatchEvent(new Event("toggle"));
});

describe("WrongNoteList — 목록 (Task 4)", () => {
  it("회차 h3 · 시험 카드 머리 · 문항 번호 · 머리줄 합계 · 방 탭엔 스터디 h2 없음", () => {
    const { host } = mount();
    expect([...host.querySelectorAll("h3")].map(text)).toEqual(["3주차", "4주차"]);
    expect(host.querySelector("h2")).toBeNull();
    expect(text(host)).toContain("1/5점 · 오답 3문항");
    expect(text(host)).toContain("오답 3문항 · 다시 풀어 맞힘 1 · 잠김 6");
    expect(text(itemEl(host, "2"))).toContain("2.");
    expect(tags(itemEl(host, "2"), "내 답")).toBe(1);
  });

  it("기본 상태엔 「정답」 태그·해설이 없다 — 「정답·해설」 을 열어야 보인다", async () => {
    const { host } = mount();
    const li = itemEl(host, "1");
    expect(tags(li, "정답")).toBe(0);
    expect(text(li)).not.toContain("해설 1");
    await openDetails(li.querySelector("details")!);
    expect(tags(li, "정답")).toBe(1);
    expect(li.querySelector("details strong")?.textContent).toBe("1");
  });

  it("해설이 없는 문항 → 「해설이 없는 문항이에요」", async () => {
    const { host } = mount();
    const li = itemEl(host, "3");
    await openDetails(li.querySelector("details")!);
    expect(text(li)).toContain("해설이 없는 문항이에요");
    expect(tags(li, "정답")).toBe(1);
  });

  it("배지: 오답·미답·다시 풀어 맞힘", () => {
    const { host } = mount();
    expect(text(itemEl(host, "1").querySelector("[aria-label='문항 상태']"))).toBe("오답");
    expect(text(itemEl(host, "2").querySelector("[aria-label='문항 상태']"))).toBe("오답다시 풀어 맞힘");
    expect(text(itemEl(host, "3").querySelector("[aria-label='문항 상태']"))).toBe("미답");
  });

  it("필터 칩(radiogroup): 다시 풀어 맞힘 → 그 문항만 · 잠금 카드 빠짐, 아직 못 맞힘 → 나머지 + 잠금", () => {
    const { host } = mount();
    const group = host.querySelector("[role='radiogroup']")!;
    expect([...group.querySelectorAll("[role='radio']")].map((b) => [text(b), b.getAttribute("aria-checked")])).toEqual([["전체", "true"], ["아직 못 맞힘", "false"], ["다시 풀어 맞힘", "false"]]);
    click(btn(group, "다시 풀어 맞힘"));
    expect([...host.querySelectorAll("[data-wn-item]")].map((e) => e.getAttribute("data-wn-item"))).toEqual(["2"]);
    expect(text(host)).not.toContain("종합 시험");
    click(btn(group, "아직 못 맞힘"));
    expect([...host.querySelectorAll("[data-wn-item]")].map((e) => e.getAttribute("data-wn-item"))).toEqual(["1", "3"]);
    expect(text(host)).toContain("종합 시험");
  });

  it("잠금 카드: 개수·열리는 날만 · 버튼·문항 없음", () => {
    const { host } = mount();
    const card = [...host.querySelectorAll("article")].find((a) => text(a).includes("종합 시험"))!;
    expect(text(card)).toContain("4/10점 · 오답 6문항 · 10.28 마감 뒤에 열려요");
    expect(card.querySelectorAll("button").length).toBe(0);
    expect(card.querySelector("[data-wn-item]")).toBeNull();
  });

  it("외운 문제 토글 — 외운 문항이 있을 때만, 켜면 「외움」 배지 + [다시 노트에]", () => {
    const st = AWS();
    st.rounds[0].exams[0].items![0].mastered = true;
    const { host } = mount({ studies: [st] });
    expect(host.querySelector("[data-wn-item='1']")).toBeNull();
    const box = [...host.querySelectorAll("label")].find((l) => text(l).includes("외운 문제 1개 보기"))!.querySelector("input")!;
    click(box);
    const li = itemEl(host, "1");
    expect(text(li)).toContain("외움");
    expect(btn(li, "다시 노트에")).not.toBeNull();
  });

  it("빈 상태 — 승인 대기 · 시험 없음 · 틀린 문항 없음 · 전부 외웠어요(링크로 토글 켜기) · 필터로 빔", () => {
    let m = mount({ studies: [], pending: true });
    expect(text(m.host)).toContain("참가가 승인되면 오답노트를 볼 수 있어요");
    act(() => root!.unmount());
    m = mount({ studies: [{ slug: "aws", hasExam: false, rounds: [] }] });
    expect(text(m.host)).toContain("아직 시험이 없는 방이에요");
    act(() => root!.unmount());
    m = mount({ studies: [{ slug: "aws", hasExam: true, rounds: [] }] });
    expect(text(m.host)).toContain("틀린 문항이 없어요");
    act(() => root!.unmount());
    m = mount({ studies: [{ slug: "aws", hasExam: true, rounds: [{ id: "3", title: "3주차", exams: [exam("31", [item("1", { mastered: true })])] }] }] });
    expect(text(m.host)).toContain("전부 외웠어요");
    click(btn(m.host, "외운 문제 1개 보기"));
    expect(m.host.querySelector("[data-wn-item='1']")).not.toBeNull();
    act(() => root!.unmount());
    m = mount({ studies: [{ slug: "aws", hasExam: true, rounds: [{ id: "3", title: "3주차", exams: [exam("31", [item("1")])] }] }] });
    click(btn(m.host.querySelector("[role='radiogroup']")!, "다시 풀어 맞힘"));
    expect(text(m.host)).toContain("조건에 맞는 문항이 없어요");
  });

  it("여러 스터디(scope all): 스터디 h2 + 「오답노트 ›」 · studyFilter 로 한 섹션 · 시험 없는 스터디 한 줄", () => {
    const empty: NoteStudy = { slug: "go", title: "Go 스터디", tone: "mint", hasExam: false, rounds: [] };
    const { host } = mount({ studies: [{ ...AWS(), title: "AWS 스터디", tone: "mint" }, SPRING, empty], scope: "all" });
    expect([...host.querySelectorAll("h2")].map((h) => text(h).replace("오답노트 ›", ""))).toEqual(["AWS 스터디", "Spring 스터디", "Go 스터디"]);
    expect(host.querySelector("h2 a")?.getAttribute("href")).toBe(routes.myStudyTab("aws", "wrong"));
    expect(text(host)).toContain("아직 시험이 없는 방이에요");
    act(() => root!.unmount());
    const m = mount({ studies: [{ ...AWS(), title: "AWS 스터디", tone: "mint" }, SPRING], scope: "all", studyFilter: "spring" });
    expect([...m.host.querySelectorAll("h2")].map((h) => text(h).replace("오답노트 ›", ""))).toEqual(["Spring 스터디"]);
    expect(text(m.host)).toContain("오답 1문항");
  });
});

describe("WrongNoteList — 다시 풀기 (Task 5)", () => {
  it("문항: [다시 풀기] → 입력(정답 태그 없음) → [채점] → 카드의 slug·[{questionId, answer}] → 결과·해설 펼침·머리줄 갱신", async () => {
    const { host, onPractice } = mount({ practice: (_s, a) => ({ ok: true, results: { [a[0].questionId]: { correct: true, practice: P(true) } } }) });
    let li = itemEl(host, "1");
    click(btn(li, "다시 풀기"));
    li = itemEl(host, "1");
    const radios = li.querySelectorAll<HTMLInputElement>("input[type='radio']");
    expect(radios.length).toBe(3);
    expect(tags(li, "정답")).toBe(0);
    click(radios[0]);
    click(btn(li, "채점"));
    await flush();
    expect(onPractice).toHaveBeenCalledWith("aws", [{ questionId: "1", answer: 0 }]);
    li = itemEl(host, "1");
    expect(text(li)).toContain("✓ 맞혔어요");
    expect(tags(li, "정답")).toBe(1);
    expect(li.querySelector("details")?.open).toBe(true);
    expect(text(host)).toContain("오답 3문항 · 다시 풀어 맞힘 2 · 잠김 6");
    click(btn(li, "닫기"));
    expect(text(itemEl(host, "1").querySelector("[aria-label='문항 상태']"))).toBe("오답다시 풀어 맞힘");
  });

  it("「아직 못 맞힘」 필터에서 맞혀도 [닫기] 전까지는 목록에 남는다", async () => {
    const { host } = mount({ practice: (_s, a) => ({ ok: true, results: { [a[0].questionId]: { correct: true, practice: P(true) } } }) });
    click(btn(host.querySelector("[role='radiogroup']")!, "아직 못 맞힘"));
    click(btn(itemEl(host, "1"), "다시 풀기"));
    click(itemEl(host, "1").querySelectorAll<HTMLInputElement>("input[type='radio']")[0]);
    click(btn(itemEl(host, "1"), "채점"));
    await flush();
    expect(text(itemEl(host, "1"))).toContain("✓ 맞혔어요");
    click(btn(itemEl(host, "1"), "닫기"));
    expect(host.querySelector("[data-wn-item='1']")).toBeNull();
  });

  it("두 스터디 — spring 카드에서 채점하면 slug 가 spring", async () => {
    const { host, onPractice } = mount({ studies: [{ ...AWS(), title: "AWS", tone: "mint" }, SPRING], scope: "all", practice: (_s, a) => ({ ok: true, results: { [a[0].questionId]: { correct: false, practice: P(false) } } }) });
    click(btn(itemEl(host, "11"), "다시 풀기"));
    click(btn(itemEl(host, "11"), "채점"));
    await flush();
    expect(onPractice).toHaveBeenCalledWith("spring", [{ questionId: "11", answer: null }]);
    expect(text(itemEl(host, "11"))).toContain("✗ 또 틀렸어요");
  });

  it("묶음: [이 시험 다시 풀기] → 전부 입력 · 막대 n/m 답함 → [채점] 1회(배열) → 「m문항 중 k 맞힘」 → [닫기]", async () => {
    const { host, onPractice } = mount({
      practice: (_s, a) => ({ ok: true, results: Object.fromEntries(a.map((x, i) => [x.questionId, { correct: i === 0, practice: P(i === 0) }])) }),
    });
    click(btn(host, "이 시험 다시 풀기"));
    for (const id of ["1", "2", "3"]) {
      expect(itemEl(host, id).querySelector("input")).not.toBeNull();
      expect(btn(itemEl(host, id), "채점")).toBeNull();
      expect(btn(itemEl(host, id), "외웠어요")).toBeNull();
    }
    expect(text(host)).toContain("0/3 답함");
    click(itemEl(host, "1").querySelectorAll<HTMLInputElement>("input[type='radio']")[0]);
    click(itemEl(host, "2").querySelectorAll<HTMLInputElement>("input[type='checkbox']")[2]);
    expect(text(host)).toContain("2/3 답함");
    click(btn(host, "채점"));
    await flush();
    expect(onPractice).toHaveBeenCalledTimes(1);
    expect(onPractice).toHaveBeenCalledWith("aws", [{ questionId: "1", answer: 0 }, { questionId: "2", answer: [2] }, { questionId: "3", answer: null }]);
    expect(text(host)).toContain("3문항 중 1 맞힘");
    expect(text(itemEl(host, "1"))).toContain("✓ 맞혔어요");
    expect(text(itemEl(host, "2"))).toContain("✗ 또 틀렸어요");
    click(btn(host, "닫기"));
    expect(text(host)).not.toContain("답함");
    expect(btn(itemEl(host, "1"), "다시 풀기")).not.toBeNull();
  });

  it("묶음 [그만두기] → 입력 버림, 호출 없음", () => {
    const { host, onPractice } = mount();
    click(btn(host, "이 시험 다시 풀기"));
    click(itemEl(host, "1").querySelectorAll<HTMLInputElement>("input[type='radio']")[1]);
    click(btn(host, "그만두기"));
    expect(onPractice).not.toHaveBeenCalled();
    expect(host.querySelector("[data-wn-item='1'] input")).toBeNull();
  });

  it("답 모양 오류(field) → 그 문항에 「답을 확인해 주세요」, 입력 유지", async () => {
    const { host } = mount({ practice: () => ({ ok: false, field: "1" }) });
    click(btn(itemEl(host, "1"), "다시 풀기"));
    click(btn(itemEl(host, "1"), "채점"));
    await flush();
    expect(itemEl(host, "1").querySelector("[role='alert']")?.textContent).toBe("답을 확인해 주세요");
    expect(itemEl(host, "1").querySelector("input")).not.toBeNull();
  });
});

describe("WrongNoteList — 외웠어요 (Task 6)", () => {
  it("[외웠어요] → 목록에서 빠짐 → 토글 켜면 「외움」 + [다시 노트에] → off", async () => {
    const { host, onMaster } = mount();
    click(btn(itemEl(host, "1"), "외웠어요"));
    await flush();
    expect(onMaster).toHaveBeenCalledWith("aws", "1", true);
    expect(host.querySelector("[data-wn-item='1']")).toBeNull();
    expect(text(host)).toContain("외움 1");
    click([...host.querySelectorAll("label")].find((l) => text(l).includes("외운 문제 1개 보기"))!.querySelector("input"));
    click(btn(itemEl(host, "1"), "다시 노트에"));
    await flush();
    expect(onMaster).toHaveBeenLastCalledWith("aws", "1", false);
    expect(text(itemEl(host, "1").querySelector("[aria-label='문항 상태']"))).toBe("오답");
  });
});
