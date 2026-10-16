/**
 * 테스트 픽스처 — aws 목업 트리를 Curriculum(NodeDto[]) 로 옮긴 것 (mystudy §3.3 회귀값).
 * `.test.ts` 가 아니라서 vitest include 에 걸리지 않는다 — 테스트끼리 서로 import 해서 describe 가 두 번 도는 일을 막는다(preflight A11).
 */
import type { Curriculum, CurriculumMember, NodeDto } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";

export const REF_DAY = "2026-10-12";
/** 개인 목표 소유자 — MEMBERS 의 userId */
export const CHULSU = "u1";
export const JIEUN = "u3";

const M = (userId: string, nickname: string, tone: CurriculumMember["tone"], role: CurriculumMember["role"] = "member", status: CurriculumMember["status"] = "active"): CurriculumMember =>
  ({ userId, nickname, tone, role, status, doesTasks: true, canEditCurriculum: role === "leader" });
const MEMBERS = [M("u2", "민수", "mint", "leader"), M("u3", "지은", "peach"), M("u1", "철수", "blue"), M("u4", "하나", "lav"), M("u5", "도윤", "slate", "member", "inactive")];
const byId = Object.fromEntries(MEMBERS.map((m) => [m.userId, m]));

const base = (id: string, parentId: string | null, roundId: string, depth: number, sortOrder: number, title: string, s: string, e: string): NodeDto =>
  ({ id, parentId, roundId, depth, sortOrder, label: null, title, descriptionMd: "", startDate: `2026-${s}`, endDate: `2026-${e}`, archived: false, task: null, assigned: 0, submitted: 0, pct: null });
const round = (id: string, n: number, title: string, s: string, e: string): NodeDto => ({ ...base(id, null, id, 2, n, title, s, e), label: `${n}주차` });
const leaf = (id: string, parentId: string, roundId: string, depth: number, order: number, title: string, type: "common" | "designated" | "personal", s: string, e: string, people: [string, TaskStatus][]): NodeDto => ({
  ...base(id, parentId, roundId, depth, order, title, s, e),
  task: { type, people: people.map(([uid, status]) => ({ userId: uid, nickname: byId[uid].nickname, tone: byId[uid].tone, status })), assigned: people.length, submitted: people.filter(([, st]) => st === "done" || st === "late").length, state: "progress" },
});
/** 개인 목표 — people = [소유자], ownerId (서버 0014 curriculum_get 과 같은 모양) */
const mine = (id: string, roundId: string, order: number, title: string, owner: string, st: TaskStatus, s: string, e: string): NodeDto =>
  ({ ...leaf(id, roundId, roundId, 3, order, title, "personal", s, e, [[owner, st]]), ownerId: owner });
const ALL4 = (st: TaskStatus): [string, TaskStatus][] => [["u2", st], ["u3", st], ["u1", st], ["u4", st]];

export const AWS: Curriculum = {
  today: REF_DAY,
  room: { slug: "aws", status: "active", leaderDoesTasks: true },
  members: MEMBERS,
  nodes: [
    round("1", 1, "IAM·VPC", "10-01", "10-07"),
    leaf("11", "1", "1", 3, 1, "IAM 정책 이해", "common", "10-01", "10-03", [["u2", "done"], ["u3", "late"], ["u1", "done"], ["u4", "missed"]]),
    leaf("12", "1", "1", 3, 2, "VPC 실습", "common", "10-04", "10-07", [["u2", "done"], ["u3", "missed"], ["u1", "done"], ["u4", "missed"]]),
    round("2", 2, "EC2·S3", "10-08", "10-14"),
    leaf("21", "2", "2", 3, 1, "EC2 인스턴스 유형 정리", "designated", "10-08", "10-14", [["u3", "done"], ["u1", "open"]]),
    leaf("22", "2", "2", 3, 2, "S3 스토리지 클래스 발표자료", "designated", "10-10", "10-14", [["u4", "open"]]),
    round("3", 3, "고가용성 아키텍처", "10-15", "10-21"),
    // 서버 순서 [지은 개인, 묶음, 철수 개인] — 화면은 팀 → 내 것 → 남의 것으로 다시 나눈다
    mine("33", "3", 1, "CloudFront 캐시 정리", JIEUN, "done", "10-15", "10-18"),
    base("31", "3", "3", 3, 2, "로드밸런서 비교", "10-15", "10-21"),
    leaf("311", "31", "3", 4, 1, "ALB vs NLB 실습", "common", "10-15", "10-21", ALL4("planned")),
    mine("32", "3", 3, "Route 53 라우팅 정책 복습", CHULSU, "planned", "10-15", "10-21"),
    round("4", 4, "오토스케일링", "10-22", "10-28"),
    leaf("41", "4", "4", 3, 1, "Auto Scaling 정책 정리", "common", "10-22", "10-28", ALL4("planned")),
    round("5", 5, "데이터베이스", "10-29", "11-04"),
    leaf("51", "5", "5", 3, 1, "RDS·Aurora 비교", "common", "10-29", "11-04", ALL4("planned")),
    leaf("52", "5", "5", 3, 2, "DynamoDB 설계 퀴즈", "designated", "11-01", "11-04", [["u3", "planned"], ["u4", "planned"]]),
  ],
  stats: { overallPct: 24, leafCount: 8, unassignedCount: 0 },
  myPermissions: { canEditCurriculum: true },
};
