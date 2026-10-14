// tableWidget.ts — CodeMirror block 위젯: GFM 표를 편집 가능한 그리드로 렌더.
// 셀=contenteditable(plaintext-only). 편집은 DOM 로컬, 커밋 시 문서 소스 재작성.
// work-note(frontend/src/editor/tableWidget.ts)에서 이식 — 셀 표시를 innerHTML 대신 parseInline → DOM 노드로 만들고,
// 메뉴에 "표 삭제"를 보탰으며, 핸들은 터치 기기에서도 보이게(테마 쪽) 했다.
import { EditorView, WidgetType } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { parseInline } from "@/components/my-study/markdown";
import { parseGfmTable, serializeGfmTable, insertRow, deleteRow, insertColumn, deleteColumn, setAlign, seqColumns, setSeqColumn, renumberSeq } from "./gfmTable";
import type { TableModel, Align } from "./gfmTable";

/** 셀 표시용 인라인 렌더 — 읽기 화면(MarkdownView)과 같은 parseInline 결과를 DOM 노드로만 만든다(HTML 문자열 주입 없음). */
export function renderCell(cell: HTMLElement, raw: string): void {
  cell.textContent = "";
  raw.split("\n").forEach((line, i) => {
    if (i > 0) cell.appendChild(document.createElement("br"));
    for (const s of parseInline(line)) {
      if (s.t === "text") { cell.appendChild(document.createTextNode(s.v)); continue; }
      const el = document.createElement(s.t === "b" ? "strong" : s.t === "i" ? "em" : s.t === "s" ? "del" : s.t === "code" ? "code" : "a");
      el.textContent = s.v;
      if (s.t === "a") { (el as HTMLAnchorElement).href = s.href; el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer nofollow"); }
      cell.appendChild(el);
    }
  });
}

/** 표를 새로 넣은 직후 첫 셀에 포커스를 주기 위한 예약 — 다음 toDOM 이 소비한다 */
export function focusNextTable(r: number, col: number): void {
  pendingFocus = { r, col };
  setTimeout(() => { pendingFocus = null; }, 0); // 같은 dispatch 에서 그려지지 않았으면 버린다(다음 표가 엉뚱하게 포커스를 가져가지 않게)
}

// 구조 변경으로 위젯이 재생성될 때, 새 toDOM이 소비해 포커스를 복원할 좌표. r=0은 헤더행, r>=1은 본문행(r-1).
let pendingFocus: { r: number; col: number } | null = null;

/** DOM의 .cm-cell들을 읽어 모델로 복원 → 직렬화. (핸들 셀은 .cm-cell 아님 → 무시) */
export function serializeFromDom(dom: HTMLElement): string {
  const headerCells = Array.from(dom.querySelectorAll(".cm-header-row .cm-cell")) as HTMLElement[];
  const header = headerCells.map((c) => c.dataset.raw ?? c.innerText);
  const align = headerCells.map((c) => (c.dataset.align as Align) || "none");
  const rows = (Array.from(dom.querySelectorAll(".cm-table tbody tr")) as HTMLElement[]).map((tr) =>
    (Array.from(tr.querySelectorAll(".cm-cell")) as HTMLElement[]).map((c) => c.dataset.raw ?? c.innerText),
  );
  return serializeGfmTable({ align, header, rows });
}

const owners = new WeakMap<HTMLElement, TableWidget>();

export class TableWidget extends WidgetType {
  dom?: HTMLElement;
  view?: EditorView;
  private commitTimer?: ReturnType<typeof setTimeout>;
  private rangeAnchor?: { r: number; col: number };
  private selectedRect?: { r1: number; c1: number; r2: number; c2: number };

  constructor(public source: string) {
    super();
  }

  /**
   * DOM 재사용 판정. CodeMirror 는 DOM 을 유지하면 그 DOM 을 *새* 위젯 인스턴스에 넘기고, eq 를 부르는 방향도 버전마다 다르다
   * (work-note 의 view 6.36 과 달리 6.43 에서는 원본 판정이 두 번째 커밋부터 표를 다시 그려 셀 포커스를 잃었다).
   * 그래서 어느 쪽이 DOM 을 가졌든 같은 DOM·뷰를 양쪽에 이어 두고, DOM 이 아직 없는 쪽을 새 위젯으로 본다.
   */
  eq(other: TableWidget): boolean {
    const keep = (): true => {
      const dom = this.dom ?? other.dom;
      const view = this.view ?? other.view;
      this.dom = other.dom = dom;
      this.view = other.view = view;
      return true;
    };
    if (other.source === this.source) return keep();          // 무변경 트랜잭션 → DOM 유지(포커스 보존)
    const dom = this.dom ?? other.dom;
    if (!dom) return false;
    const fresh = this.dom ? other : this;
    return serializeFromDom(dom) === fresh.source ? keep() : false; // DOM이 이미 반영(셀편집 커밋) → 유지, 아니면 재생성
  }

  /** DOM 을 실제로 만들고 리스너를 단 인스턴스 — 메뉴·디바운스 타이머는 거기 있다 */
  private owner(): TableWidget {
    return (this.dom && owners.get(this.dom)) || this;
  }

  ignoreEvent(): boolean {
    return true; // 위젯 내부 이벤트는 CM이 문서 편집으로 오인하지 않게 차단(키/메뉴는 위젯이 자체 처리)
  }

  get estimatedHeight(): number {
    return 80;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const model = parseGfmTable(this.source) ?? { align: ["none"], header: [""], rows: [] };
    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget";
    wrap.contentEditable = "false";
    wrap.tabIndex = -1; // 범위 선택 후 키보드(복사/삭제/Esc) 수신용
    wrap.addEventListener("keydown", (e) => this.onRangeKey(e));
    wrap.addEventListener("blur", () => this.clearRange());

    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    const table = document.createElement("table");
    table.className = "cm-table";

    const thead = document.createElement("thead");

    // (1) 열 핸들 행
    const handleRow = document.createElement("tr");
    handleRow.className = "cm-handle-row";
    handleRow.appendChild(this.makeHandleCorner());
    model.header.forEach((_t, col) => handleRow.appendChild(this.makeColHandle(col)));
    thead.appendChild(handleRow);

    // (2) 헤더 셀 행 (앞에 행핸들 자리 코너)
    const headerRow = document.createElement("tr");
    headerRow.className = "cm-header-row";
    headerRow.appendChild(this.makeHandleCorner());
    model.header.forEach((text, col) => headerRow.appendChild(this.makeCell("th", text, model.align[col] ?? "none")));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    model.rows.forEach((row, bodyIdx) => {
      const tr = document.createElement("tr");
      tr.appendChild(this.makeRowHandle(bodyIdx));
      row.forEach((text, col) => tr.appendChild(this.makeCell("td", text, model.align[col] ?? "none")));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    scroll.appendChild(table);
    wrap.appendChild(scroll);
    if (pendingFocus) {
      const f = pendingFocus;
      pendingFocus = null;
      queueMicrotask(() => this.focusCellAt(f.r, f.col));
    }
    this.dom = wrap;
    owners.set(wrap, this);
    return wrap;
  }

  /** 셀 엘리먼트 생성. Task 6: 편집 리스너 포함. */
  protected makeCell(tag: "th" | "td", text: string, align: Align): HTMLElement {
    const cell = document.createElement(tag);
    cell.className = "cm-cell";
    cell.dataset.align = align;
    if (align !== "none") cell.style.textAlign = align;
    cell.setAttribute("contenteditable", "plaintext-only"); // 편집은 평문, 표시는 인라인 렌더
    cell.dataset.raw = text;             // 원문 마크다운 — 직렬화 출처(렌더된 innerText 아님)
    renderCell(cell, text); // 비포커스: 굵게/기울임/취소선/코드/링크 렌더
    // 포커스 시 원문 노출(마커가 렌더돼 있을 때만 — 평문 셀은 캐럿 유지)
    cell.addEventListener("focus", () => { const raw = cell.dataset.raw ?? ""; if (cell.textContent !== raw) cell.textContent = raw; });
    cell.addEventListener("input", () => { cell.dataset.raw = cell.innerText; this.scheduleCommit(1000); }); // 편집 중 원문 동기화 + 디바운스
    cell.addEventListener("blur", () => { cell.dataset.raw = cell.innerText; renderCell(cell, cell.dataset.raw); this.commit(); }); // 원문 확정 → 재렌더 → 커밋
    cell.addEventListener("keydown", (e) => this.onCellKey(e, cell));
    cell.addEventListener("mousedown", (e) => this.onCellMouseDown(e, cell));
    cell.addEventListener("paste", (e) => this.onCellPaste(e, cell));
    return cell;
  }

  /** 위젯의 현재 문서 범위를 syntaxTree로 재해석(위치 이동에 강함). */
  protected currentRange(): { from: number; to: number } | null {
    if (!this.view || !this.dom) return null;
    const view = this.view;
    let pos: number;
    try {
      pos = view.posAtDOM(this.dom);
    } catch {
      return null;
    }
    const tree = syntaxTree(view.state);
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    while (node && node.name !== "Table") node = node.parent;
    if (!node) return null;
    const doc = view.state.doc;
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(Math.min(node.to, doc.length));
    return { from: first.from, to: last.to };
  }

  private scheduleCommit(delay: number): void {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), delay);
  }

  /** 현재 DOM을 직렬화해 문서 표 범위를 치환. 변경 없으면 skip. */
  protected commit(): void {
    if (this.commitTimer) { clearTimeout(this.commitTimer); this.commitTimer = undefined; }
    if (!this.view || !this.dom) return;
    const range = this.currentRange();
    if (!range) return;
    const next = serializeFromDom(this.dom);
    if (this.view.state.sliceDoc(range.from, range.to) === next) return; // no-op
    try {
      this.view.dispatch({ changes: { from: range.from, to: range.to, insert: next } });
      this.source = next; // DOM이 표현하는 현재 소스로 갱신 — eq 스테일 방지(undo로 원본 복귀 시 재렌더 보장)
    } catch {
      /* 뷰가 파괴 중이면 무시 */
    }
  }

  // ---- Task 7: 키보드 내비게이션 + 좌표/포커스 헬퍼 ----

  protected colCount(): number {
    return this.dom ? this.dom.querySelectorAll(".cm-header-row .cm-cell").length : 0;
  }
  protected bodyRowCount(): number {
    return this.dom ? this.dom.querySelectorAll(".cm-table tbody tr").length : 0;
  }
  protected allCells(): HTMLElement[] {
    return this.dom ? (Array.from(this.dom.querySelectorAll(".cm-cell")) as HTMLElement[]) : [];
  }
  /** flat .cm-cell 인덱스 → {r, col} (r=0 헤더, r>=1 본문). */
  protected coordOf(flatIdx: number): { r: number; col: number } {
    const ncol = this.colCount() || 1;
    if (flatIdx < ncol) return { r: 0, col: flatIdx };
    const b = flatIdx - ncol;
    return { r: 1 + Math.floor(b / ncol), col: b % ncol };
  }
  protected cellAt(r: number, col: number): HTMLElement | undefined {
    if (!this.dom) return undefined;
    if (r === 0) return this.dom.querySelectorAll(".cm-header-row .cm-cell")[col] as HTMLElement | undefined;
    const tr = this.dom.querySelectorAll(".cm-table tbody tr")[r - 1] as HTMLElement | undefined;
    return tr?.querySelectorAll(".cm-cell")[col] as HTMLElement | undefined;
  }
  protected focusCellAt(r: number, col: number): void {
    this.cellAt(r, col)?.focus();
  }

  /** 모델 변형 후 재직렬화→dispatch. 위젯 재생성 시 새 toDOM이 pendingFocus로 포커스 복원. */
  protected applyOp(fn: (m: TableModel) => TableModel, focus: { r: number; col: number }): void {
    if (!this.view || !this.dom) return;
    const m = parseGfmTable(serializeFromDom(this.dom));
    if (!m) return;
    const next = serializeGfmTable(fn(m));
    const range = this.currentRange();
    if (!range) return;
    pendingFocus = focus;
    try {
      this.view.dispatch({ changes: { from: range.from, to: range.to, insert: next } });
      this.source = next; // eq 스테일 방지(commit과 동일 — undo 후 재렌더 보장)
    } catch {
      pendingFocus = null;
    }
  }

  /** 구조 연산을 seq 열 유지로 감싼다. 감지는 반드시 연산 *전* 모델에서 —
   *  행을 넣고 나면 그 열은 1,2,"",3 이라 더 이상 seq로 보이지 않는다.
   *  exclude로 넘긴 열은 감지됐더라도 재번호에서 뺀다 — 붙여넣기가 그 열을 직접
   *  덮은 경우, 붙여넣은 값을 1..N으로 되돌려 조용히 지우지 않기 위함. */
  private keepingSeq(
    fn: (m: TableModel) => TableModel,
    exclude: Set<number> = new Set(),
  ): (m: TableModel) => TableModel {
    return (m) => { const cols = seqColumns(m).filter((c) => !exclude.has(c)); return renumberSeq(fn(m), cols); };
  }

  /** 행 조작 후 캐럿을 놓을 열 — seq 열은 자동 관리 셀이라 건너뛴다.
   *  거기 그대로 두면 "행 추가 → 바로 입력" 흐름에서 방금 채워진 번호를 덮어써
   *  판정을 깨고, 해제 메뉴가 없어 자동 재번호가 조용히·영구히 멈춘다.
   *  (건너뛸 데가 없으면 원래 열 — seq가 유일한 열인 표에서도 포커스는 잃지 않는다) */
  private firstEditableCol(preferred = 0): number {
    const m = this.dom ? parseGfmTable(serializeFromDom(this.dom)) : null;
    if (!m) return preferred;
    const seq = new Set(seqColumns(m));
    if (!seq.has(preferred)) return preferred;
    for (let c = 0; c < m.header.length; c++) if (!seq.has(c)) return c;
    return preferred;
  }

  /** 위젯 내부(셀/범위)의 Ctrl/Cmd+Z·Shift+Z·Y를 CM 히스토리로 라우팅.
   *  위젯은 ignoreEvent=true라 CM 키맵이 못 받으므로 여기서 직접 undo/redo 호출.
   *  undo 전엔 디바운스 미커밋분을 먼저 commit해 "내 마지막 동작" 단위로 되돌림(redo는 커밋 금지 — 리두 스택 보존).
   *  stopPropagation으로 cell→wrap 버블에 의한 이중 처리 방지. */
  protected maybeHistoryKey(e: KeyboardEvent): boolean {
    if (!this.view) return false;
    if (!(e.metaKey || e.ctrlKey)) return false;
    const k = e.key.toLowerCase();
    const isUndo = k === "z" && !e.shiftKey;
    const isRedo = (k === "z" && e.shiftKey) || k === "y";
    if (!isUndo && !isRedo) return false;
    e.preventDefault();
    e.stopPropagation();
    if (isUndo) { this.commit(); undo(this.view); }
    else redo(this.view);
    return true;
  }

  protected onCellKey(e: KeyboardEvent, cell: HTMLElement): void {
    if (this.maybeHistoryKey(e)) return;
    // 셀 안 키는 셀이 처리한다 — 편집 면(CodeMirror) 키맵(⌘A 전체 선택 등)으로 새면 포커스가 셀 밖으로 빠진다
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const r = document.createRange();
      r.selectNodeContents(cell);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const cells = this.allCells();
      const idx = cells.indexOf(cell);
      if (e.shiftKey) {
        if (idx > 0) cells[idx - 1].focus();
        return;
      }
      if (idx + 1 < cells.length) { cells[idx + 1].focus(); return; }
      // 마지막 셀에서 Tab → 새 본문 행 추가 후 첫 편집 가능 셀(seq 열은 건너뜀)
      this.commit(); // 현재 편집분 먼저 반영
      const newRowVisual = 1 + this.bodyRowCount();
      this.applyOp(this.keepingSeq((m) => insertRow(m, m.rows.length)), { r: newRowVisual, col: this.firstEditableCol() });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const cells = this.allCells();
      const { r, col } = this.coordOf(cells.indexOf(cell));
      const lastVisualRow = this.bodyRowCount(); // 본문 마지막 행의 visual r
      if (r >= lastVisualRow) {
        this.commit();
        this.applyOp(this.keepingSeq((m) => insertRow(m, m.rows.length)), { r: 1 + this.bodyRowCount(), col });
      } else {
        this.focusCellAt(r + 1, col);
      }
      return;
    }
    // Shift+Enter: plaintext-only 기본 줄바꿈 허용(preventDefault 안 함) → innerText에 \n
  }

  // ---- Task 8: 행/열 핸들 + 메뉴 ----

  private menuEl?: HTMLElement;
  private onDocDown = (e: MouseEvent) => {
    if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.closeMenu();
  };

  private makeHandleCorner(): HTMLElement {
    const c = document.createElement("th");
    c.className = "cm-handle-corner";
    c.contentEditable = "false";
    return c;
  }
  private makeColHandle(col: number): HTMLElement {
    const th = document.createElement("th");
    th.className = "cm-col-handle";
    th.contentEditable = "false";
    th.textContent = "⋯";
    th.title = "열 메뉴";
    th.setAttribute("role", "button");
    th.setAttribute("aria-label", `${col + 1}번째 열 메뉴`);
    th.addEventListener("mousedown", (e) => e.preventDefault());
    th.addEventListener("click", () => this.openColMenu(col, th));
    return th;
  }
  private makeRowHandle(bodyIdx: number): HTMLElement {
    const td = document.createElement("td");
    td.className = "cm-row-handle";
    td.contentEditable = "false";
    td.textContent = "⋮";
    td.title = "행 메뉴";
    td.setAttribute("role", "button");
    td.setAttribute("aria-label", `${bodyIdx + 1}번째 행 메뉴`);
    td.addEventListener("mousedown", (e) => e.preventDefault());
    td.addEventListener("click", () => this.openRowMenu(bodyIdx, td));
    return td;
  }

  private openColMenu(col: number, anchor: HTMLElement): void {
    this.openMenu(anchor, [
      { label: "왼쪽에 열 추가", run: () => this.applyOp((m) => insertColumn(m, col), { r: 0, col }) },
      { label: "오른쪽에 열 추가", run: () => this.applyOp((m) => insertColumn(m, col + 1), { r: 0, col: col + 1 }) },
      { label: "열 삭제", run: () => this.applyOp((m) => deleteColumn(m, col), { r: 0, col: Math.max(0, col - 1) }) },
      { sep: true },
      { label: "왼쪽 정렬", run: () => this.applyOp((m) => setAlign(m, col, "left"), { r: 0, col }) },
      { label: "가운데 정렬", run: () => this.applyOp((m) => setAlign(m, col, "center"), { r: 0, col }) },
      { label: "오른쪽 정렬", run: () => this.applyOp((m) => setAlign(m, col, "right"), { r: 0, col }) },
      { sep: true },
      { label: "번호 열로 지정", run: () => this.applyOp((m) => setSeqColumn(m, col), { r: 0, col }) },
      { sep: true },
      { label: "표 삭제", run: () => this.removeTable(), danger: true },
    ]);
  }
  private openRowMenu(bodyIdx: number, anchor: HTMLElement): void {
    // 캐럿 열은 seq 열을 건너뛴다 — firstEditableCol() 참조.
    this.openMenu(anchor, [
      { label: "위에 행 추가", run: () => this.applyOp(this.keepingSeq((m) => insertRow(m, bodyIdx)), { r: bodyIdx + 1, col: this.firstEditableCol() }) },
      { label: "아래에 행 추가", run: () => this.applyOp(this.keepingSeq((m) => insertRow(m, bodyIdx + 1)), { r: bodyIdx + 2, col: this.firstEditableCol() }) },
      { label: "행 삭제", run: () => this.applyOp(this.keepingSeq((m) => deleteRow(m, bodyIdx)), { r: Math.max(0, bodyIdx), col: this.firstEditableCol() }) },
    ]);
  }

  /** 표 전체를 문서에서 지운다(뒤따르는 줄바꿈 하나까지). 캐럿은 그 자리로. */
  private removeTable(): void {
    if (!this.view) return;
    const range = this.currentRange();
    if (!range) return;
    const doc = this.view.state.doc;
    const to = range.to < doc.length ? range.to + 1 : range.to;
    try {
      this.view.dispatch({ changes: { from: range.from, to }, selection: { anchor: range.from } });
      this.view.focus();
    } catch {
      /* 뷰가 파괴 중이면 무시 */
    }
  }

  private openMenu(anchor: HTMLElement, items: ({ label: string; run: () => void; danger?: boolean } | { sep: true })[]): void {
    this.closeMenu();
    if (!this.dom) return;
    const menu = document.createElement("div");
    menu.className = "cm-table-menu";
    menu.contentEditable = "false";
    menu.setAttribute("role", "menu");
    for (const it of items) {
      if ("sep" in it) {
        const sep = document.createElement("div");
        sep.className = "cm-menu-sep";
        menu.appendChild(sep);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      b.setAttribute("role", "menuitem");
      if (it.danger) b.className = "danger";
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => { e.preventDefault(); it.run(); this.closeMenu(); });
      menu.appendChild(b);
    }
    this.dom.appendChild(menu);
    // 고정 위치 — 에디터의 둥근 테두리(overflow:hidden)·스크롤 영역에 잘리지 않게. 화면 밖으로 넘치면 안쪽으로 당긴다
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - m.width - 8));
    const below = a.bottom + 4;
    const top = below + m.height > window.innerHeight - 8 ? Math.max(8, a.top - m.height - 4) : below;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    this.menuEl = menu;
    setTimeout(() => {
      document.addEventListener("mousedown", this.onDocDown);
      window.addEventListener("scroll", this.onScroll, true); // 고정 메뉴가 표와 떨어져 떠다니지 않게
    }, 0);
  }
  private onScroll = (e: Event) => {
    if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.closeMenu();
  };
  private closeMenu(): void {
    document.removeEventListener("mousedown", this.onDocDown);
    window.removeEventListener("scroll", this.onScroll, true);
    this.menuEl?.remove();
    this.menuEl = undefined;
  }

  // ---- 셀 범위 선택(드래그) + 복사(TSV)/삭제 ----

  /** 셀 mousedown — 드래그가 다른 셀로 넘어가면 범위 모드. 한 셀에 머물면 네이티브 텍스트 선택 유지. */
  protected onCellMouseDown(e: MouseEvent, cell: HTMLElement): void {
    if (e.button !== 0) return; // 좌클릭만
    this.clearRange();
    const anchor = this.coordOf(this.allCells().indexOf(cell));
    this.rangeAnchor = anchor;
    let active = false;
    const onMove = (ev: MouseEvent) => {
      const t = (ev.target as HTMLElement | null)?.closest?.(".cm-cell") as HTMLElement | null;
      if (!t || !this.dom || !this.dom.contains(t)) return;
      const cur = this.coordOf(this.allCells().indexOf(t));
      if (cur.r === anchor.r && cur.col === anchor.col) {
        if (active) { active = false; this.clearRangeHighlight(); this.selectedRect = undefined; } // 한 셀 복귀 → 네이티브 선택
        return;
      }
      active = true;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      this.highlightRange(anchor, cur);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (active) this.dom?.focus(); // 키보드 복사/삭제 수신
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private highlightRange(a: { r: number; col: number }, b: { r: number; col: number }): void {
    this.clearRangeHighlight();
    const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r);
    const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
    this.selectedRect = { r1, c1, r2, c2 };
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) this.cellAt(r, c)?.classList.add("cm-cell-selected");
  }
  private clearRangeHighlight(): void {
    this.dom?.querySelectorAll(".cm-cell-selected").forEach((el) => el.classList.remove("cm-cell-selected"));
  }
  private clearRange(): void {
    this.clearRangeHighlight();
    this.selectedRect = undefined;
    this.rangeAnchor = undefined;
  }

  protected onRangeKey(e: KeyboardEvent): void {
    if (this.maybeHistoryKey(e)) return;
    if (!this.selectedRect) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { e.preventDefault(); this.copyRange(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.deleteRange(); }
    else if (e.key === "Escape") { e.preventDefault(); this.clearRange(); }
  }

  /** 선택 범위를 TSV(탭 구분·행 개행)로 클립보드 복사 — 스프레드시트/셀 붙여넣기 호환. */
  private copyRange(): void {
    const rect = this.selectedRect;
    if (!rect || !this.dom) return;
    const m = parseGfmTable(serializeFromDom(this.dom));
    if (!m) return;
    const lines: string[] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const cells: string[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) cells.push(r === 0 ? (m.header[c] ?? "") : (m.rows[r - 1]?.[c] ?? ""));
      lines.push(cells.join("\t"));
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
  }

  /** 선택 범위의 셀 내용을 비움(구조 유지). */
  private deleteRange(): void {
    const rect = this.selectedRect;
    if (!rect) return;
    this.applyOp((m) => {
      const next: TableModel = { align: m.align.slice(), header: m.header.slice(), rows: m.rows.map((r) => r.slice()) };
      for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
          if (r === 0) { if (c < next.header.length) next.header[c] = ""; }
          else if (next.rows[r - 1] && c < next.rows[r - 1].length) next.rows[r - 1][c] = "";
        }
      }
      return next;
    }, { r: rect.r1, col: rect.c1 });
  }

  /** 멀티셀(TSV) 붙여넣기 — 대상 셀부터 그리드로 분배. 행 부족 시 자동 추가, 열 초과는 클램프. */
  protected onCellPaste(e: ClipboardEvent, cell: HTMLElement): void {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.includes("\t") && !text.includes("\n")) return; // 단일 셀 → 네이티브 평문 붙여넣기
    e.preventDefault();
    const grid = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
    const start = this.coordOf(this.allCells().indexOf(cell));
    // 붙여넣기 사각형이 실제로 덮는 열들(열 초과는 클램프되므로 ncol 미만만) — 이 열이 seq여도
    // 재번호로 덮어쓰면 방금 붙여넣은 값이 조용히 사라진다. keepingSeq에서 빼둔다.
    const ncol = this.colCount();
    const width = Math.max(...grid.map((g) => g.length));
    const pastedCols = new Set(
      Array.from({ length: width }, (_, j) => start.col + j).filter((c) => c < ncol),
    );
    this.applyOp(this.keepingSeq((m) => {
      const next: TableModel = { align: m.align.slice(), header: m.header.slice(), rows: m.rows.map((r) => r.slice()) };
      for (let i = 0; i < grid.length; i++) {
        const rVis = start.r + i; // r=0 헤더, r>=1 본문
        if (rVis >= 1) while (rVis - 1 >= next.rows.length) next.rows.push(Array.from({ length: ncol }, () => ""));
        for (let j = 0; j < grid[i].length; j++) {
          const c = start.col + j;
          if (c >= ncol) break; // 열 초과 클램프
          if (rVis === 0) next.header[c] = grid[i][j];
          else next.rows[rVis - 1][c] = grid[i][j];
        }
      }
      return next;
    }, pastedCols), start);
  }

  destroy(): void {
    const o = this.owner();
    o.closeMenu();
    o.commit(); // 언마운트/노트전환 안전망 — 미커밋분 최종 반영(best-effort)
  }
}
