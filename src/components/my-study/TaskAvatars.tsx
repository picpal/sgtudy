"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import { HIT_Y, RingedStatus } from "./bits";

export type TaskAvatar = { key: string; name: string; tone?: Tone; id?: string; status: TaskStatus; /** 툴팁 — "이름 · 상태" */ title: string };

/** 이 인원부터 접는다 — 3명 + "+N" */
export const COLLAPSE_AT = 5;
const SHOWN = 3;
/** 펼친 뒤 저절로 접히기까지 */
export const AUTO_COLLAPSE_MS = 3000;
/** 겹침 */
const OVERLAP = 6;

type Props = {
  people: TaskAvatar[];
  /** 아바타 크기 / 상태 아이콘 크기 — 4명 이하 */
  size: number;
  iconSize: number;
  /** 5명 이상일 때 한 단계 작은 크기 */
  compactSize: number;
  compactIconSize: number;
  /** 링 색 (배경과 같은 색) */
  ring: string;
};

/**
 * 과제 카드 아바타 줄 — 4명 이하는 다 보이고, 5명 이상은 3명 + "+N" 을 누르면 펼쳐진다.
 * 펼친 뒤 3초면 저절로 접히되, 포인터가 올라가 있거나 키보드 포커스가 있는 동안은 멈춘다.
 * 카드 자체가 누르는 영역이라 토글 클릭은 카드로 올리지 않는다.
 */
export function TaskAvatars({ people, size, iconSize, compactSize, compactIconSize, ring }: Props) {
  const collapsible = people.length >= COLLAPSE_AT;
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [kbdFocus, setKbdFocus] = useState(false);
  // 마우스로 누른 포커스는 멈춤으로 치지 않는다 — 누른 뒤 버튼에 포커스가 남아 영영 안 접히는 것을 막는다
  const pointerDown = useRef(false);

  useEffect(() => {
    if (!open || hover || kbdFocus) return;
    const t = setTimeout(() => setOpen(false), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [open, hover, kbdFocus]);

  const s = collapsible ? compactSize : size;
  const icon = collapsible ? compactIconSize : iconSize;
  const over = people.length - SHOWN;
  const chip = s + 2;

  const faces = people.map((p, i) => {
    const hidden = collapsible && !open && i >= SHOWN;
    // 펼칠 때는 앞에서부터, 접을 때는 뒤에서부터 하나씩
    const step = collapsible && i >= SHOWN ? (open ? i - SHOWN : people.length - 1 - i) : 0;
    const style: CSSProperties = { maxWidth: hidden ? 0 : s + 4, marginLeft: hidden ? 0 : -OVERLAP, transitionDelay: `${step * 35}ms` };
    return (
      <span
        key={p.key}
        data-avatar
        data-hidden={hidden || undefined}
        className={`inline-flex shrink-0 transition-[max-width,margin,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${hidden ? "invisible opacity-0" : "opacity-100"}`}
        style={style}
      >
        <span title={p.title} className="relative inline-flex shrink-0 rounded-full" style={{ border: `2px solid ${ring}` }}>
          <Avatar name={p.name} size={s} tone={p.tone} id={p.id} />
          <span className="absolute -right-[3px] -bottom-[3px] flex">
            <RingedStatus status={p.status} size={icon} />
          </span>
        </span>
      </span>
    );
  });

  // 첫 아바타도 -6 을 받고 그만큼 안쪽 여백을 둔다 — 좁은 폭에서 줄이 바뀌어도 새 줄 첫 아바타가 밖으로 삐지지 않는다
  const row = "flex min-w-0 max-w-full flex-wrap items-center gap-y-1 pl-[6px]";
  if (!collapsible) return <span className={row}>{faces}</span>;

  const onPointerEnter = (e: PointerEvent) => e.pointerType !== "touch" && setHover(true);
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  };
  return (
    <button
      type="button"
      data-avatar-toggle
      aria-expanded={open}
      aria-label={open ? "접기" : `참가자 ${people.length}명 모두 보기`}
      onClick={onClick}
      onPointerDown={() => (pointerDown.current = true)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setHover(false)}
      onFocus={() => {
        setKbdFocus(!pointerDown.current);
        pointerDown.current = false;
      }}
      onBlur={() => setKbdFocus(false)}
      className={`${HIT_Y} ${row} cursor-pointer rounded-full bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint`}
    >
      {faces}
      <span
        aria-hidden="true"
        data-avatar-more
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-slate-soft font-bold text-ink-3 transition-[max-width,margin,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? "opacity-0" : "opacity-100"}`}
        style={{ width: chip, height: chip, maxWidth: open ? 0 : chip, marginLeft: open ? 0 : -OVERLAP, borderWidth: open ? 0 : undefined, fontSize: chip <= 28 ? 10 : 11 }}
      >
        +{over}
      </span>
    </button>
  );
}
