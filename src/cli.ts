#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { resolveConfig, type CliOverrides } from './core/config.ts';
import { sync } from './core/sync.ts';
import { buildStats } from './core/stats.ts';
import { renderTerminal } from './terminal.ts';
import { serve } from './server.ts';

const HELP = `
tamagit — Claude Code 활동을 읽어 코딩을 RPG로

사용법
  tamagit [command] [options]

명령
  serve            적재 후 로컬 대시보드를 띄운다 (기본값)
  sync             history.jsonl 을 로컬 DB에 적재만 한다
  stats            터미널에 현황을 출력한다

옵션
  --history <path>   원본 경로       (기본 ~/.claude/history.jsonl)
  --db <path>        DB 경로         (기본 ~/.tamagit/data.db)
  --tz <zone>        시간대          (기본 Asia/Seoul)
  --day-start <h>    하루 시작 시각  (기본 4 — 새벽 4시)
  --idle <min>       몰입 구간 분리  (기본 30분)
  --port <n>         대시보드 포트   (기본 4173)
  --json             stats 를 JSON 으로 출력
  -h, --help         이 도움말
`;

function parseArgs(argv: string[]): { cmd: string; opts: CliOverrides; json: boolean; help: boolean } {
  const opts: CliOverrides = {};
  let cmd = '';
  let json = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    switch (a) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--json':
        json = true;
        break;
      case '--history':
        opts.history = next();
        break;
      case '--db':
        opts.db = next();
        break;
      case '--tz':
        opts.tz = next();
        break;
      case '--day-start':
        opts.dayStart = Number(next());
        break;
      case '--idle':
        opts.idle = Number(next());
        break;
      case '--port':
        opts.port = Number(next());
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`알 수 없는 옵션: ${a}`);
          process.exit(1);
        } else if (!cmd) cmd = a;
    }
  }
  return { cmd: cmd || 'serve', opts, json, help };
}

function reportSync(r: ReturnType<typeof sync>): void {
  if (r.skipped) {
    console.log(`⚠️  ${r.skipped}`);
    console.log(`   DB에 적재된 ${r.totalRows.toLocaleString()}건으로 계속 진행한다.`);
  } else {
    const added = r.newRows > 0 ? `+${r.newRows.toLocaleString()}` : '변화 없음';
    console.log(
      `📥 적재 완료 — 원본 ${r.sourceRows.toLocaleString()}줄, ${added}, DB 누적 ${r.totalRows.toLocaleString()}건`,
    );
  }
  console.log(`   몰입 구간 ${r.runs.toLocaleString()}개 (보스전 ${r.bosses}회)`);
  if (r.parseErrors.length) {
    // 조용히 삼키지 않는다 — 포맷이 바뀐 신호일 수 있다
    console.log(`⚠️  파싱 실패 ${r.parseErrors.length}줄 — 포맷이 바뀌었을 수 있다:`);
    for (const e of r.parseErrors.slice(0, 3)) {
      console.log(`     L${e.line} ${e.reason}: ${e.sample.slice(0, 60)}`);
    }
  }
  if (r.newAchievements.length) {
    console.log(`🏆 새 업적 ${r.newAchievements.length}개: ${r.newAchievements.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const { cmd, opts, json, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(HELP.trim());
    return;
  }
  const cfg = resolveConfig(opts);

  switch (cmd) {
    case 'sync': {
      reportSync(sync(cfg));
      return;
    }
    case 'stats': {
      sync(cfg);
      const stats = buildStats(cfg);
      if (json) console.log(JSON.stringify(stats, null, 2));
      else console.log(renderTerminal(stats));
      return;
    }
    case 'serve': {
      reportSync(sync(cfg));
      await serve(cfg);
      return;
    }
    default:
      console.error(`알 수 없는 명령: ${cmd}\n`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
