// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExamQuestion } from "@/lib/api/types";
import { ExamQuestionView } from "./ExamQuestionView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const q: ExamQuestion = { id: "1", ord: 0, type: "ox", prompt: "S3 는 리전 서비스다.", choices: null, points: 1 };
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
const mount = (el: ReturnType<typeof createElement>) => {
  const host = document.createElement("ul");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host.querySelector("li")!;
};

describe("ExamQuestionView — 「AI에게 물어보기」 영역(D16)", () => {
  it('take mode → data-ask-ai="off"', () => {
    const li = mount(createElement(ExamQuestionView, { mode: "take", q, no: 1, mine: null, onChange: () => {} }));
    expect(li.dataset.askAi).toBe("off");
  });
  it('result mode → data-ask-ai="exam"', () => {
    const li = mount(createElement(ExamQuestionView, { mode: "result", q, no: 1, mine: true, correct: null, earned: null }));
    expect(li.dataset.askAi).toBe("exam");
  });
});
