"use client";

import { createElement, Fragment, useState } from "react";
import { imgLabel } from "@/lib/markdown/inline";
import { headingTag, parseInline, parseMarkdown, type MdBlock, type MdInline, type MdItem } from "./markdown";

/** 줄바꿈(\n)을 <br> 로 — 표 셀(<br>)·문단 안 줄바꿈 */
function Lines({ text, images }: { text: string; images?: ImageResolver }) {
  return (
    <>
      {text.split("\n").map((l, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          <Inline text={l} images={images} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * 설명 속 그림을 그 노드의 첨부로 푸는 쪽(md-images 스펙 §3.1) — 노드 설명(DetailView·LeafBody)만 넘긴다.
 * url 은 서명 URL 뿐이다: 사용자가 쓴 주소는 <img src> 에 들어갈 길이 없다(T1·T5).
 */
export type ImageResolver = {
  resolve(name: string): { state: "loading" } | { state: "missing" } | { state: "ok"; fileId: string; url: string; svg: boolean };
  /** 라이트박스 — 없으면 그림은 누르는 버튼이 아니다 */
  open?: (fileId: string) => void;
  /** <img> 가 못 불러오면(서명 만료) 한 번 다시 서명 */
  refresh(fileId: string): void;
};

type ImgToken = Extract<MdInline, { t: "img" }>;
// 못 찾음·실패 상자 — 블록은 44px 상자, 글 사이(인라인)는 줄 높이를 벌리지 않는 글자 크기 테두리
const BOX_BLOCK = "flex min-h-11 items-center rounded-[10px] border border-dashed border-line-dash px-3 text-[13px] text-muted";
const BOX_INLINE = "rounded-[6px] border border-dashed border-line-dash px-[5px] text-[12px] text-muted [box-decoration-break:clone]";
// 글 사이 그림은 줄 높이 안의 작은 그림(누르면 라이트박스) — 원본 크기로 그리면 줄이 커진다
const INLINE_IMG = "inline-block h-[1.5em] w-auto max-w-[8em] rounded-[4px] align-middle";
const INLINE_SKELETON = "inline-block h-[1.5em] w-[2.5em] rounded-[4px] bg-surface-2 align-middle motion-safe:animate-pulse";

/** 첨부 그림 하나 — 로딩 스켈레톤 → 그림, 못 불러오면 한 번 다시 서명하고 그래도 안 되면 실패 상자 (D5·D6·D14) */
function AttachedImg({ s, name, images, block }: { s: ImgToken; name: string; images: ImageResolver; block: boolean }) {
  const r = images.resolve(name);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [retried, setRetried] = useState<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const box = block ? BOX_BLOCK : BOX_INLINE;
  if (r.state === "loading") return <span aria-hidden="true" className={block ? "block h-40 w-full rounded-[10px] bg-surface-2 motion-safe:animate-pulse" : INLINE_SKELETON} />;
  if (r.state === "missing") return <span className={box}>그림을 찾을 수 없어요 · {name}</span>;
  if (broken === r.fileId) return <span className={box}>그림을 불러올 수 없어요 · {name}</span>;
  const loaded = loadedUrl === r.url;
  const onError = () => {
    if (retried === r.fileId) setBroken(r.fileId);
    else {
      setRetried(r.fileId);
      images.refresh(r.fileId);
    }
  };
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- 서명 URL·SVG 는 next/image 최적화 대상이 아니다(스펙 D17)
    <img
      src={r.url}
      alt={s.alt || name}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoadedUrl(r.url)}
      onError={onError}
      className={`${block ? "block max-h-[min(560px,70vh)] max-w-full rounded-[10px]" : INLINE_IMG} object-contain ${r.svg ? "bg-white" : ""} ${loaded ? "" : block ? "min-h-40 min-w-40 bg-surface-2 motion-safe:animate-pulse" : "min-w-[2.5em] bg-surface-2 motion-safe:animate-pulse"}`}
    />
  );
  if (!images.open) return img;
  const open = images.open;
  const id = r.fileId;
  return (
    <button type="button" onClick={() => open(id)} className={`${block ? "block rounded-[10px]" : "inline-block rounded-[4px] align-middle leading-none"} max-w-full cursor-zoom-in p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint`}>
      {img}
      <span className="sr-only">크게 보기</span>
    </button>
  );
}

/** 그림 토큰 — 외부 그림은 불러오지 않고 링크로(D2), 첨부 그림은 풀 노드가 없으면 자리표시 글자(D4) */
function Img({ s, images, block = false }: { s: ImgToken; images?: ImageResolver; block?: boolean }) {
  if (s.src.kind === "external") {
    return <a href={s.src.href} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">그림 링크: {imgLabel(s)}</a>;
  }
  if (!images) return <span className="text-muted">[그림: {imgLabel(s)}]</span>;
  return <AttachedImg s={s} name={s.src.name} images={images} block={block} />;
}

/** 그림 하나뿐인 글(문단·목록 항목)이면 그 토큰 — 블록 그림으로 그린다(D6). 표 셀은 글 사이 그림처럼 작게 */
function soleImg(text: string): ImgToken | null {
  const only = parseInline(text.trim());
  return only.length === 1 && only[0].t === "img" ? only[0] : null;
}

/** 목록 항목 글 — 그림 하나뿐이면 블록 그림 */
function ItemText({ text, images }: { text: string; images?: ImageResolver }) {
  const img = soleImg(text);
  return img ? <Img s={img} images={images} block /> : <Lines text={text} images={images} />;
}

export function Inline({ text, images }: { text: string; images?: ImageResolver }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.t === "b" ? <strong key={i} className="font-bold text-ink">{s.v}</strong>
        : s.t === "i" ? <em key={i}>{s.v}</em>
        : s.t === "s" ? <del key={i} className="text-muted">{s.v}</del>
        : s.t === "code" ? <code key={i} className="rounded-[5px] bg-surface-2 px-[5px] py-px text-[13px]">{s.v}</code>
        : s.t === "a" ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">{s.v}</a>
        : s.t === "img" ? <Img key={i} s={s} images={images} />
        : <Fragment key={i}>{s.v}</Fragment>,
      )}
    </>
  );
}

// ul 단계별 기호 disc → circle → square → square (스펙 §4.4)
const UL_STYLE = ["list-disc", "list-[circle]", "list-[square]", "list-[square]"];

/** 목록(하위 목록은 항목 안에서 재귀) — 항목 글은 이어진 줄(\n)을 <br> 로 */
function ListBlock({ b, level, images }: { b: Extract<MdBlock, { type: "ul" | "ol" | "task" }>; level: number; images?: ImageResolver }) {
  const sub = (it: MdItem) => it.sub.length > 0 && (
    <div className="mt-[2px] flex flex-col gap-[2px]">
      {it.sub.map((c, k) => c.type === "ul" || c.type === "ol" || c.type === "task" ? <ListBlock key={k} b={c} level={level + 1} images={images} /> : <Block key={k} b={c} images={images} />)}
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
                <ItemText text={it.text} images={images} />
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
          <ItemText text={it.text} images={images} />
          {sub(it)}
        </li>
      ))}
    </List>
  );
}

const ALIGN = { none: undefined, left: "left", center: "center", right: "right" } as const;

function Block({ b, images }: { b: MdBlock; images?: ImageResolver }) {
  switch (b.type) {
    case "h": {
      const size = b.level === 1 ? "text-[17px]" : b.level === 2 ? "text-[16px]" : "text-[15px]";
      return createElement(headingTag(b.level), { className: `m-0 font-bold text-ink ${size}` }, <Inline text={b.text} />);
    }
    case "p": {
      // 문단에 그림 하나뿐이면 블록 그림(D6)
      const img = soleImg(b.lines.join("\n"));
      if (img) return <p className="m-0"><Img s={img} images={images} block /></p>;
      return <p className="m-0"><Lines text={b.lines.join("\n")} images={images} /></p>;
    }
    case "ul":
    case "ol":
    case "task":
      return <ListBlock b={b} level={0} images={images} />;
    case "quote":
      return (
        <blockquote className="m-0 flex flex-col gap-[6px] border-l-[3px] border-line-3 pl-3 text-muted">
          {b.blocks.map((c, j) => <Block key={j} b={c} images={images} />)}
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
            {b.blocks.map((c, j) => <Block key={j} b={c} images={images} />)}
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
                    <Lines text={c} images={images} />
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
                      {c.trim() ? <Lines text={c} images={images} /> : "\u00a0"}
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

/** 마크다운 본문(스터디 소개·회차/과제 설명) — 파싱 결과를 React 요소로만 그린다. images 가 있으면 그림 토큰을 그 노드의 첨부로 푼다 */
export function MarkdownView({ src, className = "text-[14px] leading-[1.75]", images }: { src: string; className?: string; images?: ImageResolver }) {
  const blocks = parseMarkdown(src);
  return (
    <div className={`flex flex-col gap-[10px] text-ink-2 ${className}`}>
      {blocks.map((b, i) => <Block key={i} b={b} images={images} />)}
    </div>
  );
}
