// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { LeafBody } from "./LeafBody";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

describe("LeafBody (before task_get resolves)", () => {
  const leaf = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).leaves.find((l) => l.title === "IAM 정책 이해")!;
  const doc = () => {
    const d = document.createElement("div");
    const body = createElement(LeafBody, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast: () => {}, viewerPending: false, onUploadingChange: () => {} });
    d.innerHTML = renderToStaticMarkup(createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], body));
    return d;
  };
  it("renders the status list from tree people with no expand toggles", () => {
    const d = doc();
    expect(d.querySelector("h3")?.textContent).toContain("제출 현황");
    expect(d.querySelectorAll("button[aria-expanded]").length).toBe(0);
    expect(d.textContent).toContain("하나");
  });
  it("shows a busy skeleton for my card", () => expect(doc().querySelector('[aria-busy="true"]')).not.toBeNull());
  it("drops the plan-06 placeholder grid", () => expect(doc().innerHTML).not.toContain("minmax(150px"));
});
