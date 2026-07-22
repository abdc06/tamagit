import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { openDb, upsertPrompts, loadPrompts } from './db.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { sync } from './sync.ts';
import {
  addAlias,
  applyAliases,
  canonical,
  expandPath,
  isExplicitPath,
  listAliases,
  loadAliases,
  matchProject,
  projectSummaries,
  removeAlias,
  resolveProject,
} from './projects.ts';
import type { PromptRow } from './achievements.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tamagit-proj-'));

const OLD = '/Users/x/Workspace/Projects/code-rpg';
const NEW = '/Users/x/Workspace/Projects/tamagit';

function row(project: string, ts: number, session = 's1'): PromptRow {
  return {
    sessionId: session,
    ts,
    project,
    charLen: 10,
    isMultiline: false,
    isSlash: false,
    isBang: false,
    pastedCount: 0,
    day: '2026-07-22',
    hour: 12,
    xp: 10,
  };
}

describe('경로 정규화', () => {
  test('끝 슬래시만 걷어낸다', () => {
    assert.equal(canonical('/a/b/'), '/a/b');
    assert.equal(canonical('  /a/b//  '), '/a/b');
    assert.equal(canonical('/'), '/');
  });

  test('~ 와 상대경로를 절대경로로 편다', () => {
    assert.equal(expandPath('~'), homedir());
    assert.equal(expandPath('~/p/q'), join(homedir(), 'p/q'));
    assert.equal(expandPath('/a/b'), '/a/b');
    assert.ok(expandPath('rel').startsWith('/'));
  });

  test('맨이름은 "새 경로"로 인정하지 않는다 — cwd 로 펴지면 엉뚱한 경로가 굳는다', () => {
    assert.equal(isExplicitPath('/a/b'), true);
    assert.equal(isExplicitPath('~/a'), true);
    assert.equal(isExplicitPath('~'), true);
    assert.equal(isExplicitPath('code-rpg'), false);
    assert.equal(isExplicitPath('Projects/tamagit'), false);
    assert.equal(isExplicitPath('./x'), false);
  });
});

describe('별칭 해석', () => {
  test('사슬을 끝까지 따라간다 (a→b→c)', () => {
    const m = new Map([
      ['/a', '/b'],
      ['/b', '/c'],
    ]);
    assert.equal(resolveProject(m, '/a'), '/c');
    assert.equal(resolveProject(m, '/b'), '/c');
    assert.equal(resolveProject(m, '/z'), '/z');
  });

  test('순환이 있어도 멈춘다', () => {
    const m = new Map([
      ['/a', '/b'],
      ['/b', '/a'],
    ]);
    // 무한루프 없이 값이 나오기만 하면 된다 (둘 중 하나로 수렴)
    assert.ok(['/a', '/b'].includes(resolveProject(m, '/a')));
  });

  test('빈 규칙이면 입력을 그대로 (끝 슬래시만 정리해서) 돌려준다', () => {
    assert.equal(resolveProject(new Map(), '/a/b/'), '/a/b');
  });
});

describe('별칭 등록', () => {
  const db = () => openDb(join(tmp(), 'db.sqlite'));

  test('등록하면 sync 없이도 기존 행이 옮겨진다', () => {
    const d = db();
    upsertPrompts(d, [row(OLD, 1000), row(OLD, 2000), row(NEW, 3000)]);
    assert.equal(addAlias(d, OLD, NEW, 1).ok, true);

    const moved = applyAliases(d, loadAliases(d));
    assert.equal(moved, 2);
    assert.deepEqual(new Set(loadPrompts(d).map((p) => p.project)), new Set([NEW]));
    d.close();
  });

  test('같은 경로끼리는 거부한다', () => {
    const d = db();
    assert.deepEqual(addAlias(d, OLD, `${OLD}/`, 1), { ok: false, reason: 'same' });
    d.close();
  });

  test('순환이 되는 등록은 거부한다', () => {
    const d = db();
    addAlias(d, OLD, NEW, 1);
    assert.deepEqual(addAlias(d, NEW, OLD, 2), { ok: false, reason: 'cycle' });
    d.close();
  });

  test('해제해도 이미 옮긴 행은 되돌리지 않는다', () => {
    const d = db();
    upsertPrompts(d, [row(OLD, 1000)]);
    addAlias(d, OLD, NEW, 1);
    applyAliases(d, loadAliases(d));

    assert.equal(removeAlias(d, OLD), true);
    assert.equal(removeAlias(d, OLD), false);
    assert.equal(listAliases(d).length, 0);
    assert.deepEqual(loadPrompts(d).map((p) => p.project), [NEW]);
    d.close();
  });

  test('적용할 규칙이 없으면 아무 행도 건드리지 않는다', () => {
    const d = db();
    upsertPrompts(d, [row(NEW, 1000)]);
    assert.equal(applyAliases(d, loadAliases(d)), 0);
    d.close();
  });
});

describe('프로젝트 집계', () => {
  test('프롬프트 많은 순으로, 존재 여부와 함께 낸다', () => {
    const d = openDb(join(tmp(), 'db.sqlite'));
    const here = process.cwd();
    upsertPrompts(d, [row(OLD, 1000), row(here, 2000), row(here, 3000)]);
    const s = projectSummaries(d);
    assert.deepEqual(s.map((x) => x.project), [here, OLD]);
    assert.deepEqual(s.map((x) => x.prompts), [2, 1]);
    assert.equal(s[0]!.exists, true);
    assert.equal(s[1]!.exists, false); // 가짜 경로 — 디스크에 없다
    assert.equal(s[0]!.xp, 20);
    d.close();
  });
});

describe('사용자 입력 → 프로젝트 해석', () => {
  const known = [OLD, NEW, '/Users/x/LLM-Dev/paladin', '/Users/x/Projects/paladin'];

  test('전체 경로', () => {
    assert.deepEqual(matchProject(known, NEW), { ok: true, project: NEW });
    assert.deepEqual(matchProject(known, `${NEW}/`), { ok: true, project: NEW });
  });

  test('끝 폴더 이름만 줘도 유일하면 잡는다', () => {
    assert.deepEqual(matchProject(known, 'code-rpg'), { ok: true, project: OLD });
    assert.deepEqual(matchProject(known, 'Projects/tamagit'), { ok: true, project: NEW });
  });

  test('후보가 여럿이면 고르지 않고 되묻는다', () => {
    assert.deepEqual(matchProject(known, 'paladin'), {
      ok: false,
      reason: 'ambiguous',
      candidates: ['/Users/x/LLM-Dev/paladin', '/Users/x/Projects/paladin'],
    });
  });

  test('없으면 없다고 한다', () => {
    assert.deepEqual(matchProject(known, 'nope'), { ok: false, reason: 'none' });
    assert.deepEqual(matchProject([], 'nope'), { ok: false, reason: 'none' });
  });
});

describe('sync 통합 — 개명 이후에도 다시 쪼개지지 않는다', () => {
  test('옛 경로로 새로 들어온 행도 적재 시점에 새 경로가 된다', () => {
    const dir = tmp();
    const historyPath = join(dir, 'history.jsonl');
    const dbPath = join(dir, 'db.sqlite');
    const cfg = { ...DEFAULT_CONFIG, historyPath, dbPath, lang: 'en' as const };

    const line = (ts: number, project: string) =>
      JSON.stringify({ display: 'hi', pastedContents: {}, timestamp: ts, project, sessionId: 's1' });

    // 1) 개명 전 기록 2건
    writeHistory(historyPath, [line(1_784_000_000_000, OLD), line(1_784_000_060_000, OLD)]);
    sync(cfg, 1_784_000_100_000);

    // 2) 별칭 등록
    const d = openDb(dbPath);
    addAlias(d, OLD, NEW, 1_784_000_100_000);
    d.close();

    // 3) 개명 직후 열려 있던 세션이 뒤늦게 옛 경로로 한 건 더 남긴다
    writeHistory(historyPath, [
      line(1_784_000_000_000, OLD),
      line(1_784_000_060_000, OLD),
      line(1_784_000_120_000, OLD),
    ]);
    const r = sync(cfg, 1_784_000_200_000);

    const d2 = openDb(dbPath);
    const projects = new Set(loadPrompts(d2).map((p) => p.project));
    d2.close();

    assert.equal(r.newRows, 1);
    assert.equal(r.remappedRows, 2); // 별칭 등록 전에 쌓여 있던 2건
    assert.deepEqual(projects, new Set([NEW]));
  });
});

function writeHistory(path: string, lines: string[]): void {
  writeFileSync(path, lines.join('\n') + '\n');
}
