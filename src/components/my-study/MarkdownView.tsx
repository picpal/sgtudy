"use client";

import { Fragment } from "react";
import { parseInline, parseMarkdown } from "./markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.t === "b" ? <strong key={i} className="font-bold text-ink">{s.v}</strong>
        : s.t === "i" ? <em key={i}>{s.v}</em>
        : s.t === "code" ? <code key={i} className="rounded-[5px] bg-surface-2 px-[5px] py-px text-[13px]">{s.v}</code>
        : s.t === "a" ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">{s.v}</a>
        : <Fragment key={i}>{s.v}</Fragment>,
      )}
    </>
  );
}

/** 스터디 소개(상세 설명, 마크다운) — 파싱 결과를 React 요소로만 그린다 */
export function MarkdownView({ src }: { src: string }) {
  const blocks = parseMarkdown(src);
  return (
    <div className="flex flex-col gap-[10px] text-[14px] leading-[1.75] text-ink-2">
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const size = b.level === 1 ? "text-[17px]" : b.level === 2 ? "text-[16px]" : "text-[15px]";
          return <p key={i} className={`m-0 font-bold text-ink ${size}`}><Inline text={b.text} /></p>;
        }
        if (b.type === "p")
          return (
            <p key={i} className="m-0">
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline text={l} />
                </Fragment>
              ))}
            </p>
          );
        const List = b.type === "ul" ? "ul" : "ol";
        return (
          <List key={i} className={`m-0 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"}`}>
            {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
