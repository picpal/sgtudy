import { describe, it, expect } from "vitest";
import {
  escapeCell, unescapeCell, parseGfmTable, serializeGfmTable,
  insertRow, deleteRow, insertColumn, deleteColumn, setAlign,
  isSeqColumn, seqColumns, setSeqColumn, renumberSeq,
} from "./gfmTable";
import type { TableModel } from "./gfmTable";

describe("escapeCell / unescapeCell", () => {
  it("파이프를 이스케이프한다", () => {
    expect(escapeCell("a|b")).toBe("a\\|b");
  });
  it("개행을 <br>로 바꾼다", () => {
    expect(escapeCell("line1\nline2")).toBe("line1<br>line2");
    expect(escapeCell("a\r\nb")).toBe("a<br>b");
  });
  it("unescape는 <br>과 \\| 를 되돌린다", () => {
    expect(unescapeCell("a\\|b")).toBe("a|b");
    expect(unescapeCell("line1<br>line2")).toBe("line1\nline2");
    expect(unescapeCell("a<br/>b")).toBe("a\nb");
  });
  it("escape→unescape 왕복", () => {
    const s = "x|y\nz";
    expect(unescapeCell(escapeCell(s))).toBe(s);
  });
});

describe("parseGfmTable", () => {
  it("표준 표를 파싱한다", () => {
    const m = parseGfmTable("| 항목 | 설명 |\n| --- | --- |\n| a | b |\n| c | d |");
    expect(m).toEqual({
      align: ["none", "none"],
      header: ["항목", "설명"],
      rows: [["a", "b"], ["c", "d"]],
    });
  });
  it("정렬 마커 4종을 파싱한다", () => {
    const m = parseGfmTable("| h1 | h2 | h3 | h4 |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |");
    expect(m!.align).toEqual(["none", "left", "center", "right"]);
  });
  it("선/후행 파이프가 없어도 파싱한다", () => {
    const m = parseGfmTable("a | b\n--- | ---\n1 | 2");
    expect(m).toEqual({ align: ["none", "none"], header: ["a", "b"], rows: [["1", "2"]] });
  });
  it("이스케이프된 \\| 는 셀을 분리하지 않는다", () => {
    const m = parseGfmTable("| h |\n| --- |\n| a\\|b |");
    expect(m!.rows).toEqual([["a|b"]]);
  });
  it("열 수가 부족한 행은 빈 셀로, 초과 셀은 버려 직사각형을 유지한다", () => {
    const m = parseGfmTable("| h1 | h2 |\n| --- | --- |\n| a |\n| x | y | z |");
    expect(m!.rows).toEqual([["a", ""], ["x", "y"]]);
  });
  it("헤더만 있는 표(본문 0행)도 유효", () => {
    const m = parseGfmTable("| h1 | h2 |\n| --- | --- |");
    expect(m).toEqual({ align: ["none", "none"], header: ["h1", "h2"], rows: [] });
  });
  it("구분행이 없으면 null", () => {
    expect(parseGfmTable("| a | b |\n| c | d |")).toBeNull();
  });
  it("두 줄 미만이면 null", () => {
    expect(parseGfmTable("| a |")).toBeNull();
  });
});

describe("serializeGfmTable", () => {
  it("정렬 마커를 출력한다", () => {
    const out = serializeGfmTable({
      align: ["none", "left", "center", "right"],
      header: ["h1", "h2", "h3", "h4"],
      rows: [["1", "2", "3", "4"]],
    });
    expect(out).toBe("| h1 | h2 | h3 | h4 |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |");
  });
  it("셀의 파이프·개행을 이스케이프한다", () => {
    const out = serializeGfmTable({ align: ["none"], header: ["h"], rows: [["a|b\nc"]] });
    expect(out).toBe("| h |\n| --- |\n| a\\|b<br>c |");
  });
  it("헤더만 있는 표를 직렬화한다", () => {
    expect(serializeGfmTable({ align: ["none", "none"], header: ["a", "b"], rows: [] }))
      .toBe("| a | b |\n| --- | --- |");
  });
});

describe("parse ∘ serialize 라운드트립", () => {
  const fixtures: TableModel[] = [
    { align: ["none", "none"], header: ["항목", "설명"], rows: [["a", "b"], ["c", "d"]] },
    { align: ["left", "center", "right"], header: ["x", "y", "z"], rows: [["1", "2", "3"]] },
    { align: ["none"], header: ["pipe"], rows: [["a|b"], ["c\nd"]] },
    { align: ["none", "none"], header: ["h1", "h2"], rows: [] },
  ];
  it("parse(serialize(m)) === m", () => {
    for (const m of fixtures) {
      expect(parseGfmTable(serializeGfmTable(m))).toEqual(m);
    }
  });
});

describe("구조조작", () => {
  const base = (): TableModel => ({
    align: ["none", "none"],
    header: ["h1", "h2"],
    rows: [["a", "b"], ["c", "d"]],
  });

  it("insertRow: 인덱스 위치에 빈 행 삽입", () => {
    expect(insertRow(base(), 1).rows).toEqual([["a", "b"], ["", ""], ["c", "d"]]);
  });
  it("insertRow: 범위 초과는 끝에 추가", () => {
    expect(insertRow(base(), 99).rows).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
  });
  it("deleteRow: 본문 행 삭제", () => {
    expect(deleteRow(base(), 0).rows).toEqual([["c", "d"]]);
  });
  it("deleteRow: 마지막 본문 행 삭제 → 헤더만", () => {
    let m = deleteRow(base(), 0);
    m = deleteRow(m, 0);
    expect(m.rows).toEqual([]);
  });
  it("deleteRow: 범위 밖이면 그대로", () => {
    expect(deleteRow(base(), 5)).toEqual(base());
  });
  it("insertColumn: 헤더·정렬·모든 행에 빈 열 삽입", () => {
    const m = insertColumn(base(), 1);
    expect(m.header).toEqual(["h1", "", "h2"]);
    expect(m.align).toEqual(["none", "none", "none"]);
    expect(m.rows).toEqual([["a", "", "b"], ["c", "", "d"]]);
  });
  it("deleteColumn: 열 삭제", () => {
    const m = deleteColumn(base(), 0);
    expect(m.header).toEqual(["h2"]);
    expect(m.align).toEqual(["none"]);
    expect(m.rows).toEqual([["b"], ["d"]]);
  });
  it("deleteColumn: 마지막 1열은 삭제 거부", () => {
    const single: TableModel = { align: ["none"], header: ["h"], rows: [["a"]] };
    expect(deleteColumn(single, 0)).toEqual(single);
  });
  it("setAlign: 지정 열 정렬 변경", () => {
    expect(setAlign(base(), 1, "center").align).toEqual(["none", "center"]);
  });
  it("setAlign: 범위 밖이면 그대로", () => {
    expect(setAlign(base(), 9, "right")).toEqual(base());
  });
  it("순수성: 원본 불변", () => {
    const m = base();
    insertRow(m, 0); deleteColumn(m, 0); setAlign(m, 0, "right");
    expect(m.rows).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("seq 열", () => {
  it("isSeqColumn: 가운데 정렬 + 1,2,3 인 열은 참", () => {
    const m: TableModel = {
      align: ["center", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"], ["2", "나"], ["3", "다"]],
    };
    expect(isSeqColumn(m, 0)).toBe(true);
  });

  it("isSeqColumn: 내용은 1,2,3 이지만 정렬이 center가 아니면 거짓", () => {
    const m: TableModel = {
      align: ["left", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"], ["2", "나"], ["3", "다"]],
    };
    expect(isSeqColumn(m, 0)).toBe(false);
  });

  it("isSeqColumn: 정렬은 center지만 번호가 끊기면(1,2,4) 거짓", () => {
    const m: TableModel = {
      align: ["center", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"], ["2", "나"], ["4", "다"]],
    };
    expect(isSeqColumn(m, 0)).toBe(false);
  });

  it("isSeqColumn: 본문 0행이면 거짓", () => {
    const m: TableModel = { align: ["center"], header: ["No."], rows: [] };
    expect(isSeqColumn(m, 0)).toBe(false);
  });

  it("isSeqColumn: 범위 밖 인덱스는 거짓", () => {
    const m: TableModel = {
      align: ["center", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"]],
    };
    expect(isSeqColumn(m, -1)).toBe(false);
    expect(isSeqColumn(m, 2)).toBe(false);
  });

  it('isSeqColumn: "01"·" 1"·"1." 같은 유사 표기는 거짓', () => {
    const withCell = (cell: string): TableModel => ({
      align: ["center"],
      header: ["No."],
      rows: [[cell]],
    });
    expect(isSeqColumn(withCell("01"), 0)).toBe(false);
    expect(isSeqColumn(withCell(" 1"), 0)).toBe(false);
    expect(isSeqColumn(withCell("1."), 0)).toBe(false);
  });

  it("seqColumns: seq 열이 둘이면 둘 다 찾는다", () => {
    const m: TableModel = {
      align: ["center", "none", "center"],
      header: ["No1", "항목", "No2"],
      rows: [["1", "가", "1"], ["2", "나", "2"]],
    };
    expect(seqColumns(m)).toEqual([0, 2]);
  });

  it("setSeqColumn: 빈 열이 1..N + center로 채워진다", () => {
    const m: TableModel = {
      align: ["none", "none"],
      header: ["No.", "항목"],
      rows: [["", "가"], ["", "나"], ["", "다"]],
    };
    const out = setSeqColumn(m, 0);
    expect(out.align[0]).toBe("center");
    expect(out.rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
  });

  it("setSeqColumn: 지정 결과가 곧 isSeqColumn을 만족한다(지정→감지 왕복)", () => {
    const m: TableModel = {
      align: ["none", "none"],
      header: ["No.", "항목"],
      rows: [["x", "가"], ["y", "나"]],
    };
    const out = setSeqColumn(m, 0);
    expect(isSeqColumn(out, 0)).toBe(true);
  });

  it("setSeqColumn: 범위 밖이면 모델이 그대로다", () => {
    const m: TableModel = {
      align: ["none", "none"],
      header: ["No.", "항목"],
      rows: [["", "가"]],
    };
    expect(setSeqColumn(m, 9)).toEqual(m);
  });

  it("renumberSeq: 행 삽입으로 깨진 번호를 1..N으로 되돌린다", () => {
    const m: TableModel = {
      align: ["center", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"], ["", ""], ["2", "다"]],
    };
    const out = renumberSeq(m, [0]);
    expect(out.rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
  });

  it("renumberSeq: 빈 배열이면 같은 객체를 그대로 반환한다", () => {
    const m: TableModel = {
      align: ["center", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"]],
    };
    expect(renumberSeq(m, [])).toBe(m);
  });

  it("renumberSeq: 유효 인덱스가 없으면 같은 객체를 그대로 반환한다", () => {
    const m: TableModel = { align: ["center"], header: ["No."], rows: [["1"]] };
    expect(renumberSeq(m, [9])).toBe(m);
  });

  it("renumberSeq: seq 열 두 개를 동시에 재번호한다", () => {
    const m: TableModel = {
      align: ["center", "none", "center"],
      header: ["No1", "항목", "No2"],
      rows: [["1", "가", "1"], ["", "나", ""], ["2", "다", "2"]],
    };
    const out = renumberSeq(m, [0, 2]);
    expect(out.rows.map((r) => r[0])).toEqual(["1", "2", "3"]);
    expect(out.rows.map((r) => r[2])).toEqual(["1", "2", "3"]);
  });

  it("renumberSeq: 정렬은 바꾸지 않는다", () => {
    const m: TableModel = {
      align: ["left", "none"],
      header: ["No.", "항목"],
      rows: [["1", "가"], ["4", "다"]],
    };
    const out = renumberSeq(m, [0]);
    expect(out.align).toEqual(["left", "none"]);
  });

  it("핵심 시나리오: 파싱 → seqColumns → insertRow → renumberSeq → 직렬화까지 왕복", () => {
    const m = parseGfmTable("| No. | 항목 |\n|:---:|---|\n| 1 | 가 |\n| 2 | 다 |")!;
    const cols = seqColumns(m);
    expect(cols).toEqual([0]);
    const next = insertRow(m, 1);
    const renumbered = renumberSeq(next, cols);
    const out = serializeGfmTable(renumbered);
    expect(out).toBe("| No. | 항목 |\n| :---: | --- |\n| 1 | 가 |\n| 2 |  |\n| 3 | 다 |");
  });
});
