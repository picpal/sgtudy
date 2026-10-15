"use client";

import { useCallback, useRef, useState } from "react";

type Half = "top" | "bottom";
type Over = { id: string; half: Half } | null;

/** 행 핸들 포인터 드래그 (마우스·펜 전용, ≥640 에서만 핸들이 보인다). 키보드·터치 대체: 회차 화면 위/아래 · 과제 화면 회차 선택 */
export function useRowDrag(onDrop: (dragId: string, overId: string, half: Half) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOverState] = useState<Over>(null);
  // pointerup 핸들러가 마지막 놓을 자리를 읽는다 — 렌더 중 대입 대신 바꿀 때 함께 적는다
  const overRef = useRef<Over>(null);
  const setOver = (o: Over) => {
    overRef.current = o;
    setOverState(o);
  };
  const end = () => {
    setDragging(null);
    setOver(null);
  };
  const handleProps = useCallback(
    (id: string): React.HTMLAttributes<HTMLElement> => ({
      onPointerDown: (e) => {
        if (e.pointerType === "touch" || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(id);
      },
      onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node]");
        if (!row?.dataset.node) return setOver(null);
        const r = row.getBoundingClientRect();
        const half: Half = e.clientY < r.top + r.height / 2 ? "top" : "bottom";
        const o = overRef.current;
        if (o?.id !== row.dataset.node || o.half !== half) setOver({ id: row.dataset.node, half });
      },
      onPointerUp: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const o = overRef.current;
        end();
        if (o && o.id !== id) onDrop(id, o.id, o.half);
      },
      onPointerCancel: end,
    }),
    // setOver·end 는 setState·ref 만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDrop],
  );
  return { handleProps, over, dragging };
}
