/**
 * 메시지 카탈로그.
 *
 * 기본은 영어다 — OSS 배포 대상이 데브 커뮤니티이기 때문.
 * 한국어는 `--lang ko` 또는 `TAMAGIT_LANG=ko` 로 켠다.
 * 로케일 자동 감지는 하지 않는다: "기본이 영어"라는 계약이 환경에 따라 흔들리면 안 된다.
 */

export type Lang = 'en' | 'ko';
export const LANGS: Lang[] = ['en', 'ko'];
export const DEFAULT_LANG: Lang = 'en';

export function resolveLang(explicit?: string): Lang {
  const raw = (explicit ?? process.env.TAMAGIT_LANG ?? '').toLowerCase().trim();
  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

export type PetMoodKey = 'asleep' | 'bored' | 'content' | 'happy' | 'blazing';

export interface Dict {
  /** 업적 표시명 (id 기준) */
  ach: Record<string, { name: string; desc: string }>;
  /** 펫 진화 단계명 (stage 인덱스 기준) */
  petStage: string[];
  petMood: Record<PetMoodKey, string>;
  petLine: (mood: PetMoodKey, streak: number, atRisk: boolean) => string;

  cli: {
    help: string;
    unknownCommand: (c: string) => string;
    unknownOption: (o: string) => string;
    failed: string;
    dashboardAt: (url: string) => string;
    stopHint: string;
    notFound: string;
  };

  /** 파서 진단 사유 */
  parse: {
    badJson: string;
    notObject: string;
    badTimestamp: string;
    noSessionId: string;
    notTopLevelObject: string;
  };

  sync: {
    sourceMissing: (p: string) => string;
    continuingWith: (n: string) => string;
    ingested: (rows: string, delta: string, total: string) => string;
    noChange: string;
    runs: (runs: string, bosses: number) => string;
    parseErrors: (n: number) => string;
    parseErrorsQuiet: (n: number) => string;
    newAchievements: (n: number, ids: string) => string;
    remapped: (rows: string) => string;
  };

  projects: {
    title: (n: number) => string;
    empty: string;
    legendMissing: string;
    mergeHint: string;
    aliasesTitle: string;
    merged: (from: string, to: string) => string;
    mergedRows: (rows: string) => string;
    unmerged: (from: string) => string;
    noAlias: (from: string) => string;
    usage: string;
    notFound: (input: string) => string;
    ambiguous: (input: string) => string;
    same: string;
    cycle: (from: string, to: string) => string;
  };

  install: {
    hookInstalled: string;
    hookUpdated: string;
    hookAlready: string;
    hookRemoved: string;
    hookNone: string;
    noSettings: string;
    unreadable: (p: string, why: string) => string;
    agentMacOnly: string;
    agentScheduled: (h: number) => string;
    agentPartial: (cmd: string) => string;
    agentRemoved: string;
    agentNone: string;
    labelHook: string;
    labelAgent: string;
    statusTitle: string;
    bothOff: string;
    backup: (p: string) => string;
    statusMessage: string;
    doneHint: string;
  };

  notify: {
    levelUp: (icon: string, level: number) => string;
    levelUpBody: (from: number, to: number, xp: string) => string;
    levelUpJump: (from: number, to: number, gained: number) => string;
    achievement: (icon: string) => string;
    achievementMore: (desc: string, more: number) => string;
    streakRisk: (days: number) => string;
    streakRiskRecord: string;
    streakRiskBody: (longest: number) => string;
  };

  term: {
    today: string;
    streak: string;
    totals: string;
    recentDays: (n: number) => string;
    perCell: string;
    bestDays: string;
    topProjects: string;
    achievements: string;
    xpOf: (into: string, needed: string) => string;
    totalXp: (xp: string) => string;
    todayLine: (xp: string, prompts: string, bosses: number) => string;
    streakLine: (cur: number, longest: number) => string;
    atRisk: string;
    totalsLine: (p: string, r: string, b: number, proj: number) => string;
    preserved: (days: number) => string;
    preservedBeyond: (days: number) => string;
    consecutive: (n: number) => string;
    prompts: string;
    dayStartAt: (h: number) => string;
  };

  /** 대시보드(브라우저)에서 쓰는 문자열 */
  web: Record<string, string>;
}

const EN: Dict = {
  ach: {
    'first-step': { name: 'First Step', desc: 'Sent your first prompt' },
    'streak-7': { name: 'Week of Discipline', desc: 'Coded 7 days in a row' },
    'streak-30': { name: 'Month of Practice', desc: 'Coded 30 days in a row' },
    'night-owl': { name: 'Night Owl', desc: '100 prompts between 8pm and midnight' },
    'witching-hour': { name: 'Witching Hour', desc: 'Coded between 2am and 5am' },
    'boss-slayer': { name: 'Boss Hunter', desc: 'Cleared 10 boss fights' },
    wordsmith: { name: 'Wordsmith', desc: '10 prompts of 500+ characters' },
    wanderer: { name: 'Wanderer', desc: 'Worked across 10 different projects' },
    frenzy: { name: 'Frenzy', desc: '200 prompts in a single day' },
    pioneer: { name: 'Pioneer', desc: '1,000 prompts in one project' },
  },
  petStage: ['Egg', 'Hatchling', 'Code Lizard', 'Drake', 'Code Dragon', 'Astral Wyrm'],
  petMood: {
    asleep: 'asleep',
    bored: 'restless',
    content: 'content',
    happy: 'excited',
    blazing: 'on fire',
  },
  petLine: (mood, streak, atRisk) => {
    switch (mood) {
      case 'asleep':
        return '…zzz. Waiting for today’s first prompt.';
      case 'bored':
        return atRisk
          ? `Your ${streak}-day streak breaks today. One prompt is enough.`
          : 'Nothing has happened yet today.';
      case 'content':
        return 'Good. Warmed up.';
      case 'happy':
        return 'Running well today!';
      case 'blazing':
        return streak >= 14 ? `${streak} days straight. The scales are glowing.` : 'Don’t stop. This is the peak.';
    }
  },

  cli: {
    help: `
tamagit — turn your Claude Code activity into an RPG

Usage
  tamagit [command] [options]

Commands
  serve            ingest, then open the local dashboard (default)
  sync             ingest history.jsonl into the local DB only
  stats            print a summary in the terminal
  projects         list projects; merge paths split by a folder rename
  install          enable auto-capture (Claude Code hook + daily job)
  uninstall        disable auto-capture
  status           show what auto-capture is enabled

Options
  --lang <en|ko>     output language     (default en, or $TAMAGIT_LANG)
  --history <path>   source file         (default ~/.claude/history.jsonl)
  --db <path>        database            (default ~/.tamagit/data.db)
  --tz <zone>        timezone            (default Asia/Seoul)
  --day-start <h>    day boundary        (default 4 — 4am)
  --idle <min>       run split gap       (default 30 min)
  --port <n>         dashboard port      (default 4173)
  --notify           level-ups, achievements and streak warnings as OS notifications
  --quiet            minimal output (for hooks and scheduled runs)
  --at <h>           daily run hour      (default 21 — 9pm)
  --hook-only        install/uninstall the Claude Code hook only
  --agent-only       install/uninstall the daily job only
  --json             emit stats as JSON
  -h, --help         this help

Why auto-capture matters
  history.jsonl is deleted after 30 days. If tamagit only ingests when you run
  it by hand, any stretch you forget about is lost permanently. \`install\` puts
  two layers in the way.
`,
    unknownCommand: (c) => `Unknown command: ${c}`,
    unknownOption: (o) => `Unknown option: ${o}`,
    failed: 'Failed:',
    dashboardAt: (url) => `\n🎮 Dashboard: ${url}`,
    stopHint: '   Press Ctrl+C to stop\n',
    notFound: 'not found',
  },

  parse: {
    badJson: 'invalid JSON',
    notObject: 'not an object',
    badTimestamp: 'missing or invalid timestamp',
    noSessionId: 'missing sessionId',
    notTopLevelObject: 'top level is not an object',
  },

  sync: {
    sourceMissing: (p) => `Source not found: ${p}`,
    continuingWith: (n) => `   Continuing with ${n} rows already in the database.`,
    ingested: (rows, delta, total) =>
      `📥 Ingested — ${rows} source lines, ${delta}, ${total} rows in DB`,
    noChange: 'no change',
    runs: (runs, bosses) => `   ${runs} focus runs (${bosses} boss fights)`,
    parseErrors: (n) => `⚠️  ${n} unparsable lines — the format may have changed:`,
    parseErrorsQuiet: (n) => `tamagit: ${n} unparsable lines — possible history.jsonl format change`,
    newAchievements: (n, ids) => `🏆 ${n} new achievement(s): ${ids}`,
    remapped: (rows) => `   ${rows} rows moved to their merged project path`,
  },

  projects: {
    title: (n) => `\nProjects (${n})\n`,
    empty: 'Nothing ingested yet. Run `tamagit sync` first.',
    legendMissing: '  ✗ = path is gone from disk — renamed, moved or deleted',
    mergeHint:
      '  Renamed a folder? Its history is split in two. Merge it:\n' +
      '    tamagit projects merge <old> <new>',
    aliasesTitle: '\nMerged paths',
    merged: (from, to) => `✅ Merged: ${from}\n           → ${to}`,
    mergedRows: (rows) => `   ${rows} rows moved. New rows on the old path will follow from now on.`,
    unmerged: (from) => `✅ Merge rule removed: ${from}\n   Rows already moved stay where they are.`,
    noAlias: (from) => `No merge rule for: ${from}`,
    usage:
      'Usage\n' +
      '  tamagit projects                      list projects\n' +
      '  tamagit projects merge <old> <new>    treat <old> as <new>\n' +
      '  tamagit projects unmerge <old>        drop that rule\n\n' +
      'Paths may be full or just the trailing folder name.',
    notFound: (input) => `No project matches: ${input}`,
    ambiguous: (input) => `"${input}" matches more than one project — use a longer path:`,
    same: 'Source and target are the same path.',
    cycle: (from, to) => `That would loop: ${to} already resolves back to ${from}.`,
  },

  install: {
    hookInstalled: 'SessionEnd hook installed',
    hookUpdated: 'SessionEnd hook path updated',
    hookAlready: 'already installed (SessionEnd)',
    hookRemoved: 'SessionEnd hook removed',
    hookNone: 'no hook installed',
    noSettings: 'settings.json does not exist',
    unreadable: (p, why) => `Cannot read ${p} (${why}). Fix it by hand and retry.`,
    agentMacOnly: 'launchd is macOS-only — use cron elsewhere',
    agentScheduled: (h) => `scheduled daily at ${h}:00`,
    agentPartial: (cmd) => `plist written but registration failed. Run manually:\n     ${cmd}`,
    agentRemoved: 'daily job removed',
    agentNone: 'no daily job registered',
    labelHook: 'Claude Code hook (SessionEnd)',
    labelAgent: 'Daily job (launchd)      ',
    statusTitle: '\nAuto-capture status\n',
    bothOff:
      '\n  ⚠️  Both are off. Anything you never ingest by hand disappears\n' +
      '      when the source is deleted after 30 days. Run `tamagit install`.\n',
    backup: (p) => `   backup: ${p}`,
    statusMessage: 'tamagit ingesting',
    doneHint:
      '\nFrom now on tamagit ingests when a Claude Code session ends, and once a day.\n' +
      'Undo with `tamagit uninstall`.',
  },

  notify: {
    levelUp: (icon, level) => `${icon} Reached Lv.${level}`,
    levelUpBody: (from, to, xp) => `${from} → ${to}. ${xp} XP total`,
    levelUpJump: (from, to, gained) => `${from} → ${to} (+${gained} levels)`,
    achievement: (icon) => `${icon} Achievement unlocked`,
    achievementMore: (desc, more) => `${desc} and ${more} more`,
    streakRisk: (days) => `🔥 Your ${days}-day streak breaks today`,
    streakRiskRecord: 'You are on your longest run yet. One prompt keeps it alive.',
    streakRiskBody: (longest) => `Longest: ${longest} days. One prompt keeps it alive.`,
  },

  term: {
    today: 'TODAY',
    streak: 'STREAK',
    totals: 'TOTAL',
    recentDays: (n) => `Last ${n} days`,
    perCell: '(one cell = one day)',
    bestDays: 'Best days',
    topProjects: 'Top projects',
    achievements: 'Achievements',
    xpOf: (into, needed) => `${into}/${needed}`,
    totalXp: (xp) => `${xp} XP total`,
    todayLine: (xp, prompts, bosses) => `${xp} XP  ·  ${prompts} prompts  ·  ${bosses} boss`,
    streakLine: (cur, longest) => `${cur} days  ·  longest ${longest}`,
    atRisk: '(breaks if you skip today)',
    totalsLine: (p, r, b, proj) =>
      `${p} prompts  ·  ${r} runs  ·  ${b} bosses  ·  ${proj} projects`,
    preserved: (days) => `🛡  ${days} days preserved · standing by for the 30-day deletion`,
    preservedBeyond: (days) => `🛡  Preserving ${days} days the source has already deleted`,
    consecutive: (n) => `${n} days`,
    prompts: 'p',
    dayStartAt: (h) => `day starts ${h}:00`,
  },

  web: {
    title: 'tamagit',
    dayStart: 'day starts',
    focusGap: 'focus gap',
    lastSync: 'last ingest',
    nextLevel: 'to next level',
    totalXpSuffix: 'XP total',
    todayXp: 'XP today',
    promptsCount: '{n} prompts',
    streakLabel: 'Streak',
    breaksToday: 'breaks if you skip today',
    longest: 'longest {n}',
    totalPrompts: 'Total prompts',
    activeDays: '{a} active of {b} days',
    streakValue: '{n}d',
    bossCleared: 'Boss fights cleared',
    focusRuns: '{n} focus runs',
    totalFocus: 'Total focus time',
    projects: '{n} projects',
    heatmap: 'Activity heatmap',
    heatmapNote: 'one cell per day — brighter means more earned',
    less: 'less',
    more: 'more',
    last30: 'Last 30 days of XP',
    topProjects: 'Top projects',
    hours: 'By hour',
    peak: 'peak',
    recentBosses: 'Recent boss fights',
    clearedSuffix: 'cleared',
    noBosses:
      'No boss fights yet. Keep going 60+ minutes with 15+ prompts and no 30-minute gap.',
    achievements: 'Achievements',
    unlockedSuffix: 'unlocked',
    achievedOn: 'unlocked',
    min: 'min',
    items: '',
    shieldPreserving: 'days preserved. The source is deleted after 30 days; this DB is not.',
    shieldBeyond: 'days the source has already deleted are preserved in the local DB.',
    shieldError: 'unparsable lines — history.jsonl may have changed format. Check the terminal log.',
    loading: 'Loading…',
    loadFailed: 'Failed to load',
    noData: 'No data yet.',
  },
};

const KO: Dict = {
  ach: {
    'first-step': { name: '첫 발자국', desc: '첫 프롬프트를 보냈다' },
    'streak-7': { name: '일주일의 규율', desc: '7일 연속으로 코딩했다' },
    'streak-30': { name: '한 달의 수행', desc: '30일 연속으로 코딩했다' },
    'night-owl': { name: '야행성', desc: '밤 20~23시에 프롬프트 100건' },
    'witching-hour': { name: '마의 시간', desc: '새벽 2~4시에 코딩했다' },
    'boss-slayer': { name: '보스 헌터', desc: '보스전 10회 클리어' },
    wordsmith: { name: '장인의 문장', desc: '500자 이상 프롬프트 10건' },
    wanderer: { name: '방랑자', desc: '서로 다른 프로젝트 10곳에서 활동' },
    frenzy: { name: '폭주', desc: '하루에 프롬프트 200건' },
    pioneer: { name: '개척자', desc: '한 프로젝트에 프롬프트 1,000건' },
  },
  petStage: ['알', '해츨링', '코드 리저드', '드레이크', '코드 드래곤', '성좌룡'],
  petMood: {
    asleep: '자는 중',
    bored: '심심함',
    content: '흡족함',
    happy: '신남',
    blazing: '불타는 중',
  },
  petLine: (mood, streak, atRisk) => {
    switch (mood) {
      case 'asleep':
        return '…zzz. 오늘 첫 프롬프트를 기다리는 중.';
      case 'bored':
        return atRisk ? `${streak}일 연속이 오늘 끊긴다. 한 건만 넣어줘.` : '오늘은 아직 아무 일도 없었다.';
      case 'content':
        return '좋아, 몸이 풀렸다.';
      case 'happy':
        return '오늘 잘 달리고 있다!';
      case 'blazing':
        return streak >= 14 ? `${streak}일 연속. 비늘이 빛난다.` : '멈추지 마라. 지금이 절정이다.';
    }
  },

  cli: {
    help: `
tamagit — Claude Code 활동을 읽어 코딩을 RPG로

사용법
  tamagit [command] [options]

명령
  serve            적재 후 로컬 대시보드를 띄운다 (기본값)
  sync             history.jsonl 을 로컬 DB에 적재만 한다
  stats            터미널에 현황을 출력한다
  projects         프로젝트 목록 · 개명으로 쪼개진 경로를 합친다
  install          자동 적재를 건다 (Claude Code 훅 + 매일 실행)
  uninstall        자동 적재를 해제한다
  status           자동 적재 설치 상태를 본다

옵션
  --lang <en|ko>     출력 언어       (기본 en, 또는 $TAMAGIT_LANG)
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
`,
    unknownCommand: (c) => `알 수 없는 명령: ${c}`,
    unknownOption: (o) => `알 수 없는 옵션: ${o}`,
    failed: '실패:',
    dashboardAt: (url) => `\n🎮 대시보드: ${url}`,
    stopHint: '   중지하려면 Ctrl+C\n',
    notFound: 'not found',
  },

  parse: {
    badJson: 'JSON 파싱 실패',
    notObject: '객체가 아님',
    badTimestamp: 'timestamp 없음/비정상',
    noSessionId: 'sessionId 없음',
    notTopLevelObject: '최상위가 객체가 아님',
  },

  sync: {
    sourceMissing: (p) => `원본 없음: ${p}`,
    continuingWith: (n) => `   DB에 적재된 ${n}건으로 계속 진행한다.`,
    ingested: (rows, delta, total) => `📥 적재 완료 — 원본 ${rows}줄, ${delta}, DB 누적 ${total}건`,
    noChange: '변화 없음',
    runs: (runs, bosses) => `   몰입 구간 ${runs}개 (보스전 ${bosses}회)`,
    parseErrors: (n) => `⚠️  파싱 실패 ${n}줄 — 포맷이 바뀌었을 수 있다:`,
    parseErrorsQuiet: (n) => `tamagit: 파싱 실패 ${n}줄 — history.jsonl 포맷 변화 의심`,
    newAchievements: (n, ids) => `🏆 새 업적 ${n}개: ${ids}`,
    remapped: (rows) => `   ${rows}건을 합쳐진 프로젝트 경로로 옮겼다`,
  },

  projects: {
    title: (n) => `\n프로젝트 (${n}곳)\n`,
    empty: '아직 적재된 기록이 없다. `tamagit sync` 를 먼저 실행할 것.',
    legendMissing: '  ✗ = 디스크에 없는 경로 — 개명·이동·삭제됐다',
    mergeHint:
      '  폴더 이름을 바꿨다면 기록이 둘로 쪼개져 있다. 합치려면:\n' +
      '    tamagit projects merge <옛경로> <새경로>',
    aliasesTitle: '\n합쳐진 경로',
    merged: (from, to) => `✅ 합쳤다: ${from}\n           → ${to}`,
    mergedRows: (rows) => `   ${rows}건을 옮겼다. 앞으로 옛 경로로 들어오는 기록도 자동으로 따라온다.`,
    unmerged: (from) => `✅ 통합 규칙을 지웠다: ${from}\n   이미 옮겨진 기록은 그대로 둔다.`,
    noAlias: (from) => `통합 규칙이 없다: ${from}`,
    usage:
      '사용법\n' +
      '  tamagit projects                        프로젝트 목록\n' +
      '  tamagit projects merge <옛것> <새것>    옛 경로를 새 경로로 취급한다\n' +
      '  tamagit projects unmerge <옛것>         그 규칙을 해제한다\n\n' +
      '경로는 전체 경로도, 끝 폴더 이름만도 받는다.',
    notFound: (input) => `일치하는 프로젝트가 없다: ${input}`,
    ambiguous: (input) => `"${input}" 에 해당하는 프로젝트가 여럿이다 — 경로를 더 길게 줄 것:`,
    same: '원본과 대상이 같은 경로다.',
    cycle: (from, to) => `순환이 된다: ${to} 는 이미 ${from} 으로 되돌아온다.`,
  },

  install: {
    hookInstalled: 'SessionEnd 훅을 설치했다',
    hookUpdated: 'SessionEnd 훅 경로를 갱신했다',
    hookAlready: '이미 설치돼 있다 (SessionEnd)',
    hookRemoved: 'SessionEnd 훅을 제거했다',
    hookNone: '설치된 훅이 없다',
    noSettings: 'settings.json 이 없다',
    unreadable: (p, why) => `${p} 를 읽을 수 없다 (${why}). 직접 고친 뒤 다시 실행할 것.`,
    agentMacOnly: 'launchd 는 macOS 전용이다 — cron 을 쓸 것',
    agentScheduled: (h) => `매일 ${h}시 자동 실행 등록됨`,
    agentPartial: (cmd) => `plist 는 썼지만 등록에 실패했다. 수동 실행:\n     ${cmd}`,
    agentRemoved: '자동 실행을 해제했다',
    agentNone: '등록된 자동 실행이 없다',
    labelHook: 'Claude Code 훅 (SessionEnd)',
    labelAgent: '매일 실행 (launchd)        ',
    statusTitle: '\n자동 적재 상태\n',
    bothOff:
      '\n  ⚠️  둘 다 꺼져 있다. 도구를 직접 실행하지 않은 기간의 기록은\n' +
      '      원본이 30일 뒤 지우면서 함께 사라진다. `tamagit install` 로 켤 것.\n',
    backup: (p) => `   백업: ${p}`,
    statusMessage: 'tamagit 적재 중',
    doneHint:
      '\n이제 Claude Code 세션이 끝날 때마다, 그리고 매일 정해진 시각에 자동으로 적재된다.\n' +
      '해제는 `tamagit uninstall`.',
  },

  notify: {
    levelUp: (icon, level) => `${icon} Lv.${level} 달성`,
    levelUpBody: (from, to, xp) => `${from} → ${to}. 총 ${xp} XP`,
    levelUpJump: (from, to, gained) => `${from} → ${to} (${gained}레벨 상승)`,
    achievement: (icon) => `${icon} 업적 해금`,
    achievementMore: (desc, more) => `${desc} 외 ${more}개`,
    streakRisk: (days) => `🔥 ${days}일 연속이 오늘 끊긴다`,
    streakRiskRecord: '최장 기록을 갱신 중이다. 한 건만 넣어도 유지된다.',
    streakRiskBody: (longest) => `최장 ${longest}일. 한 건만 넣어도 유지된다.`,
  },

  term: {
    today: '오늘',
    streak: '스트릭',
    totals: '누적',
    recentDays: (n) => `최근 ${n}일`,
    perCell: '(각 칸 = 하루)',
    bestDays: '최고의 날',
    topProjects: '주력 프로젝트',
    achievements: '업적',
    xpOf: (into, needed) => `${into}/${needed}`,
    totalXp: (xp) => `총 ${xp} XP`,
    todayLine: (xp, prompts, bosses) => `${xp} XP  ·  프롬프트 ${prompts}  ·  보스전 ${bosses}`,
    streakLine: (cur, longest) => `${cur}일 연속  ·  최장 ${longest}일`,
    atRisk: '(오늘 안 하면 끊김)',
    totalsLine: (p, r, b, proj) =>
      `프롬프트 ${p}  ·  몰입구간 ${r}  ·  보스 ${b}  ·  프로젝트 ${proj}`,
    preserved: (days) => `🛡  DB 보존 ${days}일치 · 원본 30일 삭제 방어 대기 중`,
    preservedBeyond: (days) => `🛡  원본이 이미 지운 ${days}일치를 DB가 보존 중`,
    consecutive: (n) => `${n}일`,
    prompts: 'p',
    dayStartAt: (h) => `하루 시작 ${h}시`,
  },

  web: {
    title: 'tamagit',
    dayStart: '하루 시작',
    focusGap: '몰입 판정 유휴',
    lastSync: '마지막 적재',
    nextLevel: '다음 레벨까지',
    totalXpSuffix: 'XP',
    todayXp: '오늘 XP',
    promptsCount: '프롬프트 {n}건',
    streakLabel: '연속 기록',
    breaksToday: '오늘 안 하면 끊긴다',
    longest: '최장 {n}일',
    totalPrompts: '누적 프롬프트',
    activeDays: '{b}일 중 {a}일 활동',
    streakValue: '{n}일',
    bossCleared: '보스전 클리어',
    focusRuns: '몰입 구간 {n}개',
    totalFocus: '총 몰입 시간',
    projects: '프로젝트 {n}곳',
    heatmap: '활동 히트맵',
    heatmapNote: '하루 = 한 칸, 밝을수록 많이 벌었다',
    less: '적음',
    more: '많음',
    last30: '최근 30일 XP',
    topProjects: '주력 프로젝트',
    hours: '시간대',
    peak: '피크',
    recentBosses: '최근 보스전',
    clearedSuffix: '클리어',
    noBosses: '아직 보스전이 없다. 유휴 30분 없이 60분 이상 · 15건 이상을 이어가면 잡힌다.',
    achievements: '업적',
    unlockedSuffix: '해금',
    achievedOn: '달성',
    min: '분',
    items: '개',
    shieldPreserving: '일치 보존 중. 원본은 30일 뒤 사라지지만 이 DB는 남는다.',
    shieldBeyond: '일치를 로컬 DB가 보존 중이다.',
    shieldError: '줄 — history.jsonl 포맷이 바뀌었을 수 있다. 터미널 로그를 확인할 것.',
    loading: '불러오는 중…',
    loadFailed: '불러오기 실패',
    noData: '아직 데이터가 없다.',
  },
};

const DICTS: Record<Lang, Dict> = { en: EN, ko: KO };

export function dict(lang: Lang): Dict {
  return DICTS[lang] ?? EN;
}

/** 대시보드로 내려보낼 문자열 묶음 (브라우저에서 쓴다) */
export function webStrings(lang: Lang): Record<string, string> {
  return dict(lang).web;
}
