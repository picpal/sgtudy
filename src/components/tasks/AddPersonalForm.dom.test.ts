// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeTasks } from "@/lib/api/types";
import { AddPersonalForm } from "./AddPersonalForm";

// QA Q3-2: 머리 "＋ 목표" 폼이 고른 스터디 칩을 따르고, 스터디 이름을 늘 보이며, 못 더하는 방은 이유를 알린다
const data = (): MeTasks => ({
  today: "2026-10-16",
  personalPerRound: 20,
  studies: [
    { slug: "cs", title: "CS 면접", tone: "mint", status: "active", membership: "joined", currentRoundId: "c1", canAddPersonal: true },
    { slug: "aws", title: "AWS", tone: "blue", status: "recruit", membership: "joined", currentRoundId: "a1", canAddPersonal: true },
    { slug: "mine", title: "[QA] 내 방", tone: "lav", status: "draft", membership: "leader", currentRoundId: "m1", canAddPersonal: false },
  ],
  rounds: [
    { id: "c1", slug: "cs", label: "1주차", title: "자료구조", startDate: "2026-10-12", endDate: "2026-10-18", canAdd: true },
    { id: "a1", slug: "aws", label: "1주차", title: "IAM", startDate: "2026-10-12", endDate: "2026-10-18", canAdd: true },
    { id: "m1", slug: "mine", label: "1주차", title: "준비", startDate: "2026-11-01", endDate: "2026-11-07", canAdd: false },
  ],
  items: [],
});
const render = (chosen?: string, m = data()) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(AddPersonalForm, { data: m, chosenSlug: chosen, onAdd: async () => true, onClose: () => {} }));
  return d;
};
const roundOptions = (d: HTMLElement) => Array.from(d.querySelectorAll<HTMLSelectElement>("select")).find((s) => s.closest("label")?.textContent?.startsWith("회차"))!;

describe("AddPersonalForm — 스터디 칩을 따른다", () => {
  it("칩으로 고른 방(추가 가능): 스터디 고르기 없이 그 방 이름을 보이고 회차도 그 방 것", () => {
    const d = render("aws");
    expect(d.querySelector("form")).not.toBeNull();
    expect(Array.from(d.querySelectorAll("select")).length).toBe(1); // 회차만
    expect(d.textContent).toContain("AWS");
    expect(Array.from(roundOptions(d).options).map((o) => o.value)).toEqual(["a1"]);
  });
  it("칩으로 고른 방이 추가 불가(준비중)면 폼 대신 이유", () => {
    const d = render("mine");
    expect(d.querySelector("form")).toBeNull();
    expect(d.textContent).toContain("[QA] 내 방");
    expect(d.textContent).toContain("모집을 시작하면 개인 목표를 추가할 수 있어요");
    expect(Array.from(d.querySelectorAll("button")).some((b) => b.textContent === "닫기")).toBe(true);
  });
  it("전체(칩 없음) + 추가 가능한 방 여럿: 스터디 고르기", () => {
    const d = render(undefined);
    const study = Array.from(d.querySelectorAll<HTMLSelectElement>("select")).find((s) => s.closest("label")?.textContent?.startsWith("스터디"));
    expect(study && Array.from(study.options).map((o) => o.value)).toEqual(["cs", "aws"]);
  });
  it("추가 가능한 방이 하나뿐이어도 스터디 이름은 보인다", () => {
    const m = data();
    m.studies = m.studies.filter((s) => s.slug !== "aws");
    const d = render(undefined, m);
    expect(d.textContent).toContain("CS 면접");
  });
});
