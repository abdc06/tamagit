import type { Run } from './runs.ts';

export interface PromptRow {
  sessionId: string;
  ts: number;
  project: string;
  charLen: number;
  isMultiline: boolean;
  isSlash: boolean;
  isBang: boolean;
  pastedCount: number;
  day: string;
  hour: number;
  xp: number;
}

export interface AchievementContext {
  /** ts 오름차순 */
  prompts: PromptRow[];
  runs: Run[];
  /** day → 그 날 마지막 프롬프트 ts */
  lastTsOfDay: Map<string, number>;
  /** day → 그 날 프롬프트 수 */
  countOfDay: Map<string, number>;
  /** day → 연속 며칠차 */
  streakAt: Map<string, number>;
  activeDays: string[];
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  rarity: Rarity;
  /** 달성 시점의 ts 를 돌려준다. 미달성이면 null */
  detect(ctx: AchievementContext): number | null;
  /** 진행도 표시용 (현재/목표) */
  progress?(ctx: AchievementContext): { have: number; need: number };
}

/** 조건을 만족하는 N번째 프롬프트의 ts */
function nth(ctx: AchievementContext, need: number, pred: (p: PromptRow) => boolean): number | null {
  let n = 0;
  for (const p of ctx.prompts) if (pred(p) && ++n >= need) return p.ts;
  return null;
}
function countWhere(ctx: AchievementContext, pred: (p: PromptRow) => boolean): number {
  let n = 0;
  for (const p of ctx.prompts) if (pred(p)) n++;
  return n;
}
/** 스트릭이 need 일에 처음 도달한 날의 마지막 ts */
function streakReached(ctx: AchievementContext, need: number): number | null {
  for (const day of ctx.activeDays) {
    if ((ctx.streakAt.get(day) ?? 0) >= need) return ctx.lastTsOfDay.get(day) ?? null;
  }
  return null;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-step',
    name: '첫 발자국',
    desc: '첫 프롬프트를 보냈다',
    icon: '👣',
    rarity: 'common',
    detect: (c) => c.prompts[0]?.ts ?? null,
    progress: (c) => ({ have: Math.min(c.prompts.length, 1), need: 1 }),
  },
  {
    id: 'streak-7',
    name: '일주일의 규율',
    desc: '7일 연속으로 코딩했다',
    icon: '🔥',
    rarity: 'common',
    detect: (c) => streakReached(c, 7),
    progress: (c) => ({ have: Math.max(0, ...c.streakAt.values()), need: 7 }),
  },
  {
    id: 'streak-30',
    name: '한 달의 수행',
    desc: '30일 연속으로 코딩했다',
    icon: '🏔️',
    rarity: 'epic',
    detect: (c) => streakReached(c, 30),
    progress: (c) => ({ have: Math.max(0, ...c.streakAt.values()), need: 30 }),
  },
  {
    id: 'night-owl',
    name: '야행성',
    desc: '밤 20~23시에 프롬프트 100건',
    icon: '🦉',
    rarity: 'common',
    detect: (c) => nth(c, 100, (p) => p.hour >= 20 && p.hour <= 23),
    progress: (c) => ({ have: countWhere(c, (p) => p.hour >= 20 && p.hour <= 23), need: 100 }),
  },
  {
    id: 'witching-hour',
    name: '마의 시간',
    desc: '새벽 2~4시에 코딩했다',
    icon: '🌑',
    rarity: 'legendary',
    detect: (c) => nth(c, 1, (p) => p.hour >= 2 && p.hour < 5),
    progress: (c) => ({ have: Math.min(countWhere(c, (p) => p.hour >= 2 && p.hour < 5), 1), need: 1 }),
  },
  {
    id: 'boss-slayer',
    name: '보스 헌터',
    desc: '보스전 10회 클리어',
    icon: '⚔️',
    rarity: 'rare',
    detect: (c) => {
      let n = 0;
      for (const r of c.runs) if (r.isBoss && ++n >= 10) return r.endTs;
      return null;
    },
    progress: (c) => ({ have: c.runs.filter((r) => r.isBoss).length, need: 10 }),
  },
  {
    id: 'wordsmith',
    name: '장인의 문장',
    desc: '500자 이상 프롬프트 10건',
    icon: '📜',
    rarity: 'rare',
    detect: (c) => nth(c, 10, (p) => p.charLen >= 500),
    progress: (c) => ({ have: countWhere(c, (p) => p.charLen >= 500), need: 10 }),
  },
  {
    id: 'wanderer',
    name: '방랑자',
    desc: '서로 다른 프로젝트 10곳에서 활동',
    icon: '🧭',
    rarity: 'rare',
    detect: (c) => {
      const seen = new Set<string>();
      for (const p of c.prompts) {
        seen.add(p.project);
        if (seen.size >= 10) return p.ts;
      }
      return null;
    },
    progress: (c) => ({ have: new Set(c.prompts.map((p) => p.project)).size, need: 10 }),
  },
  {
    id: 'frenzy',
    name: '폭주',
    desc: '하루에 프롬프트 200건',
    icon: '⚡',
    rarity: 'epic',
    detect: (c) => {
      for (const day of c.activeDays)
        if ((c.countOfDay.get(day) ?? 0) >= 200) return c.lastTsOfDay.get(day) ?? null;
      return null;
    },
    progress: (c) => ({ have: Math.max(0, ...c.countOfDay.values()), need: 200 }),
  },
  {
    id: 'pioneer',
    name: '개척자',
    desc: '한 프로젝트에 프롬프트 1,000건',
    icon: '🏰',
    rarity: 'legendary',
    detect: (c) => {
      const tally = new Map<string, number>();
      for (const p of c.prompts) {
        const n = (tally.get(p.project) ?? 0) + 1;
        tally.set(p.project, n);
        if (n >= 1000) return p.ts;
      }
      return null;
    },
    progress: (c) => {
      const tally = new Map<string, number>();
      for (const p of c.prompts) tally.set(p.project, (tally.get(p.project) ?? 0) + 1);
      return { have: Math.max(0, ...tally.values()), need: 1000 };
    },
  },
];

export interface AchievementState extends Omit<AchievementDef, 'detect' | 'progress'> {
  unlockedAt: number | null;
  have: number;
  need: number;
}

export function evaluateAchievements(ctx: AchievementContext): AchievementState[] {
  return ACHIEVEMENTS.map((a) => {
    const unlockedAt = ctx.prompts.length ? a.detect(ctx) : null;
    const p = a.progress?.(ctx) ?? { have: unlockedAt ? 1 : 0, need: 1 };
    return {
      id: a.id,
      name: a.name,
      desc: a.desc,
      icon: a.icon,
      rarity: a.rarity,
      unlockedAt,
      have: Math.min(p.have, p.need),
      need: p.need,
    };
  });
}
