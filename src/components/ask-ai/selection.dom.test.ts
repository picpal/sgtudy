// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readSelection } from "./selection";

// jsdom 은 Range.getBoundingClientRect 가 없을 수 있다 — 0 사각형으로 채운다
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
}

function mount(html: string) {
  document.body.innerHTML = html;
}
/** id 요소의 텍스트 노드에서 [s, e) 를 선택. endId 를 주면 다른 요소의 텍스트까지 */
function select(id: string, s: number, e: number, endId?: string) {
  const a = document.getElementById(id)!.firstChild!;
  const b = endId ? document.getElementById(endId)!.firstChild! : a;
  const r = document.createRange();
  r.setStart(a, s);
  r.setEnd(b, e);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("readSelection", () => {
  it("inside an allowed container → term/source/context/container", () => {
    mount(`<div data-ask-ai="node" id="c"><p id="p">VPC 의 CIDR 블록을 정해요</p><p>다른 문단</p></div>`);
    select("p", 6, 13);
    const r = readSelection(document)!;
    expect(r.term).toBe("CIDR 블록");
    expect(r.source).toBe("node");
    expect(r.context).toBe("VPC 의 CIDR 블록을 정해요");
    expect(r.container.id).toBe("c");
    expect(r.rect).toBeTruthy();
  });
  it("40cp ok · 41cp → tooLong hint pick (code points)", () => {
    mount(`<div data-ask-ai="node"><p id="p">${"가".repeat(41)}</p><p id="e">${"😀".repeat(41)}</p></div>`);
    select("p", 0, 40);
    expect(readSelection(document)?.term).toBe("가".repeat(40));
    expect(readSelection(document)?.tooLong).toBeUndefined();
    select("p", 0, 41);
    expect(readSelection(document)).toMatchObject({ tooLong: true, term: "", source: "node" });
    select("e", 0, 80); // 이모지 40개 = UTF-16 80
    expect(readSelection(document)?.tooLong).toBeUndefined();
    select("e", 0, 82);
    expect(readSelection(document)?.tooLong).toBe(true);
  });
  it("inside pre/code/button/input-ish → null", () => {
    mount(`<div data-ask-ai="node"><pre id="pre">npm run build</pre><p>a <code id="code">useEffect</code></p><button id="b">버튼 글자</button></div>`);
    select("pre", 0, 3);
    expect(readSelection(document)).toBeNull();
    select("code", 0, 5);
    expect(readSelection(document)).toBeNull();
    select("b", 0, 2);
    expect(readSelection(document)).toBeNull();
  });
  it("selection spanning over a code block → null", () => {
    mount(`<div data-ask-ai="node"><p id="a">앞</p><pre>x</pre><p id="b">뒤</p></div>`);
    select("a", 0, 1, "b");
    expect(readSelection(document)).toBeNull();
  });
  it('inside data-ask-ai="off" → null (also nested allowed inside off)', () => {
    mount(`<ul data-ask-ai="exam"><li data-ask-ai="off"><p id="q">S3 는 리전 서비스다</p></li></ul><div data-ask-ai="off"><div data-ask-ai="node"><p id="n">VPC</p></div></div>`);
    select("q", 0, 2);
    expect(readSelection(document)).toBeNull();
    select("n", 0, 3);
    expect(readSelection(document)).toBeNull();
  });
  it("spanning two containers → null · outside any container → null · unknown source → null", () => {
    mount(`<div data-ask-ai="node"><p id="a">VPC 서브넷</p></div><div data-ask-ai="exam"><p id="b">시험 글</p></div><p id="x">밖의 글</p><div data-ask-ai="comment"><p id="cm">댓글 글</p></div>`);
    select("a", 4, 2, "b");
    expect(readSelection(document)).toBeNull();
    select("x", 0, 2);
    expect(readSelection(document)).toBeNull();
    select("cm", 0, 2);
    expect(readSelection(document)).toBeNull();
  });
  it("collapsed or whitespace-only → null", () => {
    mount(`<div data-ask-ai="node"><p id="p">a   b</p></div>`);
    select("p", 1, 1);
    expect(readSelection(document)).toBeNull();
    select("p", 1, 4);
    expect(readSelection(document)).toBeNull();
  });
});
