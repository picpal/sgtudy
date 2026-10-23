import { addDays } from "./normalize";
import type { CallModel } from "./interview";
import type { Field, ModelTurn } from "./schema";

/*
 * AI_INTERVIEW_MOCK=1 대본(§10) — 키 없이 로컬·E2E·DOM 확인용. 결정적: 남은 칸(missing)과 직전 질문으로 다음 말을 정한다.
 * 범위 밖 값(예: "500명")은 그대로 patch 에 실어 서버 정규화(dropped)를 보여 준다. 사용자 글에 "장애 테스트" 가 있으면 503 흉내.
 */

export const MOCK_MODEL = "mock";

const Q = {
  topic: "어떤 공부를 함께 하고 싶어요? 목표나 주제를 한 줄로 알려 주세요.",
  startDate: "언제 시작할까요?",
  durationWeeks: "얼마나 진행할까요?",
  maxMembers: "몇 명까지 받을까요? (그룹장 포함)",
  access: "참가는 어떻게 받을까요?",
  style: "어떻게 진행할까요? 해당하는 걸 모두 골라 주세요.",
  extra: "더 바라는 점이 있나요? (마감 시간, 지각 규칙, 최소 인원, 그룹장도 과제를 하는지)",
  summary: "이대로 미리보기로 갈게요. 바꿀 항목이 있으면 말해 주세요.",
} as const;
type Stage = keyof typeof Q;

const ASK: Record<Stage, ModelTurn["ask"]> = {
  topic: { field: "title", kind: "text" },
  startDate: { field: "startDate", kind: "single", allowOther: "date" },
  durationWeeks: { field: "durationWeeks", kind: "single", allowOther: "number" },
  maxMembers: { field: "maxMembers", kind: "single", allowOther: "number" },
  access: { field: "access", kind: "single" },
  style: { field: "style", kind: "multi" },
  extra: { field: "extra", kind: "text" },
  summary: null,
};

/** DraftCard 「…을 바꿀래요」 → 다시 물을 단계 */
const CHANGE: [RegExp, Stage][] = [
  [/^(제목|소개|태그)/, "topic"], [/^시작/, "startDate"], [/^(종료|기간)/, "durationWeeks"], [/^(최대 )?인원/, "maxMembers"], [/^(공개|참가)/, "access"], [/^(상세|진행|규칙)/, "style"], [/^그룹장/, "extra"],
];

const STYLE_TEXT: Record<string, [string, string]> = {
  "weekly-task": ["매주 과제를 제출해요.", "- 매주 일요일 23:59(KST)까지 과제를 제출해요."],
  proof: ["푼 문제를 인증해요.", "- 푼 문제는 링크나 사진으로 인증해요."],
  meeting: ["정기적으로 온라인 모임을 해요.", "- 정기 모임에 빠질 땐 미리 알려 주세요."],
  presentation: ["돌아가며 발표하고 서로 리뷰해요.", "- 발표 순서는 회차마다 돌아가요."],
  exam: ["회차마다 시험으로 실력을 확인해요.", "- 회차 시험은 마감 전에 응시해요."],
  other: ["진행 방식은 함께 정해요.", ""],
};

const stageOf = (say: string | null): Stage | null => {
  if (!say) return null;
  return (Object.keys(Q) as Stage[]).find((k) => say.endsWith(Q[k])) ?? null;
};
const num = (s: string) => {
  const m = /(\d{1,4})/.exec(s);
  return m ? Number(m[1]) : null;
};
const FIELD_STAGE: Partial<Record<Field, Stage>> = { title: "topic", intro: "topic", startDate: "startDate", endDate: "durationWeeks", maxMembers: "maxMembers", isPublic: "access" };

export const mockCallModel: CallModel = async ({ state }) => {
  const { draft, missing, lastUser, lastAssistant, answer } = state;
  if (lastUser?.includes("장애 테스트")) return { ok: false, status: 529 };
  const asked = stageOf(lastAssistant);
  const patch: ModelTurn["patch"] = {};
  let note = "";
  let next: Stage | null = null;
  const text = (lastUser ?? "").trim();
  const change = /(을|를) 바꿀래요$/.test(text) ? CHANGE.find(([re]) => re.test(text))?.[1] : undefined;

  if (change) next = change;
  else if (answer?.field === "style" || (asked === "style" && text && !answer)) {
    const keys = (answer?.value ?? "").split(",").filter((k) => STYLE_TEXT[k]);
    if (keys.length) {
      patch.descriptionMd = [`${draft.title ?? "이 스터디"}를 함께 진행해요.`, ...keys.map((k) => STYLE_TEXT[k][0])].join("\n\n");
      patch.rulesMd = keys.map((k) => STYLE_TEXT[k][1]).filter(Boolean).join("\n");
    } else if (text && !/건너/.test(text)) patch.descriptionMd = text;
    note = "진행 방식을 설명과 규칙에 적어 둘게요. ";
  } else if (!answer && text) {
    switch (asked ?? "topic") {
      case "topic": {
        const title = text.replace(/\s+/g, " ").slice(0, 60);
        patch.title = title;
        patch.intro = "목표를 세우고 매주 진행 상황을 함께 나눠요";
        const tags = [/aws|saa/i.test(text) && "aws", /자격증|기사|토익/.test(text) && "certificate", /코딩|알고리즘|코테/.test(text) && "coding-test", /영어|토익/.test(text) && "english"].filter(Boolean) as string[];
        if (tags.length) patch.tags = tags;
        note = `좋아요. 제목은 「${title}」로 잡아 둘게요. `;
        break;
      }
      case "startDate": {
        const d = /\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
        if (d) patch.startDate = d;
        break;
      }
      case "durationWeeks": {
        const n = num(text);
        if (n && draft.startDate) patch.endDate = addDays(draft.startDate, n * 7 - 1);
        break;
      }
      case "maxMembers": {
        const n = num(text);
        if (n !== null) patch.maxMembers = n; // 범위 밖이면 서버가 dropped 로 돌려준다
        if (n !== null && (n < 2 || n > 100)) note = "최대 인원은 2~100명까지 정할 수 있어요. ";
        break;
      }
      case "access":
        patch.isPublic = !/비공개|초대/.test(text);
        patch.joinMode = /승인/.test(text) ? "approval" : "direct";
        break;
      case "extra": {
        if (!/건너/.test(text)) {
          patch.rulesMd = [draft.rulesMd, `- ${text.replace(/\n+/g, " ")}`].filter(Boolean).join("\n");
          const min = /최소\s*(\d{1,3})/.exec(text);
          if (min) patch.minMembers = Number(min[1]);
          if (/그룹장.*(안|않)/.test(text)) patch.leaderDoesTasks = false;
        }
        break;
      }
      default:
        break;
    }
  }

  // 다음 단계: 바꿀 항목 요청 → 필수 빈 칸(권장 순서) → 진행 방식 → 추가 요청 → 요약
  const filled = { ...draft, ...patch };
  const answered = (f: string) =>
    f === "maxMembers" ? patch.maxMembers !== undefined && patch.maxMembers >= 2 && patch.maxMembers <= 100 : f === "isPublic" ? patch.isPublic !== undefined : f in patch;
  const firstMissing = missing.find((f) => !answered(f));
  if (!next) {
    if (firstMissing) next = FIELD_STAGE[firstMissing] ?? "topic";
    else if (asked === "extra" || asked === "summary") next = "summary";
    else if (!filled.descriptionMd && asked !== "style") next = "style";
    else next = "extra";
  }
  const summary = `정리했어요 — ${filled.title ?? ""} / ${filled.startDate ?? "?"}~${filled.endDate ?? "?"} / ${filled.maxMembers ?? "?"}명. `;
  const say = next === "summary" ? summary + Q.summary : note + Q[next];
  return { ok: true, turn: { say, patch, ask: ASK[next], done: next === "summary" } satisfies ModelTurn, usage: { in: 0, out: 0, cached: 0 }, model: MOCK_MODEL };
};
