#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { resolveConfig, type CliOverrides, type Config } from './core/config.ts';
import { dict, resolveLang, type Lang } from './core/i18n.ts';
import { makeClock } from './core/clock.ts';
import { openDb } from './core/db.ts';
import {
  addAlias,
  applyAliases,
  expandPath,
  isExplicitPath,
  listAliases,
  loadAliases,
  matchProject,
  projectSummaries,
  removeAlias,
} from './core/projects.ts';
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
  /** cmd 뒤에 온 위치 인자 (`projects merge <a> <b>` 같은 하위 명령) */
  args: string[];
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
  const args: string[] = [];
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
        else args.push(a);
    }
  }
  return { cmd: cmd || 'serve', args, opts, json, help, notify, quiet, at, hookOnly, agentOnly };
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
  if (r.remappedRows > 0) console.log(M.remapped(r.remappedRows.toLocaleString()));
  if (r.newAchievements.length) {
    console.log(M.newAchievements(r.newAchievements.length, r.newAchievements.join(', ')));
  }
  for (const n of r.nudges) {
    console.log(`🔔 ${n.title} — ${n.message}`);
  }
}

/**
 * 프로젝트 목록 · 개명으로 쪼개진 경로 통합.
 * 종료 코드를 돌려준다 (0 = 성공).
 */
function runProjects(cfg: Config, args: string[]): number {
  const P = dict(cfg.lang).projects;
  const [sub, from, to] = args;
  const db = openDb(cfg.dbPath);
  try {
    const summaries = projectSummaries(db);
    // 이미 통합해서 DB 에 행이 남아있지 않은 옛 경로도 인자로 받아야 한다
    // (그래야 두 번째 merge 가 사슬/순환 검사에 제대로 걸린다)
    const known = [...new Set([...summaries.map((s) => s.project), ...listAliases(db).map((a) => a.from)])];

    if (!sub) {
      if (summaries.length === 0) {
        console.log(P.empty);
        return 0;
      }
      const clock = makeClock(cfg.timeZone, cfg.dayStartHour);
      const width = Math.max(...summaries.map((s) => s.prompts.toLocaleString().length));
      console.log(P.title(summaries.length));
      for (const s of summaries) {
        const n = s.prompts.toLocaleString().padStart(width);
        console.log(`  ${n}  ${s.exists ? '✓' : '✗'}  ${s.project}  ${clock.dayKey(s.lastTs)}`);
      }
      if (summaries.some((s) => !s.exists)) {
        console.log(`\n${P.legendMissing}`);
        console.log(P.mergeHint);
      }
      const aliases = listAliases(db);
      if (aliases.length) {
        console.log(P.aliasesTitle);
        for (const a of aliases) console.log(`  ${a.from}\n    → ${a.to}`);
      }
      return 0;
    }

    if (sub === 'merge') {
      if (!from || !to) {
        console.error(P.usage);
        return 1;
      }
      // 원본은 반드시 DB 에 있어야 한다 — 오타를 규칙으로 굳히면 조용히 안 맞는다
      const src = matchProject(known, from);
      if (!src.ok) {
        console.error(src.reason === 'none' ? P.notFound(from) : P.ambiguous(from));
        if (src.reason === 'ambiguous') for (const c of src.candidates) console.error(`  ${c}`);
        return 1;
      }
      // 대상은 아직 기록이 없을 수도 있다 (먼저 개명하고 아직 안 열어본 경우) —
      // 단 그때는 절대경로로 명시해야 한다. 맨이름을 cwd 로 펴면 엉뚱한 경로가 굳는다.
      const dst = matchProject(known, to);
      if (!dst.ok && dst.reason === 'ambiguous') {
        console.error(P.ambiguous(to));
        for (const c of dst.candidates) console.error(`  ${c}`);
        return 1;
      }
      if (!dst.ok && !isExplicitPath(to)) {
        console.error(P.notFound(to));
        return 1;
      }
      const target = dst.ok ? dst.project : expandPath(to);

      const added = addAlias(db, src.project, target, Date.now());
      if (!added.ok) {
        console.error(added.reason === 'same' ? P.same : P.cycle(src.project, target));
        return 1;
      }
      const moved = applyAliases(db, loadAliases(db));
      console.log(P.merged(src.project, target));
      console.log(P.mergedRows(moved.toLocaleString()));
      return 0;
    }

    if (sub === 'unmerge') {
      if (!from) {
        console.error(P.usage);
        return 1;
      }
      const rules = listAliases(db).map((a) => a.from);
      const src = matchProject(rules, from);
      if (!src.ok) {
        console.error(src.reason === 'none' ? P.noAlias(from) : P.ambiguous(from));
        if (src.reason === 'ambiguous') for (const c of src.candidates) console.error(`  ${c}`);
        return 1;
      }
      removeAlias(db, src.project);
      console.log(P.unmerged(src.project));
      return 0;
    }

    console.error(P.usage);
    return 1;
  } finally {
    db.close();
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
    case 'projects': {
      const code = runProjects(cfg, f.args);
      if (code !== 0) process.exit(code);
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
