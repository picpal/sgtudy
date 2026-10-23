"use client";

import { createElement, Fragment, memo, useMemo, useState, type CSSProperties } from "react";
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
// 블록 그림 최대 높이(D6) — 크기 예약 계산에도 같은 값
const BLOCK_MAX_H = "min(560px, 70vh)";

/**
 * 첨부 그림 원본 크기 — 파일 id 별, 이 탭이 열려 있는 동안. 첫 로드에서 재 두고 다시 그릴 때(재서명·노드 재방문) 자리를 미리 잡는다.
 * 크기를 모르면(첫 로드) 640×400 비율 자리 — 160px 상자에서 실제 크기로 커지며 긴 설명이 통째로 밀리던 것을 줄인다(스크롤 끊김)
 */
const natural = new Map<string, { w: number; h: number }>();
/** 테스트용 */
export const imageSizeCache = natural;

/** 블록 그림 자리 — 원본 크기를 알면 그 비율·최종 폭 그대로, 모르면 640px·16:10 */
function blockBox(fileId: string): CSSProperties {
  const d = natural.get(fileId);
  if (!d) return { width: 640, aspectRatio: "16 / 10" };
  const r = d.w / d.h;
  return { width: `min(${d.w}px, calc(${BLOCK_MAX_H} * ${r.toFixed(4)}))`, aspectRatio: `${d.w} / ${d.h}` };
}

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
  // 블록 그림은 불러오기 전에도 최종 크기 자리를 잡는다 — SVG 는 원본 크기가 믿을 만하지 않아(300×150 기본값) 예약만 하지 않는다
  const sized = block && !r.svg && (natural.has(r.fileId) || !loaded);
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
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (!r.svg && w > 0 && h > 0) natural.set(r.fileId, { w, h });
        setLoadedUrl(r.url);
      }}
      onError={onError}
      style={sized ? blockBox(r.fileId) : undefined}
      className={`${block ? "block h-auto max-h-[min(560px,70vh)] max-w-full rounded-[10px]" : INLINE_IMG} object-contain ${r.svg ? "bg-white" : ""} ${loaded ? "" : `${block ? (sized ? "" : "min-h-40 min-w-40 ") : "min-w-[2.5em] "}opacity-0`}`}
    />
  );
  // 불러오는 동안 img 는 자리만 차지하고(opacity-0 — 깨진 아이콘·대체 글자가 안 보이게) 그 위에 스켈레톤을 깐다
  const skeleton = loaded ? null : <span data-img-skeleton aria-hidden="true" className={`absolute inset-0 bg-line-2 motion-safe:animate-pulse ${block ? "rounded-[10px]" : "rounded-[4px]"}`} />;
  if (!images.open) return <span className={block ? "relative block max-w-full" : "relative inline-block max-w-full align-middle leading-none"}>{img}{skeleton}</span>;
  const open = images.open;
  const id = r.fileId;
  return (
    <button type="button" onClick={() => open(id)} className={`${block ? "block rounded-[10px]" : "inline-block rounded-[4px] align-middle leading-none"} relative max-w-full cursor-zoom-in p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint`}>
      {img}
      {skeleton}
      <span className="sr-only">크게 보기</span>
      {/* 「눌러서 확대」 — 손가락으로 쓰는 화면만(마우스는 돋보기 커서). 블록 그림에만, 작게 */}
      {block && loaded && (
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 hidden items-center gap-1 rounded-full bg-black/55 px-2 py-[2px] text-[11px] font-medium leading-[18px] text-white pointer-coarse:inline-flex">
          <ZoomIcon />
          눌러서 확대
        </span>
      )}
    </button>
  );
}

/** 돋보기(+) — 「눌러서 확대」 힌트·첨부 썸네일 */
export function ZoomIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6" />
    </svg>
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
  // 그림 하나만 든 항목(하위 목록 없음)은 목록 밖 블록 그림으로 — 불릿·들여쓰기 없이. 목록은 그 자리에서 나뉘고 번호는 쓴 그대로 이어진다
  const List = b.type;
  const first = b.type === "ol" ? (b.start ?? 1) : 1;
  const parts: ({ fig: ImgToken; at: number } | { items: MdItem[]; at: number })[] = [];
  b.items.forEach((it, j) => {
    const fig = it.sub.length === 0 ? soleImg(it.text) : null;
    const last = parts[parts.length - 1];
    if (fig) parts.push({ fig, at: j });
    else if (last && "items" in last) last.items.push(it);
    else parts.push({ items: [it], at: j });
  });
  return (
    <>
      {parts.map((p) =>
        "fig" in p ? (
          <p key={p.at} className="m-0">
            <Img s={p.fig} images={images} block />
          </p>
        ) : (
          <List key={p.at} start={b.type === "ol" && first + p.at !== 1 ? first + p.at : undefined} className={`m-0 pl-5 ${b.type === "ul" ? UL_STYLE[Math.min(level, 3)] : "list-decimal"}`}>
            {p.items.map((it, j) => (
              <li key={j}>
                <ItemText text={it.text} images={images} />
                {sub(it)}
              </li>
            ))}
          </List>
        ),
      )}
    </>
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
// memo + 파싱 useMemo — 라이트박스를 열고 닫는 등 부모만 다시 그릴 때 13~18k자 설명을 다시 파싱·그리지 않게
export const MarkdownView = memo(function MarkdownView({ src, className = "text-[14px] leading-[1.75]", images }: { src: string; className?: string; images?: ImageResolver }) {
  const blocks = useMemo(() => parseMarkdown(src), [src]);
  return (
    <div className={`flex flex-col gap-[10px] text-ink-2 ${className}`}>
      {blocks.map((b, i) => <Block key={i} b={b} images={images} />)}
    </div>
  );
});
