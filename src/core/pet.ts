/**
 * 펫: 코드 드래곤. 레벨에 따라 진화하고, 오늘 활동/스트릭에 따라 기분이 바뀐다.
 * SPEC §4 "성장하는 펫/아바타 1종".
 */
export interface PetStage {
  stage: number;
  name: string;
  icon: string;
  minLevel: number;
  /** 다음 단계 최소 레벨 (마지막이면 null) */
  nextLevel: number | null;
}

const STAGES: Array<Omit<PetStage, 'nextLevel'>> = [
  { stage: 0, name: '알', icon: '🥚', minLevel: 1 },
  { stage: 1, name: '해츨링', icon: '🐣', minLevel: 3 },
  { stage: 2, name: '코드 리저드', icon: '🦎', minLevel: 6 },
  { stage: 3, name: '드레이크', icon: '🐲', minLevel: 11 },
  { stage: 4, name: '코드 드래곤', icon: '🐉', minLevel: 19 },
  { stage: 5, name: '성좌룡', icon: '✨', minLevel: 31 },
];

export type PetMood = 'asleep' | 'bored' | 'content' | 'happy' | 'blazing';

export interface PetState extends PetStage {
  mood: PetMood;
  moodLabel: string;
  line: string;
}

const MOOD_LABEL: Record<PetMood, string> = {
  asleep: '자는 중',
  bored: '심심함',
  content: '흡족함',
  happy: '신남',
  blazing: '불타는 중',
};

function moodOf(todayPrompts: number, streak: number, atRisk: boolean): PetMood {
  if (todayPrompts === 0) return atRisk ? 'bored' : 'asleep';
  if (todayPrompts >= 150 || streak >= 14) return 'blazing';
  if (todayPrompts >= 50) return 'happy';
  return 'content';
}

function lineOf(mood: PetMood, streak: number, atRisk: boolean): string {
  switch (mood) {
    case 'asleep':
      return '…zzz. 오늘 첫 프롬프트를 기다리는 중.';
    case 'bored':
      return atRisk
        ? `${streak}일 연속이 오늘 끊긴다. 한 건만 넣어줘.`
        : '오늘은 아직 아무 일도 없었다.';
    case 'content':
      return '좋아, 몸이 풀렸다.';
    case 'happy':
      return '오늘 잘 달리고 있다!';
    case 'blazing':
      return streak >= 14 ? `${streak}일 연속. 비늘이 빛난다.` : '멈추지 마라. 지금이 절정이다.';
  }
}

export function petFor(level: number, todayPrompts: number, streak: number, atRisk: boolean): PetState {
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (level >= STAGES[i]!.minLevel) idx = i;
  const cur = STAGES[idx]!;
  const next = STAGES[idx + 1];
  const mood = moodOf(todayPrompts, streak, atRisk);
  return {
    ...cur,
    nextLevel: next ? next.minLevel : null,
    mood,
    moodLabel: MOOD_LABEL[mood],
    line: lineOf(mood, streak, atRisk),
  };
}

export const PET_STAGES = STAGES;
