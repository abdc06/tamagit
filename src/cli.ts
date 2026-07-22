#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { resolveConfig, type CliOverrides } from './core/config.ts';
import { dict, resolveLang, type Lang } from './core/i18n.ts';
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
      case '--lang':
        opts.lang = next();
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
          console.error(dict(resolveLang(opts.lang)).cli.unknownOption(a));
          process.exit(1);
        } else if (!cmd) cmd = a;
    }
  }
  return { cmd: cmd || 'serve', opts, json, help, notify, quiet, at, hookOnly, agentOnly };
}

function reportSync(r: ReturnType<typeof sync>, lang: Lang, quiet = false): void {
  const M = dict(lang).sync;
  if (quiet) {
    // 훅/자동 실행용 — 문제가 있을 때만 말한다
    if (r.parseErrors.length) {
      console.error(M.parseErrorsQuiet(r.parseErrors.length));
    }
    return;
  }
  if (r.skipped) {
    console.log(`⚠️  ${r.skipped}`);
    console.log(M.continuingWith(r.totalRows.toLocaleString()));
  } else {
    const added = r.newRows > 0 ? `+${r.newRows.toLocaleString()}` : M.noChange;
    console.log(M.ingested(r.sourceRows.toLocaleString(), added, r.totalRows.toLocaleString()));
  }
  console.log(M.runs(r.runs.toLocaleString(), r.bosses));
  if (r.parseErrors.length) {
    // 조용히 삼키지 않는다 — 포맷이 바뀐 신호일 수 있다
    console.log(M.parseErrors(r.parseErrors.length));
    for (const e of r.parseErrors.slice(0, 3)) {
      console.log(`     L${e.line} ${e.reason}: ${e.sample.slice(0, 60)}`);
    }
  }
  if (r.newAchievements.length) {
    console.log(M.newAchievements(r.newAchievements.length, r.newAchievements.join(', ')));
  }
  for (const n of r.nudges) {
    console.log(`🔔 ${n.title} — ${n.message}`);
  }
}

function reportStatus(lang: Lang): void {
  const I = dict(lang).install;
  const hook = isHookInstalled();
  const agent = isAgentInstalled();
  console.log(I.statusTitle);
  console.log(`  ${hook ? '✅' : '⬜'} ${I.labelHook}   ${SETTINGS_PATH}`);
  console.log(`  ${agent ? '✅' : '⬜'} ${I.labelAgent}   ${AGENT_PLIST}`);
  console.log(!hook && !agent ? I.bothOff : '');
}

async function main(): Promise<void> {
  const f = parseArgs(process.argv.slice(2));
  const cfg = resolveConfig(f.opts);
  const D = dict(cfg.lang);
  if (f.help) {
    console.log(D.cli.help.trim());
    return;
  }
  const both = !f.hookOnly && !f.agentOnly;

  switch (f.cmd) {
    case 'sync': {
      reportSync(sync(cfg, Date.now(), { notify: f.notify }), cfg.lang, f.quiet);
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
      reportSync(sync(cfg, Date.now(), { notify: f.notify }), cfg.lang, f.quiet);
      await serve(cfg);
      return;
    }
    case 'install': {
      if (both || f.hookOnly) {
        const r = installHook(undefined, undefined, undefined, cfg.lang);
        console.log(`${r.changed ? '✅' : '➖'} ${D.install.labelHook}: ${r.message}`);
        if (r.backup) console.log(D.install.backup(r.backup));
      }
      if (both || f.agentOnly) {
        const r = installAgent(f.at, undefined, cfg.lang);
        console.log(`${r.changed ? '✅' : '➖'} ${D.install.labelAgent.trim()}: ${r.message}`);
      }
      console.log(D.install.doneHint);
      return;
    }
    case 'uninstall': {
      if (both || f.hookOnly) {
        const r = uninstallHook(undefined, cfg.lang);
        console.log(`${r.changed ? '✅' : '➖'} ${D.install.labelHook}: ${r.message}`);
      }
      if (both || f.agentOnly) {
        const r = uninstallAgent(undefined, cfg.lang);
        console.log(`${r.changed ? '✅' : '➖'} ${D.install.labelAgent.trim()}: ${r.message}`);
      }
      return;
    }
    case 'status': {
      reportStatus(cfg.lang);
      return;
    }
    default:
      console.error(D.cli.unknownCommand(f.cmd) + '\n');
      console.log(D.cli.help.trim());
      process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(dict(resolveLang()).cli.failed, e instanceof Error ? e.message : e);
  process.exit(1);
});
