// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { IosNoInputZoom } from "./IosNoInputZoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "width=device-width, initial-scale=1";
const mount = (ua: string, touch = 0) => {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: touch, configurable: true });
  document.head.innerHTML = `<meta name="viewport" content="${BASE}">`;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(createElement(IosNoInputZoom)));
  return document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("IosNoInputZoom", () => {
  it("iPhone·iPadOS(맥 UA + 터치)는 maximum-scale=1 을 더한다", () => {
    expect(mount("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(`${BASE}, maximum-scale=1`);
    expect(mount("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(`${BASE}, maximum-scale=1`);
  });
  it("안드로이드·데스크톱은 그대로 — 손가락 확대를 막지 않는다", () => {
    expect(mount("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(BASE);
    expect(mount("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(BASE);
  });
});
