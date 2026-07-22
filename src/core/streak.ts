import { dayToOrdinal } from './clock.ts';

export interface StreakInfo {
  /** 오늘 기준 진행 중인 연속 일수 (오늘 또는 어제까지 활동했어야 유지) */
  current: number;
  longest: number;
  /** 각 활동일이 몇 일차 연속인지 */
  lengthAt: Map<string, number>;
  /** 오늘 아직 활동이 없어서 내일이면 끊기는 상태인가 */
  atRisk: boolean;
}

/** activeDays: 오름차순 정렬된 활동일 목록 (YYYY-MM-DD) */
export function computeStreaks(activeDays: string[], today: string): StreakInfo {
  const lengthAt = new Map<string, number>();
  let longest = 0;
  let run = 0;
  let prevOrd: number | null = null;

  for (const day of activeDays) {
    const ord = dayToOrdinal(day);
    run = prevOrd !== null && ord - prevOrd === 1 ? run + 1 : 1;
    lengthAt.set(day, run);
    if (run > longest) longest = run;
    prevOrd = ord;
  }

  const last = activeDays[activeDays.length - 1];
  const todayOrd = dayToOrdinal(today);
  let current = 0;
  let atRisk = false;
  if (last) {
    const gap = todayOrd - dayToOrdinal(last);
    if (gap === 0) current = lengthAt.get(last) ?? 0;
    else if (gap === 1) {
      // 어제까지 이어졌다 — 오늘 안에 한 건이라도 넣으면 유지
      current = lengthAt.get(last) ?? 0;
      atRisk = true;
    }
  }

  return { current, longest, lengthAt, atRisk };
}
