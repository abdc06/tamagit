#!/usr/bin/env node
// 스파이크: ~/.claude/history.jsonl 구조/필드 확인 (읽기 전용)
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILE = join(homedir(), '.claude', 'history.jsonl');
const raw = readFileSync(FILE, 'utf8');
const lines = raw.split('\n').filter((l) => l.trim().length > 0);

const rows = [];
const badLines = [];
for (const [i, line] of lines.entries()) {
  try {
    rows.push(JSON.parse(line));
  } catch (e) {
    badLines.push({ line: i + 1, err: e.message, sample: line.slice(0, 120) });
  }
}

const out = [];
const p = (...a) => out.push(a.join(' '));

p('='.repeat(72));
p('1. 파일 개요');
p('='.repeat(72));
p('path        :', FILE);
p('bytes       :', raw.length.toLocaleString());
p('lines       :', lines.length.toLocaleString());
p('parsed OK   :', rows.length.toLocaleString());
p('parse fail  :', badLines.length);
if (badLines.length) p(JSON.stringify(badLines.slice(0, 3), null, 2));

// ---------- 2. 필드 스키마 ----------
const keyStat = new Map(); // key -> {count, types:Set, samples:[]}
const walkTop = (obj) => {
  for (const [k, v] of Object.entries(obj)) {
    if (!keyStat.has(k)) keyStat.set(k, { count: 0, types: new Set(), samples: [] });
    const s = keyStat.get(k);
    s.count++;
    s.types.add(Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    if (s.samples.length < 2) {
      const str = typeof v === 'string' ? v : JSON.stringify(v);
      s.samples.push(str.length > 60 ? str.slice(0, 60) + '…' : str);
    }
  }
};
rows.forEach(walkTop);

p('');
p('='.repeat(72));
p('2. 최상위 필드 스키마 (전체 ' + rows.length + '건 기준)');
p('='.repeat(72));
p('field'.padEnd(16), 'count'.padStart(7), 'cover'.padStart(7), ' type', ' 예시');
for (const [k, s] of [...keyStat].sort((a, b) => b[1].count - a[1].count)) {
  p(
    k.padEnd(16),
    String(s.count).padStart(7),
    ((s.count / rows.length) * 100).toFixed(1).padStart(6) + '%',
    ' ' + [...s.types].join('|').padEnd(8),
    ' ' + (s.samples[0] ?? '')
  );
}

// ---------- 3. 원본 레코드 샘플 ----------
p('');
p('='.repeat(72));
p('3. 원본 레코드 샘플');
p('='.repeat(72));
p('[첫 레코드]');
p(JSON.stringify(rows[0], null, 2).slice(0, 600));
p('');
p('[마지막 레코드]');
p(JSON.stringify(rows.at(-1), null, 2).slice(0, 600));

// pastedContents 가 비어있지 않은 레코드
const withPaste = rows.filter(
  (r) => r.pastedContents && Object.keys(r.pastedContents).length > 0
);
p('');
p('[pastedContents 비어있지 않은 레코드]', withPaste.length + '건');
if (withPaste.length) {
  const ex = withPaste[0];
  const pc = ex.pastedContents;
  p('  keys:', JSON.stringify(Object.keys(pc)));
  const firstVal = pc[Object.keys(pc)[0]];
  if (firstVal && typeof firstVal === 'object') {
    p('  value keys:', JSON.stringify(Object.keys(firstVal)));
    for (const [k, v] of Object.entries(firstVal)) {
      const str = typeof v === 'string' ? v : JSON.stringify(v);
      p('    -', k.padEnd(12), typeof v, ':', String(str).slice(0, 80).replace(/\n/g, '\\n'));
    }
  }
  // 모든 pastedContents value 의 키 집합
  const pcKeys = new Set();
  for (const r of withPaste)
    for (const v of Object.values(r.pastedContents))
      if (v && typeof v === 'object') Object.keys(v).forEach((k) => pcKeys.add(k));
  p('  전체 등장 value 키:', [...pcKeys].join(', '));
}

// 스키마 변형(키 조합) 확인
const shapes = new Map();
for (const r of rows) {
  const sig = Object.keys(r).sort().join(',');
  shapes.set(sig, (shapes.get(sig) ?? 0) + 1);
}
p('');
p('[키 조합(스키마 변형) 종류]', shapes.size + '가지');
for (const [sig, c] of [...shapes].sort((a, b) => b[1] - a[1])) p('  ' + String(c).padStart(6), sig);

// ---------- 4. 타임스탬프 ----------
const ts = rows.map((r) => r.timestamp).filter((t) => typeof t === 'number');
const min = Math.min(...ts), max = Math.max(...ts);
const fmt = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
let unsorted = 0;
for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1]) unsorted++;

p('');
p('='.repeat(72));
p('4. 타임스탬프');
p('='.repeat(72));
p('단위        : epoch ms (' + String(min).length + '자리)');
p('최초        :', fmt(min), '(UTC)');
p('최신        :', fmt(max), '(UTC)');
p('기간        :', ((max - min) / 86400000).toFixed(1), '일');
p('파일 내 정렬: ' + (unsorted === 0 ? '오름차순 정렬됨 (append-only)' : `역행 ${unsorted}건 — 정렬 보장 안 됨`));

// ---------- 5. 일자별 분포 / 스트릭 ----------
const KST = 9 * 3600000;
const dayOf = (t) => new Date(t + KST).toISOString().slice(0, 10); // KST 기준 날짜
const byDay = new Map();
for (const r of rows) {
  const d = dayOf(r.timestamp);
  byDay.set(d, (byDay.get(d) ?? 0) + 1);
}
const days = [...byDay.keys()].sort();
p('');
p('='.repeat(72));
p('5. 일자별 분포 (KST 기준) — 스트릭 계산 가능성');
p('='.repeat(72));
p('활동 일수   :', days.length, '/ 달력상', Math.round((max - min) / 86400000) + 1, '일');
const maxCount = Math.max(...byDay.values());
for (const d of days) {
  const c = byDay.get(d);
  const bar = '█'.repeat(Math.max(1, Math.round((c / maxCount) * 40)));
  p('  ' + d, String(c).padStart(4), bar);
}
// 최장 연속
let best = 0, cur = 0, prev = null;
for (const d of days) {
  const t = Date.parse(d);
  cur = prev !== null && t - prev === 86400000 ? cur + 1 : 1;
  best = Math.max(best, cur);
  prev = t;
}
p('현재 연속   :', cur, '일 / 최장 연속:', best, '일');

// ---------- 6. 프로젝트 / 세션 ----------
const byProject = new Map(), bySession = new Map();
for (const r of rows) {
  byProject.set(r.project, (byProject.get(r.project) ?? 0) + 1);
  bySession.set(r.sessionId, (bySession.get(r.sessionId) ?? 0) + 1);
}
p('');
p('='.repeat(72));
p('6. 프로젝트 / 세션');
p('='.repeat(72));
p('고유 프로젝트:', byProject.size);
p('고유 세션    :', bySession.size);
p('세션당 프롬프트 평균:', (rows.length / bySession.size).toFixed(1),
  '/ 최대:', Math.max(...bySession.values()));
p('');
p('[프롬프트 많은 프로젝트 TOP 10]');
for (const [proj, c] of [...byProject].sort((a, b) => b[1] - a[1]).slice(0, 10))
  p('  ' + String(c).padStart(5), (proj ?? '(null)').replace(homedir(), '~'));

// 세션이 프로젝트를 넘나드는지
let crossProj = 0;
const sessProj = new Map();
for (const r of rows) {
  if (!sessProj.has(r.sessionId)) sessProj.set(r.sessionId, new Set());
  sessProj.get(r.sessionId).add(r.project);
}
for (const s of sessProj.values()) if (s.size > 1) crossProj++;
p('여러 프로젝트에 걸친 sessionId:', crossProj, '건');

// ---------- 7. display 필드 성격 ----------
const slash = rows.filter((r) => typeof r.display === 'string' && r.display.startsWith('/'));
const bang = rows.filter((r) => typeof r.display === 'string' && r.display.startsWith('!'));
const empty = rows.filter((r) => !r.display || !String(r.display).trim());
const lens = rows.map((r) => String(r.display ?? '').length).sort((a, b) => a - b);
const pct = (q) => lens[Math.floor(lens.length * q)];
p('');
p('='.repeat(72));
p('7. display(프롬프트 원문) 성격');
p('='.repeat(72));
p('슬래시 커맨드:', slash.length, `(${((slash.length / rows.length) * 100).toFixed(1)}%)`);
p('! bash 커맨드:', bang.length);
p('빈 문자열    :', empty.length);
p('길이 p50/p90/p99/max:', pct(0.5), '/', pct(0.9), '/', pct(0.99), '/', lens.at(-1));
p('멀티라인 포함:', rows.filter((r) => String(r.display ?? '').includes('\n')).length);
p('');
p('[슬래시 커맨드 TOP 10]');
const cmd = new Map();
for (const r of slash) {
  const c = String(r.display).split(/\s/)[0];
  cmd.set(c, (cmd.get(c) ?? 0) + 1);
}
for (const [c, n] of [...cmd].sort((a, b) => b[1] - a[1]).slice(0, 10))
  p('  ' + String(n).padStart(4), c);

// 중복 프롬프트 (동일 display 반복 = 재시도/리트라이 신호)
const dup = new Map();
for (const r of rows) {
  const k = String(r.display ?? '');
  dup.set(k, (dup.get(k) ?? 0) + 1);
}
p('');
p('[반복 입력 TOP 5] (재시도/습관 신호 → 게임 로직 힌트)');
for (const [k, n] of [...dup].sort((a, b) => b[1] - a[1]).slice(0, 5))
  p('  ' + String(n).padStart(4), JSON.stringify(k.slice(0, 60)));

// ---------- 8. 세션 길이 (보스전 후보) ----------
const sessSpan = new Map();
for (const r of rows) {
  const s = sessSpan.get(r.sessionId) ?? { min: Infinity, max: -Infinity, n: 0, proj: r.project };
  s.min = Math.min(s.min, r.timestamp);
  s.max = Math.max(s.max, r.timestamp);
  s.n++;
  sessSpan.set(r.sessionId, s);
}
const spans = [...sessSpan.entries()]
  .map(([id, s]) => ({ id, mins: (s.max - s.min) / 60000, n: s.n, proj: s.proj }))
  .sort((a, b) => b.mins - a.mins);
p('');
p('='.repeat(72));
p('8. 세션 지속시간 (= "보스전" 후보 신호)');
p('='.repeat(72));
const oneShot = spans.filter((s) => s.n === 1).length;
p('단발 세션(프롬프트 1개):', oneShot, `(${((oneShot / spans.length) * 100).toFixed(0)}%)`);
p('60분+ 세션:', spans.filter((s) => s.mins >= 60).length);
p('');
p('[최장 세션 TOP 5]');
for (const s of spans.slice(0, 5))
  p('  ' + s.mins.toFixed(0).padStart(5) + '분', String(s.n).padStart(4) + '프롬프트',
    (s.proj ?? '').replace(homedir(), '~').slice(-45));

// ---------- 9. 시간대 ----------
const hours = new Array(24).fill(0);
for (const r of rows) hours[new Date(r.timestamp + KST).getUTCHours()]++;
p('');
p('='.repeat(72));
p('9. 시간대 분포 (KST) — 업적("새벽 코딩") 후보');
p('='.repeat(72));
const hmax = Math.max(...hours);
for (let h = 0; h < 24; h++)
  p('  ' + String(h).padStart(2) + '시', String(hours[h]).padStart(4),
    '█'.repeat(Math.round((hours[h] / hmax) * 44)));

console.log(out.join('\n'));
