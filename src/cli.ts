#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { resolveConfig, type CliOverrides } from './core/config.ts';
import { sync } from './core/sync.ts';
import { buildStats } from './core/stats.ts';
import { renderTerminal } from './terminal.ts';
import { serve } from './server.ts';
import {
  AGENT_PLIST,
  SETTINGS_PATH,
  installAgent,
  installHook,
  isAgentInstalled,
  isHookInstalled,
  uninstallAgent,
  uninstallHook,
} from './core/install.ts';

const HELP = `
tamagit — Claude Code 활동을 읽어 코딩을 RPG로

사용법
  tamagit [command] [options]

명령
  serve            적재 후 로컬 대시보드를 띄운다 (기본값)
  sync             history.jsonl 을 로컬 DB에 적재만 한다
  stats            터미널에 현황을 출력한다
  install          자동 적재를 건다 (Claude Code 훅 + 매일 실행)
  uninstall        자동 적재를 해제한다
  status           자동 적재 설치 상태를 본다

옵션
  --history <path>   원본 경로       (기본 ~/.claude/history.jsonl)
  --db <path>        DB 경로         (기본 ~/.tamagit/data.db)
  --tz <zone>        시간대          (기본 Asia/Seoul)
  --day-start <h>    하루 시작 시각  (기본 4 — 새벽 4시)
  --idle <min>       몰입 구간 분리  (기본 30분)
  --port <n>         대시보드 포트   (기본 4173)
  --notify           레벨업·업적·스트릭 위험을 OS 알림으로
  --quiet            출력을 줄인다 (훅·자동 실행용)
  --at <h>           자동 실행 시각  (기본 21 — 밤 9시)
  --hook-only        install/uninstall 시 Claude Code 훅만
  --agent-only       install/uninstall 시 매일 실행만
  --json             stats 를 JSON 으로 출력
  -h, --help         이 도움말

자동 적재가 왜 필요한가
  원본 history.jsonl 은 30일 뒤 사라진다. 직접 실행할 때만 적재하면
  한 달 안 켠 기간의 기록은 영구 소실이다. install 로 두 겹을 건다.
`;

interface Flags {
  cmd: string;
  opts: CliOverrides;
  json: boolean;
  help: boolean;
  notify: boolean;
  quiet: boolean;
  at: number;
  hookOnly: boolean;
  agentOnly: boolean;
}

function parseArgs(argv: string[]): Flags {
  const opts: CliOverrides = {};
  let cmd = '';
  let json = false;
  let help = false;
  let notify = false;
  let quiet = false;
  let at = 21;
  let hookOnly = false;
  let agentOnly = false;

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
      case '--notify':
        notify = true;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--at':
        at = Number(next());
        break;
      case '--hook-only':
        hookOnly = true;
        break;
      case '--agent-only':
        agentOnly = true;
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
  return { cmd: cmd || 'serve', opts, json, help, notify, quiet, at, hookOnly, agentOnly };
}

function reportSync(r: ReturnType<typeof sync>, quiet = false): void {
  if (quiet) {
    // 훅/자동 실행용 — 문제가 있을 때만 말한다
    if (r.parseErrors.length) {
      console.error(`tamagit: 파싱 실패 ${r.parseErrors.length}줄 — history.jsonl 포맷 변화 의심`);
    }
    return;
  }
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
  for (const n of r.nudges) {
    console.log(`🔔 ${n.title} — ${n.message}`);
  }
}

function reportStatus(): void {
  const hook = isHookInstalled();
  const agent = isAgentInstalled();
  console.log('\n자동 적재 상태\n');
  console.log(`  ${hook ? '✅' : '⬜'} Claude Code 훅 (SessionEnd)   ${SETTINGS_PATH}`);
  console.log(`  ${agent ? '✅' : '⬜'} 매일 실행 (launchd)           ${AGENT_PLIST}`);
  if (!hook && !agent) {
    console.log('\n  ⚠️  둘 다 꺼져 있다. 도구를 직접 실행하지 않은 기간의 기록은');
    console.log('      원본이 30일 뒤 지우면서 함께 사라진다. `tamagit install` 로 켤 것.\n');
  } else {
    console.log('');
  }
}

async function main(): Promise<void> {
  const f = parseArgs(process.argv.slice(2));
  if (f.help) {
    console.log(HELP.trim());
    return;
  }
  const cfg = resolveConfig(f.opts);
  const both = !f.hookOnly && !f.agentOnly;

  switch (f.cmd) {
    case 'sync': {
      reportSync(sync(cfg, Date.now(), { notify: f.notify }), f.quiet);
      return;
    }
    case 'stats': {
      sync(cfg, Date.now(), { notify: f.notify });
      const stats = buildStats(cfg);
      if (f.json) console.log(JSON.stringify(stats, null, 2));
      else console.log(renderTerminal(stats));
      return;
    }
    case 'serve': {
      reportSync(sync(cfg, Date.now(), { notify: f.notify }), f.quiet);
      await serve(cfg);
      return;
    }
    case 'install': {
      if (both || f.hookOnly) {
        const r = installHook();
        console.log(`${r.changed ? '✅' : '➖'} Claude Code 훅: ${r.message}`);
        if (r.backup) console.log(`   백업: ${r.backup}`);
      }
      if (both || f.agentOnly) {
        const r = installAgent(f.at);
        console.log(`${r.changed ? '✅' : '➖'} 매일 실행: ${r.message}`);
      }
      console.log('\n이제 Claude Code 세션이 끝날 때마다, 그리고 매일 정해진 시각에 자동으로 적재된다.');
      console.log('해제는 `tamagit uninstall`.');
      return;
    }
    case 'uninstall': {
      if (both || f.hookOnly) {
        const r = uninstallHook();
        console.log(`${r.changed ? '✅' : '➖'} Claude Code 훅: ${r.message}`);
      }
      if (both || f.agentOnly) {
        const r = uninstallAgent();
        console.log(`${r.changed ? '✅' : '➖'} 매일 실행: ${r.message}`);
      }
      return;
    }
    case 'status': {
      reportStatus();
      return;
    }
    default:
      console.error(`알 수 없는 명령: ${f.cmd}\n`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
