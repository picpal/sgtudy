// gfmTable.ts — GFM 표 마크다운 ↔ 모델 순수 변환 + 구조조작. CodeMirror/DOM 의존 없음.
// work-note(frontend/src/editor/gfmTable.ts)에서 이식. 셀 인라인 렌더는 my-study/markdown.ts 의 parseInline 으로 통일해 여기서 뺐다.
// 모델의 셀 텍스트는 "논리 평문"(파이프=|, 줄바꿈=\n)이며, 직렬화 시에만 GFM 안전 형태로 이스케이프한다.

export type Align = "none" | "left" | "center" | "right";

export interface TableModel {
  align: Align[];   // 열 개수만큼. 구분행에서 파싱
  header: string[]; // 헤더 셀(논리 평문)
  rows: string[][]; // 본문 행들. 각 행은 열 개수에 맞춰 정규화
}

/** 논리 평문 → GFM 셀 안전 형태: 내부 파이프 \| , 줄바꿈 <br>. */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** GFM 셀 → 논리 평문: <br> → \n, \| → |. (순서 주의: <br> 먼저) */
export function unescapeCell(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|");
}

const DELIM_CELL = /^:?-+:?$/;

/** 한 줄에서 이스케이프되지 않은 파이프로 셀 분리. 선/후행 파이프 제거, 각 셀 trim. */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { buf += "\\|"; i++; continue; }
    if (s[i] === "|") { cells.push(buf.trim()); buf = ""; continue; }
    buf += s[i];
  }
  cells.push(buf.trim());
  return cells;
}

function parseAlign(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/** GFM 표 소스(여러 줄) → 모델. 표가 아니면 null. */
export function parseGfmTable(src: string): TableModel | null {
  const lines = src.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const header = splitCells(lines[0]);
  const delim = splitCells(lines[1]);
  if (delim.length === 0 || !delim.every((c) => DELIM_CELL.test(c))) return null;
  const ncol = header.length;
  const align: Align[] = [];
  for (let i = 0; i < ncol; i++) align.push(parseAlign(delim[i] ?? ""));
  const normRow = (cells: string[]): string[] => {
    const r = cells.slice(0, ncol).map(unescapeCell);
    while (r.length < ncol) r.push("");
    return r;
  };
  return {
    align,
    header: header.map(unescapeCell),
    rows: lines.slice(2).map((l) => normRow(splitCells(l))),
  };
}

function delimFor(a: Align): string {
  switch (a) {
    case "left": return ":---";
    case "center": return ":---:";
    case "right": return "---:";
    default: return "---";
  }
}

/** 모델 → GFM 표 마크다운(끝 개행 없음). 셀은 양쪽 한 칸 패딩 + 이스케이프. */
export function serializeGfmTable(m: TableModel): string {
  const row = (cells: string[]) => "| " + cells.map(escapeCell).join(" | ") + " |";
  return [
    row(m.header),
    "| " + m.align.map(delimFor).join(" | ") + " |",
    ...m.rows.map(row),
  ].join("\n");
}

function emptyRow(n: number): string[] {
  return Array.from({ length: n }, () => "");
}

/** atBodyIndex 위치에 빈 본문 행 삽입(범위 초과는 끝에). */
export function insertRow(m: TableModel, atBodyIndex: number): TableModel {
  const rows = m.rows.map((r) => r.slice());
  const i = Math.max(0, Math.min(atBodyIndex, rows.length));
  rows.splice(i, 0, emptyRow(m.header.length));
  return { ...m, rows };
}

/** 본문 행 삭제(범위 밖이면 그대로). 헤더만 남는 것 허용. */
export function deleteRow(m: TableModel, bodyIndex: number): TableModel {
  if (bodyIndex < 0 || bodyIndex >= m.rows.length) return m;
  const rows = m.rows.map((r) => r.slice());
  rows.splice(bodyIndex, 1);
  return { ...m, rows };
}

/** atIndex 위치에 빈 열 삽입(align="none"). */
export function insertColumn(m: TableModel, atIndex: number): TableModel {
  const i = Math.max(0, Math.min(atIndex, m.header.length));
  const header = m.header.slice(); header.splice(i, 0, "");
  const align = m.align.slice(); align.splice(i, 0, "none");
  const rows = m.rows.map((r) => { const c = r.slice(); c.splice(i, 0, ""); return c; });
  return { align, header, rows };
}

/** 열 삭제. 최소 1열 유지(마지막 열 삭제 거부). */
export function deleteColumn(m: TableModel, index: number): TableModel {
  if (m.header.length <= 1) return m;
  if (index < 0 || index >= m.header.length) return m;
  const header = m.header.slice(); header.splice(index, 1);
  const align = m.align.slice(); align.splice(index, 1);
  const rows = m.rows.map((r) => { const c = r.slice(); c.splice(index, 1); return c; });
  return { align, header, rows };
}

/** 지정 열 정렬 변경(범위 밖이면 그대로). */
export function setAlign(m: TableModel, index: number, align: Align): TableModel {
  if (index < 0 || index >= m.align.length) return m;
  const a = m.align.slice(); a[index] = align;
  return { ...m, align: a };
}

/** seq(번호) 열 판정: 가운데 정렬 + 본문 1행 이상 + 본문 셀이 정확히 "1".."N".
    GFM에 메타데이터 자리가 없어 내용 자체가 표식이다 — 지정하면 이 모양이 되고, 이 모양이면 유지된다. */
export function isSeqColumn(m: TableModel, col: number): boolean {
  if (col < 0 || col >= m.header.length) return false;
  if (m.rows.length === 0) return false;
  if (m.align[col] !== "center") return false;
  return m.rows.every((r, i) => r[col] === String(i + 1));
}

/** 모델 전체에서 seq 열 인덱스를 모은다. 구조 연산 *전에* 호출해야 한다 —
    행을 넣고 나면 그 열은 1,2,"",3 이 되어 더 이상 연속이 아니다. */
export function seqColumns(m: TableModel): number[] {
  const cols: number[] = [];
  for (let i = 0; i < m.header.length; i++) {
    if (isSeqColumn(m, i)) cols.push(i);
  }
  return cols;
}

/** 지정: 해당 열을 1..N으로 채우고 가운데 정렬. 범위 밖이면 그대로. */
export function setSeqColumn(m: TableModel, col: number): TableModel {
  if (col < 0 || col >= m.header.length) return m;
  const align = m.align.slice(); align[col] = "center";
  const rows = m.rows.map((r, i) => { const c = r.slice(); c[col] = String(i + 1); return c; });
  return { ...m, align, rows };
}

/** 주어진 열들을 1..N으로 다시 채운다. 범위 밖 인덱스는 무시. */
export function renumberSeq(m: TableModel, cols: number[]): TableModel {
  const valid = cols.filter((c) => c >= 0 && c < m.header.length);
  if (valid.length === 0) return m;
  const rows = m.rows.map((r, i) => {
    const c = r.slice();
    for (const col of valid) c[col] = String(i + 1);
    return c;
  });
  return { ...m, rows };
}
