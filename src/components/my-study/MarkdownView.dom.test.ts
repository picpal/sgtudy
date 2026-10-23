// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Inline, MarkdownView, type ImageResolver } from "./MarkdownView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = (src: string, images?: ImageResolver) => renderToStaticMarkup(createElement(MarkdownView, { src, images }));
const SIGNED = "https://sb.test/storage/v1/object/sign/attachments/";
/** 이름 → 서명 URL 만 돌려주는 가짜 resolver — a.png·v.svg 만 있고 wait.png 는 아직 받는 중 */
const resolver = (over: Partial<ImageResolver> = {}): ImageResolver => ({
  resolve: (name) =>
    name === "wait.png" ? { state: "loading" }
    : name === "a.png" ? { state: "ok", fileId: "f-a", url: `${SIGNED}a?token=1`, svg: false }
    : name === "v.svg" ? { state: "ok", fileId: "f-v", url: `${SIGNED}v?token=1`, svg: true }
    : { state: "missing" },
  refresh: () => {},
  ...over,
});

describe("MarkdownView 그림 — resolver 없음 (D4)", () => {
  it("첨부 그림은 자리표시 글자, <img> 없음", () => {
    const h = html("![구성도](attachment:vpc.svg)\n![](attachment:b.png)");
    expect(h).not.toContain("<img");
    expect(h).toContain("[그림: 구성도]");
    expect(h).toContain("[그림: b.png]");
  });
  it("외부 그림은 불러오지 않고 링크 (D2)", () => {
    const h = html("![트래커](https://t.io/p.png)");
    expect(h).not.toContain("<img");
    expect(h).toContain('<a href="https://t.io/p.png" target="_blank" rel="noopener noreferrer nofollow"');
    expect(h).toContain("그림 링크: 트래커");
  });
  it("댓글 등 Inline 만 쓰는 곳도 자리표시", () => {
    expect(renderToStaticMarkup(createElement(Inline, { text: "![a](attachment:x.png)" }))).toBe('<span class="text-muted">[그림: a]</span>');
  });
});

describe("MarkdownView 중첩 목록 (D10 · §4.4)", () => {
  it("하위 목록은 항목 안에, ul 단계별 기호, ol start", () => {
    const h = html("- a\n  - b\n    - c\n\n3. x\n   - [x] 끝");
    expect(h).toContain('<ul class="m-0 pl-5 list-disc"><li>a<div class="mt-[2px] flex flex-col gap-[2px]"><ul class="m-0 pl-5 list-[circle]"><li>b');
    expect(h).toContain("list-[square]");
    expect(h).toContain('<ol start="3"');
    expect(h).toContain("완료: </span>끝");
  });
  it("평탄 목록은 그대로 — start 없음", () => {
    expect(html("1. a\n2. b")).toBe('<div class="flex flex-col gap-[10px] text-ink-2 text-[14px] leading-[1.75]"><ol class="m-0 pl-5 list-decimal"><li>a</li><li>b</li></ol></div>');
  });
  it("이어진 줄은 <br>", () => expect(html("- a\n  이어짐")).toContain("<li>a<br/>이어짐</li>"));
});

describe("MarkdownView 접기 (D8·D9)", () => {
  it("<details><summary> — 기본 닫힘, 44px, 빈 제목은 「펼쳐 보기」", () => {
    const h = html(":::details 해설 **굵게**\n- a\n:::\n\n:::details\nb\n:::");
    expect(h).toMatch(/<details class="[^"]*"><summary class="[^"]*min-h-11/);
    expect(h).not.toContain("<details open");
    expect(h).toContain("<strong");
    expect(h).toContain("펼쳐 보기");
  });
  it("제목의 HTML·그림은 글자", () => {
    const h = html(":::details <script>x</script> ![a](attachment:p.png)\n:::");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<img");
    expect(h).toContain("[그림: a]");
  });
});

describe("MarkdownView 그림 — resolver 있음 (A4 · 스펙 §6 렌더)", () => {
  it("ok → 서명 URL 의 <img loading=lazy decoding=async>, alt 는 대체 글·없으면 이름", () => {
    const h = html("앞 ![구성도](attachment:a.png) 뒤\n\n![](attachment:v.svg)", resolver());
    expect(h).toContain(`<img src="${SIGNED}a?token=1" alt="구성도" loading="lazy" decoding="async"`);
    expect(h).toContain(`alt="v.svg"`);
    expect(h).toMatch(/<img src="[^"]*v\?token=1"[^>]*class="block[^"]*bg-white/);
  });
  it("문단에 그림 하나뿐이면 블록, 글과 섞이면 인라인 (D6)", () => {
    expect(html("![](attachment:a.png)", resolver())).toMatch(/<p class="m-0"><img [^>]*class="block /);
    expect(html("글 ![](attachment:a.png)", resolver())).toMatch(/<img [^>]*class="inline-block /);
  });
  it("글 사이 그림은 줄 높이 안의 작은 그림, 목록 항목에 그림 하나뿐이면 블록 (B · 디자인 우려)", () => {
    expect(html("글 ![](attachment:a.png) 글", resolver())).toMatch(/<img [^>]*class="inline-block h-\[1\.5em\]/);
    expect(html("| x |\n| - |\n| 표 ![](attachment:a.png) |", resolver())).toMatch(/class="inline-block h-\[1\.5em\]/);
    expect(html("- ![](attachment:a.png)", resolver())).toMatch(/<li><img [^>]*class="block /);
    expect(html("글 ![](attachment:wait.png)", resolver())).toContain("h-[1.5em] w-[2.5em]");
  });
  it("글 사이 「찾을 수 없어요」 상자는 줄 높이를 벌리지 않는다(min-h 없음), 블록은 44px", () => {
    const inline = html("앞 ![](attachment:nope.png) 뒤", resolver());
    expect(inline).toMatch(/<span class="rounded-\[6px\][^"]*">그림을 찾을 수 없어요 · nope.png/);
    expect(inline).not.toContain("min-h-11");
    expect(html("![](attachment:nope.png)", resolver())).toMatch(/<span class="flex min-h-11[^"]*">그림을 찾을 수 없어요/);
  });
  it("open 이 있으면 버튼 안(크게 보기), 없으면 버튼 없음", () => {
    expect(html("![](attachment:a.png)", resolver())).not.toContain("<button");
    const h = html("![](attachment:a.png)", resolver({ open: () => {} }));
    expect(h).toMatch(/<button type="button"[^>]*><img [^>]*><span class="sr-only">크게 보기<\/span><\/button>/);
  });
  it("없는 이름 → 「그림을 찾을 수 없어요」, 받는 중 → 스켈레톤", () => {
    expect(html("![](attachment:nope.png)", resolver())).toContain("그림을 찾을 수 없어요 · nope.png");
    const h = html("![](attachment:wait.png)", resolver());
    expect(h).toContain("animate-pulse");
    expect(h).not.toContain("<img");
  });
  it("목록·인용·접기·표 안에서도 풀린다, 접기 제목에서는 자리표시", () => {
    const h = html(":::details ![t](attachment:a.png)\n- ![](attachment:a.png)\n> ![](attachment:v.svg)\n:::\n\n| x |\n| - |\n| ![](attachment:a.png) |", resolver());
    expect(h.match(/<img /g)).toHaveLength(3);
    expect(h).toContain("[그림: t]");
  });
  it("원시 HTML 은 글자", () => {
    const h = html('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<svg onload=alert(1)>', resolver());
    expect(h).not.toMatch(/<(script|img|svg)[\s>]/);
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("사용자가 쓴 주소는 <img src> 에 절대 들어가지 않는다", () => {
    const evil = [
      "![x](https://evil.io/t.png)", "![x](http://evil.io/t.png)", "![x](javascript:alert(1))", "![x](data:image/svg+xml;base64,PHN2Zz4=)",
      "![x](attachment:https://evil.io/a.png)", "![x](attachment:javascript:alert(1))", "![x](//evil.io/a.png)", "![x](/api/x.png)",
      "[![x](attachment:a.png)](https://evil.io)", '![x" onerror="alert(1)](attachment:a.png)',
    ];
    for (const e of evil) {
      const h = html(e, resolver({ open: () => {} }));
      for (const m of h.matchAll(/<img [^>]*src="([^"]*)"/g)) expect(m[1].startsWith(SIGNED), e).toBe(true);
      expect(h, e).not.toMatch(/\son[a-z]+="/);
    }
  });
});

describe("MarkdownView 그림 — 못 불러오면 (D14)", () => {
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    host?.remove();
    host = null;
  });
  it("onError → refresh 한 번, 또 실패하면 「그림을 불러올 수 없어요」", async () => {
    const refresh = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(MarkdownView, { src: "![](attachment:a.png)", images: resolver({ refresh }) })));
    const fail = async () => act(async () => void host!.querySelector("img")!.dispatchEvent(new Event("error")));
    await fail();
    expect(refresh).toHaveBeenCalledWith("f-a");
    expect(host.querySelector("img")).not.toBeNull();
    await fail();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("그림을 불러올 수 없어요 · a.png");
    await act(async () => root.unmount());
  });
  it("누르면 open(fileId)", async () => {
    const open = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(MarkdownView, { src: "![](attachment:v.svg)", images: resolver({ open }) })));
    await act(async () => host!.querySelector("button")!.click());
    expect(open).toHaveBeenCalledWith("f-v");
    await act(async () => root.unmount());
  });
});
