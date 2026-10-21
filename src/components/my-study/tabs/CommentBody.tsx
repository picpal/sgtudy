"use client";

import { Fragment } from "react";
import { mentionLabel, tokenize } from "@/lib/mention";
import { Inline } from "../MarkdownView";

type People = Record<string, { nickname: string }>;

/**
 * 댓글 본문 (D6·D10) — 인라인 md 부분집합(굵게·기울임·취소선·`코드`·링크, 공지·설명과 같은 parseInline) + 줄바꿈 + 멘션 칩.
 * 칩은 글자 그대로 "@닉네임"(색만으로 구분하지 않는다), 나를 부른 칩은 배경까지. 맵에 없는 uid 는 "@알 수 없음"
 */
export function CommentBody({ body, people, meId }: { body: string; people: People; meId: string | null }) {
  return (
    <>
      {body.split("\n").map((line, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {tokenize(line).map((s, i) =>
            s.type === "text" ? (
              <Inline key={i} text={s.text} />
            ) : (
              <span key={i} data-mention={s.userId} className={`font-semibold text-mint ${s.userId === meId ? "rounded-[5px] bg-mint-soft px-[3px]" : ""}`}>
                {mentionLabel(s.userId, people)}
              </span>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}
