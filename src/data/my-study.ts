/**
 * RoomDetail.dc.html "내 스터디 — 참가자 시점" 목업 데이터.
 * 문구·날짜·코드는 원본 DATA / PLANS 를 그대로 옮겼다.
 */
import type { Tone } from "@/lib/palette";
import type { RoomStatus, TaskStatus } from "@/lib/types";
import { addDays } from "@/lib/date";

export type RoomId = string; // slug (D1)
export const ROOM_IDS: RoomId[] = ["aws", "spring", "sqld", "algo"];
export const isRoomId = (s: string): s is RoomId => (ROOM_IDS as string[]).includes(s);

export type TaskType = "공통" | "지정";
export type RoomAction = "joined" | "pending" | "closed";

export type MemberInfo = {
  name: string;
  done: number;
  total: number;
  leader?: boolean;
  me?: boolean;
  /** 이탈 */
  left?: boolean;
  /** 승인 대기 */
  pending?: boolean;
  /** 막대·점수 없이 "–" */
  noBar?: boolean;
  /** 그룹장이 커리큘럼 편집을 맡긴 팀원 (그룹장 자신은 표시 안 함) */
  editor?: boolean;
  userId?: string;
  tone?: Tone;
};

export type CurTask = {
  title: string;
  type: TaskType;
  /** "10.08 – 10.14" */
  dates: string;
  people: [string, TaskStatus][];
  /** 이름 → DTO tone */
  tones?: Record<string, Tone>;
  /** 이름 → userId (아바타 변형) */
  ids?: Record<string, string>;
};

export type RoundRow = {
  label: string;
  title: string;
  dates: string;
  state: string;
  sub: number;
  total: number;
  current?: boolean;
  /** 요약 대체 문구 ("과제 2개") */
  alt?: string;
  /** tree.roots 매칭용 */
  roundId?: string;
};

export type RoomTag = { label: string; tone: Tone; auto: boolean };

export type NextDue = { title: string; path: string; due: string; dday: string; nodeId?: string };

export type Room = {
  id: RoomId;
  title: string;
  intro: string;
  status: RoomStatus;
  period: string;
  dday: string;
  ddayLong: string;
  joinMode: string;
  visibility: string;
  leader: string;
  /** 그룹장 아바타 색 — DTO leader.tone */
  leaderTone?: Tone;
  /** 그룹장 userId — 아바타 변형(avatarColors) */
  leaderId?: string;
  tags: RoomTag[];
  capCur: number;
  capMax: number;
  minText: string;
  minOk: boolean;
  members: MemberInfo[];
  cur: { pill: string; title: string; meta: string; tasks: CurTask[] };
  about: string;
  rules: string[];
  rounds: RoundRow[];
  moreRounds: string;
  action: RoomAction;
  next: NextDue | null;
};

export const ROOMS: Record<RoomId, Room> = {
  aws: {
    id: "aws",
    title: "AWS SAA 자격증 3개월 완주",
    intro: "IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.",
    status: "active",
    period: "2026.10.01(목) – 12.31(목)",
    dday: "D-80",
    ddayLong: "종료까지 D-80",
    joinMode: "승인제",
    visibility: "공개",
    leader: "민수",
    tags: [
      { label: "AWS", tone: "mint", auto: true },
      { label: "클라우드", tone: "blue", auto: true },
      { label: "자격증", tone: "peach", auto: false },
    ],
    capCur: 4,
    capMax: 6,
    minText: "최소 3명 · 충족",
    minOk: true,
    members: [
      { name: "민수", done: 2, total: 3, leader: true },
      { name: "지은", done: 2, total: 4 },
      { name: "철수", done: 2, total: 4, me: true },
      { name: "하나", done: 0, total: 4 },
      { name: "도윤", done: 0, total: 0, left: true },
    ],
    cur: {
      pill: "2주차 · 진행중",
      title: "EC2·S3",
      meta: "10.08(목) – 10.14(수) · 마감 D-2",
      tasks: [
        { title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14", people: [["지은", "done"], ["철수", "open"]] },
        { title: "S3 스토리지 클래스 발표자료", type: "지정", dates: "10.10 – 10.14", people: [["하나", "open"]] },
      ],
    },
    about:
      "AWS Solutions Architect – Associate(SAA-C03) 합격을 목표로 3개월간 13회차를 진행합니다. 매주 목요일에 새 회차가 열리고, 회차마다 모두가 하는 공통 과제와 담당자가 맡는 지정 과제가 있어요. 서로의 제출물을 읽으며 복습하는 것이 이 스터디의 핵심입니다.",
    rules: [
      "마감은 회차 마지막 날 23:59(KST)예요. 늦게라도 제출하면 지각으로 기록돼요.",
      "지정 과제 담당자는 다음 회차 첫날까지 발표 자료를 공유해 주세요.",
      "2회 연속 미제출 시 그룹장과 상의 후 이탈 처리될 수 있어요.",
    ],
    rounds: [
      { label: "1주차", title: "IAM·VPC", dates: "10.01 – 10.07", state: "기간 종료", sub: 5, total: 8 },
      { label: "2주차", title: "EC2·S3", dates: "10.08 – 10.14", state: "진행중", sub: 1, total: 3, current: true },
      { label: "3주차", title: "고가용성 아키텍처", dates: "10.15 – 10.21", state: "예정", sub: 0, total: 4 },
    ],
    moreRounds: "이후 10개 회차가 더 있어요 · 진행목표 탭에서 전체 보기",
    action: "joined",
    next: { title: "EC2 인스턴스 유형 정리", path: "2주차 › EC2·S3 · 지정 과제", due: "10.14(수) 23:59 마감", dday: "D-2" },
  },
  spring: {
    id: "spring",
    title: "Spring 김영한 로드맵 완강",
    intro: "핵심 원리부터 JPA 활용까지 로드맵 순서대로, 섹션별 정리 노트를 제출합니다.",
    status: "active",
    period: "2026.10.05(월) – 2027.01.31(일)",
    dday: "D-111",
    ddayLong: "종료까지 D-111",
    joinMode: "승인제",
    visibility: "비공개 · 초대 링크로만 참가",
    leader: "지훈",
    tags: [
      { label: "Spring", tone: "lav", auto: true },
      { label: "백엔드", tone: "blue", auto: true },
      { label: "Java", tone: "amber", auto: false },
    ],
    capCur: 5,
    capMax: 5,
    minText: "최소 3명 · 충족 · 정원 마감",
    minOk: true,
    members: [
      { name: "지훈", done: 3, total: 6, leader: true },
      { name: "철수", done: 2, total: 6, me: true },
      { name: "소율", done: 3, total: 6 },
      { name: "민재", done: 3, total: 6 },
      { name: "아린", done: 1, total: 6 },
    ],
    cur: {
      pill: "2주차 · 진행중",
      title: "스프링 핵심 원리 기본편 (후반)",
      meta: "10.12(월) – 10.18(일) · 마감 D-6",
      tasks: [
        {
          title: "섹션 6~7 정리 노트",
          type: "공통",
          dates: "10.12 – 10.18",
          people: [["지훈", "done"], ["소율", "done"], ["민재", "done"], ["철수", "open"], ["아린", "open"]],
        },
        {
          title: "싱글톤 컨테이너 실습 코드",
          type: "공통",
          dates: "10.15 – 10.18",
          people: [["지훈", "planned"], ["철수", "planned"], ["소율", "planned"], ["민재", "planned"], ["아린", "planned"]],
        },
      ],
    },
    about:
      "김영한님의 스프링 로드맵 강의를 순서대로 완강하는 17주 스터디입니다. 매주 들은 섹션을 정리 노트로 제출하고, 실습 코드는 깃허브 링크로 공유해요.",
    rules: [
      "정리 노트는 마크다운으로, 핵심 개념 3개 이상을 포함해 주세요.",
      "실습 코드는 개인 저장소 링크로 제출합니다.",
      "질문은 제출물 댓글로 남기면 다음 회차에 함께 이야기해요.",
    ],
    rounds: [
      { label: "1주차", title: "핵심 원리 기본편 (전반)", dates: "10.05 – 10.11", state: "기간 종료", sub: 9, total: 10 },
      { label: "2주차", title: "핵심 원리 기본편 (후반)", dates: "10.12 – 10.18", state: "진행중", sub: 3, total: 10, current: true },
      { label: "3주차", title: "스프링 MVC 1편", dates: "10.19 – 10.25", state: "예정", sub: 0, total: 10 },
    ],
    moreRounds: "이후 14개 회차가 더 있어요 · 진행목표 탭에서 전체 보기",
    action: "joined",
    next: { title: "섹션 6~7 정리 노트", path: "2주차 › 핵심 원리 기본편 (후반) · 공통 과제", due: "10.18(일) 23:59 마감", dday: "D-6" },
  },
  sqld: {
    id: "sqld",
    title: "SQLD 4주 벼락치기",
    intro: "데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.",
    status: "recruit",
    period: "2026.10.26(월) – 11.22(일)",
    dday: "D-14",
    ddayLong: "시작까지 D-14",
    joinMode: "승인제",
    visibility: "공개",
    leader: "가은",
    tags: [
      { label: "SQL", tone: "amber", auto: true },
      { label: "데이터", tone: "blue", auto: true },
      { label: "자격증", tone: "peach", auto: false },
    ],
    capCur: 1,
    capMax: 5,
    minText: "최소 3명 · 2명 더 필요해요",
    minOk: false,
    members: [
      { name: "가은", done: 0, total: 0, leader: true, noBar: true },
      { name: "철수", done: 0, total: 0, me: true, pending: true },
    ],
    cur: { pill: "시작 전", title: "10월 26일(월) 첫 회차가 열려요", meta: "4회차 · 과제 9개 준비됨", tasks: [] },
    about:
      "11월 SQLD 시험 직전 4주 동안 핵심만 빠르게 정리합니다. 회차마다 요약 노트와 기출 풀이를 제출하고, 마지막 주에는 모의고사 2회를 함께 풀어요.",
    rules: ["기출 풀이는 틀린 문제와 이유를 함께 적어 주세요.", "모의고사는 정해진 시간(90분)을 지켜 풀어요."],
    rounds: [
      { label: "1주차", title: "데이터 모델링의 이해", dates: "10.26 – 11.01", state: "예정", sub: 0, total: 0, alt: "과제 2개" },
      { label: "2주차", title: "SQL 기본", dates: "11.02 – 11.08", state: "예정", sub: 0, total: 0, alt: "과제 3개" },
      { label: "3주차", title: "SQL 활용", dates: "11.09 – 11.15", state: "예정", sub: 0, total: 0, alt: "과제 2개" },
      { label: "4주차", title: "모의고사", dates: "11.16 – 11.22", state: "예정", sub: 0, total: 0, alt: "과제 2개" },
    ],
    moreRounds: "",
    action: "pending",
    next: null,
  },
  algo: {
    id: "algo",
    title: "알고리즘 매일 1문제",
    intro: "백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.",
    status: "ended",
    period: "2026.07.01(수) – 09.30(수)",
    dday: "종료",
    ddayLong: "09.30 종료",
    joinMode: "바로 참가",
    visibility: "공개",
    leader: "현우",
    tags: [
      { label: "알고리즘", tone: "slate", auto: true },
      { label: "코딩테스트", tone: "mint", auto: true },
    ],
    capCur: 6,
    capMax: 6,
    minText: "최소 2명 · 충족",
    minOk: true,
    members: [
      { name: "현우", done: 13, total: 13, leader: true },
      { name: "철수", done: 11, total: 13, me: true },
      { name: "보람", done: 12, total: 13 },
      { name: "지성", done: 10, total: 13 },
      { name: "다은", done: 12, total: 13 },
      { name: "유진", done: 10, total: 13 },
    ],
    cur: { pill: "종료", title: "13주 완주 · 전체 달성률 87%", meta: "07.01 – 09.30 · 제출 68 / 78건", tasks: [] },
    about:
      "매일 한 문제를 풀고 짧은 회고를 남기는 습관 스터디였어요. 주 단위로 7문제 중 5문제 이상 풀면 그 주 과제를 달성한 것으로 봤습니다.",
    rules: ["풀이 언어는 자유, 회고는 3줄 이내로 남겨요.", "주 5문제 이상 풀면 주간 과제 달성으로 기록해요."],
    rounds: [
      { label: "1–4주차", title: "구현 · 그리디", dates: "07.01 – 07.28", state: "완료", sub: 23, total: 24 },
      { label: "5–8주차", title: "BFS · DFS · 백트래킹", dates: "07.29 – 08.25", state: "완료", sub: 21, total: 24 },
      { label: "9–13주차", title: "DP · 최단경로", dates: "08.26 – 09.30", state: "완료", sub: 24, total: 30 },
    ],
    moreRounds: "",
    action: "closed",
    next: null,
  },
};

/* ---------------- 사이드바 목록 ---------------- */

export type SidebarItem = { id: RoomId; when: string; /** 남은 일수 — 있으면 D-day 배지 */ left?: number; title?: string; intro?: string };
export type SidebarGroup = { label: string; items: SidebarItem[] };

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  { label: "진행중", items: [{ id: "aws", when: "10.14 마감", left: 2 }, { id: "spring", when: "10.18 마감", left: 6 }] },
  { label: "모집중 · 신청한 방", items: [{ id: "sqld", when: "10.26 시작" }] },
  { label: "종료", items: [{ id: "algo", when: "09.30 종료" }] },
];

/* ---------------- 커리큘럼 트리 ---------------- */

/**
 * 과제 코드: 참가자 순서대로 D 기한내 / L 지각 / M 미제출 / O 진행중 / P 예정 / - 미배정
 */
export type RawLeaf = { title: string; type: TaskType; s: string; e: string; codes: string };
export type RawNode = { label: string | null; title: string; s: string; e: string; children: RawChild[] };
export type RawChild = RawLeaf | RawNode;
export type Plan = { members: string[]; tree: RawNode[] };

export const isRawLeaf = (n: RawChild): n is RawLeaf => "codes" in n;

const Lf = (title: string, type: TaskType, s: string, e: string, codes: string): RawLeaf => ({
  title,
  type,
  s: "2026-" + s,
  e: "2026-" + e,
  codes,
});
const Nd = (label: string | null, title: string, s: string, e: string, children: RawChild[]): RawNode => ({
  label,
  title,
  s: "2026-" + s,
  e: "2026-" + e,
  children,
});

const algoMembers = ["현우", "철수", "보람", "지성", "다은", "유진"];
const algoMiss: Record<number, string[]> = {
  2: ["지성"],
  5: ["유진"],
  6: ["지성"],
  7: ["보람"],
  9: ["철수"],
  10: ["지성"],
  11: ["철수"],
  12: ["다은", "유진"],
  13: ["유진"],
};
const algoWeek = (w: number): RawLeaf => {
  const s = addDays("2026-07-01", (w - 1) * 7);
  return {
    title: `${w}주차 문제 풀이`,
    type: "공통",
    s,
    e: addDays(s, 6),
    codes: algoMembers.map((nm) => ((algoMiss[w] ?? []).includes(nm) ? "M" : "D")).join(""),
  };
};
const algoGroup = (label: string, title: string, a: number, b: number): RawNode => {
  const ch: RawLeaf[] = [];
  for (let w = a; w <= b; w++) ch.push(algoWeek(w));
  return { label, title, s: ch[0].s, e: ch[ch.length - 1].e, children: ch };
};

export const PLANS: Record<RoomId, Plan> = {
  aws: {
    members: ["민수", "지은", "철수", "하나"],
    tree: [
      Nd("1주차", "IAM·VPC", "10-01", "10-07", [Lf("IAM 정책 이해", "공통", "10-01", "10-03", "DLDM"), Lf("VPC 실습", "공통", "10-04", "10-07", "DMDM")]),
      Nd("2주차", "EC2·S3", "10-08", "10-14", [
        Lf("EC2 인스턴스 유형 정리", "지정", "10-08", "10-14", "-DO-"),
        Lf("S3 스토리지 클래스 발표자료", "지정", "10-10", "10-14", "---O"),
      ]),
      Nd("3주차", "고가용성 아키텍처", "10-15", "10-21", [Nd(null, "로드밸런서 비교", "10-15", "10-21", [Lf("ALB vs NLB 실습", "공통", "10-15", "10-21", "PPPP")])]),
      Nd("4주차", "오토스케일링", "10-22", "10-28", [Lf("Auto Scaling 정책 정리", "공통", "10-22", "10-28", "PPPP")]),
      Nd("5주차", "데이터베이스", "10-29", "11-04", [Lf("RDS·Aurora 비교", "공통", "10-29", "11-04", "PPPP"), Lf("DynamoDB 설계 퀴즈", "지정", "11-01", "11-04", "-P-P")]),
    ],
  },
  spring: {
    members: ["지훈", "철수", "소율", "민재", "아린"],
    tree: [
      Nd("1주차", "핵심 원리 기본편 (전반)", "10-05", "10-11", [
        Lf("섹션 1~5 정리 노트", "공통", "10-05", "10-11", "DDDDD"),
        Lf("스프링 컨테이너 실습", "공통", "10-08", "10-11", "DLDDM"),
      ]),
      Nd("2주차", "핵심 원리 기본편 (후반)", "10-12", "10-18", [
        Lf("섹션 6~7 정리 노트", "공통", "10-12", "10-18", "DODDO"),
        Lf("싱글톤 컨테이너 실습 코드", "공통", "10-15", "10-18", "PPPPP"),
      ]),
      Nd("3주차", "스프링 MVC 1편", "10-19", "10-25", [
        Lf("MVC 구조 이해 노트", "공통", "10-19", "10-25", "PPPPP"),
        Lf("서블릿→MVC 리팩토링", "공통", "10-22", "10-25", "PPPPP"),
      ]),
      Nd("4주차", "MVC 1편 (후반)", "10-26", "11-01", [Lf("MVC 1편 섹션 5~7 노트", "공통", "10-26", "11-01", "PPPPP")]),
    ],
  },
  sqld: {
    members: ["가은"],
    tree: [
      Nd("1주차", "데이터 모델링의 이해", "10-26", "11-01", [
        Lf("데이터 모델링 요약 노트", "공통", "10-26", "11-01", "P"),
        Lf("1과목 기출 풀이", "공통", "10-29", "11-01", "P"),
      ]),
      Nd("2주차", "SQL 기본", "11-02", "11-08", [
        Lf("SELECT·JOIN 정리", "공통", "11-02", "11-05", "P"),
        Lf("내장 함수 실습", "공통", "11-04", "11-08", "P"),
        Lf("2과목 기출 풀이 (전반)", "지정", "11-06", "11-08", "-"),
      ]),
      Nd("3주차", "SQL 활용", "11-09", "11-15", [
        Lf("서브쿼리·윈도우 함수", "공통", "11-09", "11-15", "P"),
        Lf("2과목 기출 풀이 (후반)", "공통", "11-12", "11-15", "P"),
      ]),
      Nd("4주차", "모의고사", "11-16", "11-22", [Lf("모의고사 1회", "공통", "11-16", "11-19", "P"), Lf("모의고사 2회", "공통", "11-20", "11-22", "P")]),
    ],
  },
  algo: {
    members: algoMembers,
    tree: [algoGroup("1–4주차", "구현 · 그리디", 1, 4), algoGroup("5–8주차", "BFS · DFS · 백트래킹", 5, 8), algoGroup("9–13주차", "DP · 최단경로", 9, 13)],
  },
};
