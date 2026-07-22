import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { makeClock, dayRange, addDays } from './clock.ts';
import { DEFAULT_CONFIG, resolveConfig } from './config.ts';
import { parseHistory } from './history.ts';
import { promptXp, levelFromXp, xpToNext, streakBonus } from './xp.ts';
import { buildRuns } from './runs.ts';
import { computeStreaks } from './streak.ts';
import { openDb, upsertPrompts, countPrompts, loadPrompts } from './db.ts';
import { petFor } from './pet.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tamagit-test-'));
const KST = 'Asia/Seoul';

describe('clock — 하루 경계 04:00', () => {
  const clock = makeClock(KST, 4);

  test('03:59 KST 는 전날로 귀속된다', () => {
    // 2026-07-15T18:59Z = 2026-07-16 03:59 KST
    assert.equal(clock.dayKey(Date.parse('2026-07-15T18:59:00Z')), '2026-07-15');
  });

  test('04:00 KST 부터 새 날이다', () => {
    assert.equal(clock.dayKey(Date.parse('2026-07-15T19:00:00Z')), '2026-07-16');
  });

  test('달력 날짜는 경계와 무관하다', () => {
    assert.equal(clock.calendarDay(Date.parse('2026-07-15T18:59:00Z')), '2026-07-16');
  });

  test('로컬 시각을 h23 으로 낸다', () => {
    assert.equal(clock.hour(Date.parse('2026-07-15T18:59:00Z')), 3);
    assert.equal(clock.hour(Date.parse('2026-07-15T15:00:00Z')), 0);
  });

  test('경계 0시 설정이면 달력과 같다', () => {
    const c0 = makeClock(KST, 0);
    assert.equal(c0.dayKey(Date.parse('2026-07-15T18:59:00Z')), '2026-07-16');
  });

  test('dayRange / addDays', () => {
    assert.deepEqual(dayRange('2026-07-01', '2026-07-04'), [
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04',
    ]);
    assert.equal(addDays('2026-07-31', 1), '2026-08-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
});

describe('history 파서 — 포맷 변화 방어', () => {
  const line = (o: Record<string, unknown>) => JSON.stringify(o);
  const good = {
    display: 'hi',
    pastedContents: {},
    timestamp: 1784701759245,
    project: '/p',
    sessionId: 's1',
  };

  function write(lines: string[]): string {
    const f = join(tmp(), 'history.jsonl');
    writeFileSync(f, lines.join('\n') + '\n');
    return f;
  }

  test('정상 레코드를 읽는다', () => {
    const r = parseHistory(write([line(good)]));
    assert.equal(r.prompts.length, 1);
    assert.equal(r.errors.length, 0);
    assert.equal(r.prompts[0]!.sessionId, 's1');
  });

  test('깨진 줄은 버리되 반드시 카운트한다', () => {
    const { timestamp, ...noTs } = good;
    const { sessionId, ...noSid } = good;
    const r = parseHistory(write([line(good), '{not json', line(noTs), line(noSid), '[1,2]']));
    assert.equal(r.prompts.length, 1);
    assert.equal(r.errors.length, 4); // JSON 깨짐 + ts 없음 + sessionId 없음 + 객체 아님
    assert.match(r.errors[0]!.reason, /JSON/);
    assert.match(r.errors[1]!.reason, /timestamp/);
    assert.match(r.errors[2]!.reason, /sessionId/);
  });

  test('빈 줄은 레코드로 세지 않는다', () => {
    const r = parseHistory(
      write([line(good), '', '   ', line({ ...good, timestamp: good.timestamp + 1 })]),
    );
    assert.equal(r.totalLines, 2);
    assert.equal(r.prompts.length, 2);
  });

  test('timestamp 가 초 단위로 바뀌어도 ms 로 보정한다', () => {
    const r = parseHistory(write([line({ ...good, timestamp: 1784701759 })]));
    assert.equal(r.prompts[0]!.ts, 1784701759000);
  });

  test('모르는 신규 필드는 통과시킨다 (forward-compatible)', () => {
    const r = parseHistory(write([line({ ...good, brandNewField: { a: 1 } })]));
    assert.equal(r.prompts.length, 1);
    assert.equal(r.errors.length, 0);
  });

  test('display 가 없어도 버리지 않는다 (XP 만 낮아진다)', () => {
    const { display, ...noDisplay } = good;
    const r = parseHistory(write([line(noDisplay)]));
    assert.equal(r.prompts.length, 1);
    assert.equal(r.prompts[0]!.charLen, 0);
  });

  test('파일 순서가 뒤섞여도 ts 오름차순으로 정렬한다', () => {
    const t = good.timestamp;
    const r = parseHistory(write([line({ ...good, timestamp: t + 2 }), line(good)]));
    assert.deepEqual(r.prompts.map((p) => p.ts), [t, t + 2]);
  });

  test('pastedContents 개수와 멀티라인/커맨드 플래그', () => {
    const t = good.timestamp;
    const r = parseHistory(
      write([
        line({ ...good, display: 'a\nb', pastedContents: { '1': {}, '2': {} } }),
        line({ ...good, timestamp: t + 1, display: '/init' }),
        line({ ...good, timestamp: t + 2, display: '!ls' }),
      ]),
    );
    assert.equal(r.prompts[0]!.pastedCount, 2);
    assert.equal(r.prompts[0]!.isMultiline, true);
    assert.equal(r.prompts.find((p) => p.display === '/init')!.isSlash, true);
    assert.equal(r.prompts.find((p) => p.display === '!ls')!.isBang, true);
  });
});

describe('XP', () => {
  const cfg = DEFAULT_CONFIG.xp;
  const mk = (over: Partial<Parameters<typeof promptXp>[0]> = {}) =>
    promptXp(
      {
        sessionId: 's', ts: 0, project: '/p', display: '', charLen: 0,
        isMultiline: false, isSlash: false, isBang: false, pastedCount: 0, ...over,
      },
      cfg,
    );

  test('길이가 길수록 XP 가 크다 (단조 증가)', () => {
    const xs = [0, 4, 36, 133, 372, 1184].map((charLen) => mk({ charLen }));
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i]! >= xs[i - 1]!, `${xs}`);
  });

  test('"진행시켜"(4자) 와 장문(1184자) 의 차이가 유의미하다', () => {
    assert.ok(mk({ charLen: 1184 }) >= mk({ charLen: 4 }) * 3);
  });

  test('로그 스케일이라 장문 하나가 하루를 끝내지 못한다', () => {
    // 1184자 1건 < 36자(p50) 5건
    assert.ok(mk({ charLen: 1184 }) < mk({ charLen: 36 }) * 5);
  });

  test('멀티라인/붙여넣기는 가산, 커맨드는 감산', () => {
    assert.ok(mk({ charLen: 36, isMultiline: true }) > mk({ charLen: 36 }));
    assert.ok(mk({ charLen: 36, pastedCount: 1 }) > mk({ charLen: 36 }));
    assert.ok(mk({ charLen: 36, isSlash: true }) < mk({ charLen: 36 }));
  });

  test('최소 1 XP 는 보장한다', () => {
    assert.ok(mk({ charLen: 0, isSlash: true }) >= 1);
  });

  test('레벨 계산이 xpToNext 와 왕복 일치한다', () => {
    assert.equal(levelFromXp(0).level, 1);
    let acc = 0;
    for (let lv = 1; lv <= 40; lv++) {
      acc += xpToNext(lv);
      assert.equal(levelFromXp(acc).level, lv + 1, `누적 ${acc} 에서 Lv.${lv + 1} 이어야 한다`);
      assert.equal(levelFromXp(acc - 1).level, lv);
    }
  });

  test('레벨 진행도는 0~1 범위다', () => {
    for (const xp of [0, 1, 499, 500, 12345, 100_275]) {
      const l = levelFromXp(xp);
      assert.ok(l.progress >= 0 && l.progress < 1.0001);
      assert.ok(l.intoLevel < l.needed);
    }
  });

  test('스트릭 보너스는 1일차 0, 31일차 이상 +30% 로 고정된다', () => {
    assert.equal(streakBonus(1000, 1, cfg), 0);
    assert.equal(streakBonus(1000, 11, cfg), 100);
    assert.equal(streakBonus(1000, 31, cfg), 300);
    assert.equal(streakBonus(1000, 999, cfg), 300);
  });
});

describe('runs — 몰입 구간과 보스전', () => {
  const cfg = resolveConfig();
  const clock = makeClock(KST, 4);
  const base = Date.parse('2026-07-15T01:00:00Z');
  const mk = (min: number, session = 's1') => ({
    sessionId: session, ts: base + min * 60_000, project: '/p',
  });

  test('유휴 30분 초과면 구간이 갈린다', () => {
    const runs = buildRuns([mk(0), mk(10), mk(45), mk(50)], cfg, clock);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.prompts), [2, 2]);
  });

  test('정확히 30분 간격은 같은 구간으로 잇는다', () => {
    assert.equal(buildRuns([mk(0), mk(30)], cfg, clock).length, 1);
  });

  test('세션이 다르면 시간이 붙어 있어도 구간이 다르다', () => {
    assert.equal(buildRuns([mk(0), mk(1, 's2')], cfg, clock).length, 2);
  });

  test('보스전: 60분 이상 AND 15건 이상', () => {
    const many = Array.from({ length: 15 }, (_, i) => mk(i * 5)); // 70분, 15건
    const [boss] = buildRuns(many, cfg, clock);
    assert.equal(boss!.isBoss, true);
    assert.equal(boss!.xp, cfg.xp.runBonus + cfg.xp.bossBonus);
  });

  test('길기만 하고 프롬프트가 적으면 보스가 아니다 (자리비움 방어)', () => {
    // 스파이크 §2 의 1,473분/15프롬프트 세션이 보스로 잡히면 안 된다
    const sparse = Array.from({ length: 10 }, (_, i) => mk(i * 25)); // 225분, 10건
    const runs = buildRuns(sparse, cfg, clock);
    assert.ok(runs.every((r) => !r.isBoss));
  });

  test('건수만 많고 짧으면 보스가 아니다', () => {
    const burst = Array.from({ length: 40 }, (_, i) => mk(i * 0.5)); // 20분, 40건
    const [r] = buildRuns(burst, cfg, clock);
    assert.equal(r!.isBoss, false);
  });

  test('구간은 종료 시각의 날짜에 귀속된다', () => {
    const [r] = buildRuns([mk(0), mk(10)], cfg, clock);
    assert.equal(r!.day, clock.dayKey(base + 10 * 60_000));
  });
});

describe('streak', () => {
  test('연속/최장을 센다', () => {
    const s = computeStreaks(
      ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-05'],
      '2026-07-05',
    );
    assert.equal(s.longest, 3);
    assert.equal(s.current, 1);
    assert.equal(s.lengthAt.get('2026-07-03'), 3);
  });

  test('어제까지 이어졌으면 유지하되 atRisk 로 표시한다', () => {
    const s = computeStreaks(['2026-07-04', '2026-07-05'], '2026-07-06');
    assert.equal(s.current, 2);
    assert.equal(s.atRisk, true);
  });

  test('이틀 이상 비면 끊긴다', () => {
    const s = computeStreaks(['2026-07-04', '2026-07-05'], '2026-07-08');
    assert.equal(s.current, 0);
    assert.equal(s.atRisk, false);
  });

  test('활동이 없으면 0', () => {
    const s = computeStreaks([], '2026-07-08');
    assert.equal(s.current, 0);
    assert.equal(s.longest, 0);
  });
});

describe('db — 멱등 적재 (30일 삭제 방어의 핵심)', () => {
  const row = (ts: number) => ({
    sessionId: 's1', ts, project: '/p', charLen: 10, isMultiline: false,
    isSlash: false, isBang: false, pastedCount: 0, day: '2026-07-15', hour: 12, xp: 20,
  });

  test('같은 데이터를 두 번 넣어도 늘지 않는다', () => {
    const db = openDb(join(tmp(), 'a.db'));
    assert.equal(upsertPrompts(db, [row(1), row(2)]), 2);
    assert.equal(upsertPrompts(db, [row(1), row(2)]), 0);
    assert.equal(countPrompts(db), 2);
    db.close();
  });

  test('원본이 사라져도 DB 행은 남는다', () => {
    const f = join(tmp(), 'b.db');
    const db1 = openDb(f);
    upsertPrompts(db1, [row(1), row(2), row(3)]);
    db1.close();
    // 원본 파일 없이 다시 열어도 그대로
    const db2 = openDb(f);
    assert.equal(countPrompts(db2), 3);
    assert.equal(loadPrompts(db2).length, 3);
    db2.close();
  });

  test('(sessionId, ts) 가 다르면 별개 행이다', () => {
    const db = openDb(join(tmp(), 'c.db'));
    upsertPrompts(db, [row(1), { ...row(1), sessionId: 's2' }]);
    assert.equal(countPrompts(db), 2);
    db.close();
  });

  test('저장한 값이 그대로 돌아온다', () => {
    const db = openDb(join(tmp(), 'd.db'));
    upsertPrompts(db, [{ ...row(9), isMultiline: true, isSlash: true, pastedCount: 3 }]);
    const [got] = loadPrompts(db);
    assert.equal(got!.isMultiline, true);
    assert.equal(got!.isSlash, true);
    assert.equal(got!.pastedCount, 3);
    db.close();
  });
});

describe('pet', () => {
  test('레벨에 따라 진화한다', () => {
    assert.equal(petFor(1, 10, 1, false).stage, 0);
    assert.equal(petFor(6, 10, 1, false).stage, 2);
    assert.equal(petFor(13, 10, 1, false).stage, 3);
    assert.equal(petFor(999, 10, 1, false).stage, 5);
    assert.equal(petFor(999, 10, 1, false).nextLevel, null);
  });

  test('오늘 활동이 없으면 잠들거나 심심해한다', () => {
    assert.equal(petFor(10, 0, 5, false).mood, 'asleep');
    assert.equal(petFor(10, 0, 5, true).mood, 'bored');
  });

  test('많이 하면 불탄다', () => {
    assert.equal(petFor(10, 200, 1, false).mood, 'blazing');
    assert.equal(petFor(10, 60, 1, false).mood, 'happy');
  });
});

describe('회귀 — 실제 history.jsonl 포맷 감시', () => {
  const real = join(homedir(), '.claude', 'history.jsonl');
  const EXPECTED_KEYS = ['display', 'pastedContents', 'project', 'sessionId', 'timestamp'];

  test('필드 조합이 스파이크 시점(2026-07-22)과 같다', { skip: !existsSync(real) }, () => {
    const shapes = new Set<string>();
    for (const l of readFileSync(real, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        shapes.add(Object.keys(JSON.parse(l)).sort().join(','));
      } catch { /* 아래 테스트에서 잡는다 */ }
    }
    // 포맷이 바뀌면 여기서 터진다 = 파서를 고쳐야 한다는 신호
    assert.deepEqual([...shapes], [EXPECTED_KEYS.join(',')]);
  });

  test('파싱 실패가 0건이다', { skip: !existsSync(real) }, () => {
    const r = parseHistory(real);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors.slice(0, 3)));
    assert.ok(r.prompts.length > 0);
  });

  test('(sessionId, ts) 가 유일하다 = 멱등 키로 쓸 수 있다', { skip: !existsSync(real) }, () => {
    const r = parseHistory(real);
    const keys = new Set(r.prompts.map((p) => `${p.sessionId}#${p.ts}`));
    assert.equal(keys.size, r.prompts.length);
  });

  test('한 세션은 한 프로젝트에만 속한다', { skip: !existsSync(real) }, () => {
    const r = parseHistory(real);
    const m = new Map<string, string>();
    for (const p of r.prompts) {
      const prev = m.get(p.sessionId);
      if (prev === undefined) m.set(p.sessionId, p.project);
      else assert.equal(prev, p.project, `세션 ${p.sessionId} 가 프로젝트를 넘나든다`);
    }
  });
});
