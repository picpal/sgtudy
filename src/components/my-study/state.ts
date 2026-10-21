import type { TaskOrigin } from "@/lib/taskOrigin";
import { TABS, type TabId } from "./StudyHeaderInfo";
import { EMPTY_OVERRIDES, isDirty, type CalMode, type Overrides } from "./model";

export type CurMode = "view" | "edit";
export type BoardMode = "mine" | "team";
export type Zoom = "day" | "week";
/** 보기 상세를 연 곳 — 방 탭(보드 카드·개요 카드 등) 또는 다른 화면(내 과제·내 일정의 과제 링크) */
export type ViewFrom = TabId | TaskOrigin;
/** 저장하지 않은 수정이 있는 채로 다른 노드·모드·추가·탭(Q2-1)·다른 화면 주소(헤더 메뉴 등)로 가려 할 때 보류한 목적지 (Q2-05) */
export type Leave = { sel: string | null } | { mode: CurMode } | { add: string | null } | { tab: TabId } | { href: string } | { view: string | null };

/** 화면 안 모든 상태 — 방(URL) 이 바뀌면 통째로 리셋된다 */
export type ScreenState = {
  tab: TabId;
  /** {id: true} = 접힘. 커리큘럼·간트 공유 */
  closed: Record<string, boolean>;
  curMode: CurMode;
  /** 편집 화면에 열린 항목 — 있으면 목록 대신 전용 편집 화면 (URL ?item=) */
  editSel: string | null;
  /** 편집 화면에 들어오기 전 화면 — { view: id } = 그 항목의 보기 상세, "list" = 편집 목록, null = 모름(새로고침 진입).
   *  편집 화면 [저장] 이 저장한 뒤 이곳으로 돌아간다 (editReturn). 편집 화면 안에서 다른 항목으로 옮겨도 그대로 둔다
   *  (상세 X → 편집 X → 편집 안에서 Y → [저장] = X 의 상세) */
  editFrom: { view: string } | "list" | null;
  /** 보기 모드 상세 화면에 열린 항목 — 있으면 목록 대신 읽기 전용 상세 (URL ?item=, mode 없음) */
  viewSel: string | null;
  /** 보기 상세가 열리며 한 번 옮길 포커스 — 보드·캘린더·간트·알림 진입은 제출 영역 (스펙 §2.6) */
  viewFocus: "submission" | null;
  /** 보기 상세(·그 안에서 옮겨 간 항목·편집)를 연 곳 — 상세의 [← 보드] 가 그리로 돌아간다. null = 모름(새로고침·알림 링크) → 진행목표 목록.
   *  브라우저 뒤로 가기가 돌아갈 기록(상세 기록 바로 아래)과 같게 맞춘다. 열린 항목이 없어지면 지운다 (MyStudyScreen) */
  viewFrom: ViewFrom | null;
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
  /** 첨부를 올리는 중인 편집 항목 id — ov 수정이 없어도 떠나기 전에 묻는다 (EditView 가 맞춘다) */
  uploading: string | null;
  /** 시험 문항을 고치고 [문제 저장] 하지 않은 편집 항목 id — ov 밖의 수정이라 uploading 과 같이 떠나기 전에 묻는다 (EditView 가 맞춘다, 0037) */
  examDirty: string | null;
  /** 개인 목표 편집 폼에 저장하지 않은 수정·올리는 중인 파일이 있는 목표 id — 보기 모드라 ov 에 없다. 탭·뒤로 가기 전에 묻는다 (DetailView 가 맞춘다) */
  personalUnsaved: string | null;
  /** 공지 탭에 펼친 공지 id (아코디언, D14) */
  noticeOpen: string | null;
  /** 공지 탭 인라인 작성 폼 — "new" = 새 공지, 그 밖은 고치는 공지 id (D18) */
  noticeEdit: { id: string } | null;
  /** 공지 작성 폼에 저장하지 않은 글이 있다 — 탭·헤더 메뉴로 떠나기 전에 묻는다 (NoticeTab 이 맞춘다) */
  noticeUnsaved: boolean;
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
  editFrom: null,
  viewSel: null,
  viewFocus: null,
  viewFrom: null,
  quickAdd: null,
  mineOnly: false,
  othersPersonal: false,
  justAdded: null,
  fresh: null,
  confirm: false,
  leave: null,
  uploading: null,
  examDirty: null,
  personalUnsaved: null,
  noticeOpen: null,
  noticeEdit: null,
  noticeUnsaved: false,
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

/** 보드 카드·캘린더 팝오버·간트 리프·개요 카드·알림 → 그 과제의 보기 상세. from = 누른 곳(지금 탭), 알림 진입은 null */
export const goLeafPatch = (id: string, from: ViewFrom | null = null): Partial<ScreenState> => ({ tab: "curriculum", curMode: "view", viewSel: id, viewFocus: "submission", viewFrom: from, editSel: null, closed: {}, calPick: null });

const FROM_LABEL: Record<TaskOrigin, string> = { tasks: "내 과제", schedule: "내 일정" };
/** 상세 [← …] 단추 글 — 연 곳의 이름. 모르면 진행목표 */
export const viewBackLabel = (from: ViewFrom | null): string =>
  from === "tasks" || from === "schedule" ? FROM_LABEL[from] : (TABS.find(([id]) => id === (from ?? "curriculum"))?.[1] ?? "진행목표");

/** 상세 [← …] (다른 화면 출발지는 MyStudyScreen 이 history.back 으로) — 상세를 닫고 연 탭으로. 진행목표·모름은 진행목표 목록 */
export const viewBackPatch = (S: Pick<ScreenState, "viewFrom">): Partial<ScreenState> => {
  const tab = S.viewFrom && S.viewFrom !== "tasks" && S.viewFrom !== "schedule" ? S.viewFrom : "curriculum";
  return { viewSel: null, viewFocus: null, viewFrom: null, ...(tab !== "curriculum" ? { tab, calPick: null } : {}) };
};

/** 보기↔편집 전환 — 열려 있던 항목은 상대 모드의 같은 항목으로 (임시 노드는 넘기지 않는다) */
export function modeSwitchPatch(S: ScreenState, mode: CurMode): Partial<ScreenState> {
  const open = mode === "edit" ? S.viewSel : S.editSel;
  const carry = open && /^\d+$/.test(open) ? open : null;
  return { curMode: mode, editSel: mode === "edit" ? carry : null, editFrom: mode === "edit" && carry ? { view: carry } : null, viewSel: mode === "view" ? carry : null, viewFocus: null, quickAdd: null, confirm: false, leave: null, saved: "" };
}

/** 편집 화면 [저장] 이 저장한 뒤 돌아갈 곳 — 들어오기 전 화면(목록 · 편집을 연 항목의 상세). 모르면 지금 항목의 보기 상세 */
export const editReturn = (S: Pick<ScreenState, "editFrom">): Leave => (S.editFrom === "list" ? { sel: null } : S.editFrom ? { view: S.editFrom.view } : { mode: "view" });

/** 오버라이드 한 키만 갱신하는 헬퍼 */
export const patchOv = <K extends keyof Overrides>(prev: ScreenState, key: K, value: Overrides[K]): Partial<ScreenState> => ({ ov: { ...prev.ov, [key]: value } });

/** 진행목표·간트 필터 칩 — 두 칩은 서로 끈다("내 것만" 은 남의 목표를 숨기므로 둘 다 켜지면 "팀원 목표" 가 아무 일도 하지 않는다) */
/** 개요 "팀원 개인 목표 보기 →" — 열려 있던 상세·편집 항목을 닫고 진행목표 보기 목록 + 팀원 목표 칩 (두 칩은 서로 끈다) */
export const SHOW_OTHERS_PATCH: Partial<ScreenState> = { tab: "curriculum", curMode: "view", othersPersonal: true, mineOnly: false, viewSel: null, editSel: null, viewFocus: null, calPick: null };
export const toggleMinePatch = (p: ScreenState): Partial<ScreenState> => ({ mineOnly: !p.mineOnly, othersPersonal: p.mineOnly ? p.othersPersonal : false });
export const toggleOthersPatch = (p: ScreenState): Partial<ScreenState> => ({ othersPersonal: !p.othersPersonal, mineOnly: p.othersPersonal ? p.mineOnly : false });

/** 그 편집 항목에 저장하지 않은 것이 있나 — ov 수정 · 올리는 중인 첨부 · 저장하지 않은 시험 문항 */
export const editUnsaved = (S: Pick<ScreenState, "ov" | "uploading" | "examDirty">, id: string | null): boolean =>
  isDirty(S.ov, id) || (!!id && (S.uploading === id || S.examDirty === id));

/** 진행목표 편집 화면(·공지 작성 폼)에 저장하지 않은 수정이 열려 있다 — 탭·헤더 메뉴·뒤로 가기로 떠나기 전에 묻는다 (Q2-1) */
export const blocksLeave = (S: ScreenState, canEdit: boolean): boolean =>
  (S.tab === "notice" && S.noticeUnsaved) ||
  (S.tab === "curriculum" && (S.personalUnsaved !== null || (canEdit && S.curMode === "edit" && editUnsaved(S, S.editSel))));

/** 방 탭 누름 — 미저장 수정이 있으면 탭은 그대로 두고 목적지를 보류(편집 화면의 "저장하지 않은 수정이 있어요" 확인).
 *  진행목표로 돌아와 남아 있던 상세가 다시 열리면 그 기록은 지금 탭 위에 쌓인다 → 연 곳도 지금 탭 */
/*  공지 탭을 떠나면 작성 폼은 닫는다(글은 폼에만 있다 — 깨끗할 때만 여기 온다) */
export const tabPatch = (S: ScreenState, tab: TabId, canEdit: boolean): Partial<ScreenState> =>
  tab !== S.tab && blocksLeave(S, canEdit)
    ? { leave: { tab }, confirm: false }
    : { tab, calPick: null, ...(tab === "curriculum" && tab !== S.tab ? { viewFrom: S.tab } : {}), ...(S.tab === "notice" && tab !== "notice" ? { noticeEdit: null, noticeUnsaved: false } : {}) };
