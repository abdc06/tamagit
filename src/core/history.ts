import { readFileSync, statSync } from 'node:fs';
import { dict, type Lang } from './i18n.ts';

/**
 * ~/.claude/history.jsonl 파서.
 *
 * 실측(2026-07-22, 3,666건): 필드 5개 고정, 스키마 변형 0가지, 파싱 실패 0건.
 * 그래도 SPEC §3 "내부 포맷은 버전마다 변한다"를 전제로 방어적으로 읽는다.
 *   - 라인 단위로 실패를 격리하고, 버린 라인은 반드시 카운트해서 노출한다
 *     (조용히 삼키면 XP가 조용히 틀어진다)
 *   - 모르는 신규 필드는 무시하고 통과시킨다 (forward-compatible)
 */

export interface ParsedPrompt {
  sessionId: string;
  ts: number;
  project: string;
  display: string;
  charLen: number;
  isMultiline: boolean;
  isSlash: boolean;
  isBang: boolean;
  pastedCount: number;
}

export interface ParseError {
  line: number;
  reason: string;
  sample: string;
}

export interface ParseResult {
  prompts: ParsedPrompt[];
  errors: ParseError[];
  totalLines: number;
  bytes: number;
  mtime: number;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function countPasted(v: unknown): number {
  return isObj(v) ? Object.keys(v).length : 0;
}

export function parseHistory(path: string, lang: Lang = 'en'): ParseResult {
  const P = dict(lang).parse;
  const stat = statSync(path);
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');

  const prompts: ParsedPrompt[] = [];
  const errors: ParseError[] = [];
  let totalLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    totalLines++;

    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch (e) {
      errors.push({ line: i + 1, reason: P.badJson, sample: line.slice(0, 120) });
      continue;
    }
    if (!isObj(row)) {
      errors.push({ line: i + 1, reason: P.notObject, sample: line.slice(0, 120) });
      continue;
    }

    const { display, timestamp, project, sessionId } = row;

    // timestamp 는 epoch ms(13자리)다. 초로 들어오는 포맷 변화를 대비해 보정한다.
    let ts: number;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    } else {
      errors.push({ line: i + 1, reason: P.badTimestamp, sample: line.slice(0, 120) });
      continue;
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      errors.push({ line: i + 1, reason: P.noSessionId, sample: line.slice(0, 120) });
      continue;
    }

    const text = typeof display === 'string' ? display : '';
    prompts.push({
      sessionId,
      ts,
      project: typeof project === 'string' && project ? project : '(unknown)',
      display: text,
      charLen: text.length,
      isMultiline: text.includes('\n'),
      isSlash: text.startsWith('/'),
      isBang: text.startsWith('!'),
      pastedCount: countPasted(row.pastedContents),
    });
  }

  // 파일은 append-only 오름차순이지만 정렬을 신뢰하지 않는다 (포맷 변화 대비)
  prompts.sort((a, b) => a.ts - b.ts || a.sessionId.localeCompare(b.sessionId));

  return {
    prompts,
    errors,
    totalLines,
    bytes: stat.size,
    mtime: stat.mtimeMs,
  };
}
