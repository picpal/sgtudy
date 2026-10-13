"use client";

import { useEffect, useState } from "react";

/** value 가 ms 동안 안 바뀌면 그때 값을 돌려준다 (검색 250ms, 닉네임 300ms). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
