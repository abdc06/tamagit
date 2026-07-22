import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * v0 확정 규칙 (docs/SPIKE-01-data-sources.md §5 기준)
 *  - 하루 경계: KST 04:00  → 20~23시 야간 코딩(전체의 21%)을 전날로 귀속시켜 스트릭 체감을 지킨다
 *  - XP: 길이 가중치 포함  → "진행시켜"(4자, 33회)와 1,184자 설계 프롬프트를 같은 값으로 두지 않는다
 *  - 보스전: 유휴 30분 기준 → 총 경과시간(자리비움 포함)이 아니라 실제 몰입 구간을 잡는다
 */
export interface XpConfig {
  /** 프롬프트 1건 기본값 */
  base: number;
  /** 길이 보너스 계수 (자연로그 스케일) */
  lengthWeight: number;
  /** 길이 정규화 분모(자) */
  lengthScale: number;
  /** 멀티라인 프롬프트 보너스 */
  multilineBonus: number;
  /** 붙여넣기 첨부 보너스 */
  pasteBonus: number;
  /** 슬래시/뱅 커맨드 감산 계수 (타건 자체가 적음) */
  commandFactor: number;
  /** 몰입 구간(run) 완주 보너스 */
  runBonus: number;
  /** 보스 처치 보너스 */
  bossBonus: number;
  /** 스트릭 1일당 가산 비율 (최대 maxStreakBonusDays 일까지) */
  streakBonusPerDay: number;
  maxStreakBonusDays: number;
}

export interface Config {
  historyPath: string;
  dbPath: string;
  timeZone: string;
  /** 하루가 시작되는 로컬 시각(시). 4 = 새벽 4시 */
  dayStartHour: number;
  /** 이 시간 이상 입력이 없으면 몰입 구간을 끊는다(분) */
  idleBreakMinutes: number;
  boss: { minActiveMinutes: number; minPrompts: number };
  xp: XpConfig;
  port: number;
}

export const DEFAULT_CONFIG: Config = {
  historyPath: join(homedir(), '.claude', 'history.jsonl'),
  dbPath: join(homedir(), '.tamagit', 'data.db'),
  timeZone: process.env.TZ || 'Asia/Seoul',
  dayStartHour: 4,
  idleBreakMinutes: 30,
  boss: { minActiveMinutes: 60, minPrompts: 15 },
  xp: {
    base: 10,
    lengthWeight: 8,
    lengthScale: 20,
    multilineBonus: 5,
    pasteBonus: 6,
    commandFactor: 0.5,
    runBonus: 15,
    bossBonus: 200,
    streakBonusPerDay: 0.01,
    maxStreakBonusDays: 30,
  },
  port: 4173,
};

export interface CliOverrides {
  history?: string;
  db?: string;
  tz?: string;
  dayStart?: number;
  idle?: number;
  port?: number;
}

export function resolveConfig(o: CliOverrides = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    historyPath: o.history ?? DEFAULT_CONFIG.historyPath,
    dbPath: o.db ?? DEFAULT_CONFIG.dbPath,
    timeZone: o.tz ?? DEFAULT_CONFIG.timeZone,
    dayStartHour: o.dayStart ?? DEFAULT_CONFIG.dayStartHour,
    idleBreakMinutes: o.idle ?? DEFAULT_CONFIG.idleBreakMinutes,
    port: o.port ?? DEFAULT_CONFIG.port,
  };
}
