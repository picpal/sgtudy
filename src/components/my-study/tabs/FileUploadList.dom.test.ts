// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileUploadList } from "./FileUploadList";

const html = (p: Partial<Parameters<typeof FileUploadList>[0]>) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(FileUploadList, { rows: [], onPick: () => {}, onRemove: () => {}, onRetry: () => {}, canRetry: () => false, ...p }));
  return d;
};

describe("FileUploadList label/hint", () => {
  it("defaults keep the submission wording", () => {
    const d = html({});
    expect(d.textContent).toContain("파일 (선택)");
    expect(d.textContent).toContain("파일당 10MB · 5개까지");
  });
  it("node attachments override the label and disable picking for temp rows", () => {
    const d = html({ label: "첨부 파일 (선택)", hint: "저장한 뒤 파일을 붙일 수 있어요", disabled: true });
    expect(d.textContent).toContain("첨부 파일 (선택)");
    expect(d.textContent).toContain("저장한 뒤 파일을 붙일 수 있어요");
    expect(d.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  });
  it("row buttons are 44px and name the file", () => {
    const d = html({ rows: [{ key: "k", fileId: "f", name: "자료.pdf", size: 4, status: "ready", progress: 100 }] });
    const b = d.querySelector('button[aria-label="자료.pdf 빼기"]')!;
    expect(b.className).toMatch(/h-11/);
  });
});

describe("FileUploadList 조각 복사 (md-images §4.2)", () => {
  const row = (fileId: string, name: string) => ({ key: `saved:${fileId}`, fileId, name, size: 3, status: "ready" as const, progress: 100 });
  const rows = [row("p", "구성도.png"), row("d", "자료.pdf")];
  it("canCopy 인 줄만 44px 「조각 복사」, 제출(onCopy 없음)은 없다", () => {
    const d = html({ rows, canCopy: (r) => r.fileId === "p", onCopy: () => {} });
    const b = d.querySelector('button[aria-label="구성도.png 조각 복사"]');
    expect(b?.className).toContain("h-11");
    expect(d.querySelector('button[aria-label="자료.pdf 조각 복사"]')).toBeNull();
    expect(html({ rows }).textContent).not.toContain("조각 복사");
  });
});
