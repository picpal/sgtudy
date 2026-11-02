/**
 * 보기 상세 기록 표식 — 방 화면이 목록 기록 위에 push 한 상세 기록이면 history.state 에 그 항목 id 를 남긴다.
 * 제출 뒤 router.refresh 가 화면 key 를 바꿔 다시 마운트하거나 새로고침해도 [← 연 곳] 이 replace(같은 목록 기록이 둘) 대신 back 으로 닫는다.
 * 표식이 없으면(주소로 바로 연 첫 진입) 아래가 목록이라는 보장이 없어 그대로 replace.
 *
 * Next 는 refresh 등 소프트 이동을 커밋할 때 history.state 를 자기 값만으로 갈아 끼운다(사용자 값이 빠진다).
 * - 그 커밋에서 다시 마운트되는 화면: 떠나는 화면이 넘긴 값(carried)을 같은 커밋 안에서만 받는다 — 마이크로태스크에서 비운다
 * - 다시 마운트되지 않은 화면: 렌더마다 keepMark 가 표식을 다시 적는다
 */
import { readItem, readMode } from "./editUrl";

const MARK = "__sgPushed";
let carried: { href: string; item: string } | null = null;

const viewItem = (): string | null => (readMode(window.location.search) === "view" ? readItem(window.location.search) : null);

/** pushState 에 실을 상태 — Next 가 자기 값을 더한다 */
export const pushedState = (item: string): Record<string, string> => ({ [MARK]: item });

/** 지금 기록이 이 문서에서 목록 위에 push 한 그 보기 상세면 항목 id, 아니면 null */
export function readMark(): string | null {
  const item = viewItem();
  if (!item) return null;
  if ((window.history.state as Record<string, unknown> | null)?.[MARK] === item) return item;
  return carried && carried.href === window.location.href && carried.item === item ? item : null;
}

/** 화면이 아는 push 항목(pushed)이 지금 보기 상세 기록이면 표식을 (다시) 적는다 */
export function keepMark(pushed: string | null) {
  if (!pushed || viewItem() !== pushed) return;
  const st = window.history.state as Record<string, unknown> | null;
  if (st?.[MARK] === pushed) return;
  window.history.replaceState({ ...st, [MARK]: pushed }, "");
}

/** 화면이 내려갈 때 — 같은 커밋에서 다시 마운트되는 화면에만 넘긴다 */
export function handOff(pushed: string | null) {
  carried = pushed && viewItem() === pushed ? { href: window.location.href, item: pushed } : null;
  queueMicrotask(() => {
    carried = null;
  });
}
