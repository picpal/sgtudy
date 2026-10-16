"use client";

import { useEffect, useRef } from "react";

type Find = () => HTMLElement | null | undefined;

/**
 * 입력·폼을 닫은 뒤 포커스 되돌리기 — /tasks·my-study 빠른 추가와 개인 목표 편집 폼 공용.
 * 닫을 때 refocus(대상 찾기)를 부르고 open 을 false 로 바꾸면, 대상이 다시 그려진 뒤(effect) 포커스를 옮긴다.
 * rAF 는 창이 가려지면 멈추므로 쓰지 않는다. 포커스가 이미 다른 곳에 있으면(탭·클릭으로 옮김) 건드리지 않는다.
 */
export function useRefocusOnClose(open: boolean): (find: Find) => void {
  const target = useRef<Find | null>(null);
  useEffect(() => {
    if (open || !target.current) return;
    const find = target.current;
    target.current = null;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    find()?.focus({ preventScroll: true });
  }, [open]);
  return (find: Find) => {
    target.current = find;
  };
}
