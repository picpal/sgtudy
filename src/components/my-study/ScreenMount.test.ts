import { describe, expect, it } from "vitest";
import { screenKeyText } from "@/lib/leaveGuard";
import { initialMount, nextMount, type MountState } from "./ScreenMount";

/** 렌더 한 번 — 서버 key · 주소 쿼리 · popstate 수 */
const step = (s: MountState, server: string, q: string, pop = s.pop) => nextMount(s, server, screenKeyText("aws", new URLSearchParams(q)), q, pop);
const start = (q: string) => {
  const k = screenKeyText("aws", new URLSearchParams(q));
  return initialMount(k, k, q, 0);
};

describe("ScreenMount — 이동만 다시 마운트, router.refresh 는 그대로", () => {
  it("screenKeyText 는 page.tsx key 규칙(정규화 포함)과 같다", () => {
    expect(screenKeyText("aws", new URLSearchParams(""))).toBe("aws::overview");
    expect(screenKeyText("aws", new URLSearchParams("tab=curriculum&item=830"))).toBe("aws::curriculum");
    expect(screenKeyText("aws", { tab: "nope", task: "x1" })).toBe("aws::overview");
    expect(screenKeyText("aws", new URLSearchParams("task=42&tab=board"))).toBe("aws:42:board");
  });

  it("개요에서 상세를 연 뒤(주소 tab=curriculum) 제출의 router.refresh 가 그 key 를 가져와도 다시 마운트하지 않는다 (제출 뒤 [다시 시도] 회귀)", () => {
    let s = start("");
    s = step(s, "aws::overview", "tab=curriculum&item=830"); // 화면이 History API 로 주소만 바꾼 렌더
    expect(s.mount).toBe(0);
    s = step(s, "aws::curriculum", "tab=curriculum&item=830"); // router.refresh()
    expect(s.mount).toBe(0);
    expect(s.server).toBe("aws::curriculum");
  });

  it("알림 진입(?task=) 뒤 상세를 옮겨 task 가 빠진 주소도 새로 고침에 그대로", () => {
    let s = start("task=42&tab=curriculum");
    s = step(s, "aws:42:curriculum", "tab=curriculum&item=7");
    s = step(s, "aws::curriculum", "tab=curriculum&item=7");
    expect(s.mount).toBe(0);
  });

  it("이동(주소와 서버 key 가 한 렌더에서 함께 바뀜)은 다시 마운트한다 — 알림 링크·router.push", () => {
    let s = start("");
    s = step(s, "aws:42:curriculum", "task=42&tab=curriculum");
    expect(s.mount).toBe(1);
    // 처음 key(overview)로 돌아가는 이동도 다시 마운트 — 화면이 보드 탭을 보이던 채로 남지 않게
    let t = start("tab=overview");
    t = step(t, "aws::overview", "tab=board");
    t = step(t, "aws::board", "tab=board");
    expect(t.mount).toBe(0);
    t = step(t, "aws::overview", "tab=overview");
    expect(t.mount).toBe(1);
  });

  it("뒤로 가기는 주소가 먼저, 서버 key 가 뒤 렌더에 와도 다시 마운트한다", () => {
    let s = start("tab=overview");
    s = step(s, "aws::overview", "tab=board"); // 탭 전환(화면이 주소를 씀)
    s = step(s, "aws::board", "tab=board"); // 새로 고침
    s = step(s, "aws::overview", "tab=overview"); // 알림 링크로 개요
    expect(s.mount).toBe(1);
    s = step(s, "aws::overview", "tab=board", 1); // 뒤로 가기 — 주소만 먼저
    expect(s.mount).toBe(1);
    s = step(s, "aws::board", "tab=board", 1); // 서버 key 가 뒤따라 온다
    expect(s.mount).toBe(2);
  });

  it("Next 가 주소를 먼저 바꾸고 popstate 가 뒤에 와도(실제 순서) 서버 key 가 오면 다시 마운트한다", () => {
    let s = start("tab=overview");
    s = step(s, "aws::overview", "tab=board");
    s = step(s, "aws::board", "tab=board");
    s = step(s, "aws::overview", "tab=overview");
    s = step(s, "aws::overview", "tab=board"); // 뒤로 가기 — 주소 렌더(popstate 는 아직)
    s = step(s, "aws::overview", "tab=board", 1); // popstate
    s = { ...s, armed: false }; // 잠시 뒤 풀림(useEffect 타이머)
    s = step(s, "aws::board", "tab=board", 1);
    expect(s.mount).toBe(2);
  });

  it("화면 안 뒤로 가기(상세 → 목록, key 그대로) 뒤 상세를 다시 열고 제출해도 다시 마운트하지 않는다", () => {
    let s = start("");
    s = step(s, "aws::overview", "tab=curriculum&item=5"); // 상세 열기(push)
    s = step(s, "aws::overview", "", 0); // 뒤로 — 목록 주소
    s = step(s, "aws::overview", "", 1); // popstate (주소 key = 서버 key)
    s = { ...s, armed: false };
    s = step(s, "aws::overview", "tab=curriculum&item=830"); // 시험 상세 열기
    s = step(s, "aws::curriculum", "tab=curriculum&item=830"); // 제출 → router.refresh()
    expect(s.mount).toBe(0);
  });

  it("뒤로 가기 뒤 화면이 직접 주소를 바꾸면 그다음 새로 고침은 다시 그대로", () => {
    let s = start("tab=overview");
    s = step(s, "aws::overview", "tab=overview&item=5", 1); // 화면 안 뒤로 가기(상세 기록)
    s = step(s, "aws::overview", "tab=curriculum&item=8"); // 화면이 다른 상세를 연다
    s = step(s, "aws::curriculum", "tab=curriculum&item=8"); // 새로 고침
    expect(s.mount).toBe(0);
  });

  it("바뀐 게 없으면 같은 상태 객체를 돌려준다(렌더 중 setState 반복 없음)", () => {
    const s = start("tab=board");
    expect(step(s, "aws::board", "tab=board")).toBe(s);
  });
});
