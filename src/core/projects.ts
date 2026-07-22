import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * 프로젝트 경로 정규화.
 *
 * 프로젝트는 절대경로로 식별된다 — Claude Code 가 그 경로로 기록하기 때문이다.
 * 폴더 이름을 바꾸면 같은 작업이 DB 안에서 서로 다른 두 프로젝트가 되고,
 * 프롬프트 수·보스전·"프로젝트 N곳" 이 전부 쪼개진다.
 *
 * 자동 판정은 하지 않는다 — 개명과 "그냥 다른 프로젝트"를 경로만 보고 구분할 수 없다.
 * 대신 사용자가 한 번 별칭을 등록하면, 그 뒤로는 sync 가 매번
 *   (1) 새로 들어오는 행을 적재 시점에 새 경로로 바꾸고
 *   (2) DB 에 이미 쌓인 옛 경로 행도 같이 옮긴다.
 * 그래서 개명 직후 열려 있던 세션이 뒤늦게 옛 경로로 들어와도 다시 쪼개지지 않는다.
 */

export interface Alias {
  from: string;
  to: string;
  createdAt: number;
}

export interface ProjectSummary {
  project: string;
  prompts: number;
  xp: number;
  lastTs: number;
  /** 경로가 디스크에 아직 있는가 — 없으면 개명·삭제 후보다 */
  exists: boolean;
}

/** 표기 흔들림만 걷어낸다. 심볼릭 링크는 풀지 않는다 (원본 기록과 어긋나면 더 헷갈린다) */
export function canonical(p: string): string {
  const t = p.trim();
  return t.length > 1 ? t.replace(/\/+$/, '') : t;
}

/** `~/x` 와 상대경로를 절대경로로 편다 */
export function expandPath(input: string): string {
  const t = input.trim();
  if (t === '~') return homedir();
  if (t.startsWith('~/')) return canonical(resolve(homedir(), t.slice(2)));
  return canonical(resolve(t));
}

const MAX_HOPS = 16;

/** 별칭 사슬(a→b→c)을 끝까지 따라간다. 순환은 들어온 지점에서 끊는다. */
export function resolveProject(aliases: Map<string, string>, project: string): string {
  let cur = canonical(project);
  if (aliases.size === 0) return cur;
  const seen = new Set([cur]);
  for (let i = 0; i < MAX_HOPS; i++) {
    const next = aliases.get(cur);
    if (!next || seen.has(next)) break;
    cur = next;
    seen.add(next);
  }
  return cur;
}

export function loadAliases(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare('SELECT from_path, to_path FROM project_aliases').all() as Array<{
    from_path: string;
    to_path: string;
  }>;
  return new Map(rows.map((r) => [r.from_path, r.to_path]));
}

export function listAliases(db: DatabaseSync): Alias[] {
  const rows = db
    .prepare('SELECT from_path, to_path, created_at FROM project_aliases ORDER BY created_at ASC')
    .all() as Array<{ from_path: string; to_path: string; created_at: number }>;
  return rows.map((r) => ({ from: r.from_path, to: r.to_path, createdAt: r.created_at }));
}

export type AddAliasResult = { ok: true } | { ok: false; reason: 'same' | 'cycle' };

export function addAlias(db: DatabaseSync, from: string, to: string, now: number): AddAliasResult {
  const f = canonical(from);
  const t = canonical(to);
  if (f === t) return { ok: false, reason: 'same' };

  // to 가 이미 f 로 돌아오는 사슬이면 순환이다 — 등록 전에 막는다
  const current = loadAliases(db);
  if (resolveProject(current, t) === f) return { ok: false, reason: 'cycle' };

  db.prepare(
    'INSERT OR REPLACE INTO project_aliases(from_path, to_path, created_at) VALUES (?, ?, ?)',
  ).run(f, t, now);
  return { ok: true };
}

export function removeAlias(db: DatabaseSync, from: string): boolean {
  const before = listAliases(db).length;
  db.prepare('DELETE FROM project_aliases WHERE from_path = ?').run(canonical(from));
  return listAliases(db).length < before;
}

/**
 * DB 에 이미 쌓인 행을 별칭대로 옮긴다. 옮긴 행 수를 돌려준다.
 * 멱등 키는 (session_id, ts) 라 project 를 바꿔도 중복은 생기지 않는다.
 */
export function applyAliases(db: DatabaseSync, aliases: Map<string, string>): number {
  if (aliases.size === 0) return 0;
  const projects = (
    db.prepare('SELECT DISTINCT project FROM prompts').all() as Array<{ project: string }>
  ).map((r) => r.project);

  const moves = projects
    .map((p) => ({ from: p, to: resolveProject(aliases, p) }))
    .filter((m) => m.from !== m.to);
  if (moves.length === 0) return 0;

  const stmtP = db.prepare('UPDATE prompts SET project = ? WHERE project = ?');
  const stmtR = db.prepare('UPDATE runs SET project = ? WHERE project = ?');
  let moved = 0;
  db.exec('BEGIN');
  try {
    for (const m of moves) {
      moved += Number(stmtP.run(m.to, m.from).changes ?? 0);
      stmtR.run(m.to, m.from);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return moved;
}

export function projectSummaries(db: DatabaseSync): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT project, COUNT(*) AS prompts, SUM(xp) AS xp, MAX(ts) AS last_ts
       FROM prompts GROUP BY project ORDER BY prompts DESC`,
    )
    .all() as Array<{ project: string; prompts: number; xp: number; last_ts: number }>;
  return rows.map((r) => ({
    project: r.project,
    prompts: r.prompts,
    xp: r.xp ?? 0,
    lastTs: r.last_ts,
    exists: existsSync(r.project),
  }));
}

/**
 * 절대경로(또는 `~/…`)로 준 것만 "새 경로"로 인정한다.
 * 맨이름(`code-rpg`)을 cwd 기준으로 펴면 존재하지도 않는 하위 폴더가 조용히 만들어진다 —
 * 실제로 `merge tamagit code-rpg` 가 `…/tamagit/code-rpg` 로 둔갑했다.
 */
export function isExplicitPath(input: string): boolean {
  const t = input.trim();
  return t.startsWith('/') || t === '~' || t.startsWith('~/');
}

export type MatchResult =
  | { ok: true; project: string }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] };

/**
 * 사용자가 친 문자열을 알려진 프로젝트 경로로 해석한다.
 * 전체 경로를 매번 치게 하면 아무도 안 쓰므로 꼬리 조각(`code-rpg`)도 받는다 —
 * 대신 후보가 둘 이상이면 고르지 않고 되묻는다.
 */
export function matchProject(known: string[], input: string): MatchResult {
  const raw = canonical(input);
  if (!raw) return { ok: false, reason: 'none' };
  if (known.includes(raw)) return { ok: true, project: raw };

  const abs = expandPath(raw);
  if (known.includes(abs)) return { ok: true, project: abs };

  const suffix = raw.startsWith('/') ? raw : `/${raw}`;
  const hits = known.filter((k) => k.endsWith(suffix));
  if (hits.length === 1) return { ok: true, project: hits[0]! };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', candidates: hits.sort() };
  return { ok: false, reason: 'none' };
}
