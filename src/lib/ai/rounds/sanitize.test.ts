import { describe, expect, it } from "vitest";
import { sanitizeLine, sanitizeMd } from "./sanitize";

/* 회차 글 정규화(D31·§6) — 평문 + "- " 불릿만 */
describe("sanitizeMd", () => {
  it("링크는 글만 · 이미지·HTML 태그·맨 URL 제거", () => {
    expect(sanitizeMd("[공식 문서](https://evil.example) 읽기 ![x](https://t.example/p.png)<script>alert(1)</script> https://a.example/b", 300)).toBe(
      "공식 문서 읽기 alert(1)",
    );
    expect(sanitizeMd("<https://auto.example> 자동 링크", 300)).toBe("자동 링크");
  });
  it("헤딩 기호 제거 · 불릿 유지(*·+ → -) · 빈 줄 하나로 접기", () => {
    expect(sanitizeMd("# 목표\n\n\n\n- 하나\n* 둘\n+ 셋\n### ", 300)).toBe("목표\n\n- 하나\n- 둘\n- 셋");
  });
  it("제어문자 제거 · CRLF 정리 · 코드 포인트로 자르기", () => {
    expect(sanitizeMd("a\u0000b\r\nc", 300)).toBe("ab\nc");
    expect([...sanitizeMd("😀".repeat(400), 300)].length).toBe(300);
  });
});

describe("sanitizeLine", () => {
  it("한 줄로 · 불릿·헤딩 기호 없음 · 길이 40", () => {
    expect(sanitizeLine("## IAM\n- S3 기초", 40)).toBe("IAM S3 기초");
    expect([...sanitizeLine("가".repeat(100), 40)].length).toBe(40);
    expect(sanitizeLine("  <b></b>  ", 40)).toBe("");
  });
});
