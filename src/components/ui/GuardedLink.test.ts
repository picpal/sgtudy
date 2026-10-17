import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 진행목표 편집 화면(MyStudyScreen)과 함께 보이는 화면 조각의 앱 안 링크는 모두 이탈 가드(leaveGuard)를 거친다 (Q2-1, 최종 리뷰 I-1).
 * next/link 를 직접 쓰면 저장 안 한 수정이 확인 없이 사라진다 — GuardedLink(또는 HomeLink → GuardedLink)를 쓴다.
 * 예외: GuardedLink 자신, 클릭을 직접 다루며 guardNavigate 를 부르는 NotificationBell.
 */
const ROOT = join(__dirname, "..");
const DIRS = ["my-study", "ui", "room-view", "room-settings"];
const ALLOWED = new Set(["ui/GuardedLink.tsx", "ui/NotificationBell.tsx"]);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

describe("편집 화면에 보이는 앱 안 링크는 이탈 가드를 거친다", () => {
  it("my-study·ui·room-view·room-settings 는 next/link 를 직접 쓰지 않는다", () => {
    const direct = DIRS.flatMap((d) => files(join(ROOT, d)))
      .filter((p) => /from "next\/link"/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ROOT, p))
      .filter((p) => !ALLOWED.has(p));
    expect(direct).toEqual([]);
  });
  it("NotificationBell 은 직접 guardNavigate 를 부른다", () => {
    expect(readFileSync(join(ROOT, "ui/NotificationBell.tsx"), "utf8")).toContain("guardNavigate(");
  });
});
