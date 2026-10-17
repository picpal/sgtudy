import { describe, expect, it } from "vitest";
import { addTag, removeTag, sameTags, TAG_LIMIT, tagKey, tagLabelError, toPutArgs, type TagItem } from "./tags";

const aws: TagItem = { slug: "aws", label: "AWS", tone: "mint", auto: false };
const cloud: TagItem = { slug: "cloud", label: "클라우드", tone: "blue", auto: true };

describe("tags — 방 태그 고르기 (room_create p_tag_slugs · room_tags_put)", () => {
  it("사전 태그는 slug, 자유 입력은 소문자 라벨로 같은 태그를 가린다", () => {
    expect(tagKey(aws)).toBe("s:aws");
    expect(tagKey({ label: " Rust " })).toBe("l:rust");
  });

  it("추가: 끝에 붙인다. 같은 slug·같은 라벨(대소문자 무시)은 다시 넣지 않는다", () => {
    expect(addTag([aws], cloud)).toEqual({ list: [aws, cloud] });
    expect(addTag([aws], { ...aws }).list).toEqual([aws]);
    expect(addTag([{ label: "Rust" }], { label: "rust" }).list).toEqual([{ label: "Rust" }]);
    // 자유 입력이 사전 라벨과 같으면 사전 태그로 본다(서버 tag_slug_for 도 같은 라벨을 재사용)
    expect(addTag([aws], { label: "aws" }).list).toEqual([aws]);
  });

  it("추가: 8개를 넘으면 거절하고 이유를 준다", () => {
    const eight: TagItem[] = Array.from({ length: TAG_LIMIT }, (_, i) => ({ label: `t${i}` }));
    expect(addTag(eight, { label: "more" })).toEqual({ list: eight, error: "태그는 8개까지예요" });
  });

  it("자유 입력 라벨은 앞뒤 공백을 빼고 1~20자", () => {
    expect(tagLabelError("")).toBe("태그 이름을 입력해 주세요");
    expect(tagLabelError("   ")).toBe("태그 이름을 입력해 주세요");
    expect(tagLabelError("가".repeat(20))).toBeNull();
    expect(tagLabelError("가".repeat(21))).toBe("태그는 20자까지예요");
    expect(addTag([], { label: "  Rust  " }).list).toEqual([{ label: "Rust" }]);
    expect(addTag([], { label: "가".repeat(21) })).toEqual({ list: [], error: "태그는 20자까지예요" });
  });

  it("빼기: 키가 같은 태그만", () => {
    expect(removeTag([aws, cloud], "s:aws")).toEqual([cloud]);
    expect(removeTag([aws, { label: "Rust" }], "l:rust")).toEqual([aws]);
  });

  it("toPutArgs: slug 있는 태그는 slugs, 자유 입력은 freeLabels — 순서 유지", () => {
    expect(toPutArgs([aws, { label: "Rust" }, cloud])).toEqual({ slugs: ["aws", "cloud"], freeLabels: ["Rust"] });
  });

  it("sameTags: 순서까지 같아야 같다(서버 sort_order) — 자동 여부는 보지 않는다", () => {
    expect(sameTags([aws, cloud], [{ ...aws }, { ...cloud, auto: false }])).toBe(true);
    expect(sameTags([aws, cloud], [cloud, aws])).toBe(false);
    expect(sameTags([aws], [aws, cloud])).toBe(false);
  });
});
