// cm.ts — CodeMirror 6 "라이브 프리뷰" 마크다운 에디터 (Obsidian 식).
// 하나의 편집 면. 마크다운 표식(#, **, ` 등)은 캐럿이 있는 줄에서만 보이고 나머지 줄은 서식대로 보인다.
// 체크박스·구분선·표는 캐럿이 바깥에 있을 때 위젯으로 그린다(표는 셀을 바로 편집).
// work-note(frontend/src/editor/cm.ts)에서 이식 — 위키링크·이미지·mermaid·코드 언어/자동완성·첨부는 sgtudy 에 필요 없어 뺐다.
import { Annotation, EditorState, Prec, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, placeholder as cmPlaceholder, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import * as C from "./commands";
import { TableWidget, focusNextTable } from "./tableWidget";
import { editorTheme } from "./theme";

// ---------- widgets ----------
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly to: number) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked && o.from === this.from; }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-md-checkbox" + (this.checked ? " done" : "");
    span.setAttribute("role", "checkbox");
    span.setAttribute("aria-checked", String(this.checked));
    span.setAttribute("aria-label", this.checked ? "완료 표시 해제" : "완료로 표시");
    if (this.checked) span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" } });
    });
    return span;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement("span"); s.className = "cm-md-bullet"; s.textContent = "•"; return s; }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const d = document.createElement("div"); d.className = "cm-md-hr"; d.appendChild(document.createElement("hr")); return d; }
  ignoreEvent() { return false; }
}

// ---------- 포커스 상태 (포커스가 없으면 모든 줄이 서식대로 — 깔끔한 미리보기) ----------
const setFocus = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) return e.value; return v; },
});

// ---------- live preview decorations ----------
function buildDecorations(state: EditorState): DecorationSet {
  const focused = state.field(focusField, false);
  const sel = state.selection.main;
  const aFrom = state.doc.lineAt(sel.from).number;
  const aTo = state.doc.lineAt(sel.to).number;
  const lineActive = (pos: number) => { if (!focused) return false; const n = state.doc.lineAt(pos).number; return n >= aFrom && n <= aTo; };
  const selTouches = (from: number, to: number) => focused && sel.from <= to && sel.to >= from;
  const out: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name;
      const nf = node.from, nt = node.to;

      if (name === "FencedCode") {
        const firstLine = state.doc.lineAt(nf), lastLine = state.doc.lineAt(Math.min(nt, state.doc.length));
        let marks = 0;
        for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === "CodeMark") marks++;
        // 닫히지 않은 펜스가 문서 끝까지 코드로 칠하지 않게, 닫히기 전에는 캐럿이 닿은 동안만 칠한다
        if (marks < 2 && !selTouches(nf, nt)) return false;
        const editing = selTouches(nf, nt);
        for (let l = firstLine.number; l <= lastLine.number; l++) {
          const ln = state.doc.line(l);
          const fence = l === firstLine.number || (marks >= 2 && l === lastLine.number);
          out.push(Decoration.line({ class: "cm-md-codeblock" + (l === firstLine.number ? " first" : "") + (l === lastLine.number ? " last" : "") + (fence ? " fence" : "") }).range(ln.from));
          // 캐럿이 블록 밖이면 펜스(```)는 감추고 상자만 남긴다
          if (fence && !editing && ln.to > ln.from) out.push(Decoration.replace({}).range(ln.from, ln.to));
        }
        return false;
      }
      if (name === "Table") {
        if (!selTouches(nf, nt)) {
          const firstLine = state.doc.lineAt(nf), lastLine = state.doc.lineAt(Math.min(nt, state.doc.length));
          const src = state.sliceDoc(firstLine.from, lastLine.to);
          out.push(Decoration.replace({ widget: new TableWidget(src), block: true }).range(firstLine.from, lastLine.to));
          return false;
        }
        return; // 선택이 표에 걸침 → 원문
      }
      if (name === "HorizontalRule") {
        if (!lineActive(nf)) {
          const ln = state.doc.lineAt(nf);
          out.push(Decoration.replace({ widget: new HrWidget(), block: true }).range(ln.from, ln.to));
        }
        return false;
      }

      const hm = name.match(/^ATXHeading(\d)/);
      if (hm) {
        out.push(Decoration.line({ class: "cm-md-h" + hm[1] }).range(state.doc.lineAt(nf).from));
        return;
      }
      if (name === "Blockquote") {
        const firstLine = state.doc.lineAt(nf), lastLine = state.doc.lineAt(Math.min(nt, state.doc.length));
        for (let l = firstLine.number; l <= lastLine.number; l++) out.push(Decoration.line({ class: "cm-md-quote" }).range(state.doc.line(l).from));
        return;
      }

      if (name === "StrongEmphasis") out.push(Decoration.mark({ class: "cm-md-strong" }).range(nf, nt));
      else if (name === "Emphasis") out.push(Decoration.mark({ class: "cm-md-em" }).range(nf, nt));
      else if (name === "Strikethrough") out.push(Decoration.mark({ class: "cm-md-strike" }).range(nf, nt));
      else if (name === "InlineCode") out.push(Decoration.mark({ class: "cm-md-code" }).range(nf, nt));
      else if (name === "Link") out.push(Decoration.mark({ class: "cm-md-link" }).range(nf, nt));

      if (name === "TaskMarker") {
        const checked = /x/i.test(state.sliceDoc(nf, nt));
        out.push(Decoration.replace({ widget: new CheckboxWidget(checked, nf, nt) }).range(nf, nt));
        return;
      }

      // ---- 캐럿 줄이 아니면 표식을 숨긴다 ----
      const isMark =
        name === "HeaderMark" || name === "EmphasisMark" || name === "StrikethroughMark" ||
        name === "CodeMark" || name === "QuoteMark" || name === "LinkMark" || name === "URL";
      if (isMark && !lineActive(nf)) {
        let end = nt;
        if ((name === "HeaderMark" || name === "QuoteMark") && state.sliceDoc(nt, nt + 1) === " ") end = nt + 1; // 뒤따르는 공백까지
        out.push(Decoration.replace({}).range(nf, end));
        return;
      }
      if (name === "ListMark" && !lineActive(nf)) {
        if (/^[-*+]$/.test(state.sliceDoc(nf, nt))) out.push(Decoration.replace({ widget: new BulletWidget() }).range(nf, nt));
        return;
      }
    },
  });
  return Decoration.set(out, true);
}

const decoField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    const focusChanged = tr.effects.some((e) => e.is(setFocus));
    return tr.docChanged || tr.selection || focusChanged ? buildDecorations(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const atomicRanges = EditorView.atomicRanges.of((view) => view.state.field(decoField, false) || Decoration.none);

// ---------- 코드 펜스 자동 닫기 ----------
// 빈 줄에서 세 번째 백틱을 치면 닫는 펜스를 아래에 넣고 캐럿을 여는 줄에 둔다(닫히지 않은 펜스가 나머지 문서를 삼키지 않게).
const codeFenceInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "`") return false;
  const line = view.state.doc.lineAt(from);
  if (view.state.sliceDoc(line.from, from) !== "``" || view.state.sliceDoc(to, line.to).trim() !== "") return false;
  view.dispatch({ changes: { from, to, insert: "`\n\n```" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
  return true;
});

// 코드 블록 안에서 Tab 은 들여쓰기 (밖에서는 포커스 이동 — 키보드 사용자를 가두지 않는다)
function inCodeBlock(state: EditorState, pos: number) {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === "FencedCode") return true;
  return false;
}
const tabInCode = (view: EditorView) => (inCodeBlock(view.state, view.state.selection.main.head) ? (view.state.selection.main.empty ? (view.dispatch(view.state.replaceSelection("  ")), true) : indentMore(view)) : false);
const shiftTabInCode = (view: EditorView) => (inCodeBlock(view.state, view.state.selection.main.head) ? indentLess(view) : false);

// ---------- 서식 명령 ----------
export type Command =
  | "h1" | "h2" | "h3" | "bold" | "italic" | "strike" | "code"
  | "quote" | "bullet" | "ordered" | "task" | "link" | "codeblock" | "table" | "hr";

/** 순수 명령(commands.ts)의 결과를 뷰에 적용 */
export function run(view: EditorView, cmd: Command): boolean {
  const { state } = view;
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  const e: C.Edit =
    cmd === "h1" || cmd === "h2" || cmd === "h3" ? C.heading(doc, from, Number(cmd[1]))
    : cmd === "bold" ? C.wrapInline(doc, from, to, "**", "**", "굵게")
    : cmd === "italic" ? C.wrapInline(doc, from, to, "*", "*", "기울임")
    : cmd === "strike" ? C.wrapInline(doc, from, to, "~~", "~~", "취소선")
    : cmd === "code" ? C.wrapInline(doc, from, to, "`", "`", "코드")
    : cmd === "link" ? C.link(doc, from, to)
    : cmd === "codeblock" ? C.codeBlock(doc, from, to)
    : cmd === "table" ? C.insertTable(doc, to)
    : cmd === "hr" ? C.insertRule(doc, to)
    : C.toggleLines(doc, from, to, cmd);
  // 표는 넣자마자 위젯으로 그려지므로 첫 제목 셀로 포커스를 넘겨 바로 고쳐 쓰게 한다
  if (cmd === "table") focusNextTable(0, 0);
  view.dispatch({ changes: e.changes, selection: { anchor: e.anchor, head: e.head ?? e.anchor }, scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

/** 빈 인용 줄(">")에서 Enter 면 인용을 끝낸다 — lang-markdown 기본은 빈 인용 줄이 두 번 쌓여야 빠져나와 헷갈린다(목록은 한 번에 빠진다) */
function exitEmptyQuote(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to || !/^\s*>\s?$/.test(line.text)) return false;
  // 표식을 지우고 한 줄 더 내려가 빈 줄을 남긴다 — 바로 이어 쓰는 글이 인용에 붙지(lazy continuation) 않게
  view.dispatch({ changes: { from: line.from, to: line.to, insert: "\n" }, selection: { anchor: line.from + 1 }, userEvent: "input" });
  return true;
}

const formatKeymap = keymap.of([
  { key: "Mod-b", run: (v) => run(v, "bold") },
  { key: "Mod-i", run: (v) => run(v, "italic") },
  { key: "Mod-Shift-x", run: (v) => run(v, "strike") },
  { key: "Mod-e", run: (v) => run(v, "code") },
  { key: "Mod-k", run: (v) => run(v, "link") },
  { key: "Tab", run: tabInCode, shift: shiftTabInCode },
]);

/** 바깥(React)에서 값을 맞춰 넣을 때 onChange 를 다시 부르지 않도록 표시 */
export const External = Annotation.define<boolean>();

export interface CreateOpts {
  doc: string;
  placeholder?: string;
  label?: string;
  labelledBy?: string;
  onChange: (value: string) => void;
}

export function create(parent: Element, opts: CreateOpts): EditorView {
  const attrs: Record<string, string> = { "aria-multiline": "true" };
  if (opts.labelledBy) attrs["aria-labelledby"] = opts.labelledBy;
  else if (opts.label) attrs["aria-label"] = opts.label;
  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      history(),
      formatKeymap,
      Prec.highest(keymap.of([{ key: "Enter", run: exitEmptyQuote }])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      // addKeymap: Enter 로 목록·인용·체크리스트를 이어 쓰고, 빈 항목에서 Enter 면 빠져나온다
      markdown({ base: markdownLanguage, extensions: GFM, addKeymap: true }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of(attrs),
      codeFenceInput,
      focusField,
      decoField,
      atomicRanges,
      editorTheme,
      cmPlaceholder(opts.placeholder ?? ""),
      EditorView.updateListener.of((u) => {
        if (u.focusChanged) u.view.dispatch({ effects: setFocus.of(u.view.hasFocus) });
        if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) opts.onChange(u.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}

/** 바깥 값이 바뀌었을 때(버리기 등) 문서를 통째로 맞춘다 — 되돌리기 기록·onChange 없이 */
export function setDoc(view: EditorView, value: string): void {
  if (view.state.doc.toString() === value) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: [External.of(true), Transaction.addToHistory.of(false)] });
}
