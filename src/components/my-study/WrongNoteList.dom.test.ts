// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExamQuestion, WrongNoteExam, WrongNoteItem, WrongNotePractice } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import type { PracticeOutcome } from "./useWrongNote";
import { mergePractice, setMastered, type NoteStudy } from "./wrongNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom 에는 없다 — 문항 이동이 부른다
Element.prototype.scrollIntoView ??= function () {};
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

type Opt = { studies?: NoteStudy[]; scope?: "room" | "all"; pending?: boolean; studyFilter?: string; round?: string | null; practice?: (slug: string, a: { questionId: string; answer: unknown }[]) => PracticeOutcome | Promise<PracticeOutcome> };
function mount(o: Opt = {}) {
  const onPractice = vi.fn(async (slug: string, answers: { questionId: string; answer: unknown }[]): Promise<PracticeOutcome> => o.practice?.(slug, answers) ?? { ok: false });
  const onMaster = vi.fn<(slug: string, id: string, on: boolean) => Promise<boolean>>(async () => true);
  // 부모(useWrongNote)처럼 응답을 목록에 합친다
  function H() {
    const [studies, setStudies] = useState(o.studies ?? [AWS()]);
    // 부모(useNoteRound)처럼 열린 회차를 든다 — 기본은 3주차 상세
    const [round, setRound] = useState<string | null>(o.round === undefined ? "3" : o.round);
    return createElement(WrongNoteList, {
      studies, scope: o.scope ?? "room", pending: o.pending, studyFilter: o.studyFilter, busy: false,
      round, onOpenRound: setRound, onBack: () => setRound(null), periods: { "3": { startDate: "2026-10-15", endDate: "2026-10-21" } },
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
  it("목록 = 회차 카드(h3) · 머리줄 합계 · 문항은 그리지 않음 · 카드 → 상세(시험 카드 머리 · 문항 번호)", () => {
    const { host } = mount({ round: null });
    expect([...host.querySelectorAll("h3")].map(text)).toEqual(["3주차", "4주차"]);
    expect(host.querySelector("h2")).toBeNull();
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(text(host)).toContain("오답 3문항 · 다시 풀어 맞힘 1 · 잠김 6");
    click(host.querySelector("[data-round-card='3']"));
    expect([...host.querySelectorAll("h3")].map(text)).toEqual(["3주차"]);
    expect(text(host)).toContain("1/5점 · 오답 3문항");
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

  it("필터 칩(radiogroup): 다시 풀어 맞힘 → 그 문항만 · 잠긴 회차 카드 빠짐, 아직 못 맞힘 → 나머지 + 잠금", () => {
    const list = mount({ round: null });
    click(btn(list.host.querySelector("[role='radiogroup']")!, "다시 풀어 맞힘"));
    expect([...list.host.querySelectorAll("h3")].map(text)).toEqual(["3주차"]);
    expect(text(list.host)).toContain("조건에 맞는 1문항");
    click(btn(list.host.querySelector("[role='radiogroup']")!, "아직 못 맞힘"));
    expect([...list.host.querySelectorAll("h3")].map(text)).toEqual(["3주차", "4주차"]);
    act(() => root!.unmount());
    const { host } = mount();
    const group = host.querySelector("[role='radiogroup']")!;
    expect([...group.querySelectorAll("[role='radio']")].map((b) => [text(b), b.getAttribute("aria-checked")])).toEqual([["전체", "true"], ["아직 못 맞힘", "false"], ["다시 풀어 맞힘", "false"]]);
    click(btn(group, "다시 풀어 맞힘"));
    expect([...host.querySelectorAll("[data-wn-item]")].map((e) => e.getAttribute("data-wn-item"))).toEqual(["2"]);
    click(btn(group, "아직 못 맞힘"));
    expect([...host.querySelectorAll("[data-wn-item]")].map((e) => e.getAttribute("data-wn-item"))).toEqual(["1", "3"]);
  });

  it("잠긴 회차 카드: 자물쇠 · 열리는 날 · 누를 수 없음 / 상세로 와도 잠금 안내 + 개수·날짜만(문항·정답 없음)", () => {
    const list = mount({ round: null });
    const lockedCard = [...list.host.querySelectorAll("article")].find((a) => text(a).includes("4주차"))!;
    expect(text(lockedCard)).toContain("잠김 6 · 10.28 마감 뒤에 열려요");
    expect(lockedCard.querySelectorAll("button").length).toBe(0);
    expect(lockedCard.querySelector("svg")).not.toBeNull();
    act(() => root!.unmount());
    const { host } = mount({ round: "4" });
    expect(host.querySelector("[role='note']")?.textContent).toContain("10.28 마감 뒤에 열려요");
    const card = [...host.querySelectorAll("article")].find((a) => text(a).includes("종합 시험"))!;
    expect(text(card)).toContain("4/10점 · 오답 6문항 · 10.28 마감 뒤에 열려요");
    expect(card.querySelectorAll("button").length).toBe(0);
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(host.querySelector("[role='radiogroup']")).toBeNull();
    expect(host.querySelector('nav[aria-label="문항 이동"]')).toBeNull();
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
    const { host } = mount({ studies: [{ ...AWS(), title: "AWS 스터디", tone: "mint" }, SPRING, empty], scope: "all", round: null });
    expect([...host.querySelectorAll("h2")].map((h) => text(h).replace("오답노트 ›", ""))).toEqual(["AWS 스터디", "Spring 스터디", "Go 스터디"]);
    expect(host.querySelector("h2 a")?.getAttribute("href")).toBe(routes.myStudyTab("aws", "wrong"));
    expect(text(host)).toContain("아직 시험이 없는 방이에요");
    act(() => root!.unmount());
    const m = mount({ studies: [{ ...AWS(), title: "AWS 스터디", tone: "mint" }, SPRING], scope: "all", studyFilter: "spring", round: null });
    expect([...m.host.querySelectorAll("h2")].map((h) => text(h).replace("오답노트 ›", ""))).toEqual(["Spring 스터디"]);
    expect(text(m.host)).toContain("오답 1문항");
    act(() => root!.unmount());
    const go: NoteStudy = { slug: "go", title: "Go 스터디", tone: "mint", hasExam: false, rounds: [] };
    const g = mount({ studies: [SPRING, go], scope: "all", studyFilter: "go", round: null });
    expect([...g.host.querySelectorAll("h2")].map((h) => text(h).replace("오답노트 ›", ""))).toEqual(["Go 스터디"]);
    expect(text(g.host)).toContain("아직 시험이 없는 방이에요");
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
    expect(text(host.querySelector("header"))).toContain("오답 2 · 미답 1 · 다시 풀어 맞힘 2");
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
    const { host, onPractice } = mount({ studies: [{ ...AWS(), title: "AWS", tone: "mint" }, SPRING], scope: "all", round: "9", practice: (_s, a) => ({ ok: true, results: { [a[0].questionId]: { correct: false, practice: P(false) } } }) });
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

describe("WrongNoteList — 포커스 (리뷰 2)", () => {
  const OK = (_s: string, a: { questionId: string }[]): PracticeOutcome => ({ ok: true, results: Object.fromEntries(a.map((x) => [x.questionId, { correct: true, practice: P(true) }])) });
  it("[다시 풀기] → 첫 보기 · [채점] → [한 번 더] · [한 번 더] → 첫 보기 · [취소] → [다시 풀기]", async () => {
    const { host } = mount({ practice: OK });
    click(btn(itemEl(host, "1"), "다시 풀기"));
    expect(document.activeElement).toBe(itemEl(host, "1").querySelector("input[type='radio']"));
    click(btn(itemEl(host, "1"), "채점"));
    await flush();
    expect(document.activeElement).toBe(btn(itemEl(host, "1"), "한 번 더"));
    (document.activeElement as HTMLElement).blur();
    click(btn(itemEl(host, "1"), "한 번 더"));
    expect(document.activeElement).toBe(itemEl(host, "1").querySelector("input[type='radio']"));
    (document.activeElement as HTMLElement).blur();
    click(btn(itemEl(host, "1"), "취소"));
    expect(document.activeElement).toBe(btn(itemEl(host, "1"), "다시 풀기"));
  });

  it("[외웠어요] 로 빠지면 다음 문항의 [다시 풀기] · 마지막이면 앞 문항 · [다시 노트에] 는 그 문항의 [외웠어요]", async () => {
    const { host } = mount();
    click(btn(itemEl(host, "1"), "외웠어요"));
    await flush();
    expect(document.activeElement).toBe(btn(itemEl(host, "2"), "다시 풀기"));
    (document.activeElement as HTMLElement).blur();
    click(btn(itemEl(host, "3"), "외웠어요"));
    await flush();
    expect(document.activeElement).toBe(btn(itemEl(host, "2"), "다시 풀기"));
    (document.activeElement as HTMLElement).blur();
    click([...host.querySelectorAll("label")].find((l) => text(l).includes("외운 문제"))!.querySelector("input"));
    (document.activeElement as HTMLElement)?.blur?.();
    click(btn(itemEl(host, "1"), "다시 노트에"));
    await flush();
    expect(document.activeElement).toBe(btn(itemEl(host, "1"), "외웠어요"));
  });

  it("묶음 채점 뒤 포커스는 막대의 [닫기]", async () => {
    const { host } = mount({ practice: OK });
    click(btn(host, "이 시험 다시 풀기"));
    expect(document.activeElement).toBe(itemEl(host, "1").querySelector("input[type='radio']"));
    (document.activeElement as HTMLElement).blur();
    click(btn(host, "채점"));
    await flush();
    expect(document.activeElement).toBe(btn(host, "닫기"));
  });
});

describe("WrongNoteList — 채점 중 필터 변경 (리뷰 4)", () => {
  it("묶음 채점 응답 전에 필터로 문항이 빠지면 응답이 와도 묶음·결과를 되살리지 않는다", async () => {
    let resolve!: (o: PracticeOutcome) => void;
    const { host } = mount({ practice: () => new Promise<PracticeOutcome>((r) => (resolve = r)) });
    click(btn(host, "이 시험 다시 풀기"));
    click(btn(host, "채점"));
    // 「다시 풀어 맞힘」 은 2번만 — 1·3번은 빠지고 입력도 버린다
    click(btn(host.querySelector("[role='radiogroup']")!, "다시 풀어 맞힘"));
    await act(async () => resolve({ ok: true, results: { "1": { correct: true, practice: P(true) }, "2": { correct: false, practice: P(false) }, "3": { correct: true, practice: P(true) } } }));
    expect(text(host)).toContain("1문항 중 0 맞힘");
    click(btn(host.querySelector("[role='radiogroup']")!, "전체"));
    // 1·3번은 다시 풀기 상태가 아니다(입력·결과 없음) — 응답은 목록에만 합쳐졌다
    expect(itemEl(host, "1").querySelector("input")).toBeNull();
    expect(text(itemEl(host, "1"))).not.toContain("맞혔어요");
  });

  it("문항 하나 채점 응답 전에 필터로 빠지면 결과를 붙이지 않는다", async () => {
    let resolve!: (o: PracticeOutcome) => void;
    const { host } = mount({ practice: () => new Promise<PracticeOutcome>((r) => (resolve = r)) });
    click(btn(itemEl(host, "1"), "다시 풀기"));
    click(btn(itemEl(host, "1"), "채점"));
    click(btn(host.querySelector("[role='radiogroup']")!, "다시 풀어 맞힘"));
    await act(async () => resolve({ ok: true, results: { "1": { correct: true, practice: P(true) } } }));
    // 응답은 목록에 합쳐져 1번이 「다시 풀어 맞힘」 이 됐지만, 다시 풀기 상태는 버렸으니 기본 화면
    expect(btn(itemEl(host, "1"), "다시 풀기")).not.toBeNull();
    expect(text(itemEl(host, "1"))).not.toContain("✓ 맞혔어요");
  });
});

describe("WrongNoteList — 회차 카드 → 상세 (D22·D23)", () => {
  it("카드: 기간·시험 수·오답/미답/다시 풀어 맞힘 · 누르면 onOpenRound → 상세 제목에 포커스 · [회차 목록] → 그 카드에 포커스", () => {
    const { host } = mount({ round: null });
    const card = host.querySelector<HTMLElement>("[data-round-card='3']")!.closest("article")!;
    expect(text(card)).toContain("10.15 ~ 10.21 · 시험 1개");
    expect([...card.querySelectorAll("li")].map(text)).toEqual(["오답 2", "미답 1", "다시 풀어 맞힘 1"]);
    click(host.querySelector("[data-round-card='3']"));
    expect(document.activeElement?.hasAttribute("data-wn-head")).toBe(true);
    expect(text(document.activeElement)).toBe("3주차");
    click(btn(host, "회차 목록"));
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(document.activeElement?.getAttribute("data-round-card")).toBe("3");
  });

  it("없는 회차 id → 안내 + [회차 목록으로]", () => {
    const { host } = mount({ round: "999" });
    expect(text(host)).toContain("이 회차의 오답을 찾을 수 없어요");
    click(btn(host, "회차 목록으로"));
    expect(host.querySelector("[data-round-card='3']")).not.toBeNull();
  });

  it("여러 스터디(scope all) 상세 — 머리에 스터디 이름", () => {
    const { host } = mount({ studies: [{ ...AWS(), title: "AWS 스터디", tone: "mint" }, SPRING], scope: "all", round: "9" });
    expect(text(host.querySelector("header"))).toContain("Spring 스터디");
    expect(host.querySelector("[data-wn-item='11']")).not.toBeNull();
    expect(host.querySelector("[data-wn-item='1']")).toBeNull();
  });
});

describe("WrongNoteList — 상세 문항 이동 · 다시 푼 횟수 색 (D24·D25)", () => {
  const nav = (host: HTMLElement) => host.querySelector<HTMLElement>('nav[aria-label="문항 이동"]')!;
  const cell = (host: HTMLElement, no: number) => [...nav(host).querySelectorAll("button")].find((b) => b.textContent?.startsWith(String(no)))!;
  const P2 = (c: number, w: number, last: boolean): WrongNotePractice => ({ lastCorrect: last, correctCount: c, wrongCount: w, lastAnswer: 0, lastAt: "2026-10-18T00:00:00.000Z" });

  it("번호 = 시험 안 번호 · aria-label·title 에 다시 푼 횟수와 마지막 정오 · 횟수 단계 색 · 각주는 번호 아래", () => {
    const st = AWS();
    st.rounds[0].exams[0].items![2].practice = P2(1, 3, false);
    const { host } = mount({ studies: [st] });
    expect([...nav(host).querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "1번 문항 · 아직 다시 풀지 않았어요",
      "2번 문항 · 1번 다시 풀었어요 · 마지막에 맞힘",
      "3번 문항 · 4번 다시 풀었어요 · 마지막에 틀림",
    ]);
    expect(cell(host, 2).getAttribute("title")).toBe("2번 문항 · 1번 다시 풀었어요 · 마지막에 맞힘");
    expect(cell(host, 1).className).toContain("bg-surface");
    expect(cell(host, 2).className).toContain("bg-blue-soft");
    expect(cell(host, 3).className).toContain("bg-navy");
    expect(text(cell(host, 2))).toBe("2✓");
    expect(text(cell(host, 3))).toBe("3✗");
    expect(text(nav(host))).toContain("3문항");
    // 각주: 번호 목록 뒤(아래)
    const legend = nav(host).querySelector("[data-wn-legend]")!;
    expect(text(legend)).toContain("다시 푼 횟수");
    expect(text(legend)).toContain("0번1번2번3번+");
    expect(text(legend)).toContain("마지막에 맞힘");
    const lists = [...nav(host).children];
    expect(lists.indexOf(legend)).toBeGreaterThan(lists.indexOf(nav(host).querySelector("ol")!.parentElement!));
  });

  it("번호를 누르면 그 문항으로(머리에 포커스)", () => {
    const { host } = mount();
    const calls: string[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push((this as HTMLElement).dataset.wnItem ?? "");
    };
    click(cell(host, 3));
    Element.prototype.scrollIntoView = orig;
    expect(calls).toEqual(["3"]);
    expect(document.activeElement?.id).toBe("exam-q-wn-3");
    expect(cell(host, 3).getAttribute("aria-current")).toBe("step");
  });

  it("다시 풀기 채점 결과가 오면 번호 색·라벨이 바로 바뀐다", async () => {
    const { host } = mount({ practice: (_s, a) => ({ ok: true, results: { [a[0].questionId]: { correct: false, practice: P2(1, 1, false) } } }) });
    expect(cell(host, 1).getAttribute("aria-label")).toBe("1번 문항 · 아직 다시 풀지 않았어요");
    click(btn(itemEl(host, "1"), "다시 풀기"));
    click(btn(itemEl(host, "1"), "채점"));
    await flush();
    expect(cell(host, 1).getAttribute("aria-label")).toBe("1번 문항 · 2번 다시 풀었어요 · 마지막에 틀림");
    expect(cell(host, 1).className).toContain("bg-blue ");
  });

  it("묶음 다시 풀기 중 — 그 시험 번호는 답함/안 답함 · 머리 n/총 답함 · 각주에 「답함」", () => {
    const { host } = mount();
    click(btn(host, "이 시험 다시 풀기"));
    expect(text(nav(host))).toContain("0/3 답함");
    expect(cell(host, 1).getAttribute("aria-label")).toBe("1번 문항 · 안 답함");
    click(itemEl(host, "1").querySelectorAll<HTMLInputElement>("input[type='radio']")[0]);
    expect(cell(host, 1).getAttribute("aria-label")).toBe("1번 문항 · 답함");
    expect(cell(host, 1).className).toContain("bg-mint-soft");
    expect(text(nav(host))).toContain("1/3 답함");
    expect(text(nav(host).querySelector("[data-wn-legend]"))).toContain("답함");
  });

  it("시험이 여럿이면 시험 이름으로 묶는다 · 좁은 화면 [문항 이동] 판을 열고 고르면 닫힌다", () => {
    const st = AWS();
    st.rounds[0].exams.push(exam("32", [item("21", { no: 1 })], { title: "보충 시험" }));
    const { host } = mount({ studies: [st] });
    expect([...nav(host).querySelectorAll("p")].map(text)).toContain("보충 시험");
    const toggle = btn(host, "문항 이동")!;
    click(toggle);
    const sheet = host.querySelector<HTMLElement>("#wn-nav-sheet")!;
    expect(sheet.querySelector("[data-wn-legend]")).not.toBeNull();
    expect(sheet.querySelector("button")!.className).toContain("h-11");
    click(sheet.querySelectorAll("button")[3]);
    expect(host.querySelector("#wn-nav-sheet")).toBeNull();
    expect(document.activeElement?.id).toBe("exam-q-wn-21");
  });
});
