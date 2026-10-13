import type { TabId } from "./StudyHeaderInfo";
import { EMPTY_OVERRIDES, type CalMode, type Overrides } from "./model";

export type CurMode = "view" | "edit";
export type BoardMode = "mine" | "team";
export type Zoom = "day" | "week";

/** 화면 안 모든 상태 — 방(URL) 이 바뀌면 통째로 리셋된다 */
export type ScreenState = {
  tab: TabId;
  /** {id: true} = 접힘. 커리큘럼·간트 공유 */
  closed: Record<string, boolean>;
  openLeaf: string | null;
  curMode: CurMode;
  editSel: string | null;
  confirm: boolean;
  saved: string;
  ov: Overrides;
  bMode: BoardMode;
  /** 'all' 또는 루트 id */
  bRound: string;
  calMode: CalMode;
  calAnchor: string | null;
  /** "all" | "me" | 멤버 userId */
  calWho: string;
  calPick: string | null;
  zoom: Zoom;
};

export const INITIAL_STATE: ScreenState = {
  tab: "overview",
  closed: {},
  openLeaf: null,
  curMode: "view",
  editSel: null,
  confirm: false,
  saved: "",
  ov: EMPTY_OVERRIDES,
  bMode: "mine",
  bRound: "all",
  calMode: "month",
  calAnchor: null,
  calWho: "all",
  calPick: null,
  zoom: "day",
};

export type Patch = Partial<ScreenState> | ((prev: ScreenState) => Partial<ScreenState>);
export type Update = (patch: Patch) => void;

/** 보드 카드·캘린더 팝오버·간트 리프 → 해당 리프 상세가 펼쳐진 커리큘럼 */
export const goLeafPatch = (id: string): Partial<ScreenState> => ({ tab: "curriculum", curMode: "view", openLeaf: id, closed: {}, calPick: null });

/** 오버라이드 한 키만 갱신하는 헬퍼 */
export const patchOv = <K extends keyof Overrides>(prev: ScreenState, key: K, value: Overrides[K]): Partial<ScreenState> => ({ ov: { ...prev.ov, [key]: value } });
