// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderCell } from "./tableWidget";

describe("renderCell 그림 (md-images 스펙 §5)", () => {
  it("그림은 불러오지 않고 자리표시 글자", () => {
    const td = document.createElement("td");
    renderCell(td, "앞 ![구성](attachment:a.png) ![](attachment:b.svg) ![](https://x.io/t.png)");
    expect(td.querySelector("img")).toBeNull();
    expect(td.textContent).toBe("앞 [그림: 구성] [그림: b.svg] [그림: https://x.io/t.png]");
  });
});
