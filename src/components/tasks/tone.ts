import { STUDY_TONE } from "@/lib/api/schedule";
import type { Tone } from "@/lib/palette";

/** 스터디 톤 색(점·칩). 모르는 톤은 mint */
export const studyTone = (t: Tone) => STUDY_TONE[t] ?? STUDY_TONE.mint;
