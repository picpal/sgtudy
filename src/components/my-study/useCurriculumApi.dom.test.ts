// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ToastMsg } from "@/components/ui/Toast";
import type { FileMeta } from "@/lib/api/types";
import { AWS, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, type Overrides } from "./model";
import { INITIAL_STATE, type Patch, type ScreenState } from "./state";
import { useCurriculumApi, type CurriculumApi } from "./useCurriculumApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ setFiles: vi.fn(), nodeUpdate: vi.fn(), calls: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/api/nodeFiles", () => ({ setNodeFiles: m.setFiles }));
vi.mock("@/lib/api/my-study", async (orig) => ({ ...(await orig<typeof import("@/lib/api/my-study")>()), nodeUpdate: m.nodeUpdate }));

const leaf = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).nodes.find((n) => n.id === "21")!;
const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 3, status: "ready" });

let root: Root | null = null;
let S: ScreenState;
let toasts: ToastMsg[];
let api: CurriculumApi;
const update = (p: Patch) => {
  S = { ...S, ...(typeof p === "function" ? p(S) : p) };
};
function Harness() {
  const a = useCurriculumApi("aws", () => {}, update, (t) => void toasts.push(t));
  useEffect(() => {
    api = a;
  });
  return null;
}
const withOv = (ov: Partial<Overrides>) => {
  S = { ...S, ov: { ...EMPTY_OVERRIDES, ...ov } };
  return S.ov;
};

beforeEach(() => {
  S = INITIAL_STATE;
  toasts = [];
  m.calls = [];
  m.setFiles.mockReset().mockImplementation(async (_n: string, ids: string[]) => {
    m.calls.push("files");
    return ids.map(meta);
  });
  m.nodeUpdate.mockReset().mockImplementation(async () => {
    m.calls.push("node");
    return AWS;
  });
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
});
afterEach(() => act(() => root?.unmount()));

describe("api.save — 첨부 (node_files_set 먼저)", () => {
  it("첨부 + 내용: 선택 id 로 setNodeFiles → nodeUpdate, onFiles 로 새 목록", async () => {
    const ov = withOv({ files: { "21": ["a", "b"] }, titles: { "21": "새 제목" } });
    const onFiles = vi.fn();
    expect(await api.save(leaf, ov, { onFiles })).toBe(true);
    expect(m.setFiles).toHaveBeenCalledWith("21", ["a", "b"]);
    expect(m.calls).toEqual(["files", "node"]);
    expect(onFiles).toHaveBeenCalledWith([meta("a"), meta("b")]);
    expect("21" in S.ov.files).toBe(false);
  });

  it("첨부만: nodeUpdate 없이 '저장했어요'", async () => {
    const ov = withOv({ files: { "21": ["a"] } });
    expect(await api.save(leaf, ov)).toBe(true);
    expect(m.nodeUpdate).not.toHaveBeenCalled();
    expect(S.saved).toBe("저장했어요");
  });

  it("첨부 실패: false + ov.files 는 남긴다, 내용은 보내지 않는다", async () => {
    m.setFiles.mockRejectedValue(new Error("x"));
    const ov = withOv({ files: { "21": ["a"] }, titles: { "21": "t" } });
    expect(await api.save(leaf, ov)).toBe(false);
    expect(m.nodeUpdate).not.toHaveBeenCalled();
    expect(S.ov.files["21"]).toEqual(["a"]);
  });

  it("첨부를 쓸 수 없으면(목록을 못 불러옴) setNodeFiles 를 부르지 않는다", async () => {
    const ov = withOv({ files: { "21": ["a"] }, titles: { "21": "t" } });
    expect(await api.save(leaf, ov, { skipFiles: true })).toBe(true);
    expect(m.setFiles).not.toHaveBeenCalled();
    expect(m.nodeUpdate).toHaveBeenCalledTimes(1);
  });

  it("저장하는 사이 선택이 바뀌었으면(업로드 완료) ov.files 를 지우지 않는다 (M-2)", async () => {
    const ov = withOv({ files: { "21": ["a"] }, titles: { "21": "t" } });
    m.setFiles.mockImplementation(async (_n: string, ids: string[]) => {
      update((p) => ({ ov: { ...p.ov, files: { ...p.ov.files, "21": ["a", "late"] } } }));
      return ids.map(meta);
    });
    expect(await api.save(leaf, ov)).toBe(true);
    expect(S.ov.files["21"]).toEqual(["a", "late"]);
    expect("21" in S.ov.titles).toBe(false);
  });

  it("내용 저장 실패 — 첨부는 저장됐다고 알린다 (M-6)", async () => {
    m.nodeUpdate.mockRejectedValue(new Error("boom"));
    const ov = withOv({ files: { "21": ["a"] }, titles: { "21": "t" } });
    expect(await api.save(leaf, ov)).toBe(false);
    expect(m.setFiles).toHaveBeenCalled();
    expect(toasts.at(-1)?.text).toMatch(/^첨부 파일은 저장했어요 · /);
  });
});
