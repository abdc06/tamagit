import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPlist,
  installHook,
  isHookInstalled,
  uninstallHook,
  AGENT_LABEL,
} from './install.ts';
import { decideNudges, type NudgeState } from './notify.ts';
import type { Stats } from './stats.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'tamagit-install-'));
const NODE = '/opt/homebrew/bin/node';
const CLI = '/Users/x/tamagit/src/cli.ts';

function settingsFile(contents?: unknown): string {
  const f = join(tmp(), 'settings.json');
  if (contents !== undefined) writeFileSync(f, JSON.stringify(contents, null, 2));
  return f;
}
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Record<string, any>;

describe('훅 설치 — 남의 설정을 절대 건드리지 않는다', () => {
  test('파일이 없으면 새로 만든다', () => {
    const f = join(tmp(), 'settings.json');
    const r = installHook(f, NODE, CLI);
    assert.equal(r.changed, true);
    assert.equal(read(f).hooks.SessionEnd.length, 1);
    assert.equal(isHookInstalled(f), true);
  });

  test('기존 설정을 보존한다', () => {
    const f = settingsFile({ theme: 'dark', permissions: { defaultMode: 'auto' } });
    installHook(f, NODE, CLI);
    const s = read(f);
    assert.equal(s.theme, 'dark');
    assert.equal(s.permissions.defaultMode, 'auto');
    assert.ok(s.hooks.SessionEnd);
  });

  test('같은 이벤트에 있던 남의 훅을 밀어내지 않는다', () => {
    const other = { hooks: [{ type: 'command', command: 'echo bye' }] };
    const f = settingsFile({ hooks: { SessionEnd: [other] } });
    installHook(f, NODE, CLI);
    const groups = read(f).hooks.SessionEnd;
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0], other);
  });

  test('다른 이벤트의 훅도 그대로 둔다', () => {
    const f = settingsFile({
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'fmt' }] }] },
    });
    installHook(f, NODE, CLI);
    assert.equal(read(f).hooks.PostToolUse.length, 1);
  });

  test('두 번 설치해도 중복되지 않는다 (멱등)', () => {
    const f = join(tmp(), 'settings.json');
    installHook(f, NODE, CLI);
    const second = installHook(f, NODE, CLI);
    assert.equal(second.changed, false);
    assert.equal(read(f).hooks.SessionEnd.length, 1);
  });

  test('경로가 바뀌면 새로 추가하지 않고 갱신한다', () => {
    const f = join(tmp(), 'settings.json');
    installHook(f, NODE, CLI);
    const r = installHook(f, NODE, '/new/path/tamagit/src/cli.ts');
    assert.equal(r.changed, true);
    const groups = read(f).hooks.SessionEnd;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].hooks[0].args[0], '/new/path/tamagit/src/cli.ts');
  });

  test('셸을 거치지 않는 exec 형태로 심는다 (경로에 공백이 있어도 안전)', () => {
    const f = join(tmp(), 'settings.json');
    installHook(f, NODE, '/Users/x/My Projects/tamagit/src/cli.ts');
    const h = read(f).hooks.SessionEnd[0].hooks[0];
    assert.equal(h.command, NODE);
    assert.deepEqual(h.args, [
      '/Users/x/My Projects/tamagit/src/cli.ts',
      'sync',
      '--notify',
      '--quiet',
    ]);
    assert.equal(h.async, true); // 세션 종료를 붙잡으면 안 된다
  });

  test('설치 시 백업을 남긴다', () => {
    const f = settingsFile({ theme: 'dark' });
    const r = installHook(f, NODE, CLI);
    assert.ok(r.backup && existsSync(r.backup));
    assert.equal(read(r.backup!).theme, 'dark');
  });

  test('깨진 settings.json 은 덮어쓰지 않고 멈춘다', () => {
    const f = join(tmp(), 'settings.json');
    writeFileSync(f, '{ this is not json');
    assert.throws(() => installHook(f, NODE, CLI), /읽을 수 없다/);
    assert.equal(readFileSync(f, 'utf8'), '{ this is not json'); // 원본 그대로
  });

  test('빈 파일은 빈 설정으로 취급한다', () => {
    const f = join(tmp(), 'settings.json');
    writeFileSync(f, '   \n');
    assert.equal(installHook(f, NODE, CLI).changed, true);
  });
});

describe('훅 해제', () => {
  test('우리 것만 지우고 남의 훅은 남긴다', () => {
    const other = { hooks: [{ type: 'command', command: 'echo bye' }] };
    const f = settingsFile({ theme: 'dark', hooks: { SessionEnd: [other] } });
    installHook(f, NODE, CLI);
    const r = uninstallHook(f);
    assert.equal(r.changed, true);
    const s = read(f);
    assert.deepEqual(s.hooks.SessionEnd, [other]);
    assert.equal(s.theme, 'dark');
  });

  test('우리 것만 있었으면 빈 키를 정리한다', () => {
    const f = settingsFile({ theme: 'dark' });
    installHook(f, NODE, CLI);
    uninstallHook(f);
    const s = read(f);
    assert.equal(s.hooks, undefined);
    assert.equal(s.theme, 'dark');
  });

  test('설치돼 있지 않으면 아무것도 안 한다', () => {
    const f = settingsFile({ theme: 'dark' });
    assert.equal(uninstallHook(f).changed, false);
  });

  test('파일이 없어도 터지지 않는다', () => {
    assert.equal(uninstallHook(join(tmp(), 'nope.json')).changed, false);
  });
});

describe('launchd plist', () => {
  const plist = buildPlist(NODE, CLI, 21, '/Users/x/.tamagit/launchd.log');

  test('레이블과 스케줄이 들어간다', () => {
    assert.match(plist, new RegExp(`<string>${AGENT_LABEL}</string>`));
    assert.match(plist, /<key>Hour<\/key><integer>21<\/integer>/);
  });

  test('부팅 시 실행하지 않는다', () => {
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  });

  test('XML 특수문자를 이스케이프한다', () => {
    const p = buildPlist(NODE, '/Users/a&b/cli.ts', 9, '/tmp/l.log');
    assert.ok(p.includes('/Users/a&amp;b/cli.ts'));
    assert.ok(!p.includes('/Users/a&b/cli.ts'));
  });
});

// ---------------------------------------------------------------- 알림 판단

function fakeStats(over: Partial<Stats> = {}): Stats {
  const base = {
    today: '2026-07-22',
    level: { level: 13, intoLevel: 0, needed: 100, progress: 0, totalXp: 100000 },
    streak: { current: 4, longest: 24, atRisk: false },
    todayStat: { day: '2026-07-22', prompts: 20, xp: 500, promptXp: 400, runXp: 100, bonusXp: 0, streak: 4, bosses: 0, minutes: 0 },
    pet: { stage: 3, name: '드레이크', icon: '🐲', minLevel: 11, nextLevel: 19, mood: 'content', moodLabel: '흡족함', line: '' },
    achievements: [
      { id: 'streak-7', name: '일주일의 규율', desc: '7일 연속으로 코딩했다', icon: '🔥', rarity: 'common', unlockedAt: 1, have: 7, need: 7 },
      { id: 'frenzy', name: '폭주', desc: '하루에 프롬프트 200건', icon: '⚡', rarity: 'epic', unlockedAt: 2, have: 200, need: 200 },
    ],
  };
  return { ...base, ...over } as unknown as Stats;
}
const FRESH: NudgeState = { lastNotifiedLevel: null, lastStreakNagDay: null };
const SEEN: NudgeState = { lastNotifiedLevel: 12, lastStreakNagDay: null };

describe('알림 판단', () => {
  test('첫 실행에는 아무것도 띄우지 않는다 (과거를 몰아서 축하하면 스팸)', () => {
    const { nudges, nextState } = decideNudges(fakeStats(), ['streak-7', 'frenzy'], FRESH);
    assert.equal(nudges.length, 0);
    assert.equal(nextState.lastNotifiedLevel, 13); // 기준선만 기록한다
  });

  test('레벨이 오르면 알린다', () => {
    const { nudges } = decideNudges(fakeStats(), [], SEEN);
    assert.equal(nudges.length, 1);
    assert.equal(nudges[0]!.kind, 'levelup');
    assert.match(nudges[0]!.title, /Lv\.13/);
  });

  test('레벨이 그대로면 안 알린다', () => {
    const { nudges } = decideNudges(fakeStats(), [], { ...SEEN, lastNotifiedLevel: 13 });
    assert.equal(nudges.length, 0);
  });

  test('새 업적을 알린다 (여러 개면 묶어서)', () => {
    const { nudges } = decideNudges(fakeStats(), ['streak-7', 'frenzy'], { ...SEEN, lastNotifiedLevel: 13 });
    const a = nudges.find((n) => n.kind === 'achievement');
    assert.ok(a);
    assert.match(a!.message, /외 1개/);
  });

  test('스트릭 위험: 오늘 0건 + 어제까지 이어짐 → 알린다', () => {
    const s = fakeStats({
      streak: { current: 4, longest: 24, atRisk: true },
      todayStat: { ...fakeStats().todayStat, prompts: 0, xp: 0 },
    });
    const { nudges, nextState } = decideNudges(s, [], { ...SEEN, lastNotifiedLevel: 13 });
    const risk = nudges.find((n) => n.kind === 'streak-risk');
    assert.ok(risk);
    assert.match(risk!.title, /4일 연속이 오늘 끊긴다/);
    assert.equal(nextState.lastStreakNagDay, '2026-07-22');
  });

  test('스트릭 위험은 하루 한 번만 조른다', () => {
    const s = fakeStats({
      streak: { current: 4, longest: 24, atRisk: true },
      todayStat: { ...fakeStats().todayStat, prompts: 0, xp: 0 },
    });
    const { nudges } = decideNudges(s, [], {
      lastNotifiedLevel: 13,
      lastStreakNagDay: '2026-07-22',
    });
    assert.equal(nudges.filter((n) => n.kind === 'streak-risk').length, 0);
  });

  test('오늘 이미 활동했으면 조르지 않는다', () => {
    const s = fakeStats({ streak: { current: 4, longest: 24, atRisk: true } });
    const { nudges } = decideNudges(s, [], { ...SEEN, lastNotifiedLevel: 13 });
    assert.equal(nudges.filter((n) => n.kind === 'streak-risk').length, 0);
  });

  test('스트릭이 이미 끊겼으면 조르지 않는다', () => {
    const s = fakeStats({
      streak: { current: 0, longest: 24, atRisk: false },
      todayStat: { ...fakeStats().todayStat, prompts: 0, xp: 0 },
    });
    // 레벨업은 별개로 뜨는지 함께 확인 (lastNotifiedLevel=12 → 13 상승)
    const { nudges } = decideNudges(s, [], SEEN);
    assert.equal(nudges.filter((n) => n.kind === 'streak-risk').length, 0);
    assert.deepEqual(nudges.map((n) => n.kind), ['levelup']);
  });

  test('최장 기록 갱신 중이면 문구가 달라진다', () => {
    const s = fakeStats({
      streak: { current: 24, longest: 24, atRisk: true },
      todayStat: { ...fakeStats().todayStat, prompts: 0, xp: 0 },
    });
    const { nudges } = decideNudges(s, [], { ...SEEN, lastNotifiedLevel: 13 });
    assert.match(nudges.find((n) => n.kind === 'streak-risk')!.message, /최장 기록을 갱신/);
  });
});
