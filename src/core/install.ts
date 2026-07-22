import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dict, type Dict, type Lang } from './i18n.ts';

/**
 * 자동 적재 설치.
 *
 * 왜 필요한가: 원본 history.jsonl 은 30일 뒤 사라진다. 도구를 직접 실행할 때만 적재한다면
 * "30일 삭제 방어"가 사용자의 기억력에 의존하게 된다. 한 달 안 켜면 그 기간 기록은 영구 소실이다.
 *
 * 두 겹으로 막는다:
 *   1. Claude Code SessionEnd 훅 — 세션이 끝날 때마다 적재 (데이터 소스가 발생하는 바로 그 자리)
 *   2. launchd 데일리 — Claude Code 를 안 켠 날에도 돌고, 스트릭 경고를 띄운다
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = join(HERE, '..', 'cli.ts');
export const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
export const AGENT_LABEL = 'com.tamagit.daily';
export const AGENT_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);

const HOOK_EVENT = 'SessionEnd';

/**
 * node 를 `node <flags> script.ts` 로 띄울 때는 셰뱅의 플래그가 적용되지 않는다.
 * 빼먹으면 훅/자동 실행이 매번 ExperimentalWarning 을 stderr 로 흘린다.
 */
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning'];

interface HookCommand {
  type: string;
  command: string;
  args?: string[];
  async?: boolean;
  timeout?: number;
  statusMessage?: string;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
  [k: string]: unknown;
}
type Settings = Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
};

/** 우리가 심은 항목인지 — 경로에 tamagit 이 들어가는지로 판별한다 */
function isOurs(x: unknown): boolean {
  return JSON.stringify(x ?? '').includes('tamagit');
}

/**
 * 버전이 박히지 않은 node 경로를 찾는다.
 *
 * process.execPath 는 Homebrew 에서 /opt/homebrew/Cellar/node/23.6.0/bin/node 처럼 나온다.
 * 그대로 박아두면 node 를 올리는 순간 훅이 조용히 죽는다 — 자동 적재가 죽는 걸 알아채기 어렵다.
 * 같은 실체를 가리키는 안정 심볼릭 링크가 있으면 그쪽을 쓴다.
 */
export function stableNodePath(execPath = process.execPath): string {
  let real: string;
  try {
    real = realpathSync(execPath);
  } catch {
    return execPath;
  }
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  for (const c of candidates) {
    try {
      if (realpathSync(c) === real) return c;
    } catch {
      // 없는 경로 — 다음 후보로
    }
  }
  return execPath;
}

function buildHookGroup(nodePath: string, cliPath: string, L: Dict['install']): HookGroup {
  return {
    hooks: [
      {
        type: 'command',
        // exec 형태(args)를 쓰면 셸을 거치지 않는다 — 경로에 공백/따옴표가 있어도 안전하다
        command: nodePath,
        args: [...NODE_FLAGS, cliPath, 'sync', '--notify', '--quiet'],
        async: true,
        timeout: 30,
        statusMessage: L.statusMessage,
      },
    ],
  };
}

function readSettings(path: string, lang: Lang): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(dict(lang).parse.notTopLevelObject);
    }
    return parsed as Settings;
  } catch (e) {
    // 깨진 settings.json 을 덮어쓰면 사용자의 다른 설정이 전부 날아간다 — 멈춘다
    throw new Error(
      dict(lang).install.unreadable(path, String(e instanceof Error ? e.message : e)),
    );
  }
}

function writeSettingsWithBackup(path: string, settings: Settings): string | null {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | null = null;
  if (existsSync(path)) {
    backup = `${path}.tamagit-backup`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return backup;
}

export interface HookResult {
  changed: boolean;
  message: string;
  backup?: string | null;
}

export function installHook(
  settingsPath = SETTINGS_PATH,
  nodePath = stableNodePath(),
  cliPath = CLI_PATH,
  lang: Lang = 'en',
): HookResult {
  const L = dict(lang).install;
  const settings = readSettings(settingsPath, lang);
  const hooks = (settings.hooks ??= {});
  const groups = (hooks[HOOK_EVENT] ??= []);

  // 이미 있으면 최신 경로로 갱신만 한다 (중복 등록 방지)
  const mineIdx = groups.findIndex(isOurs);
  const fresh = buildHookGroup(nodePath, cliPath, L);
  if (mineIdx >= 0) {
    const before = JSON.stringify(groups[mineIdx]);
    groups[mineIdx] = fresh;
    if (before === JSON.stringify(fresh)) {
      return { changed: false, message: L.hookAlready };
    }
    const backup = writeSettingsWithBackup(settingsPath, settings);
    return { changed: true, message: L.hookUpdated, backup };
  }

  groups.push(fresh);
  const backup = writeSettingsWithBackup(settingsPath, settings);
  return { changed: true, message: L.hookInstalled, backup };
}

export function uninstallHook(settingsPath = SETTINGS_PATH, lang: Lang = 'en'): HookResult {
  const L = dict(lang).install;
  if (!existsSync(settingsPath)) return { changed: false, message: L.noSettings };
  const settings = readSettings(settingsPath, lang);
  const groups = settings.hooks?.[HOOK_EVENT];
  if (!groups?.length) return { changed: false, message: L.hookNone };

  const kept = groups.filter((g) => !isOurs(g));
  if (kept.length === groups.length) return { changed: false, message: L.hookNone };

  // 남의 설정은 건드리지 않는다 — 비어야만 키를 지운다
  if (kept.length) settings.hooks![HOOK_EVENT] = kept;
  else delete settings.hooks![HOOK_EVENT];
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const backup = writeSettingsWithBackup(settingsPath, settings);
  return { changed: true, message: L.hookRemoved, backup };
}

export function isHookInstalled(settingsPath = SETTINGS_PATH): boolean {
  const lang: Lang = 'en';
  if (!existsSync(settingsPath)) return false;
  try {
    return (readSettings(settingsPath, lang).hooks?.[HOOK_EVENT] ?? []).some(isOurs);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- launchd

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildPlist(
  nodePath: string,
  cliPath: string,
  hour: number,
  logPath: string,
): string {
  const args = [nodePath, ...NODE_FLAGS, cliPath, 'sync', '--notify', '--quiet']
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

export interface AgentResult {
  changed: boolean;
  message: string;
  plistPath?: string;
}

function launchctl(args: string[]): { ok: boolean; err: string } {
  try {
    execFileSync('launchctl', args, { stdio: 'pipe', timeout: 10_000 });
    return { ok: true, err: '' };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, err };
  }
}

export function installAgent(hour = 21, plistPath = AGENT_PLIST, lang: Lang = 'en'): AgentResult {
  const L = dict(lang).install;
  if (process.platform !== 'darwin') {
    return { changed: false, message: L.agentMacOnly };
  }
  const logPath = join(homedir(), '.tamagit', 'launchd.log');
  mkdirSync(dirname(logPath), { recursive: true });
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, buildPlist(stableNodePath(), CLI_PATH, hour, logPath));

  const domain = `gui/${userInfo().uid}`;
  launchctl(['bootout', `${domain}/${AGENT_LABEL}`]); // 기존 등록 해제 (없으면 실패해도 무시)
  const boot = launchctl(['bootstrap', domain, plistPath]);
  if (!boot.ok) {
    return {
      changed: true,
      plistPath,
      message: L.agentPartial(`launchctl bootstrap ${domain} ${plistPath}`),
    };
  }
  return { changed: true, plistPath, message: L.agentScheduled(hour) };
}

export function uninstallAgent(plistPath = AGENT_PLIST, lang: Lang = 'en'): AgentResult {
  const L = dict(lang).install;
  if (process.platform !== 'darwin') return { changed: false, message: L.agentMacOnly };
  const existed = existsSync(plistPath);
  launchctl(['bootout', `gui/${userInfo().uid}/${AGENT_LABEL}`]);
  if (existed) rmSync(plistPath, { force: true });
  return {
    changed: existed,
    message: existed ? L.agentRemoved : L.agentNone,
  };
}

export function isAgentInstalled(plistPath = AGENT_PLIST): boolean {
  return existsSync(plistPath);
}
