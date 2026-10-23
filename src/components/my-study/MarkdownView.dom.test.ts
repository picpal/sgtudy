// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { imageSizeCache, Inline, MarkdownView, type ImageResolver } from "./MarkdownView";

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
    expect(html("![](attachment:a.png)", resolver())).toMatch(/<p class="m-0"><span[^>]*><img [^>]*class="block /);
    expect(html("글 ![](attachment:a.png)", resolver())).toMatch(/<img [^>]*class="inline-block /);
  });
  it("글 사이 그림은 줄 높이 안의 작은 그림, 목록 항목에 그림 하나뿐이면 블록 (B · 디자인 우려)", () => {
    expect(html("글 ![](attachment:a.png) 글", resolver())).toMatch(/<img [^>]*class="inline-block h-\[1\.5em\]/);
    expect(html("| x |\n| - |\n| 표 ![](attachment:a.png) |", resolver())).toMatch(/class="inline-block h-\[1\.5em\]/);
    expect(html("- ![](attachment:a.png)", resolver())).toMatch(/^<div[^>]*><p class="m-0"><span[^>]*><img [^>]*class="block /);
    expect(html("글 ![](attachment:wait.png)", resolver())).toContain("h-[1.5em] w-[2.5em]");
  });
  it("글 사이 「찾을 수 없어요」 상자는 줄 높이를 벌리지 않는다(min-h 없음), 블록은 44px", () => {
    const inline = html("앞 ![](attachment:nope.png) 뒤", resolver());
    expect(inline).toMatch(/<span class="rounded-\[6px\][^"]*">그림을 찾을 수 없어요 · nope.png/);
    expect(inline).not.toContain("min-h-11");
    expect(html("![](attachment:nope.png)", resolver())).toMatch(/<span class="flex min-h-11[^"]*">그림을 찾을 수 없어요/);
  });
  it("로드 전에는 img 숨김(opacity-0, alt 유지)+스켈레톤, load 뒤에는 스켈레톤이 사라지고 img 가 보인다", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(MarkdownView, { src: "![구성도](attachment:a.png)", images: resolver({ open: () => {} }) })));
    const img = host.querySelector("img")!;
    expect(host.querySelector("[data-img-skeleton]")?.className).toMatch(/bg-line-2 motion-safe:animate-pulse/);
    expect(img.className).toContain("opacity-0");
    expect(img.getAttribute("alt")).toBe("구성도");
    act(() => void img.dispatchEvent(new Event("load")));
    expect(host.querySelector("[data-img-skeleton]")).toBeNull();
    expect(img.className).not.toContain("opacity-0");
    act(() => root.unmount());
    host.remove();
  });
  it("open 이 있으면 버튼 안(크게 보기), 없으면 버튼 없음", () => {
    expect(html("![](attachment:a.png)", resolver())).not.toContain("<button");
    const h = html("![](attachment:a.png)", resolver({ open: () => {} }));
    expect(h).toMatch(/<button type="button"[^>]*><img [^>]*><span data-img-skeleton[^>]*><\/span><span class="sr-only">크게 보기<\/span><\/button>/);
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

describe("MarkdownView 그림만 든 목록 항목 → 목록 밖 블록 그림 (불릿 없음)", () => {
  it("단독 항목은 목록이 사라지고 <p> 블록 그림 — <li>·불릿 없음", () => {
    const h = html("- ![](attachment:a.png)", resolver({ open: () => {} }));
    expect(h).not.toContain("<li");
    expect(h).not.toContain("<ul");
    expect(h).toMatch(/<p class="m-0"><button type="button" class="block rounded-\[10px\] relative/);
  });
  it("목록 중간의 그림 항목은 목록을 나눈다 — ol 번호는 쓴 그대로 이어진다", () => {
    const h = html("1. 가\n2. ![](attachment:a.png)\n3. 다\n4. 라", resolver());
    expect(h).toMatch(/<ol class="m-0 pl-5 list-decimal"><li>가<\/li><\/ol><p class="m-0"><span[^>]*><img [^>]*class="block [^>]*><span data-img-skeleton[^>]*><\/span><\/span><\/p><ol start="3"[^>]*><li>다<\/li><li>라<\/li><\/ol>/);
    const u = html("- 가\n- ![](attachment:a.png)\n- 다", resolver());
    expect(u.match(/<ul /g)).toHaveLength(2);
    expect(u).not.toMatch(/<li><span[^>]*><img/);
  });
  it("하위 목록 안의 그림 항목도 블록(부모 항목 안), 하위 목록이 딸린 그림 항목·글 섞인 항목은 그대로", () => {
    expect(html("- 가\n  - ![](attachment:a.png)", resolver())).toMatch(/<li>가<div class="mt-\[2px\] flex flex-col gap-\[2px\]"><p class="m-0"><span[^>]*><img /);
    expect(html("- 글 ![](attachment:a.png)", resolver())).toMatch(/<li>글 <span[^>]*><img [^>]*class="inline-block/);
    expect(html("- ![](attachment:a.png)\n  - 아래", resolver())).toMatch(/<li><span[^>]*><img [^>]*class="block /);
  });
  it("단독 줄 그림은 이미 블록 (권장 문법)", () => {
    expect(html("글\n\n![](attachment:a.png)\n\n글", resolver())).toMatch(/<p class="m-0">글<\/p><p class="m-0"><span[^>]*><img [^>]*class="block /);
  });
});

describe("MarkdownView 블록 그림 크기 예약 (스크롤 끊김)", () => {
  afterEach(() => imageSizeCache.clear());
  it("크기를 모르면 640px·16:10 자리, 아는 크기면 그 비율·최종 폭으로 미리 잡는다", () => {
    expect(html("![](attachment:a.png)", resolver())).toMatch(/<img [^>]*style="width:640px;aspect-ratio:16 \/ 10"/);
    imageSizeCache.set("f-a", { w: 1600, h: 1000 });
    const h = html("![](attachment:a.png)", resolver());
    expect(h).toContain('style="width:min(1600px, calc(min(560px, 70vh) * 1.6000));aspect-ratio:1600 / 1000"');
    expect(h).not.toContain("min-h-40");
  });
  it("SVG 는 예약하지 않는다(원본 크기 기본값 300×150)", () => {
    expect(html("![](attachment:v.svg)", resolver())).not.toMatch(/<img [^>]*style=/);
  });
  it("인라인 그림은 줄 높이 그대로 — 예약 없음", () => {
    expect(html("글 ![](attachment:a.png)", resolver())).not.toMatch(/<img [^>]*style=/);
  });
  it("불러오면 원본 크기를 캐시에 남긴다", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const r = createRoot(host);
    await act(async () => r.render(createElement(MarkdownView, { src: "![](attachment:a.png)", images: resolver() })));
    const im = host.querySelector("img")!;
    Object.defineProperty(im, "naturalWidth", { value: 1200 });
    Object.defineProperty(im, "naturalHeight", { value: 800 });
    await act(async () => void im.dispatchEvent(new Event("load")));
    expect(imageSizeCache.get("f-a")).toEqual({ w: 1200, h: 800 });
    expect(im.style.aspectRatio).toBe("1200 / 800");
    act(() => r.unmount());
    host.remove();
  });
  it("「눌러서 확대」 힌트 — 불러온 블록 그림 버튼에만, 손가락 화면만(pointer-coarse)", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const r = createRoot(host);
    await act(async () => r.render(createElement(MarkdownView, { src: "![](attachment:a.png)\n\n글 ![](attachment:a.png)", images: resolver({ open: () => {} }) })));
    expect(host.textContent).not.toContain("눌러서 확대");
    await act(async () => void host.querySelectorAll("img").forEach((im) => im.dispatchEvent(new Event("load"))));
    const hints = [...host.querySelectorAll("span[aria-hidden=true]")].filter((e) => e.textContent?.includes("눌러서 확대"));
    expect(hints).toHaveLength(1);
    expect(hints[0].className).toMatch(/\bhidden\b.*pointer-coarse:inline-flex/);
    act(() => r.unmount());
    host.remove();
  });
});

describe("MarkdownView 다시 그리기 (라이트박스 열기 등)", () => {
  it("같은 src·images 면 부모가 다시 그려도 다시 파싱하지 않는다(memo)", async () => {
    const md = await import("./markdown");
    const spy = vi.spyOn(md, "parseMarkdown");
    const host = document.body.appendChild(document.createElement("div"));
    const r = createRoot(host);
    const images = resolver();
    const render = (n: number) => r.render(createElement("div", { "data-n": n }, createElement(MarkdownView, { src: "# 제목\n\n![](attachment:a.png)", images })));
    act(() => render(1));
    const calls = spy.mock.calls.length;
    act(() => render(2));
    act(() => render(3));
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
    act(() => r.unmount());
    host.remove();
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
