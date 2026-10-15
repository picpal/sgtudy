// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { create, setDoc } from "./cm";
import { serializeFromDom } from "./tableWidget";
import { parseGfmTable } from "@/lib/markdown/gfmTable";

// jsdom 에는 innerText 가 없다 — 셀 편집 경로(input·blur)가 쓰므로 <br> 을 줄바꿈으로 읽는 최소 구현을 단다
beforeAll(() => {
  // CodeMirror 가 scrollIntoView 측정에 쓰는 Range 좌표 — jsdom 에 없다
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      let s = "";
      this.childNodes.forEach((n) => { s += n.nodeName === "BR" ? "\n" : (n as HTMLElement).innerText ?? n.textContent ?? ""; });
      return s;
    },
    set(this: HTMLElement, v: string) { this.textContent = v; },
  });
});

const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.destroy()); document.body.innerHTML = ""; });

function mount(doc: string): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const v = create(host, { doc, onChange: () => {} });
  views.push(v);
  return v;
}
const key = (el: Element, k: string, mods: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
const cells = (v: EditorView) => Array.from(v.dom.querySelectorAll<HTMLElement>(".cm-table-widget .cm-cell"));

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |";

describe("setDoc (버리기)", () => {
  it("문서를 바꾸면서 되돌리기 기록을 비운다 — 버리기 뒤 ⌘Z 가 옛 편집을 얹지 않는다", () => {
    const v = mount("원문");
    v.dispatch({ changes: { from: 2, insert: " 편집" }, userEvent: "input" });
    expect(v.state.doc.toString()).toBe("원문 편집");
    setDoc(v, "원문");
    expect(undo(v)).toBe(false);
    expect(v.state.doc.toString()).toBe("원문");
    v.dispatch({ changes: { from: 0, insert: "새 " }, userEvent: "input" }); // 기록은 다시 쌓인다
    expect(undo(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("원문");
  });
});

describe("체크리스트 줄", () => {
  it("글머리 기호 없이 체크박스만 그리고, 체크박스는 보조기기에 숨긴다", () => {
    const v = mount("- [ ] 문서 읽기\n- 그냥 목록");
    const lines = v.contentDOM.querySelectorAll(".cm-line");
    expect(lines[0].textContent).toBe(" 문서 읽기"); // "- " 는 감추고 체크박스 뒤 공백만 남는다
    expect(lines[0].querySelector(".cm-md-checkbox")?.getAttribute("aria-hidden")).toBe("true");
    expect(lines[0].querySelector(".cm-md-bullet")).toBeNull();
    expect(lines[1].querySelector(".cm-md-bullet")).not.toBeNull();
  });
});

describe("TableWidget", () => {
  it("새 위젯의 DOM 직렬화는 원문과 같다 — \\| 와 <br> 왕복", () => {
    const src = "| 파이프 \\| 셀 | 줄<br>바꿈 |\n| --- | :---: |\n| `a\\|b` | **굵게** |";
    const v = mount(src + "\n\n뒤");
    const dom = v.dom.querySelector<HTMLElement>(".cm-table-widget")!;
    expect(serializeFromDom(dom)).toBe(src);
    expect(cells(v)[0].dataset.raw).toBe("파이프 | 셀");
    expect(cells(v)[1].querySelector("br")).not.toBeNull();
    expect(cells(v)[3].querySelector("strong")?.textContent).toBe("굵게");
  });

  it("셀 편집을 확정하면 | 는 \\| 로, 줄바꿈은 <br> 로 문서에 들어가고 같은 DOM 을 유지한다", () => {
    const v = mount(TABLE + "\n\n뒤");
    const dom = v.dom.querySelector(".cm-table-widget");
    const c = cells(v)[2];
    c.focus();
    c.textContent = "x|y";
    c.appendChild(document.createElement("br"));
    c.appendChild(document.createTextNode("z"));
    c.dispatchEvent(new Event("blur"));
    expect(v.state.doc.toString()).toBe("| a | b |\n| --- | --- |\n| x\\|y<br>z | 2 |\n\n뒤");
    expect(parseGfmTable(v.state.sliceDoc(0, v.state.doc.toString().indexOf("\n\n")))?.rows[0][0]).toBe("x|y\nz");
    expect(v.dom.querySelector(".cm-table-widget")).toBe(dom); // eq: 커밋 뒤에도 그리드를 다시 그리지 않는다
  });

  it("Esc 는 표 뒤로 나간다 — 표에 붙어 행이 되지 않게 빈 줄 하나를 사이에 둔 빈 줄로", () => {
    const v = mount(TABLE + "\n\n뒤");
    const c = cells(v)[1];
    c.focus();
    key(c, "Escape");
    expect(v.state.doc.toString()).toBe(TABLE + "\n\n\n뒤");
    expect(v.state.selection.main.head).toBe(TABLE.length + 2);
    expect(v.hasFocus || document.activeElement === v.contentDOM).toBe(true);
    expect(v.dom.querySelector(".cm-table-widget")).not.toBeNull(); // 캐럿이 표에 닿지 않아 위젯 그대로
  });

  it("마지막 칸 Tab 은 행을 더하지 않고 표 밖으로, 표가 문서 끝이면 빈 줄을 만든다", () => {
    const v = mount(TABLE);
    const all = cells(v);
    all[all.length - 1].focus();
    key(all[all.length - 1], "Tab");
    expect(v.state.doc.toString()).toBe(TABLE + "\n\n");
    expect(v.state.selection.main.head).toBe(TABLE.length + 2);
  });

  it("이미 빈 줄 둘이 있으면 문서를 바꾸지 않고 그리로 간다", () => {
    const v = mount(TABLE + "\n\n\n뒤");
    key(cells(v)[0], "Escape");
    expect(v.state.doc.toString()).toBe(TABLE + "\n\n\n뒤");
    expect(v.state.selection.main.head).toBe(TABLE.length + 2);
  });

  it("첫 칸 Shift+Tab 은 표 앞으로 나간다", () => {
    const v = mount("앞\n\n" + TABLE);
    const first = cells(v)[0];
    first.focus();
    key(first, "Tab", { shiftKey: true });
    expect(v.state.selection.main.head).toBe(1); // 앞 문단 끝
    expect(v.state.doc.toString()).toBe("앞\n\n" + TABLE);
    const w = mount(TABLE); // 문서 맨 앞의 표 → 앞에 빈 줄을 만든다
    key(cells(w)[0], "Tab", { shiftKey: true });
    expect(w.state.doc.toString()).toBe("\n\n" + TABLE);
    expect(w.state.selection.main.head).toBe(0);
  });

  it("셀 단축키 ⌘⇧↓ 는 아래에 행, ⌘⇧→ 는 오른쪽에 열을 더한다", () => {
    const v = mount(TABLE + "\n\n뒤");
    key(cells(v)[2], "ArrowDown", { metaKey: true, shiftKey: true });
    expect(parseGfmTable(v.state.doc.toString().split("\n\n")[0])?.rows).toEqual([["1", "2"], ["", ""]]);
    key(cells(v)[0], "ArrowRight", { ctrlKey: true, shiftKey: true });
    expect(parseGfmTable(v.state.doc.toString().split("\n\n")[0])?.header).toEqual(["a", "", "b"]);
  });

  it("핸들은 Enter 로 메뉴를 열고, 메뉴는 화살표로 움직이며 Esc 로 닫고 핸들로 돌아간다", () => {
    const v = mount(TABLE + "\n\n뒤");
    const c = cells(v)[0];
    c.focus();
    key(c, "ArrowUp"); // 제목 행 ↑ → 열 핸들
    const handle = v.dom.querySelector<HTMLElement>(".cm-col-handle")!;
    expect(document.activeElement).toBe(handle);
    key(handle, "Enter");
    const items = Array.from(v.dom.querySelectorAll<HTMLElement>(".cm-table-menu [role=menuitem]"));
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items[0]);
    key(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "ArrowUp");
    key(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[items.length - 1]); // 끝으로 돈다
    key(items[items.length - 1], "Escape");
    expect(v.dom.querySelector(".cm-table-menu")).toBeNull();
    expect(document.activeElement).toBe(handle);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
  });

  it("표 영역이 스크롤돼도 키보드로 연 메뉴는 닫히지 않는다 — 핸들로 들어설 때 가로 스크롤이 생긴다", async () => {
    const v = mount(TABLE + "\n\n뒤");
    const rowHandle = v.dom.querySelector<HTMLElement>(".cm-row-handle")!;
    rowHandle.focus();
    key(rowHandle, "Enter");
    await new Promise((r) => setTimeout(r, 0)); // 스크롤 감시는 다음 틱에 붙는다
    v.dom.querySelector(".cm-table-scroll")!.dispatchEvent(new Event("scroll"));
    expect(v.dom.querySelector(".cm-table-menu")).not.toBeNull();
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
  });

  it("행 핸들 메뉴의 '아래에 행 추가'를 키보드로 실행한다", () => {
    const v = mount(TABLE + "\n\n뒤");
    const rowHandle = v.dom.querySelector<HTMLElement>(".cm-row-handle")!;
    rowHandle.focus();
    key(rowHandle, " ");
    const add = Array.from(v.dom.querySelectorAll<HTMLButtonElement>(".cm-table-menu button")).find((b) => b.textContent === "아래에 행 추가")!;
    add.click();
    expect(parseGfmTable(v.state.doc.toString().split("\n\n")[0])?.rows).toEqual([["1", "2"], ["", ""]]);
  });
});

describe("목록 표식 합치기 (Enter 로 이어진 표식 뒤에 표식을 또 칠 때)", () => {
  // 실제 입력 경로처럼 inputHandler 들을 거친 뒤, 아무도 안 받으면 그냥 넣는다
  const type = (v: EditorView, text: string) => {
    for (const ch of text) {
      const { from, to } = v.state.selection.main;
      const insert = () => v.state.update({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length }, userEvent: "input.type" });
      if (!v.state.facet(EditorView.inputHandler).some((h) => h(v, from, to, ch, insert))) v.dispatch(insert());
    }
  };
  const enter = (v: EditorView) => key(v.contentDOM, "Enter");
  const atEnd = (doc: string) => { const v = mount(doc); v.dispatch({ selection: { anchor: doc.length } }); v.focus(); return v; };

  it('"- a" Enter 뒤 "- b" → 글머리 하나', () => {
    const v = atEnd("- a");
    enter(v);
    expect(v.state.doc.toString()).toBe("- a\n- ");
    type(v, "- b");
    expect(v.state.doc.toString()).toBe("- a\n- b");
  });
  it('"  - " 를 치면 한 단계 안쪽 항목', () => {
    const v = atEnd("- a");
    enter(v);
    type(v, "  - b");
    expect(v.state.doc.toString()).toBe("- a\n  - b");
  });
  it("번호 목록은 이어 매긴 번호를 지킨다", () => {
    const v = atEnd("1. a");
    enter(v);
    type(v, "1. b");
    expect(v.state.doc.toString()).toBe("1. a\n2. b");
  });
  it("자동 표식이 아닌 곳의 \"- - \" 는 그대로 둔다", () => {
    const v = atEnd("- a");
    enter(v);
    type(v, "x - ");
    expect(v.state.doc.toString()).toBe("- a\n- x - ");
    const w = atEnd("");
    type(w, "- - c");
    expect(w.state.doc.toString()).toBe("- - c");
  });
});
