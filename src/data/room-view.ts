import type { Tone } from "@/lib/palette";
import { MEMBERSHIP_LABEL, type RoomStatus, type TaskStatus } from "@/lib/types";

/** RoomView.dc.html ROOMS 객체를 그대로 옮긴 목업. 문구·숫자는 원본과 동일. */

/** 참가 CTA 의 기본 상태. recruit 는 사용자의 join 값에 따라 join/apply/leave/pending 으로 갈린다. */
export type BaseAction = "recruit" | "owner" | "full" | "joined" | "inactive" | "activeClosed" | "ended" | "archived";
export type JoinState = "none" | "joined" | "pending";
/** 공개 식별자 = slug (D1). 목업 8개 리터럴에서 string 으로 넓힘 */
export type RoomId = string;
export type Action = "login" | "join" | "apply" | "leave" | "pending" | "inactive" | "joined" | "owner" | "full" | "activeClosed" | "ended" | "archived";

export type RoomTag = { label: string; tone: Tone; auto: boolean };
export type RoomMember = {
  name: string;
  leader?: boolean;
  me?: boolean;
  userId?: string;
  tone?: Tone;
  /** 내 승인 대기 행 */
  pending?: boolean;
};
export type RoomTask = {
  title: string;
  type: "공통" | "지정" | "개인";
  dates: string;
  people: { name: string; status: TaskStatus; tone?: Tone; userId?: string }[];
};
export type RoomRound = {
  label: string;
  title: string;
  dates: string;
  /** 시작 전 회차는 "과제 N개" 같은 문구, 그 밖에는 상태 라벨 */
  state: string;
  sub?: number;
  total?: number;
  current?: boolean;
};

export type Room = {
  /** = slug */
  id: RoomId;
  /** 보관된 방 — 표기를 "보관된 스터디" 로 (최종 수정 4). 목업은 생략 */
  archived?: boolean;
  title: string;
  intro: string;
  status: RoomStatus;
  /** 모집 시작 전(DRAFT) — status 는 recruit 로 접히므로 배지는 이것으로 "준비중" */
  draft?: boolean;
  base: BaseAction;
  approval: boolean;
  /** 비공개면 false */
  pub?: boolean;
  period: string;
  when: string;
  dday: string;
  ddayLong: string;
  leader: string;
  /** 그룹장 아바타 색 — DTO leader.tone */
  leaderTone?: Tone;
  /** 그룹장 userId — 아바타 변형(avatarColors) */
  leaderId?: string;
  tags: RoomTag[];
  capCur: number;
  capMax: number;
  minNeed: number;
  members: RoomMember[];
  cur: { pill: string; title: string; meta: string; tasks: RoomTask[] };
  about: string;
  rules: string[];
  rounds: RoomRound[];
  moreRounds: string;
  glance: { rounds: string; tasks: string };
};

const pre = (title: string, meta: string): Room["cur"] => ({ pill: "시작 전", title, meta, tasks: [] });
const tag = (label: string, tone: Tone, auto: boolean): RoomTag => ({ label, tone, auto });
const m = (name: string, o: Omit<RoomMember, "name"> = {}): RoomMember => ({ name, ...o });
const p = (name: string, status: TaskStatus) => ({ name, status });

export const ROOMS: Record<RoomId, Room> = {
  toeic: {
    id: "toeic",
    title: "토익 900 8주 챌린지",
    intro: "매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.",
    status: "recruit", base: "recruit", approval: false,
    period: "2026.11.02(월) – 12.27(일)", when: "D-21", dday: "D-21", ddayLong: "시작까지 D-21",
    leader: "서연", tags: [tag("영어", "blue", true), tag("토익", "peach", true)],
    capCur: 2, capMax: 8, minNeed: 4, members: [m("서연", { leader: true }), m("도현")],
    cur: pre("11월 2일(월) 첫 회차가 열려요", "8회차 · 과제 16개 준비됨"),
    about: "8주 동안 매일 LC·RC 한 세트를 풀고, 틀린 문제는 오답 노트로 정리해 공유합니다. 주말에는 실전 모의고사 1회를 시간 맞춰 풀고 점수를 기록해요.",
    rules: ["오답 노트에는 틀린 이유와 정답 근거를 함께 적어 주세요.", "모의고사는 120분 시간을 지켜서 풀어요."],
    rounds: [
      { label: "1주차", title: "LC Part 1·2", dates: "11.02 – 11.08", state: "과제 2개" },
      { label: "2주차", title: "RC Part 5·6", dates: "11.09 – 11.15", state: "과제 2개" },
      { label: "3주차", title: "LC Part 3·4", dates: "11.16 – 11.22", state: "과제 2개" },
    ],
    moreRounds: "이후 5개 회차가 더 있어요",
    glance: { rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" },
  },
  cs: {
    id: "cs",
    title: "CS 면접 질문 주 2회 — 운영체제·네트워크·데이터베이스 단골 질문 완전 정복하고 모의 면접까지",
    intro: "운영체제·네트워크·DB 단골 질문을 주 2회 나눠 답변을 작성하고 서로 리뷰해요.",
    status: "recruit", base: "recruit", approval: false,
    period: "2026.10.19(월) – 11.30(월)", when: "D-7", dday: "D-7", ddayLong: "시작까지 D-7",
    leader: "예린", tags: [tag("CS", "amber", true), tag("면접", "lav", false)],
    capCur: 3, capMax: 6, minNeed: 3, members: [m("예린", { leader: true }), m("승호"), m("나연")],
    cur: pre("10월 19일(월) 첫 회차가 열려요", "12회차 · 과제 24개 준비됨"),
    about: "월·목 주 2회, 회차마다 단골 면접 질문 2개에 대한 답변을 작성합니다. 서로의 답변에 댓글로 꼬리 질문을 남기고, 마지막 주에는 화상 모의 면접을 진행해요.",
    rules: ["답변은 1분 안에 말할 수 있는 분량으로 작성해요.", "다른 사람 답변에 꼬리 질문을 1개 이상 남겨 주세요."],
    rounds: [
      { label: "1회차", title: "운영체제 ① 프로세스·스레드", dates: "10.19 – 10.21", state: "과제 2개" },
      { label: "2회차", title: "운영체제 ② 메모리", dates: "10.22 – 10.25", state: "과제 2개" },
      { label: "3회차", title: "네트워크 ① TCP/IP", dates: "10.26 – 10.28", state: "과제 2개" },
    ],
    moreRounds: "이후 9개 회차가 더 있어요",
    glance: { rounds: "12회차 · 월·목 시작", tasks: "24개 · 모두 공통 과제" },
  },
  sqld: {
    id: "sqld",
    title: "SQLD 4주 벼락치기",
    intro: "데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.",
    status: "recruit", base: "recruit", approval: true,
    period: "2026.10.26(월) – 11.22(일)", when: "D-14", dday: "D-14", ddayLong: "시작까지 D-14",
    leader: "가은", tags: [tag("SQL", "amber", true), tag("데이터", "blue", true), tag("자격증", "peach", false)],
    capCur: 1, capMax: 5, minNeed: 3, members: [m("가은", { leader: true })],
    cur: pre("10월 26일(월) 첫 회차가 열려요", "4회차 · 과제 9개 준비됨"),
    about: "11월 SQLD 시험 직전 4주 동안 핵심만 빠르게 정리합니다. 회차마다 요약 노트와 기출 풀이를 제출하고, 마지막 주에는 모의고사 2회를 함께 풀어요.",
    rules: ["기출 풀이는 틀린 문제와 이유를 함께 적어 주세요.", "모의고사는 정해진 시간(90분)을 지켜 풀어요."],
    rounds: [
      { label: "1주차", title: "데이터 모델링의 이해", dates: "10.26 – 11.01", state: "과제 2개" },
      { label: "2주차", title: "SQL 기본", dates: "11.02 – 11.08", state: "과제 3개" },
      { label: "3주차", title: "SQL 활용", dates: "11.09 – 11.15", state: "과제 2개" },
    ],
    moreRounds: "이후 1개 회차가 더 있어요",
    glance: { rounds: "4회차 · 매주 월요일 시작", tasks: "9개 · 공통 7 · 지정 2" },
  },
  docker: {
    id: "docker",
    title: "Docker·K8s 입문 6주",
    intro: "컨테이너 기초부터 쿠버네티스 배포까지, 매주 실습 결과를 스크린샷과 링크로 공유해요.",
    status: "recruit", base: "owner", approval: false,
    period: "2026.11.09(월) – 12.20(일)", when: "D-28", dday: "D-28", ddayLong: "시작까지 D-28",
    leader: "철수", tags: [tag("Docker", "blue", true), tag("Kubernetes", "lav", true), tag("클라우드", "mint", false)],
    capCur: 0, capMax: 6, minNeed: 2, members: [],
    cur: pre("11월 9일(월) 첫 회차가 열려요", "6회차 · 과제 8개 준비됨"),
    about: "도커 이미지 빌드부터 쿠버네티스에 서비스를 배포하기까지 6주 동안 단계별로 실습합니다. 매주 실습 결과를 스크린샷과 저장소 링크로 공유해요.",
    rules: ["실습 환경은 각자 로컬(Docker Desktop 또는 minikube)을 사용해요.", "막힌 부분은 제출물에 그대로 적어 주면 함께 풀어 봐요."],
    rounds: [
      { label: "1주차", title: "컨테이너와 이미지", dates: "11.09 – 11.15", state: "과제 2개" },
      { label: "2주차", title: "Dockerfile·Compose", dates: "11.16 – 11.22", state: "과제 1개" },
      { label: "3주차", title: "쿠버네티스 기본 오브젝트", dates: "11.23 – 11.29", state: "과제 2개" },
    ],
    moreRounds: "이후 3개 회차가 더 있어요",
    glance: { rounds: "6회차 · 매주 월요일 시작", tasks: "8개 · 모두 공통 과제" },
  },
  jcg: {
    id: "jcg",
    title: "정보처리기사 실기 2주 완성",
    intro: "기출 회독 3회와 약점 단원 집중. 매일 저녁 9시 진도 체크.",
    status: "recruit", base: "full", approval: true,
    period: "2026.10.19(월) – 11.01(일)", when: "D-7", dday: "D-7", ddayLong: "시작까지 D-7",
    leader: "수민", tags: [tag("자격증", "peach", true), tag("정보처리기사", "amber", false)],
    capCur: 4, capMax: 4, minNeed: 3, members: [m("수민", { leader: true }), m("태윤"), m("하은"), m("준서")],
    cur: pre("10월 19일(월) 첫 회차가 열려요", "2회차 · 과제 6개 준비됨"),
    about: "실기 시험 직전 2주 동안 기출을 3회독하고, 자주 틀리는 단원을 골라 집중적으로 다시 풉니다. 매일 저녁 9시에 진도를 체크해요.",
    rules: ["매일 21시까지 그날 푼 회차를 제출해 주세요.", "오답은 단원별로 모아서 정리해요."],
    rounds: [
      { label: "1주차", title: "필기 복습 · 기출 1회독", dates: "10.19 – 10.25", state: "과제 3개" },
      { label: "2주차", title: "약점 단원 · 기출 2~3회독", dates: "10.26 – 11.01", state: "과제 3개" },
    ],
    moreRounds: "",
    glance: { rounds: "2회차", tasks: "6개 · 모두 공통 과제" },
  },
  aws: {
    id: "aws",
    title: "AWS SAA 자격증 3개월 완주",
    intro: "IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.",
    status: "active", base: "joined", approval: true,
    period: "2026.10.01(목) – 12.31(목)", when: "D-80", dday: "D-80", ddayLong: "종료까지 D-80",
    leader: "민수", tags: [tag("AWS", "mint", true), tag("클라우드", "blue", true), tag("자격증", "peach", false)],
    capCur: 4, capMax: 6, minNeed: 3,
    members: [m("민수", { leader: true }), m("지은"), m("철수", { me: true }), m("하나")],
    cur: {
      pill: "2주차 · 진행중", title: "EC2·S3", meta: "10.08(목) – 10.14(수) · 마감 D-2",
      tasks: [
        { title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14", people: [p("지은", "done"), p("철수", "open")] },
        { title: "S3 스토리지 클래스 발표자료", type: "지정", dates: "10.10 – 10.14", people: [p("하나", "open")] },
      ],
    },
    about: "AWS Solutions Architect – Associate(SAA-C03) 합격을 목표로 3개월간 13회차를 진행합니다. 매주 목요일에 새 회차가 열리고, 회차마다 공통 과제와 지정 과제가 있어요.",
    rules: ["마감은 회차 마지막 날 23:59(KST)예요. 늦게라도 제출하면 지각으로 기록돼요.", "2회 연속 미제출 시 그룹장과 상의 후 이탈 처리될 수 있어요."],
    rounds: [
      { label: "1주차", title: "IAM·VPC", dates: "10.01 – 10.07", state: "기간 종료", sub: 5, total: 8 },
      { label: "2주차", title: "EC2·S3", dates: "10.08 – 10.14", state: "진행중", sub: 1, total: 3, current: true },
      { label: "3주차", title: "고가용성 아키텍처", dates: "10.15 – 10.21", state: "예정", sub: 0, total: 4 },
    ],
    moreRounds: "이후 10개 회차가 더 있어요",
    glance: { rounds: "13회차 · 매주 목요일 시작", tasks: "진행 중 · 공통·지정 혼합" },
  },
  react: {
    id: "react",
    title: "리액트 공식문서 함께 읽기",
    intro: "react.dev Learn 섹션을 주차별로 읽고, 챕터마다 작은 예제를 만들어 공유합니다.",
    status: "active", base: "activeClosed", approval: false,
    period: "2026.09.21(월) – 11.15(일)", when: "D-34", dday: "D-34", ddayLong: "종료까지 D-34",
    leader: "태호", tags: [tag("React", "blue", true), tag("프론트엔드", "mint", true)],
    capCur: 5, capMax: 8, minNeed: 3,
    members: [m("태호", { leader: true }), m("은지"), m("시우"), m("다인"), m("현준")],
    cur: {
      pill: "4주차 · 진행중", title: "상태 관리하기", meta: "10.12(월) – 10.18(일) · 마감 D-6",
      tasks: [
        {
          title: "리듀서로 상태 로직 옮기기", type: "공통", dates: "10.12 – 10.18",
          people: [p("태호", "done"), p("은지", "done"), p("다인", "done"), p("시우", "open"), p("현준", "open")],
        },
        {
          title: "Context로 props 전달 줄이기", type: "공통", dates: "10.15 – 10.18",
          people: [p("태호", "planned"), p("은지", "planned"), p("다인", "planned"), p("시우", "planned"), p("현준", "planned")],
        },
      ],
    },
    about: "react.dev의 Learn 섹션을 8주에 나눠 읽습니다. 챕터마다 핵심을 정리하고, 직접 만든 작은 예제를 CodeSandbox 링크로 공유해요.",
    rules: ["예제는 공식문서와 다른 주제로 직접 만들어 주세요.", "정리 노트에는 이해가 안 된 부분도 솔직하게 적어요."],
    rounds: [
      { label: "3주차", title: "상호작용 더하기", dates: "10.05 – 10.11", state: "기간 종료", sub: 9, total: 10 },
      { label: "4주차", title: "상태 관리하기", dates: "10.12 – 10.18", state: "진행중", sub: 3, total: 10, current: true },
      { label: "5주차", title: "탈출구(Escape Hatches)", dates: "10.19 – 10.25", state: "예정", sub: 0, total: 10 },
    ],
    moreRounds: "1~2주차 완료 · 이후 3개 회차가 더 있어요",
    glance: { rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" },
  },
  algo: {
    id: "algo",
    title: "알고리즘 매일 1문제",
    intro: "백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.",
    status: "ended", base: "ended", approval: false,
    period: "2026.07.01(수) – 09.30(수)", when: "종료", dday: "종료", ddayLong: "09.30 종료",
    leader: "현우", tags: [tag("알고리즘", "slate", true), tag("코딩테스트", "mint", true)],
    capCur: 6, capMax: 6, minNeed: 2,
    members: [m("현우", { leader: true }), m("철수", { me: true }), m("보람"), m("지성"), m("다은"), m("유진")],
    cur: { pill: "종료", title: "13주 완주 · 전체 달성률 87%", meta: "07.01 – 09.30 · 제출 68 / 78건", tasks: [] },
    about: "매일 한 문제를 풀고 짧은 회고를 남기는 습관 스터디였어요. 주 단위로 7문제 중 5문제 이상 풀면 그 주 과제를 달성한 것으로 봤습니다.",
    rules: ["풀이 언어는 자유, 회고는 3줄 이내로 남겨요.", "주 5문제 이상 풀면 주간 과제 달성으로 기록해요."],
    rounds: [
      { label: "1–4주차", title: "구현 · 그리디", dates: "07.01 – 07.28", state: "완료", sub: 23, total: 24 },
      { label: "5–8주차", title: "BFS · DFS · 백트래킹", dates: "07.29 – 08.25", state: "완료", sub: 21, total: 24 },
      { label: "9–13주차", title: "DP · 최단경로", dates: "08.26 – 09.30", state: "완료", sub: 24, total: 30 },
    ],
    moreRounds: "",
    glance: { rounds: "13회차 · 완료", tasks: "78건 중 68건 제출" },
  },
};

export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];
export const isRoomId = (id: string): id is RoomId => id in ROOMS;

/** 좌측 사이드바 그룹 순서 */
export const ROOM_GROUPS: { key: RoomStatus; label: string; ids: RoomId[] }[] = [
  { key: "recruit", label: "모집중", ids: ["toeic", "cs", "sqld", "docker", "jcg"] },
  { key: "active", label: "진행중", ids: ["aws", "react"] },
  { key: "ended", label: "종료", ids: ["algo"] },
];

/** 초기 join 상태 */
export const INITIAL_JOIN: Partial<Record<RoomId, JoinState>> = { sqld: "pending" };

/** CTA 상태 결정 — 스펙 §3 */
export const actionOf = (room: Room, join: JoinState | undefined): Action => {
  if (room.base !== "recruit") return room.base;
  if (join === "joined") return "leave";
  if (join === "pending") return "pending";
  return room.approval ? "apply" : "join";
};

/** 좌측 목록 상태 마크 */
export const MARK: Partial<Record<Action, { label: string; fg: string; bg: string }>> = {
  leave: { label: MEMBERSHIP_LABEL.joined, fg: "#0B6553", bg: "#DDF4EE" },
  pending: { label: MEMBERSHIP_LABEL.pending, fg: "#7A4F00", bg: "#FBEFD3" },
  joined: { label: MEMBERSHIP_LABEL.joined, fg: "#0B6553", bg: "#DDF4EE" },
  owner: { label: "내 방", fg: "#2F5BC2", bg: "#E3ECFD" },
};

/** 상태 배지 색 */
export const STATUS_BADGE: Record<RoomStatus, string> = { recruit: "#3B6FE0", active: "#0D7A64", ended: "#5B6675" };
