import { existsSync } from 'node:fs';
import { makeClock } from './clock.ts';
import type { Config } from './config.ts';
import {
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
import { buildContext } from './stats.ts';

export interface SyncResult {
  sourceRows: number;
  newRows: number;
  totalRows: number;
  parseErrors: ParseError[];
  runs: number;
  bosses: number;
  newAchievements: string[];
  skipped?: string;
}

/**
 * history.jsonl → 로컬 DB 적재.
 * 원본이 30일 뒤 사라져도 DB 는 남으므로, 이 함수가 도구의 핵심 계약이다.
 */
export function sync(cfg: Config, now = Date.now()): SyncResult {
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
  db.close();

  return {
    sourceRows,
    newRows,
    totalRows: all.length,
    parseErrors,
    runs: runs.length,
    bosses: runs.filter((r) => r.isBoss).length,
    newAchievements,
    skipped,
  };
}
