"use client";

import { createElement, Fragment } from "react";
import { imgLabel } from "@/lib/markdown/inline";
import { headingTag, parseInline, parseMarkdown, type MdBlock, type MdInline, type MdItem } from "./markdown";

/** 줄바꿈(\n)을 <br> 로 — 표 셀(<br>)·문단 안 줄바꿈 */
function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((l, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          <Inline text={l} />
        </Fragment>
      ))}
    </>
  );
}

/** 그림 토큰 — 외부 그림은 불러오지 않고 링크로(D2), 첨부 그림은 풀 노드가 없으면 자리표시 글자(D4) */
function Img({ s }: { s: Extract<MdInline, { t: "img" }> }) {
  if (s.src.kind === "external") {
    return <a href={s.src.href} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">그림 링크: {imgLabel(s)}</a>;
  }
  return <span className="text-muted">[그림: {imgLabel(s)}]</span>;
}

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.t === "b" ? <strong key={i} className="font-bold text-ink">{s.v}</strong>
        : s.t === "i" ? <em key={i}>{s.v}</em>
        : s.t === "s" ? <del key={i} className="text-muted">{s.v}</del>
        : s.t === "code" ? <code key={i} className="rounded-[5px] bg-surface-2 px-[5px] py-px text-[13px]">{s.v}</code>
        : s.t === "a" ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">{s.v}</a>
        : s.t === "img" ? <Img key={i} s={s} />
        : <Fragment key={i}>{s.v}</Fragment>,
      )}
    </>
  );
}

// ul 단계별 기호 disc → circle → square → square (스펙 §4.4)
const UL_STYLE = ["list-disc", "list-[circle]", "list-[square]", "list-[square]"];

/** 목록(하위 목록은 항목 안에서 재귀) — 항목 글은 이어진 줄(\n)을 <br> 로 */
function ListBlock({ b, level }: { b: Extract<MdBlock, { type: "ul" | "ol" | "task" }>; level: number }) {
  const sub = (it: MdItem) => it.sub.length > 0 && (
    <div className="mt-[2px] flex flex-col gap-[2px]">
      {it.sub.map((c, k) => c.type === "ul" || c.type === "ol" || c.type === "task" ? <ListBlock key={k} b={c} level={level + 1} /> : <Block key={k} b={c} />)}
    </div>
  );
  if (b.type === "task") {
    return (
      <ul className={`m-0 flex list-none flex-col gap-[2px] ${level > 0 ? "pl-5" : "p-0"}`}>
        {b.items.map((it, j) => (
          <li key={j}>
            <div className="flex items-start gap-2">
              {/* 읽기 전용 표시 — 체크는 편집에서만 바꾼다 */}
              <span aria-hidden="true" className={`mt-[5px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] ${it.done ? "border-mint bg-mint text-white" : "border-line-dash bg-surface"}`}>
                {it.done && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                )}
              </span>
              <span className={it.done ? "text-muted line-through" : undefined}>
                <span className="sr-only">{it.done ? "완료: " : "할 일: "}</span>
                <Lines text={it.text} />
              </span>
            </div>
            {sub(it)}
          </li>
        ))}
      </ul>
    );
  }
  const List = b.type;
  return (
    <List start={b.type === "ol" ? b.start : undefined} className={`m-0 pl-5 ${b.type === "ul" ? UL_STYLE[Math.min(level, 3)] : "list-decimal"}`}>
      {b.items.map((it, j) => (
        <li key={j}>
          <Lines text={it.text} />
          {sub(it)}
        </li>
      ))}
    </List>
  );
}

const ALIGN = { none: undefined, left: "left", center: "center", right: "right" } as const;

function Block({ b }: { b: MdBlock }) {
  switch (b.type) {
    case "h": {
      const size = b.level === 1 ? "text-[17px]" : b.level === 2 ? "text-[16px]" : "text-[15px]";
      return createElement(headingTag(b.level), { className: `m-0 font-bold text-ink ${size}` }, <Inline text={b.text} />);
    }
    case "p":
      return <p className="m-0"><Lines text={b.lines.join("\n")} /></p>;
    case "ul":
    case "ol":
    case "task":
      return <ListBlock b={b} level={0} />;
    case "quote":
      return (
        <blockquote className="m-0 flex flex-col gap-[6px] border-l-[3px] border-line-3 pl-3 text-muted">
          {b.blocks.map((c, j) => <Block key={j} b={c} />)}
        </blockquote>
      );
    case "details":
      // 네이티브 <details> — 키보드·펼침 상태 낭독이 공짜(D9). 기본 닫힘, 제목의 그림은 자리표시(summary 안 버튼 금지)
      return (
        <details className="group rounded-[10px] border border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block text-[12px] text-muted motion-safe:transition-transform group-open:rotate-90">▸</span>
            <span>{b.title ? <Inline text={b.title} /> : "펼쳐 보기"}</span>
          </summary>
          <div className="flex flex-col gap-[10px] px-3 pb-3">
            {b.blocks.map((c, j) => <Block key={j} b={c} />)}
          </div>
        </details>
      );
    case "code":
      return (
        <pre className="thin-scroll m-0 overflow-x-auto rounded-[10px] border border-line bg-surface-2 px-3 py-[10px] text-[13px] leading-[1.6] text-ink">
          <code>{b.text}</code>
        </pre>
      );
    case "hr":
      return <hr className="my-1 border-0 border-t border-line" />;
    case "table":
      return (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full border-collapse text-[13px] leading-[1.6]">
            <thead>
              <tr>
                {b.table.header.map((c, j) => (
                  <th key={j} scope="col" className="border border-line-3 bg-surface-2 px-[10px] py-[6px] text-left font-semibold text-ink" style={{ textAlign: ALIGN[b.table.align[j] ?? "none"] }}>
                    <Lines text={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.table.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} className="border border-line-3 px-[10px] py-[6px] align-top" style={{ textAlign: ALIGN[b.table.align[j] ?? "none"] }}>
                      {/* 빈 칸도 한 줄 높이 — 빈 행이 납작하게 접히지 않게(에디터 표와 같게, Q1-11) */}
                      {c.trim() ? <Lines text={c} /> : "\u00a0"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** 마크다운 본문(스터디 소개·회차/과제 설명) — 파싱 결과를 React 요소로만 그린다 */
export function MarkdownView({ src, className = "text-[14px] leading-[1.75]" }: { src: string; className?: string }) {
  const blocks = parseMarkdown(src);
  return (
    <div className={`flex flex-col gap-[10px] text-ink-2 ${className}`}>
      {blocks.map((b, i) => <Block key={i} b={b} />)}
    </div>
  );
}
