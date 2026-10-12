import type { RoomStatus } from "@/lib/types";

/** 카드 배지 상태 — RoomStatus 에 '정원 마감'이 추가됨. 상태 필터에선 full → recruit 로 묶인다. */
export type CardStatus = RoomStatus | "full";

export type Slot = {
  label: string;
  value: string;
  pct: number;
  note: string;
  /** D-day 등 강조값. 빈 문자열이면 미표시 */
  em: string;
};

export type Room = {
  id: string;
  title: string;
  intro: string;
  status: CardStatus;
  pub: boolean;
  approval: boolean;
  cur: number;
  max: number;
  leader: string;
  tags: string[];
  mine: boolean;
  created: boolean;
  period: string;
  slot: Slot;
};

/** docs/specs/main.md §5 — 배열 순서 = 렌더 순서 */
export const ROOMS: Room[] = [
  {
    id: "aws",
    title: "AWS SAA 자격증 3개월 완주",
    intro: "IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.",
    status: "active",
    pub: true,
    approval: true,
    cur: 4,
    max: 6,
    leader: "민수",
    tags: ["AWS", "클라우드", "자격증"],
    mine: true,
    created: false,
    period: "2026.10.01 – 12.31 · 3개월",
    slot: { label: "내 진척률", value: "50%", pct: 50, note: "EC2 인스턴스 유형 정리", em: "D-2" },
  },
  {
    id: "toeic",
    title: "토익 900 8주 챌린지",
    intro: "매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.",
    status: "recruit",
    pub: true,
    approval: false,
    cur: 2,
    max: 8,
    leader: "서연",
    tags: ["영어", "토익"],
    mine: false,
    created: false,
    period: "2026.11.02 – 12.27 · 8주",
    slot: { label: "모집 현황", value: "2/8명", pct: 25, note: "11.02(월) 시작 · 6자리 남음", em: "D-21" },
  },
  {
    id: "spring",
    title: "Spring 김영한 로드맵 완강",
    intro: "핵심 원리부터 JPA 활용까지 로드맵 순서대로, 섹션별 정리 노트를 제출합니다.",
    status: "active",
    pub: false,
    approval: true,
    cur: 5,
    max: 5,
    leader: "지훈",
    tags: ["Spring", "백엔드", "Java"],
    mine: true,
    created: false,
    period: "2026.10.05 – 2027.01.31 · 17주",
    slot: { label: "내 진척률", value: "33%", pct: 33, note: "섹션 6~7 정리 노트", em: "D-6" },
  },
  {
    id: "algo",
    title: "알고리즘 매일 1문제",
    intro: "백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.",
    status: "ended",
    pub: true,
    approval: false,
    cur: 6,
    max: 6,
    leader: "현우",
    tags: ["알고리즘", "코딩테스트"],
    mine: true,
    created: false,
    period: "2026.07.01 – 09.30 · 13주",
    slot: { label: "최종 달성률", value: "87%", pct: 87, note: "13주 완주 · 제출 68/78건", em: "" },
  },
  {
    id: "jcg",
    title: "정보처리기사 실기 2주 완성",
    intro: "기출 회독 3회와 약점 단원 집중. 매일 저녁 9시 진도 체크.",
    status: "full",
    pub: true,
    approval: true,
    cur: 4,
    max: 4,
    leader: "수민",
    tags: ["자격증", "정보처리기사"],
    mine: false,
    created: false,
    period: "2026.10.19 – 11.01 · 2주",
    slot: { label: "모집 현황", value: "4/4명", pct: 100, note: "10.19(월) 시작 · 정원 마감", em: "D-7" },
  },
  {
    id: "cs",
    title: "CS 면접 질문 주 2회 — 운영체제·네트워크·데이터베이스 단골 질문 완전 정복하고 모의 면접까지",
    intro: "운영체제·네트워크·DB 단골 질문을 주 2회 나눠 답변을 작성하고 서로 리뷰해요.",
    status: "recruit",
    pub: true,
    approval: false,
    cur: 3,
    max: 6,
    leader: "예린",
    tags: ["CS", "면접"],
    mine: false,
    created: false,
    period: "2026.10.19 – 11.30 · 6주",
    slot: { label: "모집 현황", value: "3/6명", pct: 50, note: "10.19(월) 시작 · 3자리 남음", em: "D-7" },
  },
  {
    id: "react",
    title: "리액트 공식문서 함께 읽기",
    intro: "react.dev Learn 섹션을 주차별로 읽고, 챕터마다 작은 예제를 만들어 공유합니다.",
    status: "active",
    pub: true,
    approval: false,
    cur: 5,
    max: 8,
    leader: "태호",
    tags: ["React", "프론트엔드"],
    mine: false,
    created: false,
    period: "2026.09.21 – 11.15 · 8주",
    slot: { label: "전체 진행", value: "4/8주", pct: 50, note: "4주차 · 컴포넌트 상태 관리", em: "" },
  },
  {
    id: "docker",
    title: "Docker·K8s 입문 6주",
    intro: "컨테이너 기초부터 쿠버네티스 배포까지, 매주 실습 결과를 스크린샷과 링크로 공유해요.",
    status: "recruit",
    pub: true,
    approval: false,
    cur: 0,
    max: 6,
    leader: "철수",
    tags: ["Docker", "Kubernetes", "클라우드"],
    mine: false,
    created: true,
    period: "2026.11.09 – 12.20 · 6주",
    slot: { label: "모집 현황", value: "0/6명", pct: 0, note: "11.09(월) 시작 · 첫 참가자를 기다려요", em: "D-28" },
  },
  {
    id: "sqld",
    title: "SQLD 4주 벼락치기",
    intro: "데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.",
    status: "recruit",
    pub: true,
    approval: true,
    cur: 1,
    max: 5,
    leader: "가은",
    tags: ["SQL", "데이터", "자격증"],
    mine: true,
    created: false,
    period: "2026.10.26 – 11.22 · 4주",
    slot: { label: "모집 현황", value: "1/5명", pct: 20, note: "10.26(월) 시작 · 승인 대기중", em: "D-14" },
  },
];
