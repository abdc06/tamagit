import { execFileSync } from 'node:child_process';
import type { Stats } from './stats.ts';
import { dict, type Lang } from './i18n.ts';

/**
 * 알림. 게임화의 핵심 루프(손실 회피 → 복귀)는 대시보드를 열어야만 보이면 작동하지 않는다.
 * 그래서 스트릭이 끊길 상황이면 도구 쪽에서 먼저 말을 건다.
 *
 * macOS 외에서는 조용히 no-op 한다 (의존성을 늘리지 않는다).
 */

export type NudgeKind = 'levelup' | 'achievement' | 'streak-risk';

export interface Nudge {
  kind: NudgeKind;
  title: string;
  subtitle: string;
  message: string;
}

export interface NudgeState {
  /** 마지막으로 레벨업을 알린 레벨 */
  lastNotifiedLevel: number | null;
  /** 마지막으로 스트릭 경고를 띄운 날 (하루 한 번만 조른다) */
  lastStreakNagDay: string | null;
}

export interface NudgeResult {
  nudges: Nudge[];
  /** 알림 후 저장해야 할 상태 */
  nextState: NudgeState;
}

/**
 * 무엇을 알릴지 결정한다. 순수 함수 — 부수효과 없음(테스트 가능).
 */
export function decideNudges(
  stats: Stats,
  newAchievementIds: string[],
  state: NudgeState,
  lang: Lang = 'en',
): NudgeResult {
  const d = dict(lang).notify;
  const nudges: Nudge[] = [];
  const next: NudgeState = { ...state };
  const level = stats.level.level;
  const pet = stats.pet;

  // 1) 레벨업 — 처음 실행이면 알리지 않는다 (과거 기록을 몰아서 축하하면 스팸이 된다)
  if (state.lastNotifiedLevel !== null && level > state.lastNotifiedLevel) {
    const from = state.lastNotifiedLevel;
    nudges.push({
      kind: 'levelup',
      title: d.levelUp(pet.icon, level),
      subtitle: pet.name,
      message:
        from + 1 === level
          ? d.levelUpBody(from, level, stats.level.totalXp.toLocaleString())
          : d.levelUpJump(from, level, level - from),
    });
  }
  next.lastNotifiedLevel = level;

  // 2) 새 업적
  if (state.lastNotifiedLevel !== null && newAchievementIds.length > 0) {
    const unlocked = stats.achievements.filter((a) => newAchievementIds.includes(a.id));
    const first = unlocked[0];
    if (first) {
      nudges.push({
        kind: 'achievement',
        title: d.achievement(first.icon),
        subtitle: first.name,
        message:
          unlocked.length > 1 ? d.achievementMore(first.desc, unlocked.length - 1) : first.desc,
      });
    }
  }

  // 3) 스트릭 위험 — 오늘 아직 0건이고, 어제까지 이어져 있을 때만. 하루 한 번.
  const today = stats.today;
  const atRisk = stats.todayStat.prompts === 0 && stats.streak.current > 0 && stats.streak.atRisk;
  if (atRisk && state.lastStreakNagDay !== today) {
    nudges.push({
      kind: 'streak-risk',
      title: d.streakRisk(stats.streak.current),
      subtitle: `${pet.icon} ${pet.name}`,
      message:
        stats.streak.current >= stats.streak.longest
          ? d.streakRiskRecord
          : d.streakRiskBody(stats.streak.longest),
    });
    next.lastStreakNagDay = today;
  }

  return { nudges, nextState: next };
}

/** AppleScript 문자열 리터럴 이스케이프 */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** macOS 알림 센터로 보낸다. 실패해도 절대 예외를 던지지 않는다. */
export function sendNotification(n: Nudge): boolean {
  if (process.platform !== 'darwin') return false;
  const script =
    `display notification "${escapeAppleScript(n.message)}"` +
    ` with title "${escapeAppleScript(n.title)}"` +
    ` subtitle "${escapeAppleScript(n.subtitle)}"`;
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    // 알림 권한이 없거나 osascript 가 없는 환경 — 조용히 넘어간다
    return false;
  }
}
