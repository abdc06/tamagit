import type { Stats } from './core/stats.ts';

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
  const L: string[] = [];
  const p = (line = '') => L.push(line);
  const n = (v: number) => v.toLocaleString();

  const barW = 34;
  const filled = Math.round(s.level.progress * barW);
  const xpBar = `${C.green}${'█'.repeat(filled)}${C.gray}${'░'.repeat(barW - filled)}${C.reset}`;

  p();
  p(`  🥚 ${C.bold}${C.cyan}tamagit${C.reset}  ${C.dim}${s.today} (${s.timeZone}, 하루 시작 ${s.dayStartHour}시)${C.reset}`);
  p();
  p(`  ${s.pet.icon}  ${C.bold}Lv.${s.level.level}${C.reset} ${s.pet.name}  ${C.dim}${s.pet.moodLabel}${C.reset}`);
  p(`     ${C.gray}${s.pet.line}${C.reset}`);
  p();
  p(`  ${xpBar} ${n(s.level.intoLevel)}/${n(s.level.needed)}`);
  p(`  ${C.dim}총 ${n(s.level.totalXp)} XP${C.reset}`);
  p();

  const flame = s.streak.current > 0 ? '🔥' : '💤';
  const risk = s.streak.atRisk ? ` ${C.red}(오늘 안 하면 끊김)${C.reset}` : '';
  p(`  ${C.bold}오늘${C.reset}  ${C.yellow}${n(s.todayStat.xp)} XP${C.reset}  ·  프롬프트 ${n(s.todayStat.prompts)}  ·  보스전 ${s.todayStat.bosses}`);
  p(`  ${C.bold}스트릭${C.reset} ${flame} ${C.magenta}${s.streak.current}일${C.reset} 연속  ·  최장 ${s.streak.longest}일${risk}`);
  p(`  ${C.bold}누적${C.reset}  프롬프트 ${n(s.totals.prompts)}  ·  몰입구간 ${n(s.totals.runs)}  ·  보스 ${s.totals.bosses}  ·  프로젝트 ${s.totals.projects}`);
  p();

  // 히트맵 (최근 35일)
  const recent = s.days.slice(-35);
  const maxXp = Math.max(1, ...recent.map((d) => d.xp));
  p(`  ${C.bold}최근 ${recent.length}일${C.reset} ${C.dim}(각 칸 = 하루)${C.reset}`);
  p(`  ${recent.map((d) => heatLevel(d.xp, maxXp)).join('')}`);
  const firstDay = recent[0]?.day ?? '';
  const lastDay = recent[recent.length - 1]?.day ?? '';
  p(`  ${C.gray}${firstDay}${' '.repeat(Math.max(1, recent.length - 20))}${lastDay}${C.reset}`);
  p();

  // 일별 XP TOP 5
  const top = [...s.days].sort((a, b) => b.xp - a.xp).slice(0, 5);
  const topMax = Math.max(1, ...top.map((d) => d.xp));
  p(`  ${C.bold}최고의 날${C.reset}`);
  for (const d of top) {
    p(`   ${C.dim}${d.day}${C.reset} ${String(n(d.xp)).padStart(6)} XP ${C.green}${bar(d.xp, topMax, 24)}${C.reset} ${C.gray}${d.prompts}p${d.bosses ? ` ⚔${d.bosses}` : ''}${C.reset}`);
  }
  p();

  // 프로젝트 TOP 5
  p(`  ${C.bold}주력 프로젝트${C.reset}`);
  const projMax = Math.max(1, ...s.projects.slice(0, 5).map((x) => x.prompts));
  for (const pr of s.projects.slice(0, 5)) {
    p(`   ${padEndW(truncW(pr.name, 22), 22)} ${String(n(pr.prompts)).padStart(5)} ${C.cyan}${bar(pr.prompts, projMax, 20)}${C.reset}`);
  }
  p();

  // 업적
  const unlocked = s.achievements.filter((a) => a.unlockedAt);
  p(`  ${C.bold}업적${C.reset} ${C.dim}${unlocked.length}/${s.achievements.length}${C.reset}`);
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
    p(`  ${C.green}🛡  원본이 이미 지운 ${s.source.daysBeyondSource}일치를 DB가 보존 중${C.reset}`);
  } else {
    p(`  ${C.dim}🛡  DB 보존 ${s.totals.activeDays}일치 · 원본 30일 삭제 방어 대기 중${C.reset}`);
  }
  p(`  ${C.gray}   ${s.source.dbPath}${C.reset}`);
  p();

  return L.join('\n');
}
