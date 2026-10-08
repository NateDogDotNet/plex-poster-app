# Integration Plan — Plex Poster Display 2.1

Companion to `docs/spec.md` (requirements, settings model, open questions, traceability matrix). Driven by the `integration-orchestrator` skill; phases are named, numbered only inside this file, and ordered by `Blocked by`, not by number. The owner's rulings D1-D16 in `docs/decisions.md` bind this plan; each phase cites the ones it applies.

Revision r3: lean scope (D1), 27 phases (26 on the release path plus one optional), the four gate phases removed, the r1 review findings closed, and the r2 confirmation findings (N1-N10) closed. Q19-Q23 are settled (conductor rulings, listed below).

## Preamble

- **Every command runs from the repository root** (`/home/user/plex-poster-app`).
- **Starting commit:** `46257c3` ("docs(decisions): record stop-1 rulings D1-D16 for the integration plan"), branch `claude/intelligent-rubin-4vsi63`, `VERSION` 2.0.0. Every `<start>..HEAD` range in this plan means `46257c3..HEAD`.
- **Run the mock:** `npm run demo` serves the app on `http://localhost:8080` and a fake Plex server on `http://localhost:32401` (token `demo-token`, library key `1`; control endpoints under `/__mock/`).
- **Unit tests:** `npm test` (`node --test tests/*.test.js`; 29 tests pass at the starting commit).
- **Browser tests** (after `e2e-harness`): `npm run test:e2e` runs every `tests/e2e/*.spec.mjs` against `scripts/serve.mjs --mock` on ports 18080 / 18401 (`E2E_PORT`, `E2E_MOCK_PORT`); `npm run test:e2e -- <name> [<name> ...]` runs exactly `tests/e2e/<name>.spec.mjs`. Chromium is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
- **Precache check** (after `e2e-harness`): `node scripts/check-precache.mjs` fails when a `SHELL` entry in `sw.js` is missing on disk or a file under `js/` (recursively, including `js/vendor/`) is not precached.

### Conventions every phase follows

1. **Output is a whitelist.** A phase may create or modify only its `Output` paths. The plan file and `.orchestrator/` are never Output. A parenthetical after a path is a condition, not part of the path.
2. **Acceptance criteria are shell commands run from the repo root; exit 0 is a pass.** An item starting `narrated:` is not a command: it names what a human or reviewer checks, and scores as narrated.
3. **Concurrent phases run in separate git worktrees with their own ports (D12).** Each worktree sets its own `E2E_PORT` and `E2E_MOCK_PORT`, so e2e runs do not collide and a worktree's `git status` shows only that phase's edits. Every server a test spawns (unit, integration or e2e) listens on a free port probed at run time, never a fixed one, apart from the shared e2e server's `E2E_PORT`/`E2E_MOCK_PORT`, because every worktree runs `npm test`. Scope probes are therefore valid per worktree. A scope probe is `test -z "$(git status --porcelain -- <paths>)"`: unlike `git diff HEAD` it also sees untracked new files. The conductor's reconcile step is the cross-check.
4. **Negative checks and unit-test lists are guarded.** `! grep … F` passes when `F` is missing, and `node --test a b` silently skips a missing path when another path exists, so every negative grep is written `test -f F && ! grep … F` and every `node --test` criterion is prefixed with `test -f` for each test file it names.
5. **New files under `js/` go into `SHELL` in `sw.js` in the phase that creates them**, which therefore lists `sw.js` in Output. `VERSION` is bumped **once**, in `release-bump` (spec R-REL-1; D16): the rationale is clean releases, not that per-phase bumps would reload clients (any `sw.js` edit already triggers a service-worker update).
6. **Output overlap is a scheduling constraint, not a dependency.** Many UI phases edit `index.html`, `css/app.css`, `js/main.js`, `js/display.js`, `js/settings-ui.js` and `scripts/mock-plex.mjs`. Two phases whose Output lists share a path must not run concurrently even when neither blocks the other. The *Concurrency* section lists only Output-disjoint sets.
7. **Pixel shift is on by default, so geometry specs run without it.** `tests/e2e/lib.mjs` (built in `e2e-harness`) seeds `pixelShift:false`, `dailyReload:false` and the `plexPoster.whatsNew` marker by default; a spec that tests those features sets them explicitly. Every spec that measures stage geometry also names `pixelShift: false` in its own settings.
8. **The e2e `mock` helper is generic** (`mock.get(action)`, `mock.post(action, params)` call `/__mock/<action>`), so later phases add mock endpoints without editing `tests/e2e/lib.mjs`.
9. **(verify)** marks a Plex parameter, Chromium flag or hardware command that could not be exercised in the authoring environment; each is carried into `docs/validation/`.
10. **Settings keys are added once** (`settings-and-schedule-core`); feature phases add controls (bound by `name`) and consume keys, and do not edit `js/settings.js`.
11. **Plan edits commit separately** from phase output. `Findings: —` means the phase delivers no source finding directly (an enabler, or documentation of shipped work).
12. **No gate phases.** The r1 milestone gates are gone. The phase that closes each milestone (named in the *Milestones* table) carries the full-suite criteria (`npm test`, `npm run test:e2e`, `node scripts/check-precache.mjs`), and the conductor runs `/phase-gate` on it at Step 7. `release-bump` carries the release checks (D11).
13. **The run ends with a push to the working branch only (D13).** A pull request or merge happens only when the owner asks, so no phase is tagged `publish`.

### Tag assignment (for approval)

| Tag | Phases |
|---|---|
| `risk:high` | `serve-config-guard` (secret-serving boundary), `sleep-mode` (can leave a display black), `content-rating-filter` (the child-safety guarantee, D5), `kiosk-and-pin` (access control), `device-helper-server` (runs commands) |
| `irreversible` | `purge-git-history` |
| `ui` | `rotation-layout-and-shell`, `status-indicator`, `pixel-shift`, `frame-brightness`, `sleep-mode`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration`, `pi-stability`, `recommended-protection-preset`, `settings-sheet`, `touch-and-labels`, `metadata-and-now-playing`, `position-drag-nudge`, `fill-blur-and-info` |
| `architecture` | `e2e-harness` (routes `/tool-fit review` of the Playwright devDependency; `/neuroarxiv` is not needed, it is test tooling) |
| `docs` | `validation-checklists`, `docs` |
| `publish` | none (D13: the run pushes to the branch only) |
| `planning` | none in this plan (the planning phase already ran) |
| `ideation` | none; open design questions are settled by the D-rulings |
| `data` | none (`data` routes to the database agent; there is no database) |
| `bar-quality` | none; no external quality reference was named |
| `hitl` mode | `rotate-plex-token`, `real-server-validation`, `real-server-validation-extended`, `purge-git-history` |

Tag decisions: `rotate-plex-token` is hitl with no code to review cold, so it is not `risk:high` (its precondition checklist is in the phase); the merged rotation phase is CSS and e2e-covered with visible failures, so it is not `risk:high` either. `ui` is applied to every phase that changes visible markup or CSS, including `content-rating-filter` (a select and a toggle) and `pi-stability` (a checkbox and CSS).

### Milestones

| Milestone | Priority | Phases | Closing phase (Step 7 `/phase-gate`) |
|---|---|---|---|
| M1 | P0 fix-first | `e2e-harness`, `settings-and-schedule-core`, `rotate-plex-token`, `serve-config-guard`, `rotation-layout-and-shell`, `cache-first-fetch`, `status-indicator`, `validation-checklists`, `real-server-validation` | `real-server-validation` |
| M2 | P1 protection | `pixel-shift`, `frame-brightness`, `sleep-mode`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-server`, `device-helper-integration`, `pi-stability`, `recommended-protection-preset` | `recommended-protection-preset` |
| M3 | P2 polish | `settings-sheet`, `touch-and-labels`, `metadata-and-now-playing`, `position-drag-nudge` | `position-drag-nudge` |
| M4 | P3 bigger features and release | `fill-blur-and-info`, `real-server-validation-extended`, `docs`, `release-bump` | `release-bump` |

Optional, outside the release path and outside every milestone: `purge-git-history`. Milestone order is the default scheduling order; a later milestone's phase may start earlier only when its `Blocked by` is satisfied and its Output is disjoint from every running phase.

**Conductor rulings Q19-Q23** (settled at the r2 confirmation; everything else is ruled in `docs/decisions.md`): Q19 country-prefix table as written in the spec, real values verified in `real-server-validation-extended` (`content-rating-filter`); Q20 the preset dims the whole stage, `nightDimTarget:'stage'`, shown as an untickable row (`recommended-protection-preset`); Q21 `resetPin` is honoured while present, Diagnostics warns, the README says to remove it (`kiosk-and-pin`); Q22 the "Playing in" label is kept, default off (`metadata-and-now-playing`); Q23 plausible clock is year >= 2026 plus re-evaluation on a clock jump, and the README notes `fake-hwclock` staleness (`settings-and-schedule-core`, `docs`).

---

## Milestone 1 — P0 fix-first

Fix verified bugs and risks, add the browser-test harness everything else relies on, and run the first real-server validation. Exit: `real-server-validation` (`Overall: PASS`).

### 1. `e2e-harness` — Browser test harness against the mock server

- **Goal:** Add a committed Playwright harness (`npm run test:e2e`) that drives `scripts/serve.mjs --mock`, plus a recursive precache consistency script.
- **Findings:** — (enabler for F1, F2, F3, F5 and every later browser criterion) · **Requirements:** R-REL-1 · **Rulings:** D12, D15
- **Mode:** afk · **Tags:** architecture · **Blocked by:** none
- **Output:** `package.json`, `package-lock.json`, `tests/e2e/run.mjs`, `tests/e2e/lib.mjs`, `tests/e2e/smoke.spec.mjs`, `scripts/check-precache.mjs`, `.github/workflows/ci.yml`
- **Acceptance criteria:**
  1. `npm test`
  2. `for f in tests/e2e/*.mjs scripts/check-precache.mjs; do node --check "$f" || exit 1; done`
  3. `node scripts/check-precache.mjs`
  4. `d=$(mktemp -d) && mkdir -p "$d/js/vendor" && touch "$d/index.html" "$d/js/vendor/x.js" && printf "const SHELL = [\n  'index.html',\n];\n" > "$d/sw.js" && ! node scripts/check-precache.mjs --root "$d" && printf "const SHELL = [\n  'index.html',\n  'js/vendor/x.js',\n];\n" > "$d/sw.js" && node scripts/check-precache.mjs --root "$d"`  (the check is recursive: a nested `js/vendor/x.js` that is not in `SHELL` fails, and passes once listed)
  5. `npm run test:e2e -- smoke`  (spec `smoke.spec.mjs`: seeds settings `{plexToken:'demo-token', serverUrl:'http://127.0.0.1:<mock port>', libraryKey:'1'}`, loads `/`, waits for a poster layer with `naturalWidth > 0`, asserts no console errors; plus one assertion per option later phases rely on, because those phases cannot edit the harness: **`serveArgs: []`** starts a dedicated `serve.mjs --mock` child on its own free ports (different from `E2E_PORT`/`E2E_MOCK_PORT`), `app.url` serves the app, and after `app.stop()` a request to `app.url` fails; **`serveArgs: ['--helper','--helper-fake']`** is passed through to that child (`app.argv` contains `--helper` and `--helper-fake` after `--mock`, and the child was spawned with exactly that list); **`serviceWorkers`**: by default `navigator.serviceWorker.getRegistrations()` is empty, with `serviceWorkers: 'allow'` a registration exists and `navigator.serviceWorker.controller` is set after one reload; **`clock`**: with `clock: { time: '2026-01-05T03:59:30' }` `new Date().getFullYear()` is 2026 and `page.clock.runFor(60000)` advances `Date` by a minute; **`hasTouch`**: `true` gives `navigator.maxTouchPoints > 0` and the default does not; **`localStorage`**: `{ 'plexPoster.lastReload': '123' }` is readable as `'123'` by the first script on the page, and the settings seed shows `pixelShift === false` in `plexPoster.settings`)
  6. `node -e "const p=require('./package.json'); if (p.dependencies || !p.devDependencies || p.devDependencies.playwright!=='1.56.1' || !p.scripts['test:e2e']) process.exit(1)"`  (runtime stays dependency-free, Playwright pinned, D15)
  7. `node -e "const l=require('./package-lock.json'); if (!l.packages || !l.packages['node_modules/playwright'] || (l.packages[''].dependencies && Object.keys(l.packages[''].dependencies).length)) process.exit(1)" && git ls-files --error-unmatch package-lock.json`  (the lockfile is committed or staged, so CI `npm ci` works)
  8. `grep -Eq 'pixelShift: *false' tests/e2e/lib.mjs && grep -Eq 'dailyReload: *false' tests/e2e/lib.mjs && grep -q 'plexPoster.whatsNew' tests/e2e/lib.mjs`  (convention 7)
  9. `grep -q 'npm ci' .github/workflows/ci.yml && grep -q 'playwright install' .github/workflows/ci.yml && grep -q 'test:e2e' .github/workflows/ci.yml && grep -q 'check-precache' .github/workflows/ci.yml && test -f .github/workflows/ci.yml && ! grep -q 'readdirSync' .github/workflows/ci.yml`  (CI installs from the lockfile, installs Chromium, runs the e2e suite and the recursive check instead of the old inline one)
  10. `test -z "$(git status --porcelain -- js css index.html sw.js scripts/serve.mjs scripts/mock-plex.mjs)"`  (no app or server code changed)
  11. narrated: `/tool-fit review` of the Playwright devDependency (version pin, size, licence) and `dependency-audit` on the lockfile (the `architecture` tag routes this).
- **Notes/hazards:**
  - D15: Playwright is a devDependency and `package-lock.json` is mandatory Output (r1's "only if npm install runs" made CI `npm ci` fail). `tests/e2e/lib.mjs` still falls back to the global install when the local one is absent (`createRequire(`${execSync('npm root -g')}/`)('playwright')`, found at `/opt/node22/lib/node_modules/playwright` in this environment); a bare ESM `import 'playwright'` does not find the global copy.
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set; Chromium build `chromium-1194`. Launch with `--no-sandbox` when running as root.
  - `run.mjs [spec-name ...]` runs `tests/e2e/<name>.spec.mjs` exactly (no substring matching), starts one shared `serve.mjs --mock` child on `E2E_PORT` (default 18080) / `E2E_MOCK_PORT` (default 18401), kills it on exit, exits non-zero on any failure, prints one PASS/FAIL line per spec. Concurrent worktrees pick different ports through those variables (D12). A spec that passes `serveArgs` (even `[]`) gets an additional dedicated child `serve.mjs --mock --port <free> --mock-port <free> ...serveArgs`, on ports the harness probes for (listen on port 0, read the port, close, then spawn; retry on `EADDRINUSE`), killed when the callback returns; `app.stop()` kills it early, and the `mock` helper of that spec talks to its mock port.
  - `lib.mjs` contract used by all later specs: `withApp({ settings, viewport, hasTouch, isMobile, clock, serviceWorkers, serveArgs, localStorage }, async ({ page, context, app, mock }) => {})`, where `app = { url, port, mockPort, argv, stop() }`. Defaults: service workers blocked (`serviceWorkers: 'allow'` opts in for offline/SW specs), settings seeded through `addInitScript` into `localStorage['plexPoster.settings']` on top of `{pixelShift:false, dailyReload:false}`, `plexPoster.whatsNew` pre-set so the upgrade toast never interferes, `navigator.wakeLock` replaced by a counting stub (`window.__wakeLock = {held, requests, releases}`), generic mock helpers `mock.get(action)`, `mock.post(action, params)` plus `mock.play(ratingKey, params)`, `mock.stop()`, `mock.down()`, `mock.up()`, `mock.stats()`; `E2E_SHOTS=<dir>` makes `shot(page, name)` write PNGs.
  - `check-precache.mjs [--root <dir>]` parses `SHELL` from `<root>/sw.js`, walks `<root>/js` recursively, and fails on a missing entry or an unlisted file. `./` is allowed in `SHELL` without a file.
  - Fake time: use Playwright `page.clock.install({ time })` / `runFor` (available in 1.45+).
  - Hazard: the app registers a service worker and calls `requestFullscreen`/`wakeLock`; none work meaningfully in headless Chromium, hence the stub and the default `serviceWorkers: 'block'`.

### 2. `settings-and-schedule-core` — Settings schema additions and schedule helpers

- **Goal:** Add every new settings key (with sanitisers and defaults) and the pure local-time helpers later phases share, so later phases never edit the schema.
- **Findings:** — (supports E1, E4, E10, E12, E14, F3, F5, U7, U9, U10, U11) · **Requirements:** R-CACHE-2, R-PROT-6 and every key in *Settings model changes* · **Rulings:** D4, D5, D6
- **Mode:** afk · **Tags:** — · **Blocked by:** `e2e-harness`
- **Output:** `js/settings.js`, `js/schedule.js`, `tests/settings.test.js`, `tests/schedule.test.js`, `sw.js`
- **Acceptance criteria:**
  1. `test -f tests/settings.test.js && test -f tests/schedule.test.js && node --test tests/settings.test.js tests/schedule.test.js`
  2. `npm test`
  3. `test -f tests/schedule.test.js && TZ=America/New_York node --test tests/schedule.test.js && TZ=Europe/London node --test tests/schedule.test.js`  (DST cases run under two zones: 400-day fire/re-arm simulation for `04:00` and `02:30` fires once per local date and never returns a negative or NaN delay; `inWindow('01:00','07:00')` is true at 01:30 on both occurrences of a fall-back night)
  4. `node scripts/check-precache.mjs`  (`js/schedule.js` added to `SHELL`; `VERSION` is NOT bumped here)
  5. `node -e "import('./js/settings.js').then(m=>{const d=m.defaults();const need=['rotateUi','statusIndicator','posterCacheLimit','maxContentRating','limitNowPlaying','sleepEnabled','sleepStart','sleepEnd','idleSleepHours','wakeOnPlayback','pixelShift','pixelShiftMinutes','frameBrightness','nightDim','nightDimStart','nightDimEnd','nightDimLevel','nightDimTarget','dailyReload','dailyReloadTime','kioskMode','disableShortcuts','settingsPinHash','settingsPinSalt','deviceHelper','controlLabels','showMeta','showProgress','showPlayer','fillMode'];const gone=['bulbAnimation','frameRotation','frameRotationIds','frameIdRandom','fillCount'];const miss=need.filter(k=>!(k in d));const extra=gone.filter(k=>k in d);if(miss.length||extra.length){console.error(miss,extra);process.exit(1)}})"`  (every ruled key exists; the deferred ones do not)
  6. `node -e "import('./js/settings.js').then(m=>{const d=m.defaults();const ok=d.pixelShift===true&&d.dailyReload===true&&d.posterCacheLimit===100&&d.statusIndicator==='dot'&&d.rotateUi===true&&d.sleepEnabled===false&&d.idleSleepHours===0&&d.wakeOnPlayback===true&&d.nightDim===false&&d.nightDimTarget==='frame'&&d.maxContentRating===''&&d.limitNowPlaying===true&&d.kioskMode===false&&d.deviceHelper===false&&d.fillMode==='none'&&d.showProgress===true&&d.showPlayer===false;if(!ok)process.exit(1)})"`  (default table, D4/D5/D6)
  7. `node -e "import('./js/settings.js').then(m=>{const o=m.toExport({...m.defaults(),plexToken:'t',settingsPinHash:'a'.repeat(64),settingsPinSalt:'b'},{includeSecrets:true});if('settingsPinHash' in o.settings||'settingsPinSalt' in o.settings||o.settings.plexToken!=='t')process.exit(1)})"`  (PIN material never exported, token only when ticked)
  8. `node -e "import('./js/settings.js').then(m=>{const s=m.fromImport(JSON.stringify({format:'plex-poster-display/settings',version:1,settings:{settingsPinHash:'a'.repeat(64),settingsPinSalt:'b',rotateSeconds:60}}));if(s.settingsPinHash!==''||s.settingsPinSalt!==''||s.rotateSeconds!==60||s.pixelShift!==true)process.exit(1)})"`  (an import file cannot plant a PIN; a 2.0.0 export still imports; `EXPORT_VERSION` stays 1)
  9. `node -e "import('./js/schedule.js').then(m=>{for(const f of ['parseHHMM','inWindow','msUntilNext','isPlausibleClock'])if(typeof m[f]!=='function')process.exit(1); if(!m.inWindow(new Date(2026,0,5,2,0),'01:00','07:00')||!m.inWindow(new Date(2026,0,5,23,30),'22:00','07:00')||m.inWindow(new Date(2026,0,5,12,0),'22:00','07:00')||m.inWindow(new Date(2026,0,5,3,0),'03:00','03:00'))process.exit(1); if(m.isPlausibleClock(new Date(1970,0,1))||!m.isPlausibleClock(new Date(2026,9,8)))process.exit(1)})"`
  10. `test -z "$(git status --porcelain -- index.html css js/main.js js/display.js js/engine.js js/plex.js js/poster-cache.js js/layout.js scripts tests/e2e)"`  (no UI or behaviour here)
- **Notes/hazards:**
  - Sanitiser `hhmm` returns the default for anything that is not `HH:MM` with valid ranges. `inWindow(date, start, end)` uses local wall-clock time, supports windows that cross midnight, and treats `start === end` as an empty window (never asleep), not 24 h.
  - `msUntilNext(date, 'HH:MM')` returns the delay to the next local occurrence strictly after `date`; on a spring-forward night a time that does not exist fires at the first valid instant after it, on a fall-back night it fires once. Keep helpers pure: callers pass `now`. `isPlausibleClock(date)` is `date.getFullYear() >= MIN_PLAUSIBLE_YEAR` with the constant (2026) at the top of the file (Q23; bump it when it ages).
  - Add `NEVER_EXPORT_KEYS = ['settingsPinHash', 'settingsPinSalt']`; `toExport` drops them and `fromImport` ignores them (a file could plant a PIN hash). The `resetPin` flag is not a setting and is handled in `kiosk-and-pin`.
  - No UI, no behaviour: the keys are unused until later phases. Do not add controls here.

### 3. `rotate-plex-token` — Owner rotates the exposed Plex token

- **Goal:** The token committed in `5c4a716:config.js` is revoked and a receipt is recorded.
- **Findings:** S1 · **Requirements:** R-SEC-2 · **Rulings:** D14
- **Mode:** hitl · **Tags:** — · **Blocked by:** none
- **Output:** `docs/security/token-rotation.md`
- **Acceptance criteria:**
  1. `test -f docs/security/token-rotation.md && grep -qx 'Rotated: yes' docs/security/token-rotation.md`
  2. `grep -Eq '^Date: 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/security/token-rotation.md`
  3. `grep -qx 'Old token rejected (HTTP 401): yes' docs/security/token-rotation.md`
  4. `test -f docs/security/token-rotation.md && ! grep -Eq 'X-Plex-Token|(^|[^A-Za-z0-9])[A-Za-z0-9]{20,}([^A-Za-z0-9]|$)' docs/security/token-rotation.md`  (the receipt contains no token-like string: no header name and no alphanumeric run of 20 or more characters; ordinary hyphenated words are fine)
  5. narrated: the owner runs the check below with the old token exported in their own shell only and pastes `exit status: 0` into the receipt. The conductor cannot run it (it must never see the token). `test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: application/json' -H @<(printf 'X-Plex-Token: %s\n' "${OLD_PLEX_TOKEN:?set OLD_PLEX_TOKEN in your shell}") https://plex.tv/api/v2/user)" = 401`  (the token travels in a header read from a file descriptor, never in a URL or the process list)
- **Notes/hazards:**
  - Hand-off checklist for the owner (the conductor presents this; no agent runs it): (1) find which token leaked: `git show 5c4a716:config.js` in a private terminal, do not paste it anywhere; (2) rotate by either route and note which: **(a)** plex.tv > Account > Authorized Devices: remove the device or sign out everywhere; **(b)** change the account password and tick "Sign out of connected devices" **(verify which route revokes the leaked token; if the exposed value was a server-specific or Home-user token, remove and re-add that device or user)**; (3) sign every display back in with the Sign in with Plex button (once `settings-sheet` has landed the code also appears automatically; that automatic flow is checked in the extended validation, not the core one); (4) export the old token as `OLD_PLEX_TOKEN` in a shell and run the 401 check; (5) create `docs/security/token-rotation.md` from the template below.
  - Receipt template: `# Token rotation receipt` / `Rotated: yes` / `Date: YYYY-MM-DD` / `Method: authorized-devices | password-change | other` / `Old token rejected (HTTP 401): yes` / `History purge chosen: no | yes (see purge-git-history)`.
  - Not `risk:high`: there is no code to review cold; the precondition is the checklist above.
  - Hazard: every already-signed-in display stops working until it signs in again, including `config.json` provisioned devices. Required for the release (D11, D14).

### 4. `serve-config-guard` — Dev server serves only the app, and config.json only to loopback

- **Goal:** `scripts/serve.mjs --host 0.0.0.0` hands the LAN only the app files and never `config.json` (the Plex token) or repo internals.
- **Findings:** F4 · **Requirements:** R-SEC-1 · **Rulings:** D9
- **Mode:** afk · **Tags:** risk:high · **Blocked by:** none
- **Output:** `scripts/serve.mjs`, `scripts/net.mjs`, `tests/serve.test.js`
- **Acceptance criteria:**
  1. `test -f tests/serve.test.js && node --test tests/serve.test.js`  (the server is spawned on a free port: the test listens on port 0, reads the port, closes and passes it as `--port`, retrying on `EADDRINUSE`, so concurrent worktrees do not collide (D12); unit: `isLoopback` for `127.0.0.1`, `127.1.2.3`, `::1`, `::ffff:127.0.0.1`, `::ffff:192.168.1.5`, `192.168.1.5`, empty, undefined; `isLoopbackHost` for `localhost`, `localhost:8080`, `127.0.0.1:3000`, `[::1]:8080`, `evil.example`, `localhost.evil.com`, empty. Integration: spawns `serve.mjs --host 0.0.0.0 --port <free port> --root <tmp dir containing index.html, sw.js, manifest.webmanifest, css/a.css, js/a.js, assets/a.png, config.json, .orchestrator/x.md, docs/spec.md, package.json, README.md>`: loopback `GET /config.json` with `Host: localhost:<port>` is 200; the same from the machine's non-loopback IPv4 address is 403; with `X-Forwarded-For: 127.0.0.1` still 403; a loopback peer with `Host: evil.example` is refused; from the LAN address `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest`, `/css/a.css`, `/js/a.js`, `/assets/a.png` are 200 and `/.orchestrator/x.md`, `/docs/spec.md`, `/package.json`, `/README.md` are 404; `//config.json`, `/./config.json`, `/%63onfig.json`, `/config.json/`, `/CONFIG.JSON` are never 200)
  2. `npm test`
  3. `grep -q 'isLoopback' scripts/serve.mjs && grep -q 'export function isLoopback' scripts/net.mjs && grep -q 'export function isLoopbackHost' scripts/net.mjs`
  4. `test -f scripts/serve.mjs && test -f scripts/net.mjs && ! grep -qiE 'x-forwarded|forwarded' scripts/serve.mjs scripts/net.mjs`  (proxy headers are never consulted)
  5. `test -z "$(git status --porcelain -- js css index.html sw.js scripts/mock-plex.mjs)"`
  6. narrated: run `node --test tests/serve.test.js 2>&1 | grep -E '^# (pass|fail|skipped)'` on a host with a non-loopback IPv4 and confirm the LAN-address tests were not skipped (they skip only when `os.networkInterfaces()` has none). The conductor's host has one (`192.0.2.2` at review time).
- **Notes/hazards:**
  - D9: replace the `BLOCKED` denylist with an allowlist: `/`, `index.html`, `manifest.webmanifest`, `sw.js`, and paths under `css/`, `js/`, `assets/`. `config.json` is served only to a loopback peer whose `Host` hostname is `localhost`, `127.0.0.1` or `[::1]`. Everything else is 404.
  - The Host check compares the **hostname only** and ignores the port (browsers send `localhost:8080`): `new URL('http://' + host).hostname`. Proxy headers are never consulted; say so in a comment worded exactly "proxy headers are never consulted" (the words `forwarded` and `x-forwarded` must not appear anywhere in `scripts/serve.mjs` or `scripts/net.mjs`, comments included, or criterion 4 fails).
  - `isLoopback` and `isLoopbackHost` live in `scripts/net.mjs` so they can be imported without starting a server (`serve.mjs` listens at import time). `device-helper-server` reuses both.
  - Add an optional `--root <dir>` flag (default: repo root) so tests serve a temp directory containing a fake `config.json`; never write a `config.json` into the repo root from a test.
  - Normalise first, check second: decode, resolve `.`/`..`, strip trailing slash, lower-case compare against `/config.json`, then decide.
  - Hazard: a reverse proxy on the same machine makes every client look like loopback. State this in the file header comment (README gets it in `docs`).
  - Hazard: `--mock` binds the mock Plex server to the same `HOST`; it serves no secrets, leave as is.
  - `risk:high`: this is the boundary that keeps the token off the LAN; the independent reviewer tries every bypass in criterion 1 plus an IPv6 literal Host.

### 5. `rotation-layout-and-shell` — Rotated stage centred and on screen; the whole UI rotates with it

- **Goal:** At rotation 90/270 on a landscape viewport the stage is centred and fully visible, and controls, toast, empty card, Settings and Diagnostics read upright on a physically rotated screen (setting `rotateUi`, default on).
- **Findings:** F1, F2 · **Requirements:** R-ROT-1, R-ROT-2 · **Rulings:** D2
- **Mode:** afk · **Tags:** ui · **Blocked by:** `e2e-harness`, `settings-and-schedule-core`
- **Output:** `css/app.css`, `index.html`, `js/display.js`, `tests/e2e/rotation.spec.mjs`, `tests/e2e/ui-rotation.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- rotation`  (viewports 1920x1080, 1080x1920, 1280x800 x rotations 0/90/180/270 with `pixelShift:false`: `#stage` and `#frame` bounding boxes inside the viewport (1 px tolerance), centre within 1 px of viewport centre, limiting dimension within 2 px of the viewport, `.app` `scrollHeight == clientHeight`)
  2. `npm run test:e2e -- ui-rotation`  (for rotation 90/180/270 and viewports 1920x1080 and 1080x1920: open settings (`s`) and diagnostics (`d`), trigger a toast and the empty state; each of `#controls`, `#toast`, `.empty-card`, `#settings`, `#diagnostics` has a computed transform angle equal to the rotation and a bounding box inside the viewport; the controls bar sits at the viewer's bottom-right; with `rotateUi:false` none is rotated; rotation 0 bounding boxes equal those recorded with `rotateUi:false`)
  3. `grep -Eq 'pixelShift: *false' tests/e2e/rotation.spec.mjs tests/e2e/ui-rotation.spec.mjs`  (these specs name the seed, convention 7)
  4. `npm test`
  5. `node scripts/check-precache.mjs`
  6. `grep -q -- '--ui-rotation' css/app.css && grep -q -- '--ui-rotation' js/display.js`
  7. `test -z "$(git status --porcelain -- js/settings.js js/engine.js js/plex.js js/main.js sw.js scripts)"`
  8. narrated: the reviewer shows the `rotation` spec failing against the CSS at `3a7b688` (a throwaway `git worktree` of that commit with `tests/e2e/` copied in) at 1920x1080 / rotation 90, proving the test detects the bug; then runs `E2E_SHOTS=$(mktemp -d) npm run test:e2e -- ui-rotation` and looks at the rotation-90 settings and controls screenshots (Step 7 `/ux-simulate`): text reads upright when the screenshot is turned 90 degrees, nothing clipped.
- **Notes/hazards:**
  - Root cause of F1: `.app { display:grid; place-items:center }` sizes the grid row to the sideways stage's layout box (e.g. 1080x1687 inside 1920x1080), so the row grows and the rotated result lands low. Fix: `.stage { position:absolute; left:50%; top:50%; transform: translate(-50%,-50%) rotate(var(--rotation,0deg)) }` and drop reliance on grid centring. Keep `transition: transform .5s` so rotation still animates; check the reduced-motion rule still removes it.
  - `pixel-shift` later uses the individual `translate` property, which composes before `transform`; do not use `translate` here.
  - F2 (D2): a top-layer `<dialog>` (`showModal`) ignores ancestor transforms. Give each dialog its own rule: swap `width`/`height` using `--vw`/`--vh` custom properties set by `display.layout()` and rotate with a `transform-origin` chosen per angle so the sheet docks to the viewer's right edge. The backdrop stays full-screen. Expose `--ui-rotation` for `kiosk-and-pin` and `status-indicator`.
  - `rotateUi:false` is the supported path for Pi users who rotate the OS (`wlr-randr`/`xrandr`) and keep app rotation at 0. `display.apply(settings)` already receives the settings, so `js/main.js` is not touched.
  - Not `risk:high`: CSS only, fully e2e-covered, failures are visible.

### 6. `cache-first-fetch` — Cache-first poster fetch

- **Goal:** `fetchImage()` serves posters from `poster-cache.js` when it already holds them and only downloads/writes on a miss.
- **Findings:** F3, E8 · **Requirements:** R-CACHE-1, R-CACHE-2 · **Rulings:** D6
- **Mode:** afk · **Tags:** — · **Blocked by:** `e2e-harness`, `settings-and-schedule-core`
- **Output:** `js/main.js`, `js/poster-cache.js`, `scripts/mock-plex.mjs`, `tests/poster-cache.test.js`, `tests/e2e/cache-first.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/poster-cache.test.js && node --test tests/poster-cache.test.js`  (fake `caches` and `storage`: hit, miss, thumb changed -> miss, stored size smaller than requested -> miss, stored size larger -> hit, `get` throwing -> miss, limit as a function re-read on each `put`, eviction deletes the evicted entries)
  2. `npm test`
  3. `npm run test:e2e -- cache-first`  (mock `GET /__mock/stats` returns `{transcode:n}`; show the 8 mock posters 3 times each using the refresh control: `transcode <= 8` and a `Cache.prototype.put` counter installed by `addInitScript` `<= 8`; after a page reload and `POST /__mock/reset-stats`, showing the same 8 again produces `transcode == 0`)
  4. `test -z "$(git status --porcelain -- index.html css sw.js)"`
- **Notes/hazards:**
  - Validity rule: cached `thumb === poster.thumb` AND cached width >= requested width (`requestSize()` rounds up to 100 px steps). `put()` records `width`/`height` in the index entry. A hit does not call `cache.put`, so no SD write; do not re-order the index on hit (that would write `localStorage` every rotation).
  - Lazy limit: `createPosterCache({ limit })` accepts a number or a function; `main.js` passes `() => state.settings.posterCacheLimit`. Default 100 with the default pool of 100 means steady state is all hits. `cache.random()` (offline fallback) is unchanged here; `content-rating-filter` extends it.
  - Mock additions: `GET /__mock/stats` -> `{transcode, other}` counting `/photo/:/transcode` hits; `POST /__mock/reset-stats`. The mock keeps exactly 8 titles; later phases add fields, not titles.
  - `directImages` (CORS-blocked) mode is untouched and still bypasses the cache; Diagnostics already reports it. V1 checks real CORS behaviour.
  - Hazard: `fetchImage` is called before `display.show`; keep the `AbortSignal.timeout(20000)` on the network path.

### 7. `status-indicator` — Quiet status indicator

- **Goal:** Replace the always-on top-left status pill with a controls-bound pill and a tiny drifting dot, and stop the once-a-second re-render when hidden.
- **Findings:** F5 · **Requirements:** R-STAT-1 · **Rulings:** D6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `rotation-layout-and-shell`, `settings-and-schedule-core`
- **Output:** `index.html`, `css/app.css`, `js/main.js`, `tests/e2e/status.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- status`  (mock down after first poster, controls idle-hidden after 4 s: `#status` hidden, `#status-dot` visible and `<= 8x8` px, opacity `<= 0.4`; wake controls: `#status` shows retry countdown; healthy + idle: neither visible; a `MutationObserver` on `#status` records 0 mutations over 3 s while controls are hidden; fake clock +5 min moves the dot to a different corner, always inside the viewport; `statusIndicator:'off'` hides the dot; at rotation 90 with `rotateUi` true the dot's computed transform angle is 90)
  2. `grep -Eq 'pixelShift: *false' tests/e2e/status.spec.mjs`
  3. `npm test`
  4. `grep -q 'id="status-dot"' index.html`
  5. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Tie visibility to the existing `.controls.visible` / `body.idle` state set by `wake()`; do not add a second idle timer.
  - The dot has its own slow position cycle (corners of the safe area), independent of pixel shift, and follows `--ui-rotation` from the shell phase.
  - Burn-in hazard: even the dot must never sit still for hours; the cycle is the requirement, not an optimisation.

### 8. `validation-checklists` — Real-server validation checklists

- **Goal:** Create the two result templates a human fills in against a real Plex server, listing every (verify) item.
- **Findings:** V1 · **Requirements:** R-VAL-1, R-VAL-2 · **Rulings:** D11
- **Mode:** afk · **Tags:** docs · **Blocked by:** none
- **Output:** `docs/validation/real-server-core.md`, `docs/validation/real-server-extended.md`
- **Acceptance criteria:**
  1. `test "$(grep -c 'PENDING' docs/validation/real-server-core.md)" -ge 10 && test "$(grep -c 'PENDING' docs/validation/real-server-extended.md)" -ge 14`
  2. `grep -qx 'Overall: PENDING' docs/validation/real-server-core.md && grep -qx 'Overall: PENDING' docs/validation/real-server-extended.md`
  3. `for k in 'plex.tv/link' 'Sign in with Plex' firstReachable CORS '/photo/:/transcode' '/status/sessions' 'plex.direct' 'Image mode'; do grep -qF -- "$k" docs/validation/real-server-core.md || { echo "core missing: $k"; exit 1; }; done`
  4. `for k in 'first-run code' contentRating 'gb/' totalSize viewOffset Player.title overscroll-history-navigation disable-pinch DeveloperToolsAvailability chromium-browser 'cec-ctl' 'cec-client' wlr-randr WAYLAND_DISPLAY 'power cycle' thermal_zone0 'disk-cache-dir' 'Authorized Devices' 'Sign out of connected devices' 'Wake Lock'; do grep -qF -- "$k" docs/validation/real-server-extended.md || { echo "extended missing: $k"; exit 1; }; done`
  5. `test -f docs/validation/real-server-core.md && test -f docs/validation/real-server-extended.md && ! grep -Eq 'X-Plex-Token[=:] *[A-Za-z0-9_-]{15,}' docs/validation/real-server-core.md docs/validation/real-server-extended.md`
  6. `for f in docs/validation/real-server-core.md docs/validation/real-server-extended.md; do grep -qxF 'Result values: PASS | FAIL (<phase to reopen>) | SKIPPED (<reason>, extended Pi rows only)' "$f" || exit 1; done`
  7. narrated: `/doc-review` of both files: each item has an ID, exact steps, expected result, `Result: PENDING`, `Notes:`.
- **Notes/hazards:**
  - Item format: `- [ ] V1-C03 — <step> — expected: <result> — Result: PENDING — Notes:` ; end of file `Overall: PENDING`. The human replaces each PENDING with PASS/FAIL and the last line with `Overall: PASS`. **Only `Overall: PASS` closes a validation phase (D11);** a FAIL names the phase to reopen.
  - Core: PIN sign-in at plex.tv/link through the Sign in with Plex button (not the automatic first-run code, which `settings-sheet` builds later and the extended file checks), multi-server discovery and the connection `firstReachable` picks (LAN http vs `*.plex.direct` https), token/URL test, library list, `/status/sessions` while playing and paused, blob download of `/photo/:/transcode` without CORS error (Diagnostics shows `Image mode: downloaded + cached`, not `direct`), 24 h soak note.
  - Extended: a `first-run code` row (an unconfigured display shows the code without a click and approving it at plex.tv/link signs in; R-FIRST-1, built by `settings-sheet`, which blocks the extended phase) and every (verify) in the spec's list, including real country-prefixed `contentRating` values and a "window still full-screen and playback wakes after a power cycle" row; Pi-hardware rows marked `skip if no Pi` may end `SKIPPED`.
  - Secrets rule printed at the top of both files: never paste a token or a full `X-Plex-Token` URL.

### 9. `real-server-validation` — Validate core flows against a real Plex server

- **Goal:** A human proves sign-in, discovery, CORS blob download and session reads work on a real server, or names the phase to reopen. Closes M1.
- **Findings:** V1 · **Requirements:** R-VAL-1 · **Rulings:** D11
- **Mode:** hitl · **Tags:** — · **Blocked by:** `validation-checklists`, `cache-first-fetch`, `serve-config-guard`, `rotation-layout-and-shell`, `status-indicator`, `rotate-plex-token`
- **Output:** `docs/validation/real-server-core.md`
- **Acceptance criteria:**
  1. `test -f docs/validation/real-server-core.md && ! grep -q 'PENDING' docs/validation/real-server-core.md`
  2. `grep -qx 'Overall: PASS' docs/validation/real-server-core.md`
  3. `test -f docs/validation/real-server-core.md && ! grep -Eq 'X-Plex-Token[=:] *[A-Za-z0-9_-]{15,}' docs/validation/real-server-core.md`
  4. `npm test && npm run test:e2e && node scripts/check-precache.mjs`  (closing the milestone: the whole tree is green at the commit validated)
  5. narrated: only PASS closes this phase. If any row is FAIL the conductor opens the phase that row names through reconcile, and this phase stays open until a later run records `Overall: PASS`. `/phase-gate` runs on this phase at Step 7 (M1 closes here).
- **Notes/hazards:**
  - Hand-off: run `npm start` on the display device (or any machine on the LAN), open `http://localhost:8080`, walk the checklist, copy the Diagnostics panel's text into the notes for any FAIL.
  - This is the earliest point CORS on the real transcoder is observable; the "poster cache never fills" failure mode (`directImages`) would invalidate R-CACHE-1's benefit on that server.
  - It is blocked by `rotate-plex-token` so the validation uses the rotated token and the Sign in with Plex flow, and by the M1 build phases so it validates the state that M1 delivers.

---

## Milestone 2 — P1 equipment protection

Protect the screen, the Pi and the SD card, and keep children out of the settings. Each feature phase adds its own controls to a new **Display protection** fieldset in `index.html`. Exit: `recommended-protection-preset`.

### 10. `pixel-shift` — Pixel shift with a glide

- **Goal:** Move the stage a few pixels every few minutes inside a 1.5% margin, gliding over 1.5 s, so no pixel stays lit for hours.
- **Findings:** E2 · **Requirements:** R-PROT-2 · **Rulings:** D6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `rotation-layout-and-shell`, `settings-and-schedule-core`
- **Output:** `js/layout.js`, `js/display.js`, `css/app.css`, `index.html`, `tests/layout.test.js`, `tests/e2e/pixel-shift.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/layout.test.js && node --test tests/layout.test.js`  (existing cases unchanged; new: `stageSize` with `margin: 0.015` is 97% of the margin-less size on the limiting axis; `shiftOffset(step, marginPx)` is bounded by `marginPx`, never returns the same point twice in a row, visits 9 distinct points in 9 steps, is deterministic)
  2. `npm test`
  3. `npm run test:e2e -- pixel-shift`  (fake clock, `pixelShift:true`, `pixelShiftMinutes: 3`, 20 steps at rotations 0 and 90 on 1920x1080 and 1080x1920: >= 9 distinct `translate` values and stage and frame bounding boxes inside the viewport at every step, measured after the glide settles; `.stage` computed `transition-property` includes `translate` and its duration is between 1 s and 2 s; with emulated `prefers-reduced-motion: reduce` the translate transition is `none`/0 s; `pixelShift:false` -> no `translate` and stage size equal to `stageSize()` without margin)
  4. `npm run test:e2e`  (the whole existing suite still passes: the rotation, ui-rotation, status and cache specs run with the harness default `pixelShift:false`)
  5. `node -e "import('./js/layout.js').then(m=>{const a=m.stageSize({viewportW:1920,viewportH:1080,aspect:0.64});const b=m.stageSize({viewportW:1920,viewportH:1080,aspect:0.64,margin:0.015});if(!(b.height<a.height&&b.height>a.height*0.95))process.exit(1)})"`
  6. `grep -q 'pixelShift' js/display.js && grep -q 'name="pixelShift"' index.html`
  7. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Use the individual CSS `translate` property on `.stage`: it composes before `rotate`, so the offset is in screen space at every rotation. Support needs Chromium >= 104 **(verify the Pi's Chromium)**; if absent, fall back to wrapping the stage in a `#shifter` element.
  - D6 glide: `transition: translate 1.5s ease-in-out` alongside the existing rotation transition; steps are never instant jumps and never continuous drift (a continuous drift costs a composited animation for nothing).
  - Margin applies only while `pixelShift` is on, so a user who turns it off gets today's full-bleed layout. The ~3% smaller stage on upgrade is announced by the upgrade toast (`recommended-protection-preset`).
  - Creates the **Display protection** fieldset (checkbox + minutes input, bound by `name` so `settings-ui.js` needs no change).
  - Geometry specs written in later phases (`position`, `fill`) seed `pixelShift:false` as well (convention 7).

### 11. `frame-brightness` — Frame brightness and night dim

- **Goal:** Dim the frame (or, optionally, the whole stage) manually and automatically at night, in stepped minute updates.
- **Findings:** E4 · **Requirements:** R-FRM-4, R-PROT-4 · **Rulings:** D6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `settings-and-schedule-core`
- **Output:** `js/brightness.js`, `tests/brightness.test.js`, `js/display.js`, `js/main.js`, `css/app.css`, `index.html`, `sw.js`, `tests/e2e/brightness.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/brightness.test.js && node --test tests/brightness.test.js`  (pure `effectiveBrightness(now, settings)`: manual level, night window incl. midnight crossing, the 10-minute ramp in after `nightDimStart` and out before `nightDimEnd` in whole-minute steps, windows shorter than 20 minutes peak below the level, `min` of manual and night level, `nightDim:false`, an implausible clock gives no night dim, a DST night under `TZ=America/New_York`)
  2. `npm test`
  3. `npm run test:e2e -- brightness`  (fake clock 12:00 with `nightDim` on: `#frame` computed `filter` is `none` or `brightness(1)`; 23:00 (after the ramp): `brightness(0.6)` +-0.02; `frameBrightness:50` -> `brightness(0.5)`; target `frame`: the poster `<img>` layers, `#poster-box` and `#stage` have `filter: none`; target `stage`: `#stage` has `brightness(0.6)` and `#frame` none; minute-by-minute across the ramp the value changes in steps and never between minute ticks)
  4. `node scripts/check-precache.mjs`
  5. `test -f css/app.css && ! grep -nE 'will-change: *filter|transition[^;]*filter' css/app.css`  (no animated or transitioned `filter`)
- **Notes/hazards:**
  - Filter on `#frame` (target `frame`) or `#stage` (target `stage`) only. **No CSS transition and no animation on `filter`** (Pi GPU; this resolves the r1 conflict between R-PROT-4 and R-FRM-4): a once-a-minute timer sets the value in whole steps, using `schedule.inWindow` and `isPlausibleClock` from the core phase.
  - Re-evaluate on `visibilitychange` and after a clock jump. The README note on `fake-hwclock` staleness (Q23) is delivered by `docs`.
  - Hardware brightness is dropped (D8); there is no helper interaction here.
  - The `Display protection` fieldset exists after `pixel-shift`; this phase adds its controls beside them (Output overlap serialises the two).

### 12. `sleep-mode` — Sleep schedule and idle sleep

- **Goal:** Show pure black during sleep hours or after N idle hours while keeping the wake lock held, and wake on playback.
- **Findings:** E1 · **Requirements:** R-PROT-1 · **Rulings:** D4
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `settings-and-schedule-core`
- **Output:** `js/sleep.js`, `tests/sleep.test.js`, `js/engine.js`, `tests/engine.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/sleep.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/sleep.test.js && test -f tests/engine.test.js && node --test tests/sleep.test.js tests/engine.test.js`  (`decideSleep`: window crossing midnight, idle expiry at N hours, playback wakes during a window when `wakeOnPlayback`, stays asleep when not, manual wake for 60 s then back to sleep, `sleepEnabled:false` with `idleSleepHours:0` never sleeps, `clockOk:false` ignores the schedule but not idle sleep; engine `playing()` returns the session without fetching art)
  2. `npm test`
  3. `npm run test:e2e -- sleep`  (fake clock inside 01:00-07:00 with `sleepEnabled:true`: `#sleep-veil` visible and opaque black, controls hidden, `window.__wakeLock.held === true` and `releases` unchanged by sleeping, no `/photo/:/transcode` request made while asleep (counted with `page.on('request')`, not the mock stats endpoint); `mock.play()` -> veil hidden within one `nowPlayingPollSeconds`, poster shown; idle sleep: `idleSleepHours:1`, no playback for 61 simulated minutes -> asleep; a key press wakes for 60 s then sleeps again; `wakeOnPlayback:false` keeps the veil during the window; a fake clock at 1970 inside the clock window does not sleep; Diagnostics shows `Sleep: asleep (schedule)`)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'id="sleep-veil"' index.html && grep -q 'name="sleepEnabled"' index.html`
  6. narrated: independent reviewer (risk:high) tries to produce a state where the veil stays up after playback starts or the wake lock is lost (offline start, clock change, settings saved while asleep).
- **Notes/hazards:**
  - D4: asleep is a black veil with the wake lock **held**; releasing the lock is not a sleep mechanism, and re-acquiring one does not wake a screen the OS already blanked. The README (in `docs`) says to turn OS screen blanking off. Whether Chromium's Linux wake lock inhibits labwc/swayidle is **(verify)** on hardware.
  - While asleep `tick()` must still poll `/status/sessions` (to wake on playback and to refresh `lastPlaybackAt`) but must not fetch images or call `display.show`. Add `engine.playing()` for that; it honours `username` and `includeEpisodes` and works even when `showNowPlaying` is off.
  - Body class `asleep` is the contract other features key off (status dot, kiosk reveal, helper power).
  - Manual wake: any `pointerdown`/`keydown` while asleep lifts the veil for 60 s; it must not trigger the control under the finger (`touch-and-labels` generalises the first-tap rule and treats the veil as "controls hidden").
  - Local time only: browser timezone; schedules wait for a plausible clock (`isPlausibleClock`). Diagnostics shows the local time and `Clock not set` when implausible.

### 13. `content-rating-filter` — Household content limit

- **Goal:** With the "Household with children" toggle on, random posters, cached offline posters and now-playing never exceed the chosen rating; unrated and unmapped values are excluded.
- **Findings:** E14 · **Requirements:** R-FILT-1 · **Rulings:** D5
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `settings-and-schedule-core`, `cache-first-fetch`
- **Output:** `js/ratings.js`, `tests/ratings.test.js`, `js/plex.js`, `tests/plex.test.js`, `js/engine.js`, `tests/engine.test.js`, `js/poster-cache.js`, `tests/poster-cache.test.js`, `js/main.js`, `js/settings-ui.js`, `scripts/mock-plex.mjs`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/content-rating.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/ratings.test.js && test -f tests/plex.test.js && test -f tests/engine.test.js && test -f tests/poster-cache.test.js && node --test tests/ratings.test.js tests/plex.test.js tests/engine.test.js tests/poster-cache.test.js`  (ladder rank for each rung incl. `TV-Y`, `TV-Y7`, `TV-G`, `TV-PG`, `TV-14`, `TV-MA`; every row of the country-prefix table (`gb/`, `de/`, `au/`, `ca/`, `fr/`, `nl/`); `gb/XX`, empty and missing excluded when a limit is set and kept when `''`; `pool()` requests `X-Plex-Container-Size` = 3x pool size capped 500 when a limit is set; the request value list for `PG-13` contains every allowed ladder value and every mapped prefixed value at or below it (`gb/12`, `gb/12A`, `de/12`, `fr/12`, `au/M`, `ca/14A`, `nl/12`) and nothing above (no `R`, `gb/15`); the pool cache key changes with the limit; empty result throws the `empty` error with a 'raise the limit' hint; `cache.random()` skips entries above the limit and entries without a stored rating while a limit is set; the poster-cache index entry stores `contentRating`; now-playing above the limit or unrated is treated as nothing playing, unless `limitNowPlaying:false`; an owner-pinned poster is exempt)
  2. `npm test`
  3. `npm run test:e2e -- content-rating`  (the mock's 8 titles carry G, PG, PG-13, R, TV-MA, `gb/12`, `gb/15` and no rating; with `maxContentRating:'PG-13'` the library request (`page.on('request')`) lists `gb/12` among its `contentRating` values and 50 refreshes show only titles 1, 2, 3 and 6 (read from the active poster layer's `alt`); with `'R'` titles 4 and 5 also appear; with `''` all 8 appear; cached-poster case: show title 4 with no limit, then set `PG-13` and `mock.down()`: 20 offline rotations never show title 4; now-playing case: `mock.play(4)` under `PG-13` does not display title 4, and with `limitNowPlaying:false` it does; the "Household with children" toggle in Settings sets and clears `maxContentRating`, defaulting to `PG-13`)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'contentRating' js/plex.js && grep -q 'contentRating' js/poster-cache.js && grep -q 'name="limitNowPlaying"' index.html && grep -q 'id="household-toggle"' index.html`
  6. narrated: independent reviewer (risk:high, the child-safety guarantee) tries to show an above-limit title by every route: random, offline cache, now-playing, a cached pre-2.1 entry, a pinned poster (must be allowed), Plex ignoring the filter parameter.
- **Notes/hazards:**
  - D5. The client-side ladder is the guarantee and is always applied, so a wrong server parameter cannot leak an R title. The Plex request parameter and multi-value syntax are **(verify)**. The country table is ruled (Q19); real stored strings are checked in `real-server-validation-extended`.
  - The limit is its own "Household with children" toggle (UI-only; on reveals the select defaulting to `PG-13`; off stores `maxContentRating: ''`) and is **not** part of the protection preset. `limitNowPlaying` (default true) is shown only while a limit is set.
  - `toPoster` gains `contentRating` here; `metadata-and-now-playing` reads it. The poster-cache index entry gains `contentRating` (this phase owns `js/poster-cache.js`, after `cache-first-fetch`). Entries cached before 2.1 have none and are skipped while a limit is set.
  - Mock: add `contentRating` to the existing 8 `MOVIES` (G, PG, PG-13, R, TV-MA, `gb/12`, `gb/15`, none); honour a `contentRating=` comma-separated value list on `/library/sections/1/all` strictly (a title whose rating is not in the list is dropped, so a request list missing `gb/12` fails the PG-13 e2e), the way Plex is believed to **(verify)**; still ignore unknown params. The mock keeps exactly 8 titles.
  - Ladder: `G=TV-Y=TV-G < PG=TV-Y7=TV-PG < PG-13=TV-14 < R=TV-MA < NC-17`; a rating on the same rung as the limit is allowed (`R` allows `TV-MA`).

### 14. `kiosk-and-pin` — Kiosk mode, settings PIN, recovery

- **Goal:** Hide the controls entirely, reveal them by a 3 s corner hold or a 3 s Enter hold, gate settings and token reveal behind an optional PIN, and allow a loopback-only PIN reset.
- **Findings:** E12, E16 · **Requirements:** R-KIOSK-1, R-KIOSK-2 · **Rulings:** D10, D16
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `rotation-layout-and-shell`, `settings-and-schedule-core`
- **Output:** `js/kiosk.js`, `tests/kiosk.test.js`, `js/main.js`, `js/settings-ui.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/kiosk.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/kiosk.test.js && node --test tests/kiosk.test.js`  (hash/verify round trip with salt; wrong PIN fails; lockout: 5 failures lock 60 s, doubling to 15 min, clears on success; fallback hasher used when `crypto.subtle` is missing; `cornerZone(rotation, viewport)` returns the viewer's bottom-right 96x96 region for 0/90/180/270; hold timer cancels on movement > 12 px or early release; `shouldResetPin(config)` is true only for `{resetPin: true}`)
  2. `npm test`
  3. `npm run test:e2e -- kiosk`  (`kioskMode:true`: pointer move, tap and key press never add `.visible` to `#controls`, and the controls are `inert`; a 3 s press in the corner does, for 15 s, at rotation 0 and 90; holding Enter for 3 s does, including with `disableShortcuts:true`; with a PIN set, `s` and the Settings button show the PIN dialog (at rotation 90 `#pin-dialog`'s computed transform angle is 90 and its bounding box lies inside the viewport); a wrong PIN keeps Settings closed; the correct PIN opens it; `#token-toggle` asks for the PIN and the field re-hides when the sheet closes; `disableShortcuts:true` ignores `s`, `d`, `r`, `p`, `o`, `f`, space; the PIN dialog has an on-screen keypad usable by touch; export with 'include token' contains no PIN material and an import file carrying PIN material is ignored; with `config.json` intercepted by `context.route` to `{"resetPin": true}` Settings opens without a PIN and `localStorage` holds no PIN hash or salt, and without the flag the PIN stays; Diagnostics shows `PIN reset flag present` while the flag is served)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'name="kioskMode"' index.html && grep -q 'id="pin-dialog"' index.html`
  6. `grep -q 'deterrent' index.html js/kiosk.js`  (the UI states the PIN is deterrence, D16)
  7. narrated: independent reviewer (risk:high) tries to reach settings, Diagnostics, import, reset or the token without the PIN (keyboard, URL, Tab focus into hidden controls, `data-action` click via dispatch, long-press without release), and tries to trigger `resetPin` from a non-loopback origin (the server refuses `config.json`; verified in `serve-config-guard`).
- **Notes/hazards:**
  - D10 and Q21 (ruled): the PIN reset works through a loopback-only `config.json` flag `{"resetPin": true}`, fetched on **every** load (not only first run) and honoured while present; Diagnostics warns while the flag is present and the README says to remove it afterwards. Do not add a network reset path.
  - The PIN is deterrence only (D16); the UI and README say so. Hash with salted SHA-256 via Web Crypto (requires a secure context; `localhost` and https qualify), fall back to a small pure-JS SHA-256 on plain-http LAN origins.
  - Hidden controls must also be unfocusable (`inert` or `display:none`) in kiosk mode, otherwise Tab reaches them.
  - Hold detection uses pointer events (`pointerdown`/`pointerup`/`pointercancel`) so it works for mouse, touch and pen, plus `keydown` Enter timing for remotes (cancel on `keyup`). Place the zone with the `--ui-rotation` variable the shell uses.
  - `s` key and the Settings button both route through one `requestSettings()` that applies the PIN gate; same for Diagnostics, import and reset.
  - Lockout state is kept in memory plus `localStorage` (`plexPoster.pinLock`) so a reload does not reset it; this is not a security boundary.

### 15. `device-helper-server` — Loopback device helper for screen power and temperature

- **Goal:** Add an opt-in `--helper` mode that lets the page switch display power and read CPU temperature on a Pi.
- **Findings:** E6 · **Requirements:** R-HELP-1 · **Rulings:** D8, D9
- **Mode:** afk · **Tags:** risk:high · **Blocked by:** `serve-config-guard`
- **Output:** `scripts/device-helper.mjs`, `scripts/serve.mjs`, `tests/device-helper.test.js`
- **Acceptance criteria:**
  1. `test -f tests/device-helper.test.js && node --test tests/device-helper.test.js`  (with an injected fake `execFile`: `POST /__helper/display {on:false}` runs exactly the chosen strategy's argv (`cec-ctl -d /dev/cec0 --to 0 --standby`, `cec-client` with `standby 0` on stdin, or `wlr-randr --output <name> --off`) and `{on:true}` the matching on argv; the `wlr-randr` call receives an `env` containing `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR` from the flags or the helper's environment and nothing else secret; a non-boolean `on` (`'yes'`, `1`, missing) -> 400 and no command; non-loopback peer, missing `X-Poster-Helper: 1`, hostile `Host` (`evil.example`, `localhost.evil.com`) -> 403 and no command, while `Host: localhost:8080` is accepted; `X-Forwarded-For: 127.0.0.1` from a non-loopback peer is still 403; `GET /__helper/status` lists the detected power strategy or `null` and `tempC` parsed from `thermal_zone0`; `POST /__helper/brightness` -> 404; `--helper-fake` records calls and returns canned data, and exposes the recorded calls as `GET /__helper/calls` (a JSON array of `{ action, on, at }`, oldest first) **in fake mode only**: without `--helper-fake` that route is 404, and with it the same loopback, Host and `X-Poster-Helper: 1` guards apply; integration: `serve.mjs --helper --helper-fake` spawned on a free port answers `status` 200 with the header and 403 without, `calls` lists a `display` call after a `POST /__helper/display` and is 404 when started with `--helper` alone)
  2. `npm test`
  3. `test -f scripts/device-helper.mjs && ! grep -nE "\bexec\(|execSync|shell: *true" scripts/device-helper.mjs`  (`execFile` with fixed argument arrays only, never a shell)
  4. `test -f scripts/device-helper.mjs && test -f scripts/serve.mjs && ! grep -n 'Access-Control-Allow' scripts/device-helper.mjs scripts/serve.mjs`  (no CORS grant)
  5. `test -f scripts/device-helper.mjs && ! grep -niE 'brightness|ddcutil|backlight|vcgencmd display_power' scripts/device-helper.mjs`  (brightness is dropped, D8)
  6. `test -z "$(git status --porcelain -- js css index.html sw.js scripts/net.mjs scripts/mock-plex.mjs)"`
  7. narrated: independent reviewer (risk:high; this phase runs commands on the device) tries to run a command with a hostile body, a spoofed header and a rebinding Host.
- **Notes/hazards:**
  - D8: scope is screen power (HDMI-CEC via `cec-ctl`/`cec-client`; output off/on via `wlr-randr` with the compositor environment passed through) and CPU temperature. Brightness control is dropped. Loopback-only and opt-in.
  - Reuses `isLoopback` and `isLoopbackHost` (hostname-only Host check) from `scripts/net.mjs`; never reads proxy headers.
  - Without `--helper` the routes do not exist (404), so nothing changes for existing users. Flags: `--helper-power cec-ctl|cec-client|wlr-randr|none`, `--helper-output <name>`, `--helper-wayland-display <name>`, `--helper-xdg-runtime-dir <dir>`; default is auto-detect by probing for the binaries, reported by `status`.
  - All command syntax is **(verify)** and cannot be exercised here: `cec-ctl` needs `/dev/cec0` and the `video` group; `cec-client -s -d 1` with `on 0` / `standby 0`; `wlr-randr --output HDMI-A-1 --off|--on`. `real-server-validation-extended` has optional rows for each, plus "window still full-screen after power off/on".
  - Every command gets a 5 s timeout and runs one at a time (a lock), so a hung `cec-client` cannot stack processes; kill on timeout.
  - CSRF: the custom header forces a CORS preflight that is never granted; that is why `Access-Control-Allow-*` must not appear.

### 16. `device-helper-integration` — Use the helper from the app and show CPU temperature

- **Goal:** Optional page-side client for the helper: power off in sleep, power on at wake, CPU temperature in Diagnostics.
- **Findings:** E6, E9 · **Requirements:** R-HELP-2 · **Rulings:** D8
- **Mode:** afk · **Tags:** ui · **Blocked by:** `device-helper-server`, `sleep-mode`
- **Output:** `js/helper.js`, `tests/helper.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/helper.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/helper.test.js && node --test tests/helper.test.js`  (fake `fetch`: 404 or network error -> `available:false` and no throw; every request carries `X-Poster-Helper: 1`; `power(false)` posts `{on:false}`; failures are logged once, not every tick)
  2. `npm test`
  3. `npm run test:e2e -- helper`  (harness `serveArgs: ['--helper','--helper-fake']`: with `deviceHelper:true` Diagnostics shows `CPU temperature` with the fake value; entering sleep makes `GET /__helper/calls` (read with the `X-Poster-Helper: 1` header through `context.request`) show power off after the veil is up, then power on at wake before the poster fetch; with `deviceHelper:false` or without `--helper` the page makes no `/__helper/` request after the initial probe and logs no console error)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'name="deviceHelper"' index.html && test -f js/helper.js && ! grep -niE 'brightness' js/helper.js`
- **Notes/hazards:**
  - E9 here is the CPU-temperature half (the `backdrop-filter` half is in `pi-stability`). Probe once at boot and when Settings opens; never poll in a loop except the Diagnostics temperature, which refreshes only while that dialog is open.
  - `deviceHelper` default false: a page that silently runs commands on the device must be an explicit opt-in even on loopback.
  - Power off must happen after the veil is up, and power on before the poster fetch on wake, with a short delay for the TV to wake (a named constant, **(verify)** on hardware). A power cycle can renegotiate the display and hide the page, delaying wake-on-playback through timer throttling: a V1-extended row checks it.

### 17. `pi-stability` — Remove backdrop blur, guarded daily self-reload, overscroll backstop

- **Goal:** Cut GPU load on the settings sheet, shed Chromium memory growth with a daily reload that cannot strand a display, and add the in-page swipe-back backstop.
- **Findings:** E9, E10 · **Requirements:** R-PROT-3, R-PROT-4, R-TOPO-1 · **Rulings:** D6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `sleep-mode`, `settings-and-schedule-core`
- **Output:** `css/app.css`, `js/main.js`, `index.html`, `sw.js`, `tests/e2e/pi-stability.spec.mjs`
- **Acceptance criteria:**
  1. `test -f css/app.css && ! grep -n 'backdrop-filter' css/app.css`
  2. `npm run test:e2e -- pi-stability`  (service workers allowed, fake clock 03:59:30 with `dailyReload:true`, `dailyReloadTime:'04:00'`, page controlled by the service worker and the mock up: a reload happens at 04:00 (navigation counter kept in `sessionStorage`); with the **app server** unreachable at 04:00 (the spec runs with `serveArgs: []`, which gives it a dedicated server, and calls `app.stop()` before 04:00; never `mock.down()`, which stops only the Plex mock and does not touch the probe) no reload and a logged skip reason; with the server stopped, `fetch('index.html',{cache:'no-store'})` from the controlled page rejects, and with it running the same call resolves `ok`, while an ordinary `fetch('index.html')` and a reload still succeed from the cached shell; with service workers blocked (no controller) no reload and a logged skip; no reload while Settings or Diagnostics is open (it retries after close); `dailyReload:false` -> none; a fake clock at 1970 -> none; on wake from sleep with `plexPoster.lastReload` older than 12 h -> one reload, with it newer -> none; a second reload within 10 minutes is refused; after a reload settings persist and `paused` is cleared; `html` and `body` compute `overscroll-behavior: none`; Diagnostics shows `Daily reload: active` or `skipped (...)`, `Secure context: yes|no` and `Service worker: controlling|none`)
  3. `npm test`
  4. `grep -q 'name="dailyReload"' index.html`
  5. `grep -q 'no-store' sw.js && node scripts/check-precache.mjs`  (the service worker special-cases `no-store`; the precache list is still consistent)
- **Notes/hazards:**
  - `sw.js` is Output here: its fetch handler must send requests with `request.cache === 'no-store'` to the network (bypassing `caches.match`), otherwise the shell cache answers the probe and it can never fail. The `no-store` request is the only exception; navigations and ordinary same-origin GETs stay cache-backed. Precache is unchanged (no new `js/` file), so `VERSION` is not bumped.
  - D6 guard: reload only when `navigator.serviceWorker.controller` is set **and** a `fetch('index.html',{cache:'no-store'})` probe succeeds just before reloading; otherwise skip and log. On an http LAN origin there is no service worker, so the default-on setting is effectively off there; a reload with the host down would otherwise leave a dead browser error page that nothing reloads.
  - Tablet note (for `docs`): in a browser tab a reload drops Fullscreen API state (needs a user gesture); installed PWAs and `--kiosk` Chromium are unaffected.
  - Merged because both are Pi-stability fixes sharing one pre-flight and evidence run. Replace the blur with a slightly more opaque `--panel` (about .98); `::backdrop` darkening stays (cheap).
  - Guard against reload loops: write `plexPoster.lastReload` (a plain key, not a setting) before reloading and refuse a second reload within 10 minutes. Never reload mid-fade; wait for `state.busy` to clear.
  - `overscroll-behavior: none` on `html, body` is the backstop for the Chromium flag, which is reported not to stop swipe-back on every touch build (R-DOC-4).

### 18. `recommended-protection-preset` — One-tap recommended protection and the upgrade notice

- **Goal:** A single Settings button that applies the recommended protection values after showing what it will change, and a one-time "What's new in 2.1" toast. Closes M2.
- **Findings:** — (applies the E1, E4 and E2 settings in one tap) · **Requirements:** R-PROT-5, R-UPG-1 · **Rulings:** D4, D5, D6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `sleep-mode`, `frame-brightness`, `pixel-shift`, `pi-stability`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration`
- **Output:** `index.html`, `css/app.css`, `js/settings-ui.js`, `js/main.js`, `tests/e2e/preset.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- preset`  (click **Recommended protection**: a list of the keys it will change appears; Cancel changes nothing; Apply then Save persists `sleepEnabled:true`, `sleepStart:'01:00'`, `sleepEnd:'07:00'`, `nightDim:true`, `nightDimLevel:60`, `nightDimTarget:'stage'`, `pixelShift:true`, `dailyReload:true`; `idleSleepHours` stays 0, `maxContentRating` and `limitNowPlaying` keep their seeded values (test with `maxContentRating:'R'` and with `''`), and `plexToken`, `serverUrl`, `libraryKey` are unchanged)
  2. `npm run test:e2e -- preset`  (upgrade toast: with the harness default `plexPoster.whatsNew` removed and the app configured, a toast containing `What's new in 2.1` with an **Open settings** action appears once and not after a reload; unconfigured it never appears)
  3. `test -z "$(git status --porcelain -- js/settings.js sw.js)"`
  4. `npm test && npm run test:e2e && node scripts/check-precache.mjs`  (milestone close: the full suites pass on the merged M2 tree; this is also the seam check for the shared `index.html`/`main.js`/`display.js` edits)
  5. `npm run test:e2e -- sleep pixel-shift kiosk brightness helper content-rating pi-stability`  (the protection features still pass together)
  6. narrated: `/phase-gate` over M2 (story status, test health, doc currency); one combined scenario at rotation 90: sleep window + kiosk + pixel shift, then wake by playback.
- **Notes/hazards:**
  - D4/D5/D6: the preset does **not** enable idle sleep and does **not** set a content limit (that is the separate "Household with children" toggle). The night-dim target `stage` is ruled (Q20); the preset shows it as an untickable row.
  - The preset constants live in `js/settings-ui.js`; the schema phase deliberately did not hard-code them so the preset can evolve without a schema change. Each row in the confirm list has a checkbox so a household can untick any row.
  - Upgrade toast (R-UPG-1): marker `plexPoster.whatsNew` (a plain key); shown once for a configured install; its action opens Settings at the Display protection fieldset. Lives here because that fieldset is what it points to.

---

## Milestone 3 — P2 polish

Settings and input ergonomics for a keyboardless, remote-or-touch-only device. Exit: `position-drag-nudge`.

### 19. `settings-sheet` — Connection card, libraries, minute presets, Advanced fold, actionable errors and the keyboardless first run

- **Goal:** Open Settings on a "Connected to ... Change" card with library counts, offer rotation time in minutes with the rare settings under Advanced, make errors carry their fix, and start the plex.tv code flow automatically on an unconfigured display.
- **Findings:** U1, U2, U3, U4, U14 · **Requirements:** R-SET-1, R-SET-2, R-SET-3, R-SET-4, R-SET-6, R-FIRST-1 · **Rulings:** D3
- **Mode:** afk · **Tags:** ui · **Blocked by:** `rotation-layout-and-shell`, `settings-and-schedule-core`
- **Output:** `index.html`, `css/app.css`, `js/settings-ui.js`, `js/main.js`, `js/plex.js`, `tests/plex.test.js`, `js/duration.js`, `tests/duration.test.js`, `js/util.js`, `scripts/mock-plex.mjs`, `sw.js`, `tests/e2e/settings-sheet.spec.mjs`, `tests/e2e/first-run.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/plex.test.js && test -f tests/duration.test.js && node --test tests/plex.test.js tests/duration.test.js`  (new `client.libraryCount(key)` reads `totalSize` from a JSON and from an XML container, returns `null` on error or missing attribute, and requests `X-Plex-Container-Start=0` and `X-Plex-Container-Size=0`; `presetFor(seconds)` -> 60/300/900/3600 or `'custom'`; `secondsFromMinutes('2.5')` = 150; below the schema minimum of 10 s clamps; non-numeric returns the previous value)
  2. `npm test`
  3. `npm run test:e2e -- settings-sheet`  (configured settings: `#connected-card` visible with text containing `Connected to Mock Plex`, `Movies` and a **Change** button, `#signin-btn` hidden until Change is pressed; library options read `Movies · 8 titles`; with the mock's count request returning 500 the option reads `Movies` and the connection test still succeeds; Music is not listed; preset buttons set `rotateSeconds` to 60/300/900/3600 on save; Custom with `2.5` saves 150; a stored 420 s opens as Custom showing `7`; `details#advanced` is closed by default and contains `nowPlayingPollSeconds`, `randomPoolSize`, `crossfadeMs`, and a change inside it persists; the rotation field label no longer contains `seconds`; errors: token `bad` -> the empty-state card shows **Sign in again** and pressing it starts a pin request on the intercepted plex.tv route; `mock.down()` -> **Diagnostics** and **Test connection** appear and work; `mock.post('empty')` -> **Turn off "unwatched only"** appears and pressing it saves `unwatchedOnly:false` and refreshes; the connection-test result carries the same buttons)
  4. `npm run test:e2e -- first-run`  (unconfigured, plex.tv intercepted by Playwright `context.route`: without any click `#signin-code-large` shows the code in a computed font size >= 64 px, exactly one `POST /api/v2/pins` was made and Settings is not open; when the intercepted pin expires a new code replaces it and exactly one new pin is created; at rotation 90 the code block's transform angle equals 90; a configured app and a `config.json`-provisioned app (`config.json` intercepted by `context.route`) make no pin request; a plex.tv network failure retries at most once per 30 s with no console error spam; the empty card's **Open settings** still works)
  5. `grep -Eq 'pixelShift: *false' tests/e2e/settings-sheet.spec.mjs tests/e2e/first-run.spec.mjs`
  6. `node scripts/check-precache.mjs`
  7. `grep -q 'totalSize' js/plex.js && grep -q 'id="connected-card"' index.html && grep -q 'id="signin-code-large"' index.html && grep -q 'Sign in again' js/main.js index.html && grep -q 'id="advanced"' index.html`
  8. `test -z "$(git status --porcelain -- js/settings.js js/engine.js js/display.js js/layout.js)"`
- **Notes/hazards:**
  - Merged because these edit the same Settings sheet and empty-state card and share one e2e run. If the dispatch proves too large the conductor may split at the seam "U1-U4 + U2/U3" versus "U14 + first run" (the second depends on the first only through `index.html`).
  - D3: when `isConfigured()` is false and no `config.json` provisioned settings, start the plex.tv PIN flow automatically (reuse `createPin`/`checkPin` in `js/plex.js`; refactor `signIn()` in `js/settings-ui.js` so Settings and the empty card share it), show the code large and upright on the empty-state card, refresh on expiry, and do not force Settings open (today's `boot()` opens it on first run). Network failures back off, no loop. After approval the existing post-sign-in flow runs unchanged. Local-network discovery stays on the Roadmap only.
  - `PlexError.kind` (`auth`, `network`, `timeout`, `http`, `parse`) and `err.kind === 'empty'` already exist; map kind -> actions in one table in `main.js`, reuse it for the empty card, the toast and the test result. `toast()` supports one action; extend `js/util.js` to accept a list of actions.
  - `totalSize` with `X-Plex-Container-Size=0` is **(verify)** against a real server (extended validation). Counts load lazily after the list renders; never block `testConnection()` on them.
  - Storage stays seconds: no migration. The preset group is a radio group with `name` outside the schema (UI-only), mapped in `read()`/`write()`.
  - Mock: `GET /library/sections/{key}/all` with `X-Plex-Container-Size=0` returns `{ MediaContainer: { size: 0, totalSize: 8 } }`; `POST /__mock/counts-fail`, `POST /__mock/empty`, `POST /__mock/nonempty` toggles. The mock keeps its 8 titles.

### 20. `touch-and-labels` — Control labels, first-tap-only wake and shortcut overlay

- **Goal:** Label the icon-only controls, make the first touch only wake them (without eating taps inside dialogs), and list shortcuts under `?`.
- **Findings:** U11, U12, U13 · **Requirements:** R-CTRL-1, R-CTRL-2, R-CTRL-3
- **Mode:** afk · **Tags:** ui · **Blocked by:** `kiosk-and-pin`, `sleep-mode`
- **Output:** `js/shortcuts.js`, `tests/shortcuts.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/touch-controls.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/shortcuts.test.js && node --test tests/shortcuts.test.js`  (the table has `r p space o f s d ?` with a label each; no duplicate keys; `listShortcuts({disableShortcuts:true})` is empty)
  2. `npm test`
  3. `npm run test:e2e -- touch-controls`  (touch context, controls idle-hidden: a tap on the Settings button's position reveals the controls and does NOT open Settings; a second tap opens it; the same with Pin and Rotate (rotation unchanged after the first tap); **no swallow outside the rule:** with Settings open for longer than the controls' hide delay a touch tap on Save works on the first tap; a touch tap on the empty-state card's **Open settings** works on the first tap; a mouse click on a visible button works on the first click; a tap while `#sleep-veil` is up wakes and does not trigger a control; `(hover: none)` emulation shows a text label under each of the 7 icons, desktop shows a tooltip on hover/focus and no persistent label; `controlLabels:'always'`/`'never'` override; `?` opens the shortcuts dialog listing at least 8 entries generated from `shortcuts.js` (at rotation 90 `#shortcuts`' computed transform angle is 90 and its bounding box lies inside the viewport), Esc closes it; with `disableShortcuts:true` `?` does nothing)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'id="shortcuts"' index.html`
- **Notes/hazards:**
  - Root cause of U12: `.controls` has `pointer-events:none` until `.visible`; `pointerdown` adds `.visible` and the browser then dispatches the `click` to the button that just became hit-testable. Record `wasVisible` at `pointerdown` (capture phase) and swallow the following `click` **only when** `wasVisible` was false, the target is inside `#controls` or is the bare stage, no dialog is open, and `pointerType !== 'mouse'` (sceptic I10: `wake()` runs on every `pointerdown` document-wide and hides the controls after 3.5 s even with a dialog open, so an unconditional rule would eat the first tap inside Settings).
  - `KEYS` in `main.js` is rebuilt from `js/shortcuts.js` so the overlay and the handler cannot drift.
  - Touch labels must fit seven buttons on a phone-width bar: stack icon over text, allow the bar to wrap; check at rotation 90.
  - Kiosk mode hides the controls entirely; this phase's first-tap rule applies only when they can be revealed.

### 21. `metadata-and-now-playing` — Metadata overlay and playback progress

- **Goal:** An optional overlay of content rating, runtime and year, plus a thin progress bar (and an optional player label) while something plays.
- **Findings:** U9, U10 · **Requirements:** R-NP-1, R-NP-2 · **Rulings:** D1 (U9's player label is kept, default off, Q22)
- **Mode:** afk · **Tags:** ui · **Blocked by:** `content-rating-filter`, `settings-and-schedule-core`
- **Output:** `js/plex.js`, `tests/plex.test.js`, `js/engine.js`, `tests/engine.test.js`, `js/display.js`, `js/poster-cache.js`, `js/main.js`, `index.html`, `css/app.css`, `scripts/mock-plex.mjs`, `tests/e2e/metadata.spec.mjs`, `tests/e2e/now-playing.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/plex.test.js && test -f tests/engine.test.js && node --test tests/plex.test.js tests/engine.test.js`  (`toPoster` carries `contentRating`, `duration`, `year` for movies and the series values for episodes; `formatRuntime(8040000)` = `2 h 14 m`, `formatRuntime(2880000)` = `48 m`, missing -> empty; `pickNowPlaying` carries `viewOffset`, `duration`, `playerTitle` (`Player.title`) and paused state from JSON and XML sessions; the engine exposes the latest session snapshot even when it returns `null` because the poster is unchanged)
  2. `npm test`
  3. `npm run test:e2e -- metadata`  (`showMeta:true`: `#title-card` text matches `^PG-13 · 2 h 14 m · 1972$` for mock item 3; missing fields are omitted without stray separators; `showMeta:false` and `showTitle:false` -> hidden; `showTitle:true` alone behaves as in 2.0.0; the poster-cache index entry carries `duration` and `contentRating`, so the overlay also works on an offline cached poster)
  4. `npm run test:e2e -- now-playing`  (`mock.play(3, {offset: 600000, duration: 6000000, player: 'Living Room'})`: `#progress` width is 10% (+-1%) of the poster window; after the next poll with `offset: 1200000` it is 20%; `state=paused` freezes it; `mock.stop()` removes it; `showProgress:false` hides it; `showPlayer:true` shows text `Playing in Living Room`, default hides it; the bar is inside `#stage` and 3 px high)
  5. `grep -Eq 'pixelShift: *false' tests/e2e/now-playing.spec.mjs && grep -q 'name="showMeta"' index.html && grep -q 'id="progress"' index.html`
  6. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Merged (r2): both phases edit `toPoster`, `tests/plex.test.js`, the mock and the overlay slot. Export `formatRuntime(ms)` from `js/plex.js`.
  - `viewOffset`, `duration` and `Player.title` in `/status/sessions` are **(verify)** (extended validation). The bar advances between 20 s polls with one linear CSS transition set to the remaining time, never a JS timer per frame; Plex updates `viewOffset` only about every 10 s, so expect a jump on a poll.
  - Mock: add `duration` (ms) and `contentRating` (from `content-rating-filter`) so item 3 is `PG-13`, 8,040,000 ms, 1972; `POST /__mock/play?ratingKey=&offset=&duration=&player=&state=` stores them on the session and returns them in `/status/sessions` (with `Player: { title, state }`).
  - Q22: the "Playing in" label is kept (default off) because D1 does not defer it (ruled, Q22). The bar sits along the bottom edge of the poster window, not on the frame art (frames differ), and moves with pixel shift because it is inside `#stage`.
  - Keep poster-cache index entries small (localStorage): `duration` and `year` only; `summary` is not stored.

### 22. `position-drag-nudge` — Drag and nudge poster positioning

- **Goal:** Place the poster by dragging it or with arrow keys while Settings is open, instead of tiny sliders. Closes M3.
- **Findings:** U5 · **Requirements:** R-SET-5
- **Mode:** afk · **Tags:** ui · **Blocked by:** `rotation-layout-and-shell`, `settings-and-schedule-core`, `settings-sheet`, `touch-and-labels`, `metadata-and-now-playing`
- **Output:** `js/position.js`, `tests/position.test.js`, `index.html`, `css/app.css`, `js/settings-ui.js`, `js/main.js`, `sw.js`, `tests/e2e/position.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/position.test.js && node --test tests/position.test.js`  (`dragToOffset({dx,dy,stageW,stageH,rotation})`: 100 px on a 1000 px stage = 10% at rotation 0, and the same on-screen drag maps to the rotated axes at 90/180/270; `nudge(value, step)` clamps to [-100,100]; Shift multiplies by 10)
  2. `npm run test:e2e -- position`  (`pixelShift:false`; press **Position poster**: the sheet collapses to a bar and the poster accepts pointer drag; drag by 100 px changes `posterOffsetX` by 10 (+-0.2) at rotation 0, and by the mapped amount at 90; ArrowRight nudges +0.1, Shift+ArrowRight +1.0, `+`/`-` change size; arrow keys do not trigger global shortcuts in position mode; **Done** reopens the sheet with the new values; **Cancel** on the sheet afterwards restores the originals; the live preview matches the sliders)
  3. `grep -Eq 'pixelShift: *false' tests/e2e/position.spec.mjs`
  4. `npm test && npm run test:e2e && node scripts/check-precache.mjs`  (milestone close: all P2 phases edit `index.html`, `css/app.css` and `js/settings-ui.js`, so the full e2e suite is the seam check)
  5. narrated: `/phase-gate` over M3; `/ux-simulate` walk of first run (code on the card), reconnect after a token error, and a touch-only session at rotation 90.
- **Notes/hazards:**
  - A modal `<dialog>` makes the page inert and its backdrop swallows pointer events: position mode must close the modal and show a non-modal bar (`dialog.show()` or a plain element), keeping `original` so Cancel still reverts.
  - Arrow keys and `+`/`-` must not collide with the global shortcut table (only active in position mode).
  - On a TV remote the D-pad arrives as arrow keys, which is why nudging matters more than drag.
  - Blocked by every other M3 phase so it is the last of them; the shared files make them serial anyway.

---

## Milestone 4 — P3 bigger features and release

One remaining fill feature, the extended real-server validation, the single docs pass and the version bump. Exit: `release-bump`, which also carries the release gate (D11).

### 23. `fill-blur-and-info` — Landscape fill: blurred backdrop and info panel

- **Goal:** Use the empty sides of a landscape screen for a dimmed poster backdrop or a synopsis panel.
- **Findings:** U7 · **Requirements:** R-FILL-1 · **Rulings:** D1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `metadata-and-now-playing`, `rotation-layout-and-shell`, `pi-stability`
- **Output:** `js/fill.js`, `tests/fill.test.js`, `js/plex.js`, `tests/plex.test.js`, `js/display.js`, `index.html`, `css/app.css`, `scripts/mock-plex.mjs`, `sw.js`, `tests/e2e/fill.spec.mjs`
- **Acceptance criteria:**
  1. `test -f tests/fill.test.js && test -f tests/plex.test.js && node --test tests/fill.test.js tests/plex.test.js`  (`isLandscape({w,h,rotation})` accounts for 90/270; `trimSummary(text, 300)` cuts on a word boundary with an ellipsis; `toPoster` carries `summary`)
  2. `npm test`
  3. `npm run test:e2e -- fill`  (`pixelShift:false`; 1920x1080, rotation 0, `fillMode:'blur'`: `#fill-backdrop` exists, its canvas intrinsic width is <= 64 px, effective brightness <= 0.25, and NO element has a non-`none` computed blur `filter` or `backdrop-filter`; `fillMode:'info'`: `#info-panel` shows title, runtime, rating, year and a summary of at most 301 characters beside the poster; a portrait viewport, or rotation making the effective aspect portrait: neither is shown; `fillMode:'none'` unchanged from today; cross-fade keeps backdrop and poster in step)
  4. `grep -Eq 'pixelShift: *false' tests/e2e/fill.spec.mjs`
  5. `node scripts/check-precache.mjs`
  6. `test -f css/app.css && ! grep -nE 'backdrop-filter|filter: *blur' css/app.css`
- **Notes/hazards:**
  - I4 (anchored): criterion 6 passes only after `pi-stability` removed the `.sheet` blur, so this phase is blocked by `pi-stability`; this phase must not remove that rule itself.
  - Blur technique: draw the poster into a tiny canvas (48 px wide) once per poster and scale it up with CSS; smooth upscaling is the blur. `filter: blur()`/`backdrop-filter` on a full-screen layer is exactly the Pi GPU cost `pi-stability` removed.
  - OLED: backdrop opacity capped at 25%; default `none`; mention in the setting's help text that large lit areas shorten OLED life.
  - `summary` can be long: trim before it enters any stored descriptor (localStorage budget).
  - Mock: add `summary` to the existing 8 `MOVIES`. Multi-poster layout is deferred (D1); this phase delivers U7 for single-poster landscape screens.

### 24. `real-server-validation-extended` — Validate the (verify) items on real hardware and a real server

- **Goal:** A human confirms or corrects every parameter, flag and command the spec marked (verify), and checks the automatic first-run code.
- **Findings:** V1 · **Requirements:** R-VAL-2 · **Rulings:** D11
- **Mode:** hitl · **Tags:** — · **Blocked by:** `validation-checklists`, `real-server-validation`, `content-rating-filter`, `settings-sheet`, `metadata-and-now-playing`, `device-helper-integration`, `pi-stability`
- **Output:** `docs/validation/real-server-extended.md`
- **Acceptance criteria:**
  1. `test -f docs/validation/real-server-extended.md && ! grep -q 'PENDING' docs/validation/real-server-extended.md`
  2. `grep -qx 'Overall: PASS' docs/validation/real-server-extended.md`
  3. `test -f docs/validation/real-server-extended.md && ! grep -Eq 'X-Plex-Token[=:] *[A-Za-z0-9_-]{15,}' docs/validation/real-server-extended.md`
  4. narrated: only PASS closes this phase (D11). Every FAIL row names the phase to reopen (for example `content-rating-filter` if Plex's `contentRating` parameter or real country-prefixed values differ from the table); the conductor routes those through reconcile and this phase stays open. Rows marked `skip if no Pi` may be `SKIPPED` with a reason and still allow `Overall: PASS`.
- **Notes/hazards:**
  - Do this before `docs` so verified facts, not guesses, reach the README.
  - Blocked by the core validation so sign-in/CORS/discovery problems surface first.

### 25. `docs` — README and Roadmap: hardening, setups and shipped features

- **Goal:** Document everything a page cannot do (smart plug, SD wear, overlay FS, battery, Chromium flags and policy, OS blanking, VLAN, managed user, helper, config.json, supported setups), bring the feature docs to 2.1 reality, and record each D1 deferral on the Roadmap.
- **Findings:** E7, E8, E11, E13, E15, E17, F4 · **Requirements:** R-DOC-1, R-DOC-2, R-DOC-3, R-DOC-4, R-DOC-5, R-DOC-6, R-DOC-7, R-DOC-8, R-DOC-9, R-TOPO-1 · **Rulings:** D1, D7, D9, D16
- **Mode:** afk · **Tags:** docs · **Blocked by:** `recommended-protection-preset`, `position-drag-nudge`, `fill-blur-and-info`, `real-server-validation-extended`
- **Output:** `README.md`, `Roadmap.md`
- **Acceptance criteria:**
  1. `for k in 'smart plug' 'Overlay File System' 'disk-cache-dir' 'lost on reboot' 'swelling' 'overscroll-history-navigation' 'disable-pinch' 'overscroll-behavior' 'managed user' 'Plex Home' '32400' 'VLAN' '--helper' 'cec-ctl' 'wlr-randr' 'config.json' 'resetPin' 'reverse proxy' 'Recommended protection' 'Household with children' 'DeveloperToolsAvailability' 'chromium-browser' 'labwc' 'screen blanking' 'Supported setups' 'deterrent' 'Fullscreen' 'rotateUi' 'hdmi_force_hotplug' 'video group' 'fake-hwclock'; do grep -qiF -- "$k" README.md || { echo "missing: $k"; exit 1; }; done`
  2. `grep -Eqi 'not (yet )?verified|unverified' README.md`  (unverified flags and commands are labelled as such)
  3. `node -e "const fs=require('fs');const t=fs.readFileSync('README.md','utf8');const bad=[...t.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].map(m=>m[1].split('#')[0]).filter(p=>p&&!fs.existsSync(p));if(bad.length){console.error(bad);process.exit(1)}"`  (relative links resolve)
  4. `for f in js/*.js scripts/*.mjs; do grep -q "$(basename "$f")" README.md || { echo "undocumented: $f"; exit 1; }; done`  (project layout lists every module and script)
  5. `for k in 'Sleep' 'Pixel shift' 'Kiosk' 'PIN' 'Content rating' 'Fill' 'Progress' 'Recommended protection' 'npm run test:e2e'; do grep -qiF -- "$k" README.md || { echo "missing: $k"; exit 1; }; done && grep -qi 'shortcuts overlay' README.md`
  6. `for k in 'Multi-poster landscape layout' 'Frame per poster source' 'Animated frame bulbs' 'Frame rotation' 'Remote control'; do grep -qF -- "$k" Roadmap.md || { echo "roadmap missing: $k"; exit 1; }; done && grep -q 'PIN-locked' Roadmap.md && ! sed -n '/Ideas/,$p' Roadmap.md | grep -qE 'Scheduled dimming|Playback progress'`  (every D1 deferral has an entry, the existing Remote control idea carries D7's constraint, and shipped ideas left the list)
  7. `test -z "$(git status --porcelain -- . ':!README.md' ':!Roadmap.md')"`  (only the two documents changed; `.orchestrator/` is git-ignored)
  8. narrated: `/doc-review` band; `keep-docs-current` over `git diff --name-only 46257c3..HEAD`; every command and flag is tagged (verify)/unverified unless proven in `real-server-validation-extended`; `Roadmap.md` deferral entries each state their reason (spec Non-goals table).
- **Notes/hazards:**
  - Merged (r2) from the two r1 README passes. Sections: *Supported setups* (the three topologies of R-TOPO-1 and what the http LAN page loses), *Hardening for 24/7 displays* (sleep and the recommended preset, OS screen blanking off, smart plug schedule with a clean-shutdown caution, read-only overlay FS via `raspi-config` with "configure, then enable the overlay", Chromium disk cache in RAM), *Tablets* (charge limit / smart plug, battery swelling, the reload-drops-fullscreen note), *Kiosk* (flags `--kiosk --noerrdialogs --disable-session-crashed-bubble --app=` plus `--overscroll-history-navigation=0` and `--disable-pinch`, `DeveloperToolsAvailability` policy, package `chromium-browser` on Bookworm and `chromium` on Trixie, labwc/XDG autostart, the PIN-is-deterrence statement and the `resetPin` recovery), *Network* (IoT/guest VLAN reaching only Plex 32400 and plex.tv 443), *Accounts* (Plex Home managed user limited to one library; "Household with children" toggle), *The helper* (`--helper`, `cec-ctl`/`cec-client`/`wlr-randr`, compositor environment, loopback only, `hdmi_force_hotplug=1` in the boot config and membership of the `video` group for `/dev/cec0`, both (verify)), *Rotation* (turning the OS or compositor instead: `rotateUi` off with app rotation 0 is supported, D2), *Clock* (Pi OS `fake-hwclock` restores a stale time after a long power-off until NTP syncs, Q23), *config.json* (loopback-only, delete after first run, never behind a reverse proxy).
  - Roadmap: extend "Remote control" with D7's constraints; add entries for multi-poster landscape layout, frame per poster source with "Coming Attractions" artwork, animated frame bulbs and frame rotation, each with its reason from the spec's Non-goals table; remove "Scheduled dimming / sleep" and "Playback progress" (shipped).
  - The `Findings` list includes F4 because the README documents the loopback `config.json` and allowlist behaviour.

### 26. `release-bump` — Bump the version once; the release gate

- **Goal:** Set `VERSION` to 2.1.0 in `sw.js`, `js/main.js` and `package.json` (and the lockfile) so installed clients update, only after the token is rotated and both real-server validations PASS.
- **Findings:** — · **Requirements:** R-REL-1 · **Rulings:** D11, D13, D16
- **Mode:** afk · **Tags:** — · **Blocked by:** `docs`, `rotate-plex-token`, `real-server-validation`, `real-server-validation-extended`
- **Output:** `sw.js`, `js/main.js`, `package.json`, `package-lock.json`, `tests/e2e/release.spec.mjs`
- **Acceptance criteria:**
  1. `node -e "const fs=require('fs');const g=(f)=>fs.readFileSync(f,'utf8').match(/VERSION = '([^']+)'/)[1];const a=g('sw.js'),b=g('js/main.js'),p=require('./package.json'),l=require('./package-lock.json');if(!(a===b&&b===p.version&&a==='2.1.0'&&l.version==='2.1.0'&&l.packages[''].version==='2.1.0')){console.error(a,b,p.version,l.version);process.exit(1)}"`
  2. `test -f docs/security/token-rotation.md && grep -qx 'Rotated: yes' docs/security/token-rotation.md`  (D11: token rotated)
  3. `for f in docs/validation/real-server-core.md docs/validation/real-server-extended.md; do test -f "$f" && grep -qx 'Overall: PASS' "$f" && ! grep -q 'PENDING' "$f" || { echo "validation not PASS: $f"; exit 1; }; done`  (D11: both validation files PASS; a FAIL or PENDING blocks the release)
  4. `npm test`
  5. `npm run test:e2e`  (includes `release.spec.mjs`: with service workers enabled, a stale `shell-2.0.0` cache is created in the page before registration, then after activation `shell-2.1.0` exists and `shell-2.0.0` is gone)
  6. `node scripts/check-precache.mjs`
  7. `test "$(git status --porcelain --untracked-files=all | awk '{print $2}' | sort | tr '\n' ' ')" = "js/main.js package-lock.json package.json sw.js tests/e2e/release.spec.mjs "`  (nothing else changed)
  8. narrated: the close-time reviews (full `code-review` of `46257c3..HEAD`, `security-scan` over the repo, `dependency-audit` of the devDependencies, `scrub-pii` on `docs/validation/*` and `docs/security/*`) are the conductor's Step 8 close work; this plan has no `publish` tag (D13).
- **Notes/hazards:**
  - Decision (D16): one bump here, not per phase, for clean releases (the r1 rationale that per-phase bumps would reload clients was wrong: any `sw.js` edit already triggers an update).
  - The release path includes the four D11 prerequisites only; optional and deferred phases (including `purge-git-history`) never block it. `release-bump` is blocked by `rotate-plex-token`, `real-server-validation` and `real-server-validation-extended`, so a FAIL in either file cannot pass criterion 3.
  - Closes M4 and the whole run: `npm test`, `npm run test:e2e` and the precache check are the final full-suite evidence (criteria 4-6), replacing the r1 gate phases.
  - Do not tag, push or publish anything: the conductor pushes the working branch only (D13); a PR or merge happens only when the owner asks.

### 27. `purge-git-history` — OPTIONAL: purge config.js from git history

- **Goal:** Remove `config.js` (the leaked token) from every commit and force-push, only if the owner says the repository is public or shared.
- **Findings:** S1 · **Requirements:** R-SEC-2 · **Rulings:** D14
- **Mode:** hitl · **Tags:** irreversible · **Blocked by:** `rotate-plex-token`, `release-bump`
- **Output:** `docs/security/history-purge.md`
- **Acceptance criteria:**
  1. `d=$(mktemp -d) && git clone -q "$(git remote get-url origin)" "$d/fresh" && test -z "$(git -C "$d/fresh" log --all --oneline -- config.js)"`  (run against a fresh clone of `origin`, not the conductor's checkout, which keeps the old objects until re-synced)
  2. `test -f docs/security/history-purge.md && grep -qx 'Purged: yes' docs/security/history-purge.md`
  3. `git fsck --no-dangling >/dev/null 2>&1`
  4. narrated: **explicitly skipped unless the owner says the repository is public or shared (D14);** it is outside the release path and nothing depends on it. Before the approval pause the independent precondition review (target commit, clean tree, suite green, exact command) is written; the owner runs the force-push themselves.
- **Notes/hazards:**
  - Hand-off checklist: (1) `git clone --mirror` a backup somewhere safe; (2) install `git-filter-repo` **(verify the package name for your OS)**; (3) in a fresh clone: `git filter-repo --invert-paths --path config.js`; (4) re-add `origin`; (5) `git push --force-with-lease --all && git push --force --tags`; (6) tell every collaborator to re-clone and re-sync the conductor's checkout (`git fetch --prune --force`, reset each local branch, drop stale refs); (7) ask GitHub support to drop cached views and check forks if the repo was public; (8) record `Purged: yes` and the date in `docs/security/history-purge.md`.
  - Irreversible: every SHA changes, so it runs after `release-bump`. Rotation (`rotate-plex-token`) is what actually removes the risk; a purge only removes the evidence. Do not rewrite history on the branch the conductor is committing to while it is running.

---

## Dependency graph

`phase -> blocked by` (real prerequisites only; the first column is the plan number, which implies no order beyond the arrows). Output overlap is not an edge (convention 6).

| # | Phase | Mode | Blocked by |
|---|---|---|---|
| 1 | `e2e-harness` | afk | — |
| 2 | `settings-and-schedule-core` | afk | `e2e-harness` |
| 3 | `rotate-plex-token` | hitl | — |
| 4 | `serve-config-guard` | afk | — |
| 5 | `rotation-layout-and-shell` | afk | `e2e-harness`, `settings-and-schedule-core` |
| 6 | `cache-first-fetch` | afk | `e2e-harness`, `settings-and-schedule-core` |
| 7 | `status-indicator` | afk | `rotation-layout-and-shell`, `settings-and-schedule-core` |
| 8 | `validation-checklists` | afk | — |
| 9 | `real-server-validation` | hitl | `validation-checklists`, `cache-first-fetch`, `serve-config-guard`, `rotation-layout-and-shell`, `status-indicator`, `rotate-plex-token` |
| 10 | `pixel-shift` | afk | `rotation-layout-and-shell`, `settings-and-schedule-core` |
| 11 | `frame-brightness` | afk | `settings-and-schedule-core` |
| 12 | `sleep-mode` | afk | `settings-and-schedule-core` |
| 13 | `content-rating-filter` | afk | `settings-and-schedule-core`, `cache-first-fetch` |
| 14 | `kiosk-and-pin` | afk | `rotation-layout-and-shell`, `settings-and-schedule-core` |
| 15 | `device-helper-server` | afk | `serve-config-guard` |
| 16 | `device-helper-integration` | afk | `device-helper-server`, `sleep-mode` |
| 17 | `pi-stability` | afk | `sleep-mode`, `settings-and-schedule-core` |
| 18 | `recommended-protection-preset` | afk | `sleep-mode`, `frame-brightness`, `pixel-shift`, `pi-stability`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration` |
| 19 | `settings-sheet` | afk | `rotation-layout-and-shell`, `settings-and-schedule-core` |
| 20 | `touch-and-labels` | afk | `kiosk-and-pin`, `sleep-mode` |
| 21 | `metadata-and-now-playing` | afk | `content-rating-filter`, `settings-and-schedule-core` |
| 22 | `position-drag-nudge` | afk | `rotation-layout-and-shell`, `settings-and-schedule-core`, `settings-sheet`, `touch-and-labels`, `metadata-and-now-playing` |
| 23 | `fill-blur-and-info` | afk | `metadata-and-now-playing`, `rotation-layout-and-shell`, `pi-stability` |
| 24 | `real-server-validation-extended` | hitl | `validation-checklists`, `real-server-validation`, `content-rating-filter`, `settings-sheet`, `metadata-and-now-playing`, `device-helper-integration`, `pi-stability` |
| 25 | `docs` | afk | `recommended-protection-preset`, `position-drag-nudge`, `fill-blur-and-info`, `real-server-validation-extended` |
| 26 | `release-bump` | afk | `docs`, `rotate-plex-token`, `real-server-validation`, `real-server-validation-extended` |
| 27 | `purge-git-history` | hitl | `rotate-plex-token`, `release-bump` |

### Waves (longest-path levels)

Phases in one wave have no path between them (given the `Blocked by` edges), so they are dependency-concurrent. Output overlap then splits each wave into the concurrent groups below.

| Wave | Phases |
|---|---|
| 0 | `e2e-harness`, `rotate-plex-token`, `serve-config-guard`, `validation-checklists` |
| 1 | `settings-and-schedule-core`, `device-helper-server` |
| 2 | `rotation-layout-and-shell`, `cache-first-fetch`, `frame-brightness`, `sleep-mode` |
| 3 | `status-indicator`, `pixel-shift`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration`, `pi-stability`, `settings-sheet` |
| 4 | `real-server-validation`, `recommended-protection-preset`, `touch-and-labels`, `metadata-and-now-playing` |
| 5 | `position-drag-nudge`, `fill-blur-and-info`, `real-server-validation-extended` |
| 6 | `docs` |
| 7 | `release-bump` |
| 8 | `purge-git-history` |

### Phases that can run concurrently

Waves are a planning aid: the conductor computes the real frontier live from `Blocked by`, and the Output-overlap rule applies across waves too (a wave-3 phase and a wave-2 phase that share a path are serialised). Concurrent phases run in separate git worktrees with their own `E2E_PORT`/`E2E_MOCK_PORT` (D12). Within each wave, afk phases are packed greedily into groups whose Output paths are pairwise disjoint; phases in the same group may run at the same time, groups of one wave run one after another. `hitl` phases never occupy an agent and always run alongside.

| Wave | Concurrent group |
|---|---|
| 0 | `e2e-harness` ‖ `serve-config-guard` ‖ `validation-checklists` |
| 0 | `rotate-plex-token` (hitl: owner acts, no agent) |
| 1 | `settings-and-schedule-core` ‖ `device-helper-server` |
| 2 | `rotation-layout-and-shell` ‖ `cache-first-fetch` |
| 2 | `frame-brightness` (alone: shares Output with a wave-mate) |
| 2 | `sleep-mode` (alone: shares Output with a wave-mate) |
| 3 | `status-indicator` (alone: shares Output with a wave-mate) |
| 3 | `pixel-shift` (alone: shares Output with a wave-mate) |
| 3 | `content-rating-filter` (alone: shares Output with a wave-mate) |
| 3 | `kiosk-and-pin` (alone: shares Output with a wave-mate) |
| 3 | `device-helper-integration` (alone: shares Output with a wave-mate) |
| 3 | `pi-stability` (alone: shares Output with a wave-mate) |
| 3 | `settings-sheet` (alone: shares Output with a wave-mate) |
| 4 | `recommended-protection-preset` (alone: shares Output with a wave-mate) |
| 4 | `touch-and-labels` (alone: shares Output with a wave-mate) |
| 4 | `metadata-and-now-playing` (alone: shares Output with a wave-mate) |
| 4 | `real-server-validation` (hitl: owner acts, no agent) |
| 5 | `position-drag-nudge` (alone: shares Output with a wave-mate) |
| 5 | `fill-blur-and-info` (alone: shares Output with a wave-mate) |
| 5 | `real-server-validation-extended` (hitl: owner acts, no agent) |
| 6 | `docs` |
| 7 | `release-bump` |
| 8 | `purge-git-history` (hitl: owner acts, no agent) |

### Critical path

`e2e-harness` -> `settings-and-schedule-core` -> `rotation-layout-and-shell` -> `kiosk-and-pin` -> `touch-and-labels` -> `position-drag-nudge` -> `docs` -> `release-bump`  (8 phases)

No optional or deferred phase is on it: the deferred items (D1) have no phases, and `purge-git-history` is a leaf outside the release path.

### Finding coverage (also in `docs/spec.md`, Traceability matrix)

Every finding ID is delivered by at least one phase, or is `deferred (D1)` with its reason in the spec (enablers, whose `Findings:` line starts with `—`, are left out of this table):

| Finding | Phase(s) |
|---|---|
| F1 | `rotation-layout-and-shell` |
| F2 | `rotation-layout-and-shell` |
| F3 | `cache-first-fetch` |
| F4 | `serve-config-guard`, `docs` |
| F5 | `status-indicator` |
| S1 | `rotate-plex-token`, `purge-git-history` |
| V1 | `validation-checklists`, `real-server-validation`, `real-server-validation-extended` |
| U1 | `settings-sheet` |
| U2 | `settings-sheet` |
| U3 | `settings-sheet` |
| U4 | `settings-sheet` |
| U5 | `position-drag-nudge` |
| U6 | deferred (D1): phone remote → Roadmap |
| U7 | `fill-blur-and-info` ; multi-poster part deferred (D1) → Roadmap |
| U8 | deferred (D1): frame per source and "Coming Attractions" artwork → Roadmap |
| U9 | `metadata-and-now-playing` |
| U10 | `metadata-and-now-playing` |
| U11 | `touch-and-labels` |
| U12 | `touch-and-labels` |
| U13 | `touch-and-labels` |
| U14 | `settings-sheet` |
| E1 | `sleep-mode` |
| E2 | `pixel-shift` |
| E3 | deferred (D1): animated bulbs → Roadmap |
| E4 | `frame-brightness` |
| E5 | deferred (D1): frame rotation → Roadmap |
| E6 | `device-helper-server`, `device-helper-integration` |
| E7 | `docs` |
| E8 | `cache-first-fetch`, `docs` |
| E9 | `device-helper-integration`, `pi-stability` |
| E10 | `pi-stability` |
| E11 | `docs` |
| E12 | `kiosk-and-pin` |
| E13 | `docs` |
| E14 | `content-rating-filter` |
| E15 | `docs` |
| E16 | `kiosk-and-pin` |
| E17 | `docs` |
| D1 | `docs` (Roadmap entries for every deferral) |
