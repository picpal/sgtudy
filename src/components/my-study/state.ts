import type { TabId } from "./StudyHeaderInfo";
import { EMPTY_OVERRIDES, isDirty, type CalMode, type Overrides } from "./model";

export type CurMode = "view" | "edit";
export type BoardMode = "mine" | "team";
export type Zoom = "day" | "week";
/** 저장하지 않은 수정이 있는 채로 다른 노드·모드·추가·탭(Q2-1)·다른 화면 주소(헤더 메뉴 등)로 가려 할 때 보류한 목적지 (Q2-05) */
export type Leave = { sel: string | null } | { mode: CurMode } | { add: string | null } | { tab: TabId } | { href: string };

/** 화면 안 모든 상태 — 방(URL) 이 바뀌면 통째로 리셋된다 */
export type ScreenState = {
  tab: TabId;
  /** {id: true} = 접힘. 커리큘럼·간트 공유 */
  closed: Record<string, boolean>;
  curMode: CurMode;
  /** 편집 화면에 열린 항목 — 있으면 목록 대신 전용 편집 화면 (URL ?item=) */
  editSel: string | null;
  /** 보기 모드 상세 화면에 열린 항목 — 있으면 목록 대신 읽기 전용 상세 (URL ?item=, mode 없음) */
  viewSel: string | null;
  /** 보기 상세가 열리며 한 번 옮길 포커스 — 보드·캘린더·간트·알림 진입은 제출 영역 (스펙 §2.6) */
  viewFocus: "submission" | null;
  /** 빠른 추가 입력이 열린 회차 id — 편집 목록 팀 과제는 그대로 id, 보기 목록 "내 목표 추가" 는 `p:{id}` */
  quickAdd: string | null;
  /** 진행목표(·간트) "내 것만" — 내게 배정된 팀 과제 + 내 개인 목표만. URL 에 싣지 않는다 */
  mineOnly: boolean;
  /** 진행목표(·간트) "팀원 목표" — 남의 개인 목표도 보기 */
  othersPersonal: boolean;
  /** 방금 추가한 항목 — 편집 화면이 열리면 제목을 선택해 바로 고쳐 쓰게 한다 */
  justAdded: string | null;
  /** "회차 추가" 로 방금 만들고 아직 한 번도 저장하지 않은 항목 — 저장 없이 편집 화면을 떠나면 빈 채로 남지 않게 지운다 (Q2-8) */
  fresh: string | null;
  confirm: boolean;
  leave: Leave | null;
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
  curMode: "view",
  editSel: null,
  viewSel: null,
  viewFocus: null,
  quickAdd: null,
  mineOnly: false,
  othersPersonal: false,
  justAdded: null,
  fresh: null,
  confirm: false,
  leave: null,
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

/** 보드 카드·캘린더 팝오버·간트 리프·알림 → 그 과제의 보기 상세 */
export const goLeafPatch = (id: string): Partial<ScreenState> => ({ tab: "curriculum", curMode: "view", viewSel: id, viewFocus: "submission", editSel: null, closed: {}, calPick: null });

/** 보기↔편집 전환 — 열려 있던 항목은 상대 모드의 같은 항목으로 (임시 노드는 넘기지 않는다) */
export function modeSwitchPatch(S: ScreenState, mode: CurMode): Partial<ScreenState> {
  const open = mode === "edit" ? S.viewSel : S.editSel;
  const carry = open && /^\d+$/.test(open) ? open : null;
  return { curMode: mode, editSel: mode === "edit" ? carry : null, viewSel: mode === "view" ? carry : null, viewFocus: null, quickAdd: null, confirm: false, leave: null, saved: "" };
}

/** 오버라이드 한 키만 갱신하는 헬퍼 */
export const patchOv = <K extends keyof Overrides>(prev: ScreenState, key: K, value: Overrides[K]): Partial<ScreenState> => ({ ov: { ...prev.ov, [key]: value } });

/** 진행목표·간트 필터 칩 — 두 칩은 서로 끈다("내 것만" 은 남의 목표를 숨기므로 둘 다 켜지면 "팀원 목표" 가 아무 일도 하지 않는다) */
/** 개요 "팀원 개인 목표 보기 →" — 열려 있던 상세·편집 항목을 닫고 진행목표 보기 목록 + 팀원 목표 칩 (두 칩은 서로 끈다) */
export const SHOW_OTHERS_PATCH: Partial<ScreenState> = { tab: "curriculum", curMode: "view", othersPersonal: true, mineOnly: false, viewSel: null, editSel: null, viewFocus: null, calPick: null };
export const toggleMinePatch = (p: ScreenState): Partial<ScreenState> => ({ mineOnly: !p.mineOnly, othersPersonal: p.mineOnly ? p.othersPersonal : false });
export const toggleOthersPatch = (p: ScreenState): Partial<ScreenState> => ({ othersPersonal: !p.othersPersonal, mineOnly: p.othersPersonal ? p.mineOnly : false });

/** 진행목표 편집 화면에 저장하지 않은 수정이 열려 있다 — 탭·헤더 메뉴·뒤로 가기로 떠나기 전에 묻는다 (Q2-1) */
export const blocksLeave = (S: ScreenState, canEdit: boolean): boolean => canEdit && S.tab === "curriculum" && S.curMode === "edit" && isDirty(S.ov, S.editSel);

/** 방 탭 누름 — 미저장 수정이 있으면 탭은 그대로 두고 목적지를 보류(편집 화면의 "저장하지 않은 수정이 있어요" 확인) */
export const tabPatch = (S: ScreenState, tab: TabId, canEdit: boolean): Partial<ScreenState> =>
  tab !== S.tab && blocksLeave(S, canEdit) ? { leave: { tab }, confirm: false } : { tab, calPick: null };
