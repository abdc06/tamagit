import { basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { addDays, dayRange, makeClock, type Clock } from './clock.ts';
import type { Config } from './config.ts';
import { getMeta, loadPrompts, loadRuns, openDb, recentSyncs } from './db.ts';
import { evaluateAchievements, type AchievementContext, type AchievementState, type PromptRow } from './achievements.ts';
import type { Run } from './runs.ts';
import { levelFromXp, streakBonus, type LevelInfo } from './xp.ts';
import { computeStreaks } from './streak.ts';
import { petFor, type PetState } from './pet.ts';

export function buildContext(
  prompts: PromptRow[],
  runs: Run[],
  clock: Clock,
  now: number,
): AchievementContext {
  const lastTsOfDay = new Map<string, number>();
  const countOfDay = new Map<string, number>();
  for (const p of prompts) {
    lastTsOfDay.set(p.day, Math.max(lastTsOfDay.get(p.day) ?? 0, p.ts));
    countOfDay.set(p.day, (countOfDay.get(p.day) ?? 0) + 1);
  }
  const activeDays = [...countOfDay.keys()].sort();
  const { lengthAt } = computeStreaks(activeDays, clock.dayKey(now));
  return { prompts, runs, lastTsOfDay, countOfDay, streakAt: lengthAt, activeDays };
}

export interface DayStat {
  day: string;
  prompts: number;
  xp: number;
  promptXp: number;
  runXp: number;
  bonusXp: number;
  streak: number;
  bosses: number;
  minutes: number;
}

export interface ProjectStat {
  project: string;
  name: string;
  prompts: number;
  xp: number;
  bosses: number;
  lastTs: number;
}

export interface Stats {
  generatedAt: number;
  timeZone: string;
  dayStartHour: number;
  today: string;
  level: LevelInfo;
  xp: { total: number; today: number; fromPrompts: number; fromRuns: number; fromStreak: number };
  streak: { current: number; longest: number; atRisk: boolean };
  totals: {
    prompts: number;
    sessions: number;
    runs: number;
    bosses: number;
    projects: number;
    activeDays: number;
    calendarDays: number;
    firstDay: string | null;
    lastDay: string | null;
    activeMinutes: number;
  };
  todayStat: DayStat;
  pet: PetState;
  days: DayStat[];
  hours: number[];
  projects: ProjectStat[];
  achievements: AchievementState[];
  recentBosses: Array<Pick<Run, 'project' | 'day' | 'prompts' | 'activeMinutes' | 'endTs'> & { name: string }>;
  source: {
    historyPath: string;
    historyExists: boolean;
    dbPath: string;
    lastSyncAt: number | null;
    syncs: Array<{ ranAt: number; sourceRows: number; newRows: number; parseErrors: number }>;
    /** DB 에만 남아있고 원본에서는 이미 사라진 날 수 (= 도구가 지켜낸 기록) */
    daysBeyondSource: number;
  };
}

const SOURCE_RETENTION_DAYS = 30;

export function buildStats(cfg: Config, now = Date.now()): Stats {
  const db = openDb(cfg.dbPath);
  const clock = makeClock(cfg.timeZone, cfg.dayStartHour);
  const prompts = loadPrompts(db);
  const runs = loadRuns(db);
  const lastSyncAt = Number(getMeta(db, 'last_sync_at')) || null;
  const syncs = recentSyncs(db, 10).map((s) => ({
    ranAt: s.ran_at,
    sourceRows: s.source_rows,
    newRows: s.new_rows,
    parseErrors: s.parse_errors,
  }));
  db.close();

  const today = clock.dayKey(now);

  // ---- 일자별 집계 ----
  const byDay = new Map<string, DayStat>();
  const touch = (day: string): DayStat => {
    let d = byDay.get(day);
    if (!d) {
      d = { day, prompts: 0, xp: 0, promptXp: 0, runXp: 0, bonusXp: 0, streak: 0, bosses: 0, minutes: 0 };
      byDay.set(day, d);
    }
    return d;
  };
  for (const p of prompts) {
    const d = touch(p.day);
    d.prompts++;
    d.promptXp += p.xp;
  }
  for (const r of runs) {
    const d = touch(r.day);
    d.runXp += r.xp;
    d.minutes += r.activeMinutes;
    if (r.isBoss) d.bosses++;
  }

  const activeDays = [...byDay.keys()].sort();
  const streaks = computeStreaks(activeDays, today);

  let total = 0;
  let fromPrompts = 0;
  let fromRuns = 0;
  let fromStreak = 0;
  for (const day of activeDays) {
    const d = byDay.get(day)!;
    d.streak = streaks.lengthAt.get(day) ?? 0;
    const subtotal = d.promptXp + d.runXp;
    d.bonusXp = streakBonus(subtotal, d.streak, cfg.xp);
    d.xp = subtotal + d.bonusXp;
    total += d.xp;
    fromPrompts += d.promptXp;
    fromRuns += d.runXp;
    fromStreak += d.bonusXp;
  }

  const first = activeDays[0] ?? null;
  const last = activeDays[activeDays.length - 1] ?? null;

  // 달력 전체(빈 날 포함) — 히트맵과 스트릭 시각화용
  const days: DayStat[] =
    first && last
      ? dayRange(first, today >= last ? today : last).map(
          (day) =>
            byDay.get(day) ?? {
              day,
              prompts: 0,
              xp: 0,
              promptXp: 0,
              runXp: 0,
              bonusXp: 0,
              streak: 0,
              bosses: 0,
              minutes: 0,
            },
        )
      : [];

  const todayStat =
    byDay.get(today) ?? {
      day: today,
      prompts: 0,
      xp: 0,
      promptXp: 0,
      runXp: 0,
      bonusXp: 0,
      streak: 0,
      bosses: 0,
      minutes: 0,
    };

  // ---- 시간대 ----
  const hours = new Array(24).fill(0) as number[];
  for (const p of prompts) hours[p.hour] = (hours[p.hour] ?? 0) + 1;

  // ---- 프로젝트 ----
  const projMap = new Map<string, ProjectStat>();
  for (const p of prompts) {
    let s = projMap.get(p.project);
    if (!s) {
      s = { project: p.project, name: basename(p.project) || p.project, prompts: 0, xp: 0, bosses: 0, lastTs: 0 };
      projMap.set(p.project, s);
    }
    s.prompts++;
    s.xp += p.xp;
    if (p.ts > s.lastTs) s.lastTs = p.ts;
  }
  for (const r of runs) {
    if (r.isBoss) {
      const s = projMap.get(r.project);
      if (s) s.bosses++;
    }
  }
  // 이름이 겹치는 프로젝트는 상위 폴더까지 붙여 구분한다
  // (실측: LLM-Dev/paladin 233건 vs Projects/paladin 209건 — 둘 다 "paladin" 이면 못 읽는다)
  const nameCount = new Map<string, number>();
  for (const s of projMap.values()) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
  for (const s of projMap.values()) {
    if ((nameCount.get(s.name) ?? 0) > 1) {
      const parent = basename(dirname(s.project));
      if (parent) s.name = `${parent}/${s.name}`;
    }
  }

  const projects = [...projMap.values()].sort((a, b) => b.prompts - a.prompts);

  // ---- 업적 ----
  const ctx = buildContext(prompts, runs, clock, now);
  const achievements = evaluateAchievements(ctx).sort((a, b) => {
    if (!!a.unlockedAt !== !!b.unlockedAt) return a.unlockedAt ? -1 : 1;
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt - a.unlockedAt;
    return b.have / b.need - a.have / a.need;
  });

  const level = levelFromXp(total);
  const pet = petFor(level.level, todayStat.prompts, streaks.current, streaks.atRisk);

  const recentBosses = runs
    .filter((r) => r.isBoss)
    .sort((a, b) => b.endTs - a.endTs)
    .slice(0, 8)
    .map((r) => ({
      project: r.project,
      name: projMap.get(r.project)?.name ?? basename(r.project) ?? r.project,
      day: r.day,
      prompts: r.prompts,
      activeMinutes: r.activeMinutes,
      endTs: r.endTs,
    }));

  // 원본 보관기간(30일)을 넘겨 DB 에만 남은 날 수
  const cutoff = addDays(today, -SOURCE_RETENTION_DAYS);
  const daysBeyondSource = activeDays.filter((d) => d < cutoff).length;

  return {
    generatedAt: now,
    timeZone: cfg.timeZone,
    dayStartHour: cfg.dayStartHour,
    today,
    level,
    xp: { total, today: todayStat.xp, fromPrompts, fromRuns, fromStreak },
    streak: { current: streaks.current, longest: streaks.longest, atRisk: streaks.atRisk },
    totals: {
      prompts: prompts.length,
      sessions: new Set(prompts.map((p) => p.sessionId)).size,
      runs: runs.length,
      bosses: runs.filter((r) => r.isBoss).length,
      projects: projMap.size,
      activeDays: activeDays.length,
      calendarDays: days.length,
      firstDay: first,
      lastDay: last,
      activeMinutes: Math.round(runs.reduce((a, r) => a + r.activeMinutes, 0)),
    },
    todayStat,
    pet,
    days,
    hours,
    projects,
    achievements,
    recentBosses,
    source: {
      historyPath: cfg.historyPath,
      historyExists: existsSync(cfg.historyPath),
      dbPath: cfg.dbPath,
      lastSyncAt,
      syncs,
      daysBeyondSource,
    },
  };
}
