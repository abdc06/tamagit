#!/usr/bin/env node
// 스파이크 2: ~/.claude/projects/<proj>/<session>.jsonl 구조 (2차 소스) — 읽기 전용, 샘플링
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), '.claude', 'projects');
const files = [];
for (const d of readdirSync(ROOT)) {
  const dir = join(ROOT, d);
  try {
    for (const f of readdirSync(dir))
      if (f.endsWith('.jsonl')) files.push(join(dir, f));
  } catch {}
}
// 크기 중간대 파일 5개 샘플
files.sort((a, b) => statSync(a).size - statSync(b).size);
const sample = [files[Math.floor(files.length * 0.5)], files[Math.floor(files.length * 0.8)], files.at(-1)];

const out = [];
const p = (...a) => out.push(a.join(' '));
p('세션 파일 총', files.length, '개 / 샘플', sample.length, '개 분석');

const typeCount = new Map();
const topKeys = new Map();
const toolNames = new Map();
let usageSample = null, modelSample = new Set(), totalRows = 0;
let firstAssistantWithUsage = null;

for (const f of sample) {
  const lines = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
  p('');
  p('─'.repeat(70));
  p('파일:', f.replace(homedir(), '~').split('/').slice(-2).join('/'),
    '| ' + (statSync(f).size / 1024).toFixed(0) + 'KB |', lines.length, '줄');
  const localTypes = new Map();
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    totalRows++;
    const t = r.type ?? '(no type)';
    typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
    localTypes.set(t, (localTypes.get(t) ?? 0) + 1);
    Object.keys(r).forEach((k) => topKeys.set(k, (topKeys.get(k) ?? 0) + 1));

    const content = r.message?.content;
    if (Array.isArray(content))
      for (const c of content)
        if (c.type === 'tool_use') toolNames.set(c.name, (toolNames.get(c.name) ?? 0) + 1);
    if (r.message?.usage && !usageSample) usageSample = r.message.usage;
    if (r.message?.model) modelSample.add(r.message.model);
    if (!firstAssistantWithUsage && r.type === 'assistant' && r.message?.usage)
      firstAssistantWithUsage = r;
  }
  p('  type 분포:', [...localTypes].map(([k, v]) => `${k}=${v}`).join(', '));
}

p('');
p('='.repeat(70));
p('레코드 type 분포 (샘플 ' + totalRows + '줄)');
p('='.repeat(70));
for (const [t, c] of [...typeCount].sort((a, b) => b[1] - a[1])) p('  ' + String(c).padStart(5), t);

p('');
p('최상위 키 (출현수):');
for (const [k, c] of [...topKeys].sort((a, b) => b[1] - a[1])) p('  ' + String(c).padStart(5), k);

p('');
p('툴 사용 빈도 TOP 15:');
for (const [n, c] of [...toolNames].sort((a, b) => b[1] - a[1]).slice(0, 15))
  p('  ' + String(c).padStart(5), n);

p('');
p('model:', [...modelSample].join(', '));
p('usage 필드 샘플:', JSON.stringify(usageSample));

if (firstAssistantWithUsage) {
  const r = { ...firstAssistantWithUsage };
  if (r.message?.content) r.message = { ...r.message, content: '…(생략)' };
  p('');
  p('assistant 레코드 형태 (content 생략):');
  p(JSON.stringify(r, null, 2).slice(0, 900));
}

console.log(out.join('\n'));
