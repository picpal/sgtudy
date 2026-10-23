import { describe, expect, it } from "vitest";
import { isImageMime, isSvgMime } from "./imageMime";

describe("isImageMime (D12)", () => {
  it("래스터 4종 + SVG 만", () => {
    expect(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].every(isImageMime)).toBe(true);
    expect(["application/pdf", "image/bmp", "text/html", "image/x-icon", ""].some(isImageMime)).toBe(false);
    expect(isSvgMime("image/svg+xml")).toBe(true);
  });
});
