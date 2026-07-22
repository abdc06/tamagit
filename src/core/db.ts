import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PromptRow } from './achievements.ts';
import type { Run } from './runs.ts';

/**
 * 로컬 DB. 이 테이블이 곧 도구의 존재이유다 —
 * 원본 history.jsonl 은 30일 뒤 사라지지만(스파이크 §1: 실측 28.9일치만 남아있음)
 * 여기 적재된 행은 남는다.
 *
 * 멱등 키는 (session_id, ts). 실측 3,666건에서 이 조합의 중복은 0건이었다.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prompts (
  session_id   TEXT    NOT NULL,
  ts           INTEGER NOT NULL,
  project      TEXT    NOT NULL,
  char_len     INTEGER NOT NULL,
  is_multiline INTEGER NOT NULL,
  is_slash     INTEGER NOT NULL,
  is_bang      INTEGER NOT NULL,
  pasted_count INTEGER NOT NULL,
  day          TEXT    NOT NULL,
  hour         INTEGER NOT NULL,
  xp           INTEGER NOT NULL,
  PRIMARY KEY (session_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_prompts_day ON prompts(day);
CREATE INDEX IF NOT EXISTS idx_prompts_ts  ON prompts(ts);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT    PRIMARY KEY,
  session_id     TEXT    NOT NULL,
  project        TEXT    NOT NULL,
  day            TEXT    NOT NULL,
  start_ts       INTEGER NOT NULL,
  end_ts         INTEGER NOT NULL,
  prompts        INTEGER NOT NULL,
  active_minutes REAL    NOT NULL,
  is_boss        INTEGER NOT NULL,
  xp             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_day ON runs(day);

CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  unlocked_at INTEGER NOT NULL,
  first_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at       INTEGER NOT NULL,
  source_rows  INTEGER NOT NULL,
  new_rows     INTEGER NOT NULL,
  parse_errors INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 프로젝트는 절대경로로 식별된다. 폴더 이름을 바꾸면 같은 프로젝트가 둘로 쪼개지므로,
-- 옛 경로 → 새 경로 매핑을 여기 남기고 sync 가 적재 시점마다 적용한다.
CREATE TABLE IF NOT EXISTS project_aliases (
  from_path  TEXT    PRIMARY KEY,
  to_path    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export const SCHEMA_VERSION = '2';

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    SCHEMA_VERSION,
  );
  return db;
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value);
}

/** 프롬프트 멱등 적재. 새로 들어간 행 수를 돌려준다. */
export function upsertPrompts(db: DatabaseSync, rows: PromptRow[]): number {
  const before = countPrompts(db);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO prompts
      (session_id, ts, project, char_len, is_multiline, is_slash, is_bang, pasted_count, day, hour, xp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(
        r.sessionId,
        r.ts,
        r.project,
        r.charLen,
        r.isMultiline ? 1 : 0,
        r.isSlash ? 1 : 0,
        r.isBang ? 1 : 0,
        r.pastedCount,
        r.day,
        r.hour,
        r.xp,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return countPrompts(db) - before;
}

export function countPrompts(db: DatabaseSync): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number };
  return r.n;
}

export function replaceRuns(db: DatabaseSync, runs: Run[]): void {
  const stmt = db.prepare(`
    INSERT INTO runs
      (id, session_id, project, day, start_ts, end_ts, prompts, active_minutes, is_boss, xp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM runs');
    for (const r of runs) {
      stmt.run(
        r.id,
        r.sessionId,
        r.project,
        r.day,
        r.startTs,
        r.endTs,
        r.prompts,
        r.activeMinutes,
        r.isBoss ? 1 : 0,
        r.xp,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 모든 프롬프트를 ts 오름차순으로 읽는다 (DB 가 원본보다 오래 산다) */
export function loadPrompts(db: DatabaseSync): PromptRow[] {
  const rows = db
    .prepare(
      `SELECT session_id, ts, project, char_len, is_multiline, is_slash, is_bang,
              pasted_count, day, hour, xp
       FROM prompts ORDER BY ts ASC`,
    )
    .all() as Array<Record<string, number | string>>;
  return rows.map((r) => ({
    sessionId: r.session_id as string,
    ts: r.ts as number,
    project: r.project as string,
    charLen: r.char_len as number,
    isMultiline: !!r.is_multiline,
    isSlash: !!r.is_slash,
    isBang: !!r.is_bang,
    pastedCount: r.pasted_count as number,
    day: r.day as string,
    hour: r.hour as number,
    xp: r.xp as number,
  }));
}

export function loadRuns(db: DatabaseSync): Run[] {
  const rows = db
    .prepare(`SELECT * FROM runs ORDER BY start_ts ASC`)
    .all() as Array<Record<string, number | string>>;
  return rows.map((r) => ({
    id: r.id as string,
    sessionId: r.session_id as string,
    project: r.project as string,
    day: r.day as string,
    startTs: r.start_ts as number,
    endTs: r.end_ts as number,
    prompts: r.prompts as number,
    activeMinutes: r.active_minutes as number,
    isBoss: !!r.is_boss,
    xp: r.xp as number,
  }));
}

/** 새로 잠금 해제된 업적 id 목록을 돌려준다 */
export function recordAchievements(
  db: DatabaseSync,
  unlocked: Array<{ id: string; unlockedAt: number }>,
  now: number,
): string[] {
  const known = new Set(
    (db.prepare('SELECT id FROM achievements').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO achievements(id, unlocked_at, first_seen) VALUES (?, ?, ?)',
  );
  const fresh: string[] = [];
  db.exec('BEGIN');
  try {
    for (const a of unlocked) {
      if (!known.has(a.id)) fresh.push(a.id);
      stmt.run(a.id, a.unlockedAt, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return fresh;
}

export function logSync(
  db: DatabaseSync,
  entry: { ranAt: number; sourceRows: number; newRows: number; parseErrors: number },
): void {
  db.prepare(
    'INSERT INTO sync_log(ran_at, source_rows, new_rows, parse_errors) VALUES (?, ?, ?, ?)',
  ).run(entry.ranAt, entry.sourceRows, entry.newRows, entry.parseErrors);
}

export interface SyncLogRow {
  ran_at: number;
  source_rows: number;
  new_rows: number;
  parse_errors: number;
}

export function recentSyncs(db: DatabaseSync, limit = 10): SyncLogRow[] {
  return db
    .prepare('SELECT ran_at, source_rows, new_rows, parse_errors FROM sync_log ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as SyncLogRow[];
}
