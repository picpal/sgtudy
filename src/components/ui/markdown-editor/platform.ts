// 단축키 표기용 수정 키 — 툴바 tooltip 과 표 핸들 tooltip 이 같이 쓴다.
// navigator.platform 은 deprecated 라 userAgentData 가 있으면 그쪽을 먼저 본다.
const platform =
  typeof navigator === "undefined"
    ? ""
    : (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";

export const mod = /Mac|iP(hone|ad|od)/i.test(platform) ? "⌘" : "Ctrl+";
export const shift = mod === "⌘" ? "⇧" : "Shift+";
