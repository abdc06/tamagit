import { dict, type Lang, type PetMoodKey } from './i18n.ts';

/**
 * 펫: 코드 드래곤. 레벨에 따라 진화하고, 오늘 활동/스트릭에 따라 기분이 바뀐다.
 * 표시 문자열은 i18n 이 갖고 있고, 여기서는 단계/기분만 결정한다.
 */
export interface PetStage {
  stage: number;
  name: string;
  icon: string;
  minLevel: number;
  /** 다음 단계 최소 레벨 (마지막이면 null) */
  nextLevel: number | null;
}

const STAGES: Array<{ stage: number; icon: string; minLevel: number }> = [
  { stage: 0, icon: '🥚', minLevel: 1 },
  { stage: 1, icon: '🐣', minLevel: 3 },
  { stage: 2, icon: '🦎', minLevel: 6 },
  { stage: 3, icon: '🐲', minLevel: 11 },
  { stage: 4, icon: '🐉', minLevel: 19 },
  { stage: 5, icon: '✨', minLevel: 31 },
];

export type PetMood = PetMoodKey;

export interface PetState extends PetStage {
  mood: PetMood;
  moodLabel: string;
  line: string;
}

function moodOf(todayPrompts: number, streak: number, atRisk: boolean): PetMood {
  if (todayPrompts === 0) return atRisk ? 'bored' : 'asleep';
  if (todayPrompts >= 150 || streak >= 14) return 'blazing';
  if (todayPrompts >= 50) return 'happy';
  return 'content';
}

export function petFor(
  level: number,
  todayPrompts: number,
  streak: number,
  atRisk: boolean,
  lang: Lang = 'en',
): PetState {
  const d = dict(lang);
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (level >= STAGES[i]!.minLevel) idx = i;
  const cur = STAGES[idx]!;
  const next = STAGES[idx + 1];
  const mood = moodOf(todayPrompts, streak, atRisk);
  return {
    stage: cur.stage,
    icon: cur.icon,
    minLevel: cur.minLevel,
    name: d.petStage[idx] ?? `Stage ${idx}`,
    nextLevel: next ? next.minLevel : null,
    mood,
    moodLabel: d.petMood[mood],
    line: d.petLine(mood, streak, atRisk),
  };
}

export const PET_STAGES = STAGES;
