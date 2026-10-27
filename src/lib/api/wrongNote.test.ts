import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { bookmarkWrongNote, fetchWrongNote, fetchWrongNoteMine, masterWrongNote, practiceWrongNote } from "./wrongNote";

const fake = (data: unknown = {}) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("wrongNote adapter — RPC 이름·인자(0046)", () => {
  it("each call maps to the SQL signature (question id → number, answer undefined → null)", async () => {
    const f = fake();
    await fetchWrongNote("aws", f.client);
    await fetchWrongNoteMine(f.client);
    await practiceWrongNote("aws", [{ questionId: "12", answer: [0, 2] }, { questionId: "13", answer: undefined }], f.client);
    await masterWrongNote("spring", "12", true, f.client);
    await masterWrongNote("aws", "7", false, f.client);
    await bookmarkWrongNote("aws", "9", true, f.client);
    expect(f.calls).toEqual([
      ["wrong_note_list", { p_slug: "aws" }],
      ["wrong_note_mine", {}],
      ["wrong_note_practice", { p_slug: "aws", p_answers: [{ questionId: "12", answer: [0, 2] }, { questionId: "13", answer: null }] }],   // questionId 는 문자열 그대로(서버 검사)
      ["wrong_note_master", { p_slug: "spring", p_question: 12, p_on: true }],
      ["wrong_note_master", { p_slug: "aws", p_question: 7, p_on: false }],
      ["wrong_note_bookmark", { p_slug: "aws", p_question: 9, p_on: true }],
    ]);
  });

  it("returns data · server error → ApiException with code/details", async () => {
    await expect(masterWrongNote("aws", "1", true, fake({ mastered: true }).client)).resolves.toEqual({ mastered: true });
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: "WRONG_NOTE_LOCKED", details: "정답이 공개된 뒤에 다시 풀 수 있어요", hint: '{"unlockDate":"2026-10-21"}', code: "P0001" } }) } as unknown as Db;
    await expect(practiceWrongNote("aws", [{ questionId: "1", answer: 0 }], client)).rejects.toMatchObject({ code: "WRONG_NOTE_LOCKED", details: { unlockDate: "2026-10-21" } });
  });
});
