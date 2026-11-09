import { describe, expect, it } from "vitest";
import { placeCalPopover } from "./calPopover";

const bar = (top: number, left: number, right: number) => ({ top, bottom: top + 26, left, right });

describe("placeCalPopover — 누른 막대 기준 자리", () => {
  it("아래에 자리가 있으면 막대 바로 아래, 누른 x 가운데", () => {
    expect(placeCalPopover(bar(100, 200, 600), 400, 300, 1280, 800)).toEqual({ top: 132, left: 250, width: 300, side: "below", maxHeight: null });
  });

  it("아래가 모자라면 위로 뒤집는다", () => {
    const p = placeCalPopover(bar(600, 200, 600), 400, 300, 1280, 800);
    expect(p.side).toBe("above");
    expect(p.top).toBe(600 - 6 - 300);
  });

  it("둘 다 모자라면 넓은 쪽에 붙이고 높이를 제한한다", () => {
    expect(placeCalPopover(bar(100, 0, 100), 50, 500, 1280, 400)).toMatchObject({ side: "below", top: 132, maxHeight: 400 - 126 - 6 - 8 });
    expect(placeCalPopover(bar(300, 0, 100), 50, 500, 1280, 400)).toMatchObject({ side: "above", top: 8, maxHeight: 300 - 6 - 8 });
  });

  it("왼쪽·오른쪽 끝에서는 화면 안으로 민다", () => {
    expect(placeCalPopover(bar(100, 0, 60), 10, 200, 1280, 800).left).toBe(8);
    expect(placeCalPopover(bar(100, 1200, 1275), 1270, 200, 1280, 800).left).toBe(1280 - 300 - 8);
  });

  it("캘린더 칸이 있으면 그 안에 머문다(옆 메뉴를 덮지 않음), 칸이 좁으면 화면 기준", () => {
    const cal = { left: 377, right: 1220 };
    expect(placeCalPopover(bar(100, 377, 500), 380, 200, 1280, 800, cal).left).toBe(377);
    expect(placeCalPopover(bar(100, 1100, 1219), 1215, 200, 1280, 800, cal).left).toBe(1220 - 300);
    expect(placeCalPopover(bar(100, 0, 100), 50, 200, 1280, 800, { left: 0, right: 200 }).left).toBe(8);
  });

  it("키보드로 열면(x 없음) 막대 가운데 기준", () => {
    expect(placeCalPopover(bar(100, 500, 700), null, 200, 1280, 800).left).toBe(450);
  });

  it("좁은 화면에서는 너비를 화면 안으로 줄인다", () => {
    expect(placeCalPopover(bar(100, 0, 100), 50, 200, 280, 800)).toMatchObject({ width: 264, left: 8 });
  });
});
