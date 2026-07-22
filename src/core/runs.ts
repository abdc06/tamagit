import type { Clock } from './clock.ts';
import type { Config } from './config.ts';

/** run 계산에 필요한 최소 정보 (history 파서 출력과 DB 행 양쪽에 맞는다) */
export interface RunInput {
  sessionId: string;
  ts: number;
  project: string;
}

/**
 * 몰입 구간(run) = 같은 세션 안에서 프롬프트 간격이 idleBreakMinutes 이내로 이어진 덩어리.
 *
 * 왜 세션 통째로 쓰지 않는가(스파이크 §2): 최장 세션이 1,473분(24.5h)인데 프롬프트가 15개뿐이다.
 * 총 경과시간은 "자리를 비운 시간"까지 포함해서 몰입의 척도가 못 된다.
 */
export interface Run {
  id: string;
  sessionId: string;
  project: string;
  day: string;
  startTs: number;
  endTs: number;
  prompts: number;
  activeMinutes: number;
  isBoss: boolean;
  xp: number;
}

export function buildRuns(prompts: RunInput[], cfg: Config, clock: Clock): Run[] {
  const bySession = new Map<string, RunInput[]>();
  for (const p of prompts) {
    let arr = bySession.get(p.sessionId);
    if (!arr) bySession.set(p.sessionId, (arr = []));
    arr.push(p);
  }

  const gapMs = cfg.idleBreakMinutes * 60_000;
  const runs: Run[] = [];

  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.ts - b.ts);
    let chunk: RunInput[] = [];
    let index = 0;

    const flush = () => {
      if (chunk.length === 0) return;
      const first = chunk[0]!;
      const last = chunk[chunk.length - 1]!;
      const activeMinutes = (last.ts - first.ts) / 60_000;
      const isBoss =
        activeMinutes >= cfg.boss.minActiveMinutes && chunk.length >= cfg.boss.minPrompts;
      runs.push({
        id: `${sessionId}#${index++}`,
        sessionId,
        project: first.project,
        day: clock.dayKey(last.ts),
        startTs: first.ts,
        endTs: last.ts,
        prompts: chunk.length,
        activeMinutes: Math.round(activeMinutes * 10) / 10,
        isBoss,
        xp: cfg.xp.runBonus + (isBoss ? cfg.xp.bossBonus : 0),
      });
      chunk = [];
    };

    for (const p of list) {
      const prev = chunk[chunk.length - 1];
      if (prev && p.ts - prev.ts > gapMs) flush();
      chunk.push(p);
    }
    flush();
  }

  runs.sort((a, b) => a.startTs - b.startTs);
  return runs;
}
