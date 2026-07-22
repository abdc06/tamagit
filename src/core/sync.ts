import { existsSync } from 'node:fs';
import { makeClock } from './clock.ts';
import type { Config } from './config.ts';
import {
  getMeta,
  loadPrompts,
  logSync,
  openDb,
  recordAchievements,
  replaceRuns,
  setMeta,
  upsertPrompts,
} from './db.ts';
import { parseHistory, type ParseError } from './history.ts';
import { buildRuns } from './runs.ts';
import { promptXp } from './xp.ts';
import { evaluateAchievements, type PromptRow } from './achievements.ts';
import { buildContext, buildStats } from './stats.ts';
import { decideNudges, sendNotification, type Nudge } from './notify.ts';

export interface SyncResult {
  sourceRows: number;
  newRows: number;
  totalRows: number;
  parseErrors: ParseError[];
  runs: number;
  bosses: number;
  newAchievements: string[];
  skipped?: string;
  /** --notify 로 실행했을 때 실제로 띄운 알림 */
  nudges: Nudge[];
}

export interface SyncOptions {
  /** 레벨업·새 업적·스트릭 위험을 OS 알림으로 띄운다 */
  notify?: boolean;
}

/**
 * history.jsonl → 로컬 DB 적재.
 * 원본이 30일 뒤 사라져도 DB 는 남으므로, 이 함수가 도구의 핵심 계약이다.
 */
export function sync(cfg: Config, now = Date.now(), opts: SyncOptions = {}): SyncResult {
  const db = openDb(cfg.dbPath);
  const clock = makeClock(cfg.timeZone, cfg.dayStartHour);

  let sourceRows = 0;
  let newRows = 0;
  let parseErrors: ParseError[] = [];
  let skipped: string | undefined;

  if (!existsSync(cfg.historyPath)) {
    // 원본이 없어도 DB 에 쌓아둔 기록으로 계속 논다 — 이게 30일 삭제 방어의 실제 동작이다
    skipped = `원본 없음: ${cfg.historyPath}`;
  } else {
    const parsed = parseHistory(cfg.historyPath);
    sourceRows = parsed.totalLines;
    parseErrors = parsed.errors;

    const rows: PromptRow[] = parsed.prompts.map((p) => ({
      sessionId: p.sessionId,
      ts: p.ts,
      project: p.project,
      charLen: p.charLen,
      isMultiline: p.isMultiline,
      isSlash: p.isSlash,
      isBang: p.isBang,
      pastedCount: p.pastedCount,
      day: clock.dayKey(p.ts),
      hour: clock.hour(p.ts),
      xp: promptXp(p, cfg.xp),
    }));

    newRows = upsertPrompts(db, rows);
    setMeta(db, 'last_source_mtime', String(parsed.mtime));
    setMeta(db, 'last_source_bytes', String(parsed.bytes));
  }

  // run/보스전은 DB 전체(원본에서 이미 사라진 과거 포함)를 기준으로 다시 만든다
  const all = loadPrompts(db);
  const runs = buildRuns(all, cfg, clock);
  replaceRuns(db, runs);

  const ctx = buildContext(all, runs, clock, now);
  const states = evaluateAchievements(ctx);
  const unlocked = states
    .filter((s) => s.unlockedAt !== null)
    .map((s) => ({ id: s.id, unlockedAt: s.unlockedAt! }));
  const newAchievements = recordAchievements(db, unlocked, now);

  setMeta(db, 'last_sync_at', String(now));
  setMeta(db, 'day_start_hour', String(cfg.dayStartHour));
  setMeta(db, 'time_zone', cfg.timeZone);
  logSync(db, { ranAt: now, sourceRows, newRows, parseErrors: parseErrors.length });

  const prevLevelRaw = getMeta(db, 'last_notified_level');
  const prevNagDay = getMeta(db, 'last_streak_nag_day');
  db.close();

  const nudges = opts.notify
    ? fireNudges(cfg, now, newAchievements, prevLevelRaw, prevNagDay)
    : [];

  return {
    sourceRows,
    newRows,
    totalRows: all.length,
    parseErrors,
    runs: runs.length,
    bosses: runs.filter((r) => r.isBoss).length,
    newAchievements,
    skipped,
    nudges,
  };
}

/**
 * 알림 판단 → 발송 → 상태 저장.
 * 첫 실행에는 아무것도 띄우지 않는다 (과거 30일치를 몰아서 축하하면 스팸이 된다).
 */
function fireNudges(
  cfg: Config,
  now: number,
  newAchievements: string[],
  prevLevelRaw: string | null,
  prevNagDay: string | null,
): Nudge[] {
  const stats = buildStats(cfg, now);
  const { nudges, nextState } = decideNudges(stats, newAchievements, {
    lastNotifiedLevel: prevLevelRaw === null ? null : Number(prevLevelRaw),
    lastStreakNagDay: prevNagDay,
  });

  for (const n of nudges) sendNotification(n);

  const db = openDb(cfg.dbPath);
  setMeta(db, 'last_notified_level', String(nextState.lastNotifiedLevel ?? stats.level.level));
  if (nextState.lastStreakNagDay) setMeta(db, 'last_streak_nag_day', nextState.lastStreakNagDay);
  db.close();

  return nudges;
}
