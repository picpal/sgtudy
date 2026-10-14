// theme.ts — 에디터 모양. 색·반경은 globals.css 토큰(var(--…))만 쓴다 — work-note 테마가 아니라 sgtudy 화면 언어를 따른다.
// EditorView.theme 는 이 에디터 DOM 안으로만 범위가 잡히고, 에디터 청크와 함께 지연 로드된다.
import { EditorView } from "@codemirror/view";

export const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.75" },
  ".cm-content": { padding: "10px 12px", caretColor: "var(--mint)", minHeight: "var(--md-min-h, 120px)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--mint)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--mint-soft)" },
  ".cm-placeholder": { color: "var(--ghost)" },

  // 제목 — 패널 안에서 쓰는 크기 (읽기 화면 MarkdownView 와 같은 단계감)
  ".cm-line.cm-md-h1, .cm-line.cm-md-h2, .cm-line.cm-md-h3, .cm-line.cm-md-h4, .cm-line.cm-md-h5, .cm-line.cm-md-h6": { color: "var(--ink)", fontWeight: "700" },
  ".cm-line.cm-md-h1": { fontSize: "1.25em", lineHeight: "1.5", paddingTop: ".2em" },
  ".cm-line.cm-md-h2": { fontSize: "1.15em", lineHeight: "1.5", paddingTop: ".15em" },
  ".cm-line.cm-md-h3, .cm-line.cm-md-h4, .cm-line.cm-md-h5, .cm-line.cm-md-h6": { fontSize: "1.07em" },

  // 인라인
  ".cm-md-strong": { fontWeight: "700", color: "var(--ink)" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through", color: "var(--muted)" },
  ".cm-md-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".9em",
    backgroundColor: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "5px", padding: "1px .35em",
  },
  ".cm-md-link": { color: "var(--mint)", textDecoration: "underline", textUnderlineOffset: "2px" },

  // 인용·코드 블록 (줄 단위)
  ".cm-line.cm-md-quote": { borderLeft: "3px solid var(--line-3)", paddingLeft: "12px", color: "var(--muted)" },
  ".cm-line.cm-md-codeblock": {
    backgroundColor: "var(--surface-2)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".9em",
    padding: "0 12px", borderLeft: "1px solid var(--line)", borderRight: "1px solid var(--line)",
  },
  ".cm-line.cm-md-codeblock.fence": { color: "var(--faint)" },
  ".cm-line.cm-md-codeblock.first": { paddingTop: "6px", borderTop: "1px solid var(--line)", borderRadius: "10px 10px 0 0" },
  ".cm-line.cm-md-codeblock.last": { paddingBottom: "6px", borderBottom: "1px solid var(--line)", borderRadius: "0 0 10px 10px" },

  // 목록 기호·체크박스·구분선 위젯
  ".cm-md-bullet": { color: "var(--faint)", display: "inline-block" },
  ".cm-md-checkbox": {
    display: "inline-grid", placeItems: "center", verticalAlign: "-3px", width: "16px", height: "16px", marginRight: "2px", cursor: "pointer",
    border: "1.5px solid var(--line-dash)", borderRadius: "4px", backgroundColor: "var(--surface)", color: "#fff",
  },
  ".cm-md-checkbox.done": { backgroundColor: "var(--mint)", borderColor: "var(--mint)" },
  ".cm-md-checkbox svg": { width: "11px", height: "11px" },
  ".cm-md-hr": { padding: ".5em 0" },
  ".cm-md-hr hr": { border: "none", borderTop: "1px solid var(--line-3)", margin: "0" },

  // 표 위젯 — 셀을 바로 편집. 핸들(⋯ 열 / ⋮ 행)은 마우스를 올리거나 표 안을 편집할 때 보인다
  // 왼쪽 핸들 칸(12px)을 본문 여백으로 내어 표 격자가 본문 글줄과 나란히 선다
  ".cm-table-widget": { position: "relative", margin: "6px 0 6px -12px" },
  ".cm-table-widget:focus": { outline: "none" },
  // width 0 + min-width 100%: 넓은 표가 편집 면 자체를 넓히지 않고 이 안에서 가로 스크롤된다
  ".cm-table-scroll": { overflowX: "auto", scrollbarWidth: "thin", width: "0", minWidth: "100%" },
  // 내용 폭만큼 넓어지고(좁은 패널에서는 가로 스크롤), 넓은 칸에서는 꽉 채운다
  ".cm-table": { borderCollapse: "collapse", width: "max-content", minWidth: "100%", fontSize: "13px", lineHeight: "1.6" },
  ".cm-table .cm-cell": {
    border: "1px solid var(--line-3)", padding: "6px 10px", verticalAlign: "top", whiteSpace: "pre-wrap",
    wordBreak: "keep-all", overflowWrap: "anywhere", minWidth: "72px", maxWidth: "240px", textAlign: "left", cursor: "text",
  },
  ".cm-table thead .cm-cell": { backgroundColor: "var(--surface-2)", fontWeight: "600", color: "var(--ink)" },
  ".cm-table .cm-cell:focus": { outline: "2px solid var(--mint)", outlineOffset: "-2px", backgroundColor: "var(--surface)" },
  ".cm-table .cm-cell.cm-cell-selected": { backgroundColor: "var(--mint-soft)" },
  ".cm-table .cm-cell:empty::before": { content: '"\\200b"' }, // 빈 셀도 한 줄 높이·캐럿 자리
  ".cm-table .cm-cell code": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", backgroundColor: "var(--surface-2)", padding: "0 4px", borderRadius: "4px", fontSize: ".92em" },
  ".cm-table .cm-cell a": { color: "var(--mint)", textDecoration: "underline" },
  ".cm-table .cm-cell del": { color: "var(--muted)" },
  ".cm-handle-corner": { border: "none", width: "12px", minWidth: "12px", padding: "0", background: "transparent" },
  ".cm-col-handle, .cm-row-handle": {
    border: "none", color: "var(--muted)", textAlign: "center", cursor: "pointer", userSelect: "none",
    opacity: "0", transition: "opacity .12s ease, background-color .12s ease", fontSize: "13px", lineHeight: "1", padding: "2px", borderRadius: "5px",
  },
  ".cm-col-handle": { height: "18px" },
  ".cm-row-handle": { width: "12px", minWidth: "12px", padding: "0", verticalAlign: "middle" },
  ".cm-table-widget:hover .cm-col-handle, .cm-table-widget:hover .cm-row-handle, .cm-table-widget:focus-within .cm-col-handle, .cm-table-widget:focus-within .cm-row-handle": { opacity: ".6" },
  "@media (hover: none)": { ".cm-col-handle, .cm-row-handle": { opacity: ".6" } },
  ".cm-col-handle:hover, .cm-row-handle:hover": { opacity: "1", backgroundColor: "var(--surface-2)" },
  ".cm-table-menu": {
    position: "fixed", zIndex: "50", backgroundColor: "var(--surface)", border: "1px solid var(--line)", borderRadius: "10px",
    boxShadow: "0 10px 30px rgba(27,34,48,.12)", padding: "4px", minWidth: "150px", display: "flex", flexDirection: "column",
  },
  ".cm-table-menu button": {
    font: "inherit", fontSize: "13px", textAlign: "left", background: "none", border: "none", borderRadius: "7px",
    padding: "8px 10px", color: "var(--ink)", cursor: "pointer",
  },
  ".cm-table-menu button:hover, .cm-table-menu button:focus-visible": { backgroundColor: "var(--surface-2)", outline: "none" },
  ".cm-table-menu button.danger": { color: "var(--warn)" },
  ".cm-menu-sep": { height: "1px", backgroundColor: "var(--line)", margin: "4px 2px" },
});
