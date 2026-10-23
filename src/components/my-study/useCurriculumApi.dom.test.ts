// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ToastMsg } from "@/components/ui/Toast";
import type { Curriculum, FileMeta } from "@/lib/api/types";
import { AWS, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, type Overrides } from "./model";
import { INITIAL_STATE, type Patch, type ScreenState } from "./state";
import { useCurriculumApi, type CurriculumApi } from "./useCurriculumApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ setFiles: vi.fn(), setFilesFrom: vi.fn(), nodeUpdate: vi.fn(), personalUpdate: vi.fn(), nodeCreate: vi.fn(), fetchCurriculum: vi.fn(), putExam: vi.fn(), calls: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/api/nodeFiles", () => ({ setNodeFiles: m.setFiles, setNodeFilesFrom: m.setFilesFrom }));
vi.mock("@/lib/api/personal", async (orig) => ({ ...(await orig<typeof import("@/lib/api/personal")>()), personalUpdate: m.personalUpdate }));
vi.mock("@/lib/api/my-study", async (orig) => ({ ...(await orig<typeof import("@/lib/api/my-study")>()), nodeUpdate: m.nodeUpdate, nodeCreate: m.nodeCreate, fetchCurriculum: m.fetchCurriculum }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), putExam: m.putExam }));

const leaf = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).nodes.find((n) => n.id === "21")!;
const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 3, status: "ready" });

let root: Root | null = null;
let S: ScreenState;
let toasts: ToastMsg[];
let api: CurriculumApi;
let cur: Curriculum;
const update = (p: Patch) => {
  S = { ...S, ...(typeof p === "function" ? p(S) : p) };
};
function Harness() {
  const a = useCurriculumApi("aws", (c) => void (cur = typeof c === "function" ? c(cur) : c), update, (t) => void toasts.push(t));
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
  cur = AWS;
  toasts = [];
  m.calls = [];
  m.setFilesFrom.mockReset();
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

  it("baseFiles 가 있으면 3인자 setNodeFilesFrom(0045 D30) — 2인자는 부르지 않는다", async () => {
    m.setFilesFrom.mockImplementation(async (_n: string, ids: string[]) => [...ids, "mcp"].map(meta));
    const onFiles = vi.fn();
    expect(await api.save(leaf, withOv({ files: { "21": ["a"] } }), { onFiles, baseFiles: ["a", "b"] })).toBe(true);
    expect(m.setFilesFrom).toHaveBeenCalledWith("21", ["a"], ["a", "b"]);
    expect(m.setFiles).not.toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledWith([meta("a"), meta("mcp")]);          // 편집 중 붙은 그림은 남는다
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

describe("api.updatePersonal — 실패 토스트 앞말", () => {
  it("failPrefix 를 구체적인 실패 사유 앞에 붙인다 (사유를 덮지 않는다)", async () => {
    m.personalUpdate.mockReset().mockRejectedValue(Object.assign(new Error("x"), { code: "ROOM_NOT_EDITABLE", message: "x" }));
    expect(await api.updatePersonal("32", { title: "a" }, "저장했어요", "첨부 파일은 저장했어요 · ")).toBeNull();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.text.startsWith("첨부 파일은 저장했어요 · ")).toBe(true);
    expect(toasts[0]!.text.length).toBeGreaterThan("첨부 파일은 저장했어요 · ".length);
  });
  it("앞말이 없으면 그대로", async () => {
    m.personalUpdate.mockReset().mockRejectedValue(Object.assign(new Error("x"), { code: "ROOM_NOT_EDITABLE", message: "x" }));
    await api.updatePersonal("32", { title: "a" });
    expect(toasts[0]!.text.startsWith("첨부")).toBe(false);
  });
});

describe("api.create — 시험 (exam: true)", () => {
  const round = AWS.nodes.find((n) => n.parentId === null)!;
  const sib = AWS.nodes.find((n) => n.parentId === round.id)!;
  const created: Curriculum = { ...AWS, nodes: [...AWS.nodes, { ...sib, id: "900", title: "3주차 정리 시험", sortOrder: 900, exam: null }] };
  const withExam: Curriculum = { ...created, nodes: created.nodes.map((n) => (n.id === "900" ? { ...n, exam: { status: "draft", questionCount: 0, totalPoints: 0, reveal: "after_submit" } } : n)) };

  beforeEach(() => {
    m.nodeCreate.mockReset().mockImplementation(async () => {
      m.calls.push("node_create");
      return created;
    });
    m.putExam.mockReset().mockImplementation(async () => {
      m.calls.push("exam_put");
      return {};
    });
    m.fetchCurriculum.mockReset().mockImplementation(async () => {
      m.calls.push("curriculum_get");
      return withExam;
    });
  });

  it("node_create → exam_put(빈 초안) → 트리 다시 받기 → 새 리프의 출제 화면", async () => {
    let ok = false;
    await act(async () => {
      ok = await api.create(round.id, { title: "3주차 정리 시험", open: false, taskType: "common", exam: true });
    });
    expect(ok).toBe(true);
    expect(m.calls).toEqual(["node_create", "exam_put", "curriculum_get"]);
    expect(m.putExam).toHaveBeenCalledWith("aws", "900", { reveal: "after_submit", questions: [] });
    expect(cur.nodes.find((n) => n.id === "900")?.exam?.status).toBe("draft");
    expect(S).toMatchObject({ curMode: "edit", editSel: "900", editFrom: "list", justAdded: "900", quickAdd: null });
    expect(toasts).toEqual([]);
  });

  it("exam_put 실패: 토스트, 리프는 남고 목록에 머문다", async () => {
    m.putExam.mockRejectedValue(new Error("x"));
    let ok = false;
    await act(async () => {
      ok = await api.create(round.id, { title: "3주차 정리 시험", open: false, exam: true });
    });
    expect(ok).toBe(true);
    expect(m.fetchCurriculum).not.toHaveBeenCalled();
    expect(cur.nodes.some((n) => n.id === "900")).toBe(true);
    expect(S.editSel).toBeNull();
    expect(toasts).toEqual([{ text: "시험을 만들지 못했어요 · 과제는 추가됐어요", tone: "bad" }]);
  });

  it("트리 다시 받기가 실패해도 새 리프에 초안 요약을 붙여 출제 화면으로", async () => {
    m.fetchCurriculum.mockRejectedValue(new Error("x"));
    await act(async () => {
      await api.create(round.id, { title: "3주차 정리 시험", open: false, exam: true });
    });
    expect(cur.nodes.find((n) => n.id === "900")?.exam?.status).toBe("draft");
    expect(S.editSel).toBe("900");
  });

  it("exam 없이는 exam_put 을 부르지 않는다", async () => {
    await act(async () => {
      await api.create(round.id, { title: "그냥 과제", open: false });
    });
    expect(m.putExam).not.toHaveBeenCalled();
    expect(S.editSel).toBeNull();
  });
});
