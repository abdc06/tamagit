import type { Stats } from './core/stats.ts';
import { dict } from './core/i18n.ts';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const HEAT = ['·', '░', '▒', '▓', '█'];

/** 한글·CJK·이모지는 터미널에서 2칸을 먹는다 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf);
    w += wide ? 2 : 1;
  }
  return w;
}

function padEndW(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

function truncW(s: string, width: number): string {
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out;
}

function bar(v: number, max: number, width: number, ch = '█'): string {
  if (max <= 0) return '';
  return ch.repeat(Math.max(v > 0 ? 1 : 0, Math.round((v / max) * width)));
}

function heatLevel(xp: number, max: number): string {
  if (xp <= 0) return HEAT[0]!;
  const q = xp / max;
  if (q > 0.66) return HEAT[4]!;
  if (q > 0.33) return HEAT[3]!;
  if (q > 0.1) return HEAT[2]!;
  return HEAT[1]!;
}

export function renderTerminal(s: Stats): string {
  const T = dict(s.lang).term;
  const L: string[] = [];
  const p = (line = '') => L.push(line);
  const n = (v: number) => v.toLocaleString();

  const barW = 34;
  const filled = Math.round(s.level.progress * barW);
  const xpBar = `${C.green}${'█'.repeat(filled)}${C.gray}${'░'.repeat(barW - filled)}${C.reset}`;

  p();
  p(`  🥚 ${C.bold}${C.cyan}tamagit${C.reset}  ${C.dim}${s.today} · ${s.timeZone} · ${T.dayStartAt(s.dayStartHour)}${C.reset}`);
  p();
  p(`  ${s.pet.icon}  ${C.bold}Lv.${s.level.level}${C.reset} ${s.pet.name}  ${C.dim}${s.pet.moodLabel}${C.reset}`);
  p(`     ${C.gray}${s.pet.line}${C.reset}`);
  p();
  p(`  ${xpBar} ${n(s.level.intoLevel)}/${n(s.level.needed)}`);
  p(`  ${C.dim}${T.totalXp(n(s.level.totalXp))}${C.reset}`);
  p();

  const flame = s.streak.current > 0 ? '🔥' : '💤';
  const risk = s.streak.atRisk ? ` ${C.red}${T.atRisk}${C.reset}` : '';
  p(`  ${C.bold}${T.today}${C.reset}  ${C.yellow}${T.todayLine(n(s.todayStat.xp), n(s.todayStat.prompts), s.todayStat.bosses)}${C.reset}`);
  p(`  ${C.bold}${T.streak}${C.reset} ${flame} ${C.magenta}${T.streakLine(s.streak.current, s.streak.longest)}${C.reset}${risk}`);
  p(`  ${C.bold}${T.totals}${C.reset}  ${T.totalsLine(n(s.totals.prompts), n(s.totals.runs), s.totals.bosses, s.totals.projects)}`);
  p();

  // 히트맵 (최근 35일)
  const recent = s.days.slice(-35);
  const maxXp = Math.max(1, ...recent.map((d) => d.xp));
  p(`  ${C.bold}${T.recentDays(recent.length)}${C.reset} ${C.dim}${T.perCell}${C.reset}`);
  p(`  ${recent.map((d) => heatLevel(d.xp, maxXp)).join('')}`);
  const firstDay = recent[0]?.day ?? '';
  const lastDay = recent[recent.length - 1]?.day ?? '';
  p(`  ${C.gray}${firstDay}${' '.repeat(Math.max(1, recent.length - 20))}${lastDay}${C.reset}`);
  p();

  // 일별 XP TOP 5
  const top = [...s.days].sort((a, b) => b.xp - a.xp).slice(0, 5);
  const topMax = Math.max(1, ...top.map((d) => d.xp));
  p(`  ${C.bold}${T.bestDays}${C.reset}`);
  for (const d of top) {
    p(`   ${C.dim}${d.day}${C.reset} ${String(n(d.xp)).padStart(6)} XP ${C.green}${bar(d.xp, topMax, 24)}${C.reset} ${C.gray}${d.prompts}${T.prompts}${d.bosses ? ` ⚔${d.bosses}` : ''}${C.reset}`);
  }
  p();

  // 프로젝트 TOP 5
  p(`  ${C.bold}${T.topProjects}${C.reset}`);
  const projMax = Math.max(1, ...s.projects.slice(0, 5).map((x) => x.prompts));
  for (const pr of s.projects.slice(0, 5)) {
    p(`   ${padEndW(truncW(pr.name, 22), 22)} ${String(n(pr.prompts)).padStart(5)} ${C.cyan}${bar(pr.prompts, projMax, 20)}${C.reset}`);
  }
  p();

  // 업적
  const unlocked = s.achievements.filter((a) => a.unlockedAt);
  p(`  ${C.bold}${T.achievements}${C.reset} ${C.dim}${unlocked.length}/${s.achievements.length}${C.reset}`);
  for (const a of s.achievements) {
    const nm = padEndW(a.name, 16);
    if (a.unlockedAt) {
      const when = new Date(a.unlockedAt).toISOString().slice(0, 10);
      p(`   ${a.icon} ${C.bold}${nm}${C.reset} ${C.gray}${padEndW(a.desc, 34)}${C.reset} ${C.dim}${when}${C.reset}`);
    } else {
      p(`   ${C.gray}🔒 ${nm} ${padEndW(a.desc, 34)} ${a.have}/${a.need}${C.reset}`);
    }
  }
  p();

  // 데이터 보존 상태 — 이 도구의 존재이유
  if (s.source.daysBeyondSource > 0) {
    p(`  ${C.green}${T.preservedBeyond(s.source.daysBeyondSource)}${C.reset}`);
  } else {
    p(`  ${C.dim}${T.preserved(s.totals.activeDays)}${C.reset}`);
  }
  p(`  ${C.gray}   ${s.source.dbPath}${C.reset}`);
  p();

  return L.join('\n');
}
