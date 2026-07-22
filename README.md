# 🥚 tamagit

**English** · [한국어](README.ko.md)

> Turn your Claude Code activity into an RPG.
> XP, streaks, achievements, and a pet that grows. Local-first, **zero runtime dependencies**.

![Dashboard](assets/dashboard.png)

---

## Quick start

```bash
node --disable-warning=ExperimentalWarning src/cli.ts   # ingest + dashboard (default)
npm start                                               # same as above
npm run stats                                           # terminal summary
npm run install:auto                                    # turn on auto-capture ← do this first
npm test                                                # 79 tests
```

Dashboard runs at `http://127.0.0.1:4173`, bound to loopback only.

**Requires Node ≥ 22.18** — tamagit uses built-in type stripping and `node:sqlite`, so there is
no build step and nothing to install. (`typescript` / `@types/node` are dev-only, for typechecking.)

---

## Why this exists

`~/.claude/history.jsonl` **disappears after 30 days.** Claude Code rotates it, and once a day
falls off the end, that day is gone.

tamagit copies it into a local SQLite database on every run. Your level and streak survive the
rotation — the database is the point, the game is the reason you keep it running.

```
🛡  Preserving 28 days. The source is deleted after 30 days; this DB is not.
    ~/.tamagit/data.db
```

Each line in the source is one prompt, with five fields: `display`, `pastedContents`,
`timestamp`, `project`, `sessionId`. Timestamps are epoch **milliseconds**, and the file is
append-only in ascending order. `(sessionId, ts)` is unique, so it doubles as the idempotency key.

---

## Auto-capture — turn this on

If tamagit only ingests when you run it by hand, then any stretch you forget about is **lost
permanently.** That would make "survives the 30-day deletion" depend on your memory, which
defeats the point. So it installs two layers.

```bash
tamagit install              # both layers
tamagit install --at 22      # run the daily job at 10pm instead
tamagit install --hook-only  # hook only
tamagit status               # what's currently enabled
tamagit uninstall            # remove
```

| Layer | When | What it does |
|---|---|---|
| **Claude Code hook** (`SessionEnd`) | every time a session ends | Ingest, right where the data is produced |
| **launchd** (macOS) | daily at 9pm | Ingest + streak warning. Covers days you never open Claude Code |

The hook is `async: true`, so it never holds up session shutdown, and it's installed in `args`
(exec) form rather than as a shell string — paths with spaces are safe. `~/.claude/settings.json`
is **read and merged**: your existing settings are untouched and a backup is written to
`settings.json.tamagit-backup`. If that file is malformed, tamagit refuses to write rather than
clobbering it.

The `node` path is resolved to a stable symlink (`/opt/homebrew/bin/node`) instead of the
version-pinned one `process.execPath` reports (`.../Cellar/node/23.6.0/bin/node`). Otherwise a
Homebrew upgrade would silently kill the hook — and silent capture failure is the worst kind,
since you'd only find out a month later when the data isn't there.

### Notifications

With `--notify` (added automatically by `install`), three things reach macOS Notification Center:

- **Level up** and **new achievement** — celebration
- **Streak at risk** — only when today is still empty and yesterday was not. **Once per day, max.**

The first run stays silent. Replaying a month of history as a burst of congratulations is spam,
so tamagit records a baseline and only speaks up from the next run onward. On non-macOS platforms
it silently does nothing — no extra dependency.

---

## Game rules

### XP

| Item | Value |
|---|---|
| Base per prompt | 10 XP |
| Length bonus | `8 × ln(1 + chars/20)` |
| Multi-line | +5 |
| Pasted attachment | +6 |
| Slash / bang command | ×0.5 |
| Focus run completed | +15 |
| **Boss fight cleared** | **+200** |
| Streak bonus | `(streak − 1)%` of the day's subtotal, capped at +30% |

Length is rewarded on a **log scale** because real prompt lengths span two orders of magnitude —
from a four-character "go on" to a thousand-character design brief. Linear scaling lets one long
prompt end your day; flat scoring makes a grunt worth as much as a spec. The current curve gives
12 XP at 4 chars, 18 at 36, and 43 at 1,184.

Levels cost `500 × level^1.4`. At a steady 130 prompts a day, that lands around Lv.13 in a month.

### Day boundary — 4am

Activity at `03:59` counts toward the **previous day**. Late-night coding (8–11pm) is routinely a
fifth of daily volume, so a midnight boundary splits an all-nighter across two days and wrecks how
the streak feels. Use `--day-start 0` if you disagree.

### Focus runs and boss fights

A **focus run** is a stretch within one session where consecutive prompts are **under 30 minutes**
apart. A **boss fight** is a run of **60+ minutes AND 15+ prompts**.

Sessions aren't used whole because a session that stays open for 24 hours with a dozen prompts in
it is common. Wall-clock duration counts the time you walked away, so it doesn't measure focus.

### Achievements

👣 First Step · 🔥 Week of Discipline · 🏔️ Month of Practice · 🦉 Night Owl · 🌑 Witching Hour
⚔️ Boss Hunter · 📜 Wordsmith · 🧭 Wanderer · ⚡ Frenzy · 🏰 Pioneer

Unlock times are computed retroactively to **the moment the condition was actually met**, so
first-run history gets real dates rather than today's.

### Pet

🥚 Egg (Lv.1) → 🐣 Hatchling (3) → 🦎 Code Lizard (6) → 🐲 Drake (11) → 🐉 Code Dragon (19) → ✨ Astral Wyrm (31)

Its mood follows today's activity and your streak. If the streak is about to break, the pet says so
before you have to go looking.

---

## Renamed a project folder?

Projects are identified by **absolute path** — that is what Claude Code records. Rename the folder
and the same work becomes two projects: prompt counts, boss fights and the "N projects" total all
split.

```bash
tamagit projects                          # ✗ marks paths that are gone from disk
tamagit projects merge code-rpg tamagit   # the trailing folder name is enough
tamagit projects unmerge code-rpg         # drop the rule; rows already moved stay put
```

`merge` stores a rule rather than running a one-off `UPDATE`. Every `sync` from then on applies it
to **incoming rows as well as existing ones**, so a session that was already open under the old
path can't re-split the history a day later.

It is deliberately not automatic. A path that vanished from disk is equally consistent with a
rename, a move, or a deletion — only you know which, so tamagit flags it and waits.

---

## Language

Everything defaults to **English**. Korean is available as an option:

```bash
tamagit stats --lang ko          # one-off
export TAMAGIT_LANG=ko           # persistent, for your shell
```

The dashboard takes a query parameter too, so you can switch without restarting the server:
`http://127.0.0.1:4173/?lang=ko`

Locale is deliberately **not** auto-detected — "the default is English" should not shift
depending on whose machine it runs on. The CLI flag beats `$TAMAGIT_LANG`, which beats the default.

Adding a language means adding one entry to `src/core/i18n.ts`. A test asserts that every
dictionary has exactly the same keys, so a missing translation fails the build rather than
silently rendering a blank label.

---

## Options

```
--history <path>   source file    (default ~/.claude/history.jsonl)
--db <path>        database       (default ~/.tamagit/data.db)
--tz <zone>        timezone       (default Asia/Seoul)
--day-start <h>    day boundary   (default 4)
--idle <min>       run split gap  (default 30)
--lang <en|ko>     output language (default en, or $TAMAGIT_LANG)
--port <n>         dashboard port (default 4173)
--notify           level-ups, achievements and streak warnings as OS notifications
--quiet            minimal output (for hooks and scheduled runs)
--at <h>           daily run hour (default 21)
--json             emit stats as JSON
```

---

## When the format changes

Claude Code's internal format shifts between versions. The parser is built for that:

- Failures are isolated per line, and **discarded lines are always counted and surfaced**
  (swallowing them quietly means XP drifts quietly)
- Unknown new fields pass through untouched
- If `timestamp` ever switches to seconds, it's coerced back to milliseconds

The test suite includes a **regression check that watches your real `history.jsonl`**. If the field
set stops matching the known shape, `npm test` fails — that's the signal to fix the parser. On
machines without the file, that check skips itself.

---

## Layout

```
src/
  cli.ts            entry point (sync / stats / serve / install)
  server.ts         built-in http server, no dependencies
  terminal.ts       terminal renderer
  web/index.html    dashboard (inline CSS/JS, zero external requests)
  core/
    config.ts       settings and game constants
    clock.ts        day boundary and timezone
    history.ts      history.jsonl parser (defensive)
    xp.ts           XP and level curve
    runs.ts         focus runs and boss detection
    streak.ts       streaks
    achievements.ts the ten achievements
    pet.ts          pet evolution and mood
    db.ts           SQLite schema and idempotent ingest
    sync.ts         ingest pipeline
    i18n.ts         message catalog (en / ko)
    install.ts      hook and launchd installation
    notify.ts       notification decisions and macOS delivery
    stats.ts        dashboard aggregation
```

---

## Known limits

- **Total focus time is optimistic.** Any gap under 30 minutes counts as active, so stepping away
  for 29 minutes still counts. Boss detection also requires a prompt count, which limits the
  damage there, but read the total-hours tile as an upper bound.
- The day-boundary shift is off by an hour on DST transition days in zones that observe it.

---

## License

MIT © Dalgureum Lab
