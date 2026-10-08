# Integration Plan — Plex Poster Display 2.1

Companion to `docs/spec.md` (requirements, settings model, open questions, traceability matrix). Driven by the `integration-orchestrator` skill; phases are named, numbered only inside this file, and ordered by `Blocked by`, not by number.

## Preamble

- **Every command runs from the repository root** (`/home/user/plex-poster-app`).
- **Starting commit:** `3a7b688` ("Rewrite as an installable, offline-capable progressive web app"), branch `claude/intelligent-rubin-4vsi63`, `VERSION` 2.0.0.
- **Run the mock:** `npm run demo` serves the app on `http://localhost:8080` and a fake Plex server on `http://localhost:32401` (token `demo-token`, library key `1`; control endpoints under `/__mock/`).
- **Unit tests:** `npm test` (`node --test tests/*.test.js`; 29 tests pass at the starting commit).
- **Browser tests** (after `e2e-harness`): `npm run test:e2e` runs every `tests/e2e/*.spec.mjs` against `scripts/serve.mjs --mock` on ports 18080 / 18401 (`E2E_PORT`, `E2E_MOCK_PORT`); `npm run test:e2e -- <name> [<name> ...]` runs exactly `tests/e2e/<name>.spec.mjs`. Chromium is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
- **Precache check** (after `e2e-harness`): `node scripts/check-precache.mjs` fails when a `SHELL` entry in `sw.js` is missing on disk or a `js/*.js` file is not precached.

### Conventions every phase follows

1. **Output is a whitelist.** A phase may create or modify only its `Output` paths. The plan file and `.orchestrator/` are never Output. A parenthetical after a path (for example `package-lock.json (only if ...)`) is a condition, not part of the path.
2. **Acceptance criteria are shell commands run from the repo root; exit 0 is a pass.** An item starting `narrated:` is not a command: it names what a human or reviewer checks, and scores as narrated. Criteria of the form `git diff --quiet HEAD -- <paths>` prove scope and are evaluated before the phase commit.
3. **New files under `js/` go into `SHELL` in `sw.js` in the phase that creates them**, which therefore lists `sw.js` in Output. `VERSION` is bumped **once**, in `release-bump` (spec Q6): per-phase bumps would make every phase edit the same three lines and would auto-reload installed clients into unfinished work.
4. **Output overlap is a scheduling constraint, not a dependency.** Many UI phases edit `index.html`, `css/app.css`, `js/main.js`, `js/display.js`, `js/settings-ui.js` and `scripts/mock-plex.mjs`. Two phases whose Output lists share a path must not run concurrently even when neither blocks the other. The *Concurrency* section lists only Output-disjoint sets.
5. **(verify)** marks a Plex parameter, Chromium flag or hardware command that could not be exercised in the authoring environment; each is carried into `docs/validation/`.
6. **Settings keys are added once** (`settings-and-schedule-core`); feature phases add controls (bound by `name`) and consume keys, and do not edit `js/settings.js`.
7. **Plan edits commit separately** from phase output.
8. `Findings: —` means the phase delivers no source finding directly (enabler, gate or documentation of shipped work).

### Tag assignment (for approval)

| Tag | Phases |
|---|---|
| `risk:high` | `rotate-plex-token`, `serve-config-guard`, `ui-rotation-shell`, `sleep-mode`, `kiosk-and-pin`, `device-helper-server`, `multi-poster-layout`, `remote-config-server`, `purge-git-history` |
| `irreversible` | `purge-git-history` |
| `ui` | `layout-rotation-fix`, `status-indicator`, `ui-rotation-shell`, `pixel-shift`, `frame-brightness`, `sleep-mode`, `bulb-animation`, `frame-rotation`, `kiosk-and-pin`, `device-helper-integration`, `pi-stability`, `recommended-protection-preset`, `connection-card-and-libraries`, `settings-time-and-advanced`, `actionable-errors`, `touch-and-labels`, `metadata-overlay`, `position-drag-nudge`, `now-playing-extras`, `fill-blur-and-info`, `multi-poster-layout`, `frame-per-source`, `coming-attractions-register`, `remote-config-ui` |
| `publish` | `release-bump` |
| `docs` | `validation-checklists`, `docs-hardening`, `docs-features` |
| `architecture` | `multi-poster-layout`, `remote-config-server`, `remote-config-ui` |
| `planning` | none in this plan (the planning phase already ran) |
| `ideation` | none; open design questions are settled by the Q-rulings in the spec |
| `data` | none (`data` routes to the database agent; there is no database) |
| `bar-quality` | none; no external quality reference was named |
| `hitl` mode | `rotate-plex-token`, `real-server-validation`, `coming-attractions-artwork`, `real-server-validation-extended`, `purge-git-history` |

### Milestones

| Milestone | Priority | Phases | Gate |
|---|---|---|---|
| M1 | P0 fix-first | 11 | `p0-gate` |
| M2 | P1 protection | 13 | `p1-gate` |
| M3 | P2 polish | 7 | `p2-gate` |
| M4 | P3 bigger features | 13 | `p3-gate` |

The gates (`p0-gate`..`p3-gate`) are verification-only phases that run `/phase-gate`. Milestone order is the default scheduling order; a later milestone's phase may start earlier only when its `Blocked by` is satisfied and its Output is disjoint from every running phase.

**Open rulings the conductor must settle before the named phase is dispatched** (full text in `docs/spec.md` and `.orchestrator/questions.md`): Q1 `ui-rotation-shell`, `kiosk-and-pin`; Q2/Q3 `remote-config-server`, `remote-config-ui`; Q4 `coming-attractions-*`; Q5 `e2e-harness`; Q6 `release-bump` (decided here: single bump); Q7 `content-rating-filter`; Q8 `purge-git-history`; Q9 `sleep-mode`; Q10 `settings-and-schedule-core`; Q11 `kiosk-and-pin`; Q12 `multi-poster-layout`; Q13 `real-server-validation*`.

---

## Milestone 1 — P0 fix-first

Fix verified bugs and risks, add the browser-test harness everything else relies on, and run the first real-server validation. Exit: `p0-gate`.

### 1. `e2e-harness` — Browser test harness against the mock server

- **Goal:** Add a committed Playwright harness (`npm run test:e2e`) that drives `scripts/serve.mjs --mock`, plus a precache consistency script.
- **Findings:** — (enabler for F1, F2, F3, F5 and every later browser criterion) · **Requirements:** R-REL-1
- **Mode:** afk · **Tags:** — · **Blocked by:** none
- **Output:** `package.json`, `package-lock.json` (only if `npm install` runs), `tests/e2e/run.mjs`, `tests/e2e/lib.mjs`, `tests/e2e/smoke.spec.mjs`, `scripts/check-precache.mjs`, `.github/workflows/ci.yml`
- **Acceptance criteria:**
  1. `npm test`
  2. `for f in tests/e2e/*.mjs scripts/check-precache.mjs; do node --check "$f" || exit 1; done`
  3. `node scripts/check-precache.mjs`  (every `SHELL` entry exists and every `js/*.js` is precached — the check currently inline in `.github/workflows/ci.yml`)
  4. `npm run test:e2e -- smoke`  (spec `smoke.spec.mjs`: seeds settings `{plexToken:'demo-token', serverUrl:'http://127.0.0.1:<mock port>', libraryKey:'1'}`, loads `/`, waits for a poster layer with `naturalWidth > 0`, asserts no console errors)
  5. `node -e "const p=require('./package.json'); if (p.dependencies || !p.devDependencies || !p.devDependencies.playwright || !p.scripts['test:e2e']) process.exit(1)"`  (runtime stays dependency-free)
  6. `grep -q 'check-precache' .github/workflows/ci.yml && grep -q 'test:e2e' .github/workflows/ci.yml`
  7. `git diff --quiet HEAD -- js css index.html sw.js scripts/serve.mjs scripts/mock-plex.mjs`  (no app or server code changed)
  8. narrated: the CI job installs Chromium (`npx playwright install --with-deps chromium`) and runs `npm ci` before `npm run test:e2e`; reviewer reads the YAML.
- **Notes/hazards:**
  - Q5 ruling needed: recommended devDependency `playwright@1.56.1` with a fallback in `tests/e2e/lib.mjs` that resolves the global install (`createRequire(`${execSync('npm root -g')}/`)('playwright')`, found at `/opt/node22/lib/node_modules/playwright` here). A bare `import 'playwright'` does not find the global copy from ESM.
  - `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set; Chromium build `chromium-1194`. Launch with `--no-sandbox` when running as root.
  - `run.mjs [spec-name ...]` runs `tests/e2e/<name>.spec.mjs` exactly (no substring matching, so `rotation` does not also run `ui-rotation`), starts one `serve.mjs --mock` child on `E2E_PORT` (default 18080) / `E2E_MOCK_PORT` (default 18401), kills it on exit, exits non-zero on any failure, prints one PASS/FAIL line per spec.
  - `lib.mjs` contract used by all later specs: `withApp({ settings, viewport, hasTouch, isMobile, clock, serviceWorkers, serveArgs }, async ({ page, context, app, mock }) => {})`. Defaults: service workers blocked (opt in for offline/SW specs), settings seeded through `addInitScript` into `localStorage['plexPoster.settings']`, `navigator.wakeLock` replaced by a counting stub (`window.__wakeLock = {held, requests, releases}`), mock helpers `mock.play(ratingKey, opts)`, `mock.stop()`, `mock.down()`, `mock.up()`, `mock.stats()`, `E2E_SHOTS=<dir>` makes `shot(page, name)` write PNGs.
  - Fake time: use Playwright `page.clock.install({ time })` / `runFor` (available in 1.45+).
  - Hazard: the app registers a service worker and calls `requestFullscreen`/`wakeLock`; none work meaningfully in headless Chromium, hence the stub and the default `serviceWorkers: 'block'`.

### 2. `settings-and-schedule-core` — Settings schema additions and schedule helpers

- **Goal:** Add every new settings key (with sanitisers and defaults) and the pure local-time helpers later phases share, so later phases never edit the schema.
- **Findings:** — (supports E1, E4, E5, E10, E12, E14, F3, F5, U7, U8, U9, U10, U11) · **Requirements:** R-CACHE-2 and every key in *Settings model changes*
- **Mode:** afk · **Tags:** — · **Blocked by:** `e2e-harness`
- **Output:** `js/settings.js`, `js/schedule.js`, `tests/settings.test.js`, `tests/schedule.test.js`, `sw.js`
- **Acceptance criteria:**
  1. `node --test tests/settings.test.js tests/schedule.test.js`
  2. `npm test`
  3. `node scripts/check-precache.mjs`  (`js/schedule.js` added to `SHELL` in `sw.js`; `VERSION` is NOT bumped here)
  4. `node -e "import('./js/settings.js').then(m=>{const d=m.defaults();const need=['rotateUi','statusIndicator','posterCacheLimit','maxContentRating','sleepEnabled','sleepStart','sleepEnd','idleSleepHours','wakeOnPlayback','pixelShift','pixelShiftMinutes','bulbAnimation','frameBrightness','nightDim','nightDimStart','nightDimEnd','nightDimLevel','frameRotation','frameRotationIds','frameIdRandom','dailyReload','dailyReloadTime','kioskMode','disableShortcuts','settingsPinHash','settingsPinSalt','deviceHelper','controlLabels','showMeta','showProgress','showPlayer','fillMode','fillCount'];const miss=need.filter(k=>!(k in d));if(miss.length){console.error(miss);process.exit(1)}})"`
  5. `node -e "import('./js/settings.js').then(m=>{const d=m.defaults();const ok=d.pixelShift===true&&d.bulbAnimation===true&&d.dailyReload===true&&d.posterCacheLimit===100&&d.statusIndicator==='dot'&&d.rotateUi===true&&d.sleepEnabled===false&&d.idleSleepHours===0&&d.nightDim===false&&d.maxContentRating===''&&d.frameRotation==='off'&&d.kioskMode===false&&d.deviceHelper===false&&d.fillMode==='none';if(!ok)process.exit(1)})"`  (default table)
  6. `node -e "import('./js/settings.js').then(m=>{const o=m.toExport({...m.defaults(),plexToken:'t',settingsPinHash:'a'.repeat(64),settingsPinSalt:'b'},{includeSecrets:true});if('settingsPinHash' in o.settings||'settingsPinSalt' in o.settings||o.settings.plexToken!=='t')process.exit(1)})"`  (PIN material never exported, token only when ticked)
  7. `node -e "import('./js/settings.js').then(m=>{const s=m.fromImport(JSON.stringify({format:'plex-poster-display/settings',version:1,settings:{rotateSeconds:60}}));if(s.rotateSeconds!==60||s.pixelShift!==true)process.exit(1)})"`  (a 2.0.0 export still imports; `EXPORT_VERSION` stays 1)
  8. `node -e "import('./js/schedule.js').then(m=>{for(const f of ['parseHHMM','inWindow','msUntilNext','dayIndex','weekIndex'])if(typeof m[f]!=='function')process.exit(1); if(!m.inWindow(new Date(2026,0,5,2,0),'01:00','07:00')||!m.inWindow(new Date(2026,0,5,23,30),'22:00','07:00')||m.inWindow(new Date(2026,0,5,12,0),'22:00','07:00'))process.exit(1)})"`
- **Notes/hazards:**
  - Sanitiser `hhmm` returns the default for anything that is not `HH:MM` with valid ranges. `inWindow(date, start, end)` uses local wall-clock time, supports windows that cross midnight, and treats `start === end` as an empty window (never asleep), not 24 h.
  - `msUntilNext(date, 'HH:MM')` and `dayIndex`/`weekIndex` (local-date based, weeks start Monday) are what R-PROT-3, R-FRM-2 and R-FRM-4 consume. Keep them pure: callers pass `now`.
  - Add `NEVER_EXPORT_KEYS = ['settingsPinHash', 'settingsPinSalt']` and make `toExport` always drop them. `fromImport` must not accept them from a file either (a file could plant a PIN hash); verify with a unit test.
  - No UI, no behaviour: the keys are unused until later phases. Do not add controls here.

### 3. `rotate-plex-token` — Owner rotates the exposed Plex token

- **Goal:** The token committed in `5c4a716:config.js` is revoked and a receipt is recorded.
- **Findings:** S1 · **Requirements:** R-SEC-2
- **Mode:** hitl · **Tags:** risk:high · **Blocked by:** none
- **Output:** `docs/security/token-rotation.md`
- **Acceptance criteria:**
  1. `grep -qx 'Rotated: yes' docs/security/token-rotation.md`
  2. `grep -Eq '^Date: 20[0-9]{2}-[0-9]{2}-[0-9]{2}$' docs/security/token-rotation.md`
  3. `! grep -Eq 'X-Plex-Token=[A-Za-z0-9_-]{15,}|[A-Za-z0-9_-]{20,}' docs/security/token-rotation.md`  (the receipt contains no token-like string)
  4. narrated: the owner runs `test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "https://plex.tv/api/v2/user?X-Plex-Token=${OLD_PLEX_TOKEN:?set OLD_PLEX_TOKEN in your shell}")" = 401` with the old token exported in their own shell only, and pastes `exit status: 0` into the receipt. The conductor cannot run this (it must never see the token).
- **Notes/hazards:**
  - Hand-off checklist for the owner (the conductor presents this; no agent runs it): (1) find which token leaked: `git show 5c4a716:config.js` in a private terminal, do not paste it anywhere; (2) in Plex (plex.tv > Account > Authorized Devices) sign out all devices so the account token changes **(verify that this rotates `X-Plex-Token`)**; if the exposed value was a server-specific or Home-user token, remove/re-add that device or user; (3) sign every display back in (`Sign in with Plex`); (4) export the old token as `OLD_PLEX_TOKEN` in a shell and run the 401 check; (5) create `docs/security/token-rotation.md` from the template below and commit nothing containing a token.
  - Receipt template: `# Token rotation receipt` / `Rotated: yes` / `Date: YYYY-MM-DD` / `Method: sign out of all devices | other` / `Old token rejected (HTTP 401): yes` / `History purge chosen: no | yes (see purge-git-history)`.
  - Hazard: every already-signed-in display stops working until it signs in again, including `config.json` provisioned devices.

### 4. `serve-config-guard` — Dev server refuses non-loopback requests for config.json

- **Goal:** `scripts/serve.mjs --host 0.0.0.0` no longer hands `config.json` (the Plex token) to LAN clients.
- **Findings:** F4 · **Requirements:** R-SEC-1
- **Mode:** afk · **Tags:** risk:high · **Blocked by:** none
- **Output:** `scripts/serve.mjs`, `scripts/net.mjs`, `tests/serve.test.js`
- **Acceptance criteria:**
  1. `node --test tests/serve.test.js`  (unit: `isLoopback` for `127.0.0.1`, `127.1.2.3`, `::1`, `::ffff:127.0.0.1`, `::ffff:192.168.1.5`, `192.168.1.5`, empty, undefined; integration: spawns `serve.mjs --host 0.0.0.0 --root <tmp dir containing config.json and index.html>`, then loopback `GET /config.json` is 200, `GET` of the machine's non-loopback IPv4 address is 403, `GET /index.html` from that address is 200, and `//config.json`, `/./config.json`, `/%63onfig.json`, `/config.json/`, `/CONFIG.JSON` from that address are not 200)
  2. `npm test`
  3. `grep -q 'isLoopback' scripts/serve.mjs && grep -q 'export function isLoopback' scripts/net.mjs`
  4. `git diff --quiet HEAD -- js css index.html sw.js scripts/mock-plex.mjs`
  5. narrated: run `node --test tests/serve.test.js 2>&1 | grep -E '^# (pass|fail|skipped)'` on a host with a non-loopback IPv4 and confirm the LAN-address tests were not skipped (they skip only when `os.networkInterfaces()` has none).
- **Notes/hazards:**
  - `isLoopback` lives in a new `scripts/net.mjs` so it can be imported without starting a server (`serve.mjs` listens at import time). `device-helper-server` and `remote-config-server` reuse it.
  - Add an optional `--root <dir>` flag (default: repo root) so tests can serve a temp directory containing a fake `config.json`; never write a `config.json` into the repo root from a test.
  - Normalise first, check second: decode, resolve `.`/`..`, strip trailing slash, lower-case compare against `/config.json`, then decide. A Host header outside `localhost`/`127.0.0.1`/`[::1]` on a loopback peer is also refused for `config.json` (DNS rebinding).
  - Hazard: a reverse proxy on the same machine makes every client look like loopback. State this in the file header comment (README gets it in `docs-hardening`).
  - Hazard: `--mock` binds the mock Plex server to the same `HOST`; it serves no secrets, leave as is.

### 5. `layout-rotation-fix` — Rotated stage stays centred and on screen

- **Goal:** At rotation 90/270 on a landscape viewport the stage is centred and fully visible (no 300 px drop, no clipping).
- **Findings:** F1 · **Requirements:** R-ROT-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `e2e-harness`
- **Output:** `css/app.css`, `tests/e2e/rotation.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- rotation`  (viewports 1920x1080, 1080x1920, 1280x800 x rotations 0/90/180/270: `#stage` and `#frame` bounding boxes inside the viewport (1 px tolerance), centre within 1 px of viewport centre, limiting dimension within 2 px of the viewport, `.app` `scrollHeight == clientHeight`)
  2. `npm test`
  3. `git diff --quiet HEAD -- js index.html sw.js scripts`  (CSS-only fix)
  4. narrated: the reviewer shows the same spec failing against the CSS at `3a7b688` (e.g. in a throwaway `git worktree` of that commit with `tests/e2e/` copied in) at 1920x1080 / rotation 90, proving the test detects the bug.
- **Notes/hazards:**
  - Root cause: `.app { display:grid; place-items:center }` sizes the grid row to the sideways stage's layout box (e.g. 1080x1687 inside 1920x1080) so the row grows and the rotated result lands low. Fix: `.stage { position:absolute; left:50%; top:50%; transform: translate(-50%,-50%) rotate(var(--rotation,0deg)) }` and drop reliance on grid centring.
  - Keep `transition: transform .5s` so rotation still animates; check the reduced-motion rule still removes it.
  - `pixel-shift` later uses the individual `translate` property, which composes before `transform`; do not use `translate` here.
  - `display.layout()` only sets width/height/`--rotation` on the stage; do not touch it (F2 needs it later).

### 6. `cache-first-fetch` — Cache-first poster fetch

- **Goal:** `fetchImage()` serves posters from `poster-cache.js` when it already holds them and only downloads/writes on a miss.
- **Findings:** F3, E8 · **Requirements:** R-CACHE-1, R-CACHE-2
- **Mode:** afk · **Tags:** — · **Blocked by:** `e2e-harness`, `settings-and-schedule-core`
- **Output:** `js/main.js`, `js/poster-cache.js`, `scripts/mock-plex.mjs`, `tests/poster-cache.test.js`, `tests/e2e/cache-first.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/poster-cache.test.js`  (fake `caches` and `storage`: hit, miss, thumb changed -> miss, stored size smaller than requested -> miss, stored size larger -> hit, `get` throwing -> miss, limit as a function re-read on each `put`, eviction deletes the evicted entries)
  2. `npm test`
  3. `npm run test:e2e -- cache-first`  (mock `GET /__mock/stats` returns `{transcode:n}`; show the 8 mock posters 3 times each using the refresh control: `transcode <= 8` and a `Cache.prototype.put` counter installed by `addInitScript` `<= 8`; after a page reload and `POST /__mock/reset-stats`, showing the same 8 again produces `transcode == 0`)
  4. `git diff --quiet HEAD -- index.html css sw.js`
- **Notes/hazards:**
  - Validity rule: cached `thumb === poster.thumb` AND cached width >= requested width (`requestSize()` rounds up to 100 px steps). `put()` records `width`/`height` in the index entry. A hit does not call `cache.put`, so no SD write; do not re-order the index on hit (that would write `localStorage` every rotation).
  - Lazy limit: `createPosterCache({ limit })` accepts a number or a function; `main.js` passes `() => state.settings.posterCacheLimit`. Default 100 with the default pool of 100 means steady state is all hits. `cache.random()` (offline fallback) is unchanged.
  - Mock additions: `GET /__mock/stats` -> `{transcode, other}` counting `/photo/:/transcode` hits; `POST /__mock/reset-stats`. Later phases extend the same mock file (serialise).
  - `directImages` (CORS-blocked) mode is untouched and still bypasses the cache; Diagnostics already reports it. V1 checks real CORS behaviour.
  - Hazard: `fetchImage` is called before `display.show`; keep the `AbortSignal.timeout(20000)` on the network path.

### 7. `status-indicator` — Quiet status indicator

- **Goal:** Replace the always-on top-left status pill with a controls-bound pill and a tiny drifting dot, and stop the once-a-second re-render when hidden.
- **Findings:** F5 · **Requirements:** R-STAT-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `e2e-harness`, `settings-and-schedule-core`
- **Output:** `index.html`, `css/app.css`, `js/main.js`, `tests/e2e/status.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- status`  (mock down after first poster, controls idle-hidden after 4 s: `#status` hidden, `#status-dot` visible and `<= 8x8` px, opacity `<= 0.4`; wake controls: `#status` shows retry countdown; healthy + idle: neither visible; a `MutationObserver` on `#status` records 0 mutations over 3 s while controls are hidden; fake clock +5 min moves the dot to a different corner, always inside the viewport; `statusIndicator:'off'` hides the dot)
  2. `npm test`
  3. `grep -q 'id="status-dot"' index.html`
  4. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Tie visibility to the existing `.controls.visible` / `body.idle` state set by `wake()`; do not add a second idle timer.
  - The dot has its own slow position cycle (corners of the safe area), independent of pixel shift. `ui-rotation-shell` makes it rotate with the UI.
  - Burn-in hazard: even the dot must never sit still for hours; the cycle is the requirement, not an optimisation.

### 8. `ui-rotation-shell` — UI shell rotates with the stage

- **Goal:** Controls, toast, status, empty card, settings and diagnostics read upright on a physically rotated screen (setting `rotateUi`, default on).
- **Findings:** F2 · **Requirements:** R-ROT-2
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `layout-rotation-fix`, `status-indicator`, `settings-and-schedule-core`
- **Output:** `css/app.css`, `index.html`, `js/display.js`, `tests/e2e/ui-rotation.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- ui-rotation`  (for rotation 90/180/270 and viewports 1920x1080 and 1080x1920: open settings (`s`) and diagnostics (`d`), trigger a toast and the empty state; each of `#controls`, `#toast`, `.empty-card`, `#settings`, `#diagnostics`, `#status-dot` has a computed transform angle equal to the rotation and a bounding box inside the viewport; the controls bar sits at the viewer's bottom-right; with `rotateUi:false` none is rotated; rotation 0 bounding boxes equal those recorded with `rotateUi:false`)
  2. `npm test`
  3. `git diff --quiet HEAD -- js/settings.js js/engine.js js/plex.js js/main.js sw.js`
  4. narrated: the reviewer runs `E2E_SHOTS=$(mktemp -d) npm run test:e2e -- ui-rotation` and looks at the rotation-90 settings and controls screenshots: text reads upright when the screenshot is turned 90 degrees, nothing clipped (Step 7 `/ux-simulate`).
- **Notes/hazards:**
  - Q1 ruling needed (recommended: rotate the shell). If ruled B, this phase shrinks to documenting OS rotation and the `rotateUi` default flips to false.
  - Top-layer `<dialog>` (`showModal`) ignores ancestor transforms and `::backdrop` cannot be transformed. Give each dialog its own rule: swap `width`/`height` using `--vw`/`--vh` custom properties set by `display.layout()` and rotate with `transform-origin` chosen per angle so the sheet docks to the viewer's right edge. The backdrop may stay full-screen.
  - Controls and safe-area insets are anchored to the viewer's bottom-right at every angle (`kiosk-and-pin` maps its corner zone through the same variable `--ui-rotation`).
  - `rotateUi:false` is the supported path for Pi users who rotate the OS (`wlr-randr`/`xrandr`) and keep app rotation at 0.

### 9. `validation-checklists` — Real-server validation checklists

- **Goal:** Create the two result templates a human fills in against a real Plex server, listing every (verify) item.
- **Findings:** V1 · **Requirements:** R-VAL-1, R-VAL-2
- **Mode:** afk · **Tags:** docs · **Blocked by:** none
- **Output:** `docs/validation/real-server-core.md`, `docs/validation/real-server-extended.md`
- **Acceptance criteria:**
  1. `test "$(grep -c 'PENDING' docs/validation/real-server-core.md)" -ge 10 && test "$(grep -c 'PENDING' docs/validation/real-server-extended.md)" -ge 12`
  2. `grep -qx 'Overall: PENDING' docs/validation/real-server-core.md && grep -qx 'Overall: PENDING' docs/validation/real-server-extended.md`
  3. `for k in 'plex.tv/link' firstReachable CORS '/photo/:/transcode' '/status/sessions' 'plex.direct' 'Image mode'; do grep -qF -- "$k" docs/validation/real-server-core.md || { echo "core missing: $k"; exit 1; }; done`
  4. `for k in contentRating totalSize viewOffset Player.title overscroll-history-navigation disable-pinch cec-client 'vcgencmd display_power' wlr-randr ddcutil 'thermal_zone0' 'disk-cache-dir' 'Sign out' ; do grep -qF -- "$k" docs/validation/real-server-extended.md || { echo "extended missing: $k"; exit 1; }; done`
  5. `! grep -Eq 'X-Plex-Token=[A-Za-z0-9_-]{15,}' docs/validation/real-server-core.md docs/validation/real-server-extended.md`
  6. narrated: `/doc-review` of both files: each item has an ID, exact steps, expected result, `Result: PENDING`, `Notes:`.
- **Notes/hazards:**
  - Item format: `- [ ] V1-C03 — <step> — expected: <result> — Result: PENDING — Notes:` ; end of file `Overall: PENDING`. The human replaces each PENDING with PASS/FAIL and the last line with `Overall: PASS` or `Overall: FAIL (<phase to reopen>)`.
  - Core: PIN sign-in at plex.tv/link, multi-server discovery and the connection `firstReachable` picks (LAN http vs `*.plex.direct` https), token/URL test, library list, `/status/sessions` while playing and paused, blob download of `/photo/:/transcode` without CORS error (Diagnostics shows `Image mode: downloaded + cached`, not `direct`), 24 h soak note.
  - Extended: every (verify) in the spec's list, plus optional Pi-hardware rows marked `skip if no Pi`.
  - Secrets rule printed at the top of both files: never paste a token or a full `X-Plex-Token` URL.

### 10. `real-server-validation` — Validate core flows against a real Plex server

- **Goal:** A human proves sign-in, discovery, CORS blob download and session reads work on a real server, or names the phase to reopen.
- **Findings:** V1 · **Requirements:** R-VAL-1
- **Mode:** hitl · **Tags:** — · **Blocked by:** `validation-checklists`, `cache-first-fetch`, `serve-config-guard`
- **Output:** `docs/validation/real-server-core.md`
- **Acceptance criteria:**
  1. `! grep -q 'PENDING' docs/validation/real-server-core.md`
  2. `grep -Eq '^Overall: (PASS|FAIL \(.+\))$' docs/validation/real-server-core.md`
  3. `! grep -Eq 'X-Plex-Token=[A-Za-z0-9_-]{15,}' docs/validation/real-server-core.md`
  4. narrated: if `Overall: FAIL (...)`, the conductor opens the named fix phase through its reconcile step; this phase is not done until a later run records PASS.
- **Notes/hazards:**
  - Hand-off: run `npm start` on the display device (or any machine on the LAN), open `http://localhost:8080`, walk the checklist, copy the Diagnostics panel's text into the notes for any FAIL.
  - This is the earliest point CORS on the real transcoder is observable; the 'poster cache never fills' failure mode (`directImages`) would invalidate R-CACHE-1's benefit on that server.

### 11. `p0-gate` — Milestone 1 gate

- **Goal:** Everything in P0 holds together on a clean tree.
- **Findings:** F1, F2, F3, F4, F5, S1, V1 · **Requirements:** R-ROT-1, R-ROT-2, R-CACHE-1, R-CACHE-2, R-SEC-1, R-SEC-2, R-STAT-1, R-VAL-1
- **Mode:** afk · **Tags:** — · **Blocked by:** `layout-rotation-fix`, `ui-rotation-shell`, `cache-first-fetch`, `serve-config-guard`, `status-indicator`, `rotate-plex-token`, `real-server-validation`
- **Output:** none (verification-only phase)
- **Acceptance criteria:**
  1. `npm test`
  2. `npm run test:e2e`
  3. `node scripts/check-precache.mjs`
  4. `grep -qx 'Rotated: yes' docs/security/token-rotation.md && grep -Eq '^Overall: PASS$' docs/validation/real-server-core.md`
  5. `test -z "$(git status --porcelain -- . ':!.orchestrator')"`  (tree clean apart from the audit trail)
  6. narrated: `/phase-gate` over the milestone (story status, test health, doc currency).
- **Notes/hazards:**
  - Verification-only phase: no Output. A gate fails the milestone, not a phase; the conductor reopens whichever phase's criterion broke.

---

## Milestone 2 — P1 equipment protection

Protect the screen, the Pi and the SD card, and keep children out of the settings. Each feature phase adds its own controls to a new **Display protection** fieldset in `index.html`. Exit: `p1-gate`.

### 12. `pixel-shift` — Pixel shift / orbit

- **Goal:** Move the stage a few pixels every few minutes inside a 1.5% margin so no pixel stays lit for hours.
- **Findings:** E2 · **Requirements:** R-PROT-2
- **Mode:** afk · **Tags:** ui · **Blocked by:** `ui-rotation-shell`, `settings-and-schedule-core`
- **Output:** `js/layout.js`, `js/display.js`, `css/app.css`, `index.html`, `tests/layout.test.js`, `tests/e2e/pixel-shift.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/layout.test.js`  (existing cases unchanged; new: `stageSize` with `margin: 0.015` is 97% of the margin-less size on the limiting axis; `shiftOffset(step, marginPx)` is bounded by `marginPx`, never returns the same point twice in a row, visits 9 distinct points in 9 steps, is deterministic)
  2. `npm test`
  3. `npm run test:e2e -- pixel-shift`  (fake clock, `pixelShiftMinutes: 3`, 20 steps at rotations 0 and 90 on 1920x1080 and 1080x1920: >= 9 distinct `translate` values, stage and frame bounding boxes inside the viewport at every step; `pixelShift:false` -> no `translate` and stage size equal to `stageSize()` without margin)
  4. `node -e "import('./js/layout.js').then(m=>{const a=m.stageSize({viewportW:1920,viewportH:1080,aspect:0.64});const b=m.stageSize({viewportW:1920,viewportH:1080,aspect:0.64,margin:0.015});if(!(b.height<a.height&&b.height>a.height*0.95))process.exit(1)})"`
  5. `grep -q 'pixelShift' js/display.js && grep -q 'name="pixelShift"' index.html`
- **Notes/hazards:**
  - Use the individual CSS `translate` property on `.stage`: it composes before `rotate`, so the offset is in screen space at every rotation. Support needs Chromium >= 104 **(verify the Pi's Chromium)**; if absent, fall back to wrapping the stage in a `#shifter` element.
  - Steps are instant or an ease <= 2 s; never a continuous drift (that costs a composited animation for nothing).
  - Margin applies only while `pixelShift` is on, so a user who turns it off gets today's full-bleed layout.
  - Creates the **Display protection** fieldset (checkbox + minutes input, bound by `name` so `settings-ui.js` needs no change).

### 13. `frame-brightness` — Frame brightness and night dim

- **Goal:** Dim the frame layer manually and automatically at night, without touching the poster.
- **Findings:** E4 · **Requirements:** R-FRM-4
- **Mode:** afk · **Tags:** ui · **Blocked by:** `settings-and-schedule-core`
- **Output:** `js/brightness.js`, `tests/brightness.test.js`, `js/display.js`, `js/main.js`, `css/app.css`, `index.html`, `sw.js`, `tests/e2e/brightness.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/brightness.test.js`  (pure `effectiveBrightness(now, settings)`: manual level, night window incl. midnight crossing, 60 s ease at both boundaries, `min` of manual and night level, `nightDim:false`)
  2. `npm test`
  3. `npm run test:e2e -- brightness`  (fake clock 12:00 with `nightDim` on: `#frame` computed `filter` is `none` or `brightness(1)`; 23:00 (after 60 s): `brightness(0.6)` +-0.02; `frameBrightness:50` -> `brightness(0.5)`; the poster `<img>` layers and `#poster-box` have `filter: none`)
  4. `node scripts/check-precache.mjs`
  5. `! grep -n 'will-change: *filter' css/app.css`
- **Notes/hazards:**
  - Filter on the frame `<img>` only (static layer, rasterised once). Do not animate `filter` (Pi GPU); ease the value in steps from a once-a-minute timer, or with a single 60 s CSS transition on the filter value.
  - Re-evaluate on `visibilitychange` and after a clock jump; use `schedule.inWindow` from the core phase.
  - Real hardware brightness is separate (`device-helper-integration`).

### 14. `sleep-mode` — Sleep schedule and idle sleep

- **Goal:** Show pure black during sleep hours or after N idle hours, release the wake lock, and wake on playback.
- **Findings:** E1 · **Requirements:** R-PROT-1
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `settings-and-schedule-core`
- **Output:** `js/sleep.js`, `tests/sleep.test.js`, `js/engine.js`, `tests/engine.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/sleep.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/sleep.test.js tests/engine.test.js`  (`decideSleep`: window crossing midnight, idle expiry at N hours, playback wakes during a window when `wakeOnPlayback`, stays asleep when not, manual wake for 60 s then back to sleep, `sleepEnabled:false` and `idleSleepHours:0` never sleep; engine `playing()` returns the session without fetching art)
  2. `npm test`
  3. `npm run test:e2e -- sleep`  (fake clock inside 01:00-07:00: `#sleep-veil` visible and opaque black, controls hidden, `window.__wakeLock.held === false` and a release recorded, no `/photo/:/transcode` requests while asleep; `mock.play()` -> veil hidden within one `nowPlayingPollSeconds`, wake lock held again, poster shown; idle sleep: `idleSleepHours:1`, no playback for 61 simulated minutes -> asleep; a key press wakes for 60 s then sleeps again; `wakeOnPlayback:false` keeps the veil during the window)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'id="sleep-veil"' index.html && grep -q 'name="sleepEnabled"' index.html`
  6. narrated: independent reviewer (risk:high) tries to produce a state where the veil stays up after playback starts or the wake lock is never re-acquired (offline start, clock change, settings saved while asleep).
- **Notes/hazards:**
  - Q9 ruling (recommended: playback wakes the display during the scheduled window).
  - While asleep `tick()` must still poll `/status/sessions` (to wake on playback and to refresh `lastPlaybackAt`) but must not fetch images or call `display.show`. Add `engine.playing()` for that; it honours `username` and `includeEpisodes` and works even when `showNowPlaying` is off.
  - `updateWakeLock()` must treat `state.asleep` as 'do not want'; on wake re-request immediately (document must be visible). On a Pi the wake lock does not blank the screen by itself, so power-off needs the helper (`device-helper-integration`) or a smart plug (docs).
  - Body class `asleep` is the contract other features key off (`bulb-animation`, `status-indicator`, kiosk reveal).
  - Manual wake: any `pointerdown`/`keydown` while asleep lifts the veil for 60 s; it must not trigger the control under the finger (reuse the first-tap rule from `touch-and-labels` when it lands).
  - Local time only: browser timezone. A device with a wrong clock sleeps at the wrong hours; Diagnostics shows the local time.

### 15. `bulb-animation` — Animated marquee bulbs

- **Goal:** Slowly twinkle the frame's bulbs with an opacity-only layer located at runtime from the frame image.
- **Findings:** E3 · **Requirements:** R-FRM-3
- **Mode:** afk · **Tags:** ui · **Blocked by:** `settings-and-schedule-core`, `sleep-mode`
- **Output:** `js/frames.js`, `js/display.js`, `css/app.css`, `index.html`, `tests/frames.test.js`, `tests/e2e/bulbs.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/frames.test.js`  (existing `detectWindow` behaviour unchanged; `detectBulbs` on synthetic RGBA with 10 bright warm squares returns 10 centroids within 1% of truth; ignores a bright blob inside the poster window; returns `[]` for an opaque-centre frame; cap at 80)
  2. `npm test`
  3. `npm run test:e2e -- bulbs`  (marquee: `#bulbs > *` count between 40 and 80, every centre inside the frame and outside the poster window; each child has a non-`none` `animationName`; the `@keyframes` rules used contain `opacity` and none of `transform`, `filter`, `box-shadow`, `left`, `top`; `bulbAnimation:false` -> 0 children; `frameId:'none'` -> 0; emulated `prefers-reduced-motion: reduce` -> animation `none`; `body.asleep` -> `#bulbs` not displayed)
  4. `grep -q 'detectBulbs' js/frames.js && grep -q 'id="bulbs"' index.html`
  5. `node scripts/check-precache.mjs`
  6. narrated: on the Pi (V1 extended, optional row) idle Chromium CPU with bulbs on is within a few percent of bulbs off.
- **Notes/hazards:**
  - Detection: reuse the downscaled-canvas approach of `detectFromImage` (600 px long side). Threshold: alpha high, luminance > ~235, red >= green >= blue (warm white/yellow); connected components; drop components outside the frame ring (inside `win`) and tiny/huge ones; return centres as % of the frame. Expect about 58 bulbs on `marquee.png` (12 top, 12 bottom, 17 per side, plus two corner flares to ignore). Tune on the three bundled frames.
  - Layer: `#bulbs` is inside `.stage` above `.frame`, `contain: strict`, children `position:absolute` at percentages, size from the median blob diameter, `radial-gradient` glow, `animation: bulb-twinkle 6-10s ease-in-out infinite` with per-bulb `animation-delay`, **opacity only**. No `mix-blend-mode`, no `filter`, no `box-shadow` (all repaint or cost GPU).
  - Cross-origin custom frames taint the canvas: detection returns `[]` and the layer is empty (log once).
  - Re-run detection only when the frame image changes (`frame-rotation`, `frame-per-source` call the same hook).

### 16. `frame-rotation` — Switch the frame daily or weekly

- **Goal:** Rotate through chosen frames by local date so the same pixels are not lit all week.
- **Findings:** E5 · **Requirements:** R-FRM-2
- **Mode:** afk · **Tags:** ui · **Blocked by:** `settings-and-schedule-core`, `bulb-animation`
- **Output:** `js/frame-rotation.js`, `tests/frame-rotation.test.js`, `js/main.js`, `js/display.js`, `css/app.css`, `index.html`, `sw.js`, `tests/e2e/frame-rotation.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/frame-rotation.test.js`  (`frameForDate(ids, mode, date)`: stable within a day, advances at local midnight, weekly changes only on Monday, empty ids -> all built-ins, one id -> that id, unknown ids skipped, `off` -> null)
  2. `npm test`
  3. `npm run test:e2e -- frame-rotation`  (fake clock: day 1 -> frame A src, +1 day -> frame B (daily); weekly stays the same Tue-Sun and changes on Monday; `off` -> `frameId`; reload mid-day keeps the same frame; bulbs re-detected after a switch)
  4. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Depends on `bulb-animation` because a frame switch must re-run bulb detection through the same hook.
  - Schedule the switch with `schedule.msUntilNext(now, '00:00')`; re-arm after each fire and after `visibilitychange` (timers pause in hidden tabs).
  - Switching: brief opacity dip on the frame layer (about 300 ms out, swap `src`, 300 ms in), not a second full-size layer.
  - User-chosen `frameId` is the fallback when rotation is off; `customFrameUrl` is rotated only if listed as `custom`.

### 17. `content-rating-filter` — Maximum content rating for random posters

- **Goal:** Random posters never exceed the chosen rating; unknown ratings are excluded when a limit is set.
- **Findings:** E14 · **Requirements:** R-FILT-1
- **Mode:** afk · **Tags:** — · **Blocked by:** `settings-and-schedule-core`
- **Output:** `js/ratings.js`, `tests/ratings.test.js`, `js/plex.js`, `tests/plex.test.js`, `js/engine.js`, `tests/engine.test.js`, `scripts/mock-plex.mjs`, `index.html`, `sw.js`, `tests/e2e/content-rating.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/ratings.test.js tests/plex.test.js tests/engine.test.js`  (ladder rank for each rung incl. `TV-Y`, `TV-Y7`, `TV-G`, `TV-PG`, `TV-14`, `TV-MA`; `gb/15`, empty and missing excluded when a limit is set and kept when `''`; `pool()` requests `X-Plex-Container-Size` = 3x pool size capped 500 when a limit is set; pool cache key changes with the limit; empty result throws the `empty` error with a 'raise the limit' hint)
  2. `npm test`
  3. `npm run test:e2e -- content-rating`  (mock movies carry G, PG, PG-13, R, TV-MA, `gb/15` and unrated; with `maxContentRating:'PG-13'` 50 refreshes never show an R/TV-MA/`gb/15`/unrated title (read from the active poster layer's `alt`); with `'R'` TV-MA stays hidden; with `''` all appear)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'contentRating' js/plex.js && grep -q 'name="maxContentRating"' index.html`
- **Notes/hazards:**
  - Q7 ruling (recommended: exclude unrated and country-prefixed). The Plex request parameter and multi-value syntax are **(verify)**; the client-side ladder filter is the guarantee and is always applied, so a wrong server parameter cannot leak an R title.
  - Applies to the random pool only. Now-playing and an owner-pinned poster are deliberate (state it in the UI help text).
  - `toPoster` gains `contentRating` here; `metadata-overlay` reads it.
  - Mock: add `contentRating` to `MOVIES`, honour a `contentRating=` query list on `/library/sections/1/all` the way Plex is believed to **(verify)**, still ignore unknown params. Serialise with other mock-editing phases.

### 18. `kiosk-and-pin` — Kiosk mode, settings PIN, token behind the PIN

- **Goal:** Hide the controls entirely, reveal them by a 3 s corner hold, and gate settings and token reveal behind an optional PIN.
- **Findings:** E12, E16 · **Requirements:** R-KIOSK-1, R-KIOSK-2
- **Mode:** afk · **Tags:** ui, risk:high · **Blocked by:** `ui-rotation-shell`, `settings-and-schedule-core`
- **Output:** `js/kiosk.js`, `tests/kiosk.test.js`, `js/main.js`, `js/settings-ui.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/kiosk.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/kiosk.test.js`  (hash/verify round trip with salt; wrong PIN fails; lockout: 5 failures lock 60 s, doubling to 15 min, clears on success; fallback hasher used when `crypto.subtle` is missing; `cornerZone(rotation, viewport)` returns the viewer's bottom-right 96x96 region for 0/90/180/270; hold timer cancels on movement > 12 px or early release)
  2. `npm test`
  3. `npm run test:e2e -- kiosk`  (`kioskMode:true`: pointer move, tap and key press never add `.visible` to `#controls`; a 3 s press in the corner does, for 15 s; with a PIN set, `s` and the Settings button show the PIN dialog; a wrong PIN keeps Settings closed; the correct PIN opens it; `#token-toggle` asks for the PIN; `disableShortcuts:true` ignores `s`, `d`, `r`, `p`, `o`, `f`, space; the PIN dialog has an on-screen keypad usable by touch; rotation 90 maps the corner correctly; export with 'include token' contains no PIN material)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'name="kioskMode"' index.html && grep -q 'id="pin-dialog"' index.html`
  6. narrated: independent reviewer (risk:high) tries to reach settings, Diagnostics, import, reset or the token without the PIN (keyboard, URL, Tab focus into hidden controls, `data-action` click via dispatch, long-press without release).
- **Notes/hazards:**
  - Q11: the PIN is deterrence only; the UI and README say so. Hash with salted SHA-256 via Web Crypto (requires a secure context; `localhost` and https qualify), fall back to a small pure-JS SHA-256 on plain-http LAN origins.
  - Hidden controls must also be unfocusable (`inert` or `display:none`) in kiosk mode, otherwise Tab reaches them.
  - Hold detection uses pointer events (`pointerdown`/`pointerup`/`pointercancel`) so it works for mouse, touch and pen. Place the zone with the same `--ui-rotation` variable the shell uses.
  - `s` key and the Settings button both route through one `requestSettings()` that applies the PIN gate; same for Diagnostics, import and reset.
  - Lockout state is kept in memory plus `localStorage` (`plexPoster.pinLock`) so a reload does not reset it; this is not a security boundary (Q11).

### 19. `device-helper-server` — Loopback device helper for power, brightness and temperature

- **Goal:** Add an opt-in `--helper` mode that lets the page switch display power and brightness and read CPU temperature on a Pi.
- **Findings:** E6 · **Requirements:** R-HELP-1
- **Mode:** afk · **Tags:** risk:high · **Blocked by:** `serve-config-guard`
- **Output:** `scripts/device-helper.mjs`, `scripts/serve.mjs`, `scripts/net.mjs`, `tests/device-helper.test.js`
- **Acceptance criteria:**
  1. `node --test tests/device-helper.test.js`  (with an injected fake `execFile`: `POST /__helper/display {on:false}` runs exactly the chosen strategy's argv (`vcgencmd display_power 0`, `wlr-randr --output <name> --off`, `cec-client` with `standby 0` on stdin); `POST /__helper/brightness {percent:55}` runs `ddcutil setvcp 10 55` or writes the backlight file; percent `-1`, `101`, `'5; rm'`, float, missing -> 400 and no command; non-loopback peer, missing `X-Poster-Helper: 1`, hostile `Host` -> 403 and no command; `GET /__helper/status` lists detected strategies and `tempC` parsed from `thermal_zone0`; `--helper-fake` records calls and returns canned data; integration: `serve.mjs --helper --helper-fake` spawned on a free port answers `status` 200 with the header and 403 without)
  2. `npm test`
  3. `! grep -nE "\bexec\(|execSync|shell: *true" scripts/device-helper.mjs`  (`execFile` with fixed argument arrays only, never a shell)
  4. `! grep -n 'Access-Control-Allow' scripts/device-helper.mjs scripts/serve.mjs`  (no CORS grant)
  5. `git diff --quiet HEAD -- js css index.html sw.js`
- **Notes/hazards:**
  - Without `--helper` the routes do not exist (404), so nothing changes for existing users. Strategy flags: `--helper-power cec|vcgencmd|wlr-randr|none`, `--helper-output <name>`, `--helper-brightness ddc|backlight|none`; default is auto-detect by probing for the binaries / sysfs files, reported by `status`.
  - All command syntax is **(verify)** and cannot be exercised here: `cec-client -s -d 1` with `on 0` / `standby 0`, `vcgencmd display_power 0|1` (legacy/fkms only; KMS needs `wlr-randr` or CEC), `wlr-randr --output HDMI-A-1 --off|--on`, `ddcutil setvcp 10 <n>`, `/sys/class/backlight/*/brightness` (needs write permission). `real-server-validation-extended` has optional rows for each.
  - Every command gets a 5 s timeout and runs one at a time (a lock), so a hung `cec-client` cannot stack processes. CEC clients can hold the adapter open: spawn per request and always kill on timeout.
  - CSRF: the custom header forces a CORS preflight that is never granted; that is why `Access-Control-Allow-*` must not appear.

### 20. `device-helper-integration` — Use the helper from the app and show CPU temperature

- **Goal:** Optional page-side client for the helper: power off in sleep, real brightness, CPU temperature in Diagnostics.
- **Findings:** E6, E9 · **Requirements:** R-HELP-2
- **Mode:** afk · **Tags:** ui · **Blocked by:** `device-helper-server`, `sleep-mode`, `frame-brightness`
- **Output:** `js/helper.js`, `tests/helper.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/helper.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/helper.test.js`  (fake `fetch`: 404 or network error -> `available:false` and no throw; every request carries `X-Poster-Helper: 1`; `power(false)` posts `{on:false}`; failures are logged once, not every tick)
  2. `npm test`
  3. `npm run test:e2e -- helper`  (harness `serveArgs: ['--helper','--helper-fake']`: with `deviceHelper:true` Diagnostics shows `CPU temperature` with the fake value; entering sleep makes the helper's call log show power off then power on at wake; with `deviceHelper:false` or without `--helper` the page makes no `/__helper/` request after the initial probe and logs no console error)
  4. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - E9 here is the CPU-temperature half (the `backdrop-filter` half is in `pi-stability`). Probe once at boot and when Settings opens; never poll in a loop except the Diagnostics temperature, which refreshes only while that dialog is open.
  - `deviceHelper` default false: a page that silently runs commands on the device must be an explicit opt-in even on loopback.
  - Power off must happen after the veil is up, and power on before the poster fetch on wake, with a short delay for the TV to wake (configurable constant, **(verify)** on hardware).

### 21. `pi-stability` — Remove backdrop blur and add daily self-reload

- **Goal:** Cut GPU load on the settings sheet and shed Chromium memory growth with a daily reload.
- **Findings:** E9, E10 · **Requirements:** R-PROT-3, R-PROT-4
- **Mode:** afk · **Tags:** ui · **Blocked by:** `sleep-mode`, `settings-and-schedule-core`
- **Output:** `css/app.css`, `js/main.js`, `index.html`, `tests/e2e/pi-stability.spec.mjs`
- **Acceptance criteria:**
  1. `! grep -n 'backdrop-filter' css/app.css`
  2. `npm run test:e2e -- pi-stability`  (fake clock 03:59:30 with `dailyReload:true`, `dailyReloadTime:'04:00'`: a reload happens at 04:00 (navigation counter kept in `sessionStorage`); no reload while Settings or Diagnostics is open (it retries after close); `dailyReload:false` -> none; on wake from sleep with `plexPoster.lastReload` older than 12 h -> one reload, with it newer -> none; after a reload settings persist and `paused` is cleared)
  3. `npm test`
  4. `grep -q 'name="dailyReload"' index.html`
- **Notes/hazards:**
  - Merged because both are Pi-stability fixes sharing one pre-flight and evidence run.
  - Replace the blur with a slightly more opaque `--panel` (about .98); `::backdrop` darkening stays (cheap).
  - Guard against reload loops: write `plexPoster.lastReload` (a plain key, not a setting) before reloading and refuse a second reload within 10 minutes.
  - Never reload during playback of a now-playing poster mid-fade; wait for `state.busy` to clear.

### 22. `recommended-protection-preset` — One-tap recommended protection

- **Goal:** A single Settings button that applies the recommended protection values after showing what it will change.
- **Findings:** — (applies the E1, E4 and E14 settings in one tap) · **Requirements:** R-PROT-5
- **Mode:** afk · **Tags:** ui · **Blocked by:** `sleep-mode`, `frame-brightness`, `pixel-shift`, `bulb-animation`, `pi-stability`, `content-rating-filter`
- **Output:** `index.html`, `css/app.css`, `js/settings-ui.js`, `tests/e2e/preset.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- preset`  (click **Recommended protection**: a list of the keys it will change appears; Cancel changes nothing; Apply then Save persists `sleepEnabled:true`, `sleepStart:'01:00'`, `sleepEnd:'07:00'`, `idleSleepHours:3`, `nightDim:true`, `nightDimLevel:60`, `pixelShift:true`, `bulbAnimation:true`, `dailyReload:true`, `maxContentRating:'PG-13'`; `plexToken`, `serverUrl`, `libraryKey` unchanged)
  2. `npm test`
  3. `git diff --quiet HEAD -- js/settings.js js/main.js sw.js`
- **Notes/hazards:**
  - The preset constants live in `js/settings-ui.js`; the schema phase deliberately did not hard-code them so the preset can evolve without a schema change.
  - Hazard: a household that does not want the content limit must be able to untick it in the confirm list (each row has a checkbox).

### 23. `docs-hardening` — README: kiosk, Pi, power, battery, network and account hardening

- **Goal:** Document everything a page cannot do: smart plug, SD wear, battery, Chromium flags, VLAN, managed user, helper, config.json.
- **Findings:** E7, E8, E11, E13, E15, E17, F4 · **Requirements:** R-DOC-1, R-DOC-2, R-DOC-3, R-DOC-4, R-DOC-5, R-DOC-6
- **Mode:** afk · **Tags:** docs · **Blocked by:** `cache-first-fetch`, `serve-config-guard`, `kiosk-and-pin`, `device-helper-server`, `sleep-mode`, `pi-stability`, `recommended-protection-preset`
- **Output:** `README.md`
- **Acceptance criteria:**
  1. `for k in 'smart plug' 'Overlay File System' 'disk-cache-dir' 'swelling' 'overscroll-history-navigation' 'disable-pinch' 'managed user' 'Plex Home' '32400' 'VLAN' '--helper' 'config.json' 'reverse proxy' 'Recommended protection'; do grep -qiF -- "$k" README.md || { echo "missing: $k"; exit 1; }; done`
  2. `grep -Eqi 'not (yet )?verified|unverified' README.md`  (unverified flags and commands are labelled as such)
  3. `node -e "const fs=require('fs');const t=fs.readFileSync('README.md','utf8');const bad=[...t.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].map(m=>m[1].split('#')[0]).filter(p=>p&&!fs.existsSync(p));if(bad.length){console.error(bad);process.exit(1)}"`  (relative links resolve)
  4. `test -z "$(git diff --name-only HEAD | grep -vx README.md)"`  (only README.md changed)
  5. narrated: `/doc-review` band; `keep-docs-current` run over `git diff --name-only 3a7b688..HEAD`; every command and flag is tagged **(verify)**/unverified unless proven in `real-server-validation-extended`.
- **Notes/hazards:**
  - Sections: *Hardening for 24/7 displays* (sleep and the recommended preset, smart plug schedule with a clean-shutdown caution, read-only overlay FS via `raspi-config`, Chromium disk cache in RAM), *Tablets* (charge limit / smart plug, battery swelling), *Kiosk flags* (`--kiosk --noerrdialogs --disable-session-crashed-bubble --app=` plus `--overscroll-history-navigation=0` and `--disable-pinch`), *Network* (IoT/guest VLAN reaching only Plex 32400 and plex.tv 443; phone config needs reachability), *Accounts* (Plex Home managed user limited to one library), *The helper* (`--helper`, strategies, permissions, loopback only), *config.json* (loopback-only, delete after first run, never behind a reverse proxy).
  - Do not describe features that have not landed (`remote`, fill modes); `docs-features` does that at the end.

### 24. `p1-gate` — Milestone 2 gate

- **Goal:** Equipment protection holds together end to end.
- **Findings:** E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17 · **Requirements:** R-PROT-1..5, R-FRM-2..4, R-KIOSK-1..2, R-FILT-1, R-HELP-1..2, R-DOC-1..6
- **Mode:** afk · **Tags:** — · **Blocked by:** `pixel-shift`, `frame-brightness`, `sleep-mode`, `bulb-animation`, `frame-rotation`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration`, `pi-stability`, `recommended-protection-preset`, `docs-hardening`
- **Output:** none (verification-only phase)
- **Acceptance criteria:**
  1. `npm test`
  2. `npm run test:e2e`
  3. `node scripts/check-precache.mjs`
  4. `npm run test:e2e -- sleep pixel-shift bulbs kiosk`  (the protection features still pass together on the merged tree; this is the seam check for the shared `index.html`/`main.js`/`display.js` edits)
  5. `test -z "$(git status --porcelain -- . ':!.orchestrator')"`
  6. narrated: `/phase-gate`; reviewer runs one combined scenario: sleep window + kiosk + pixel shift + bulbs at rotation 90, then wakes by playback.
- **Notes/hazards:**
  - Verification-only phase: no Output.

---

## Milestone 3 — P2 polish

Settings and input ergonomics for a keyboardless, remote-or-touch-only device. Exit: `p2-gate`.

### 25. `connection-card-and-libraries` — Connected summary card and library counts

- **Goal:** Open Settings on a 'Connected to ... Change' card, and label libraries 'Movies · 1,240 titles'.
- **Findings:** U1, U4 · **Requirements:** R-SET-1, R-SET-4
- **Mode:** afk · **Tags:** ui · **Blocked by:** `e2e-harness`
- **Output:** `index.html`, `css/app.css`, `js/settings-ui.js`, `js/plex.js`, `tests/plex.test.js`, `scripts/mock-plex.mjs`, `tests/e2e/connection-card.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/plex.test.js`  (new `client.libraryCount(key)` reads `totalSize` from a JSON and from an XML container, returns `null` on error or missing attribute; request uses `X-Plex-Container-Start=0` and `X-Plex-Container-Size=0`)
  2. `npm test`
  3. `npm run test:e2e -- connection-card`  (configured settings: `#connected-card` visible with text containing `Connected to Mock Plex`, `Movies` and a **Change** button, `#signin-btn` hidden until Change is pressed; unconfigured first run still shows `#signin-btn` and the first-run hint; library options read `Movies · 8 titles` (thousands separator for 1,240); with the mock's count request returning 500 the option reads `Movies` and the connection test still succeeds; Music is not listed)
  4. `grep -q 'totalSize' js/plex.js && grep -q 'id="connected-card"' index.html`
- **Notes/hazards:**
  - `totalSize` with `X-Plex-Container-Size=0` is **(verify)** against a real server (V1 extended). Counts load lazily after the list renders; never block `testConnection()` on them; cap concurrency to the number of usable libraries.
  - Mock: `GET /library/sections/{key}/all` with `X-Plex-Container-Size=0` returns `{ MediaContainer: { size: 0, totalSize: <n> } }`; add `GET /__mock/counts-fail` toggle for the failure case.
  - The card needs `serverName` and `libraryName` (already stored on save).

### 26. `settings-time-and-advanced` — Minute presets and an Advanced fold

- **Goal:** Rotation time as 1/5/15/60 minute presets with a custom option; rare settings tucked under Advanced.
- **Findings:** U2, U3 · **Requirements:** R-SET-2, R-SET-3
- **Mode:** afk · **Tags:** ui · **Blocked by:** `e2e-harness`
- **Output:** `js/duration.js`, `tests/duration.test.js`, `index.html`, `css/app.css`, `js/settings-ui.js`, `sw.js`, `tests/e2e/settings-simplify.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/duration.test.js`  (`presetFor(seconds)` -> 60/300/900/3600 or `'custom'`; `secondsFromMinutes('2.5')` = 150; below the schema minimum of 10 s clamps; non-numeric returns the previous value)
  2. `npm test`
  3. `npm run test:e2e -- settings-simplify`  (preset buttons set `rotateSeconds` to 60/300/900/3600 on save; Custom with `2.5` saves 150; a stored 420 s opens as Custom showing `7`; `details#advanced` is closed by default and contains `nowPlayingPollSeconds`, `randomPoolSize`, `crossfadeMs`; changing a field inside it and saving persists it; the labels no longer contain the word `seconds` for the rotation field)
  4. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - Merged because both edit the same Timing/What-to-show fieldsets in `index.html` and share one evidence run.
  - Storage stays seconds: no migration. The preset group is a radio group with `name` outside the schema (UI-only), mapped in `read()`/`write()`.

### 27. `actionable-errors` — Errors that carry their fix

- **Goal:** Auth, network and empty-pool errors offer the button that fixes them.
- **Findings:** U14 · **Requirements:** R-SET-6
- **Mode:** afk · **Tags:** ui · **Blocked by:** `connection-card-and-libraries`
- **Output:** `index.html`, `css/app.css`, `js/main.js`, `js/settings-ui.js`, `js/util.js`, `scripts/mock-plex.mjs`, `tests/e2e/errors.spec.mjs`
- **Acceptance criteria:**
  1. `npm run test:e2e -- errors`  (token `bad` -> the empty-state card shows **Sign in again**; clicking it opens Settings with the sign-in panel started (a mocked plex.tv `POST /api/v2/pins` route intercepted by Playwright); `mock.down()` -> **Diagnostics** and **Test connection** buttons appear and work; `/__mock/empty` -> **Turn off "unwatched only"** is offered and, when pressed, saves `unwatchedOnly:false` and refreshes; the connection-test result in Settings carries the same buttons)
  2. `npm test`
  3. `grep -q 'Sign in again' js/main.js index.html`
- **Notes/hazards:**
  - `PlexError.kind` (`auth`, `network`, `timeout`, `http`, `parse`) and `err.kind === 'empty'` already exist; map kind -> actions in one table in `main.js`, reuse it for the empty card, the toast and the test result.
  - `toast()` supports one action; extend `js/util.js` to accept a list of actions.
  - Mock: `POST /__mock/empty` / `POST /__mock/nonempty` make the library return no items.

### 28. `touch-and-labels` — Control labels, first-tap-only wake and shortcut overlay

- **Goal:** Label the icon-only controls, make the first touch only wake them, and list shortcuts under `?`.
- **Findings:** U11, U12, U13 · **Requirements:** R-CTRL-1, R-CTRL-2, R-CTRL-3
- **Mode:** afk · **Tags:** ui · **Blocked by:** `kiosk-and-pin`
- **Output:** `js/shortcuts.js`, `tests/shortcuts.test.js`, `js/main.js`, `index.html`, `css/app.css`, `sw.js`, `tests/e2e/touch-controls.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/shortcuts.test.js`  (the table has `r p space o f s d ?` with a label each; no duplicate keys; `listShortcuts({disableShortcuts:true})` is empty)
  2. `npm test`
  3. `npm run test:e2e -- touch-controls`  (touch context, controls idle-hidden: a tap on the Settings button's position reveals the controls and does NOT open Settings; a second tap opens it; the same with Pin (no pin set) and Rotate (rotation unchanged after the first tap); mouse click on a visible button still works on the first click; `(hover: none)` emulation shows a text label under each of the 7 icons, desktop shows a tooltip on hover/focus and no persistent label; `controlLabels:'always'`/`'never'` override; `?` opens the shortcuts dialog listing at least 8 entries generated from `shortcuts.js`, Esc closes it; with `disableShortcuts:true` `?` does nothing)
  4. `node scripts/check-precache.mjs`
  5. `grep -q 'id="shortcuts"' index.html`
- **Notes/hazards:**
  - Root cause of U12: `.controls` has `pointer-events:none` until `.visible`; `pointerdown` adds `.visible` and the browser then dispatches the `click` to the button that just became hit-testable. Record `wasVisible` at `pointerdown` (capture phase) and swallow the following `click` when it was false.
  - `KEYS` in `main.js` is rebuilt from `js/shortcuts.js` so the overlay and the handler cannot drift.
  - Touch labels must fit seven buttons on a phone-width bar: stack icon over text, allow the bar to wrap; check at rotation 90.

### 29. `metadata-overlay` — Metadata overlay instead of a duplicate title

- **Goal:** An optional overlay of content rating, runtime and year; the title overlay stays optional and off.
- **Findings:** U10 · **Requirements:** R-NP-2
- **Mode:** afk · **Tags:** ui · **Blocked by:** `content-rating-filter`, `settings-and-schedule-core`
- **Output:** `js/plex.js`, `tests/plex.test.js`, `js/display.js`, `js/poster-cache.js`, `index.html`, `css/app.css`, `scripts/mock-plex.mjs`, `tests/e2e/metadata-overlay.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/plex.test.js`  (`toPoster` carries `contentRating`, `duration`, `year` for movies and the series values for episodes; `formatRuntime(8040000)` = `2 h 14 m`, `formatRuntime(2880000)` = `48 m`, missing -> empty)
  2. `npm test`
  3. `npm run test:e2e -- metadata-overlay`  (`showMeta:true`: `#title-card` text matches `^PG-13 · 2 h 14 m · 1993$` for the mock's item (exact values defined in the mock); missing fields are omitted without stray separators; `showMeta:false` and `showTitle:false` -> hidden; `showTitle:true` alone behaves as in 2.0.0)
  4. `grep -q 'name="showMeta"' index.html`
- **Notes/hazards:**
  - Export `formatRuntime(ms)` from `js/plex.js`. The poster-cache index entry gains `contentRating` and `duration` so the overlay also works on offline cached posters. Keep index entries small (localStorage).
  - Mock: add `duration` (ms) to `MOVIES`. `now-playing-extras` also edits `toPoster`; this phase lands first.

### 30. `position-drag-nudge` — Drag and nudge poster positioning

- **Goal:** Place the poster by dragging it or with arrow keys while Settings is open, instead of tiny sliders.
- **Findings:** U5 · **Requirements:** R-SET-5
- **Mode:** afk · **Tags:** ui · **Blocked by:** `ui-rotation-shell`, `settings-and-schedule-core`
- **Output:** `js/position.js`, `tests/position.test.js`, `index.html`, `css/app.css`, `js/settings-ui.js`, `js/main.js`, `sw.js`, `tests/e2e/position.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/position.test.js`  (`dragToOffset({dx,dy,stageW,stageH,rotation})`: 100 px on a 1000 px stage = 10% at rotation 0, and the same on-screen drag maps to the rotated axes at 90/180/270; `nudge(value, step)` clamps to [-100,100]; Shift multiplies by 10)
  2. `npm test`
  3. `npm run test:e2e -- position`  (press **Position poster**: the sheet collapses to a bar and the poster accepts pointer drag; drag by 100 px changes `posterOffsetX` by 10 (+-0.2) at rotation 0, and by the mapped amount at 90; ArrowRight nudges +0.1, Shift+ArrowRight +1.0, `+`/`-` change size; **Done** reopens the sheet with the new values; **Cancel** on the sheet afterwards restores the originals; the live preview matches the sliders)
  4. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - A modal `<dialog>` makes the page inert and its backdrop swallows pointer events: position mode must close the modal and show a non-modal bar (`dialog.show()` or a plain element), keeping `original` so Cancel still reverts.
  - Arrow keys and `+`/`-` must not collide with the global shortcut table (only active in position mode).
  - On a TV remote the D-pad arrives as arrow keys, which is why nudging matters more than drag.

### 31. `p2-gate` — Milestone 3 gate

- **Goal:** Settings and input polish hold together at all rotations.
- **Findings:** U1, U2, U3, U4, U5, U10, U11, U12, U13, U14 · **Requirements:** R-SET-1..6, R-CTRL-1..3, R-NP-2
- **Mode:** afk · **Tags:** — · **Blocked by:** `connection-card-and-libraries`, `settings-time-and-advanced`, `actionable-errors`, `touch-and-labels`, `metadata-overlay`, `position-drag-nudge`
- **Output:** none (verification-only phase)
- **Acceptance criteria:**
  1. `npm test`
  2. `npm run test:e2e`
  3. `node scripts/check-precache.mjs`
  4. `test -z "$(git status --porcelain -- . ':!.orchestrator')"`
  5. narrated: `/phase-gate`; `/ux-simulate` walk of first run, reconnect after a token error and a touch-only session at rotation 90.
- **Notes/hazards:**
  - Verification-only phase: no Output. The seam check is the full e2e suite, because these phases all edit `index.html`, `css/app.css` and `js/settings-ui.js`.

---

## Milestone 4 — P3 bigger features

Features that need design decisions or a human asset. Several are droppable (see Q4, Q12). Exit: `p3-gate`, after the single version bump.

### 32. `now-playing-extras` — Playback progress bar and 'Playing in' label

- **Goal:** Show a thin progress bar and the player/room name while something plays.
- **Findings:** U9 · **Requirements:** R-NP-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `metadata-overlay`, `pixel-shift`
- **Output:** `js/plex.js`, `tests/plex.test.js`, `js/engine.js`, `tests/engine.test.js`, `js/display.js`, `js/main.js`, `index.html`, `css/app.css`, `scripts/mock-plex.mjs`, `tests/e2e/now-playing-extras.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/plex.test.js tests/engine.test.js`  (`pickNowPlaying` carries `viewOffset`, `duration`, `playerTitle` (`Player.title`) from JSON and XML sessions; the engine exposes the latest session snapshot even when it returns `null` because the poster is unchanged; paused state is carried)
  2. `npm test`
  3. `npm run test:e2e -- now-playing-extras`  (`mock.play(3, {offset: 600000, duration: 6000000, player: 'Living Room'})`: `#progress` width is 10% (+-1%) of the poster window; after the next poll with `offset: 1200000` it is 20%; `state=paused` freezes it; `mock.stop()` removes it; `showProgress:false` hides it; `showPlayer:true` shows text `Playing in Living Room`, default hides it; the bar is inside `#stage` (moves with pixel shift) and is 3 px high)
  4. `grep -q 'id="progress"' index.html`
- **Notes/hazards:**
  - `viewOffset`, `duration` and `Player.title` in `/status/sessions` are **(verify)** (V1 extended). The bar advances between 20 s polls with one linear CSS transition set to the remaining time, never a JS timer per frame.
  - Mock: `POST /__mock/play?ratingKey=&offset=&duration=&player=&state=` stores them on the session and returns them in `/status/sessions` (with `Player: { title, state }`).
  - Placed along the bottom edge of the poster window, not on the frame art (frames differ).

### 33. `fill-blur-and-info` — Landscape fill: blurred backdrop and info panel

- **Goal:** Use the empty sides of a landscape screen for a dimmed poster backdrop or a synopsis panel.
- **Findings:** U7 · **Requirements:** R-FILL-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `metadata-overlay`, `ui-rotation-shell`
- **Output:** `js/fill.js`, `tests/fill.test.js`, `js/plex.js`, `tests/plex.test.js`, `js/display.js`, `index.html`, `css/app.css`, `scripts/mock-plex.mjs`, `sw.js`, `tests/e2e/fill.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/fill.test.js tests/plex.test.js`  (`isLandscape({w,h,rotation})` accounts for 90/270; `trimSummary(text, 300)` cuts on a word boundary with an ellipsis; `toPoster` carries `summary`)
  2. `npm test`
  3. `npm run test:e2e -- fill`  (1920x1080, rotation 0, `fillMode:'blur'`: `#fill-backdrop` exists, its canvas intrinsic width is <= 32 px, effective brightness <= 0.25, and NO element has a non-`none` computed `filter` blur or `backdrop-filter`; `fillMode:'info'`: `#info-panel` shows title, runtime, rating, year and a summary of at most 301 characters beside the poster; portrait viewport or rotation making the screen portrait: neither is shown; `fillMode:'none'` unchanged from today; cross-fade keeps backdrop and poster in step)
  4. `node scripts/check-precache.mjs`
  5. `! grep -nE 'backdrop-filter|filter: *blur' css/app.css`
- **Notes/hazards:**
  - Blur technique: draw the poster into a tiny canvas once per poster and scale it up with CSS; smooth upscaling is the blur. `filter: blur()`/`backdrop-filter` on a full-screen layer is exactly the Pi GPU cost E9 removed.
  - OLED: backdrop opacity capped at 25%; default `none`; mention in the setting's help text that large lit areas shorten OLED life.
  - `summary` can be long: trim before it enters the poster-cache index (localStorage budget).
  - Mock: add `summary` to `MOVIES`.

### 34. `multi-poster-layout` — Landscape fill: 2-3 posters side by side

- **Goal:** On a landscape screen show 2 or 3 framed posters at once, with the playing poster in the centre.
- **Findings:** U7 · **Requirements:** R-FILL-2
- **Mode:** afk · **Tags:** architecture, ui, risk:high · **Blocked by:** `fill-blur-and-info`, `now-playing-extras`
- **Output:** `js/display.js`, `js/engine.js`, `tests/engine.test.js`, `js/main.js`, `index.html`, `css/app.css`, `tests/e2e/multi.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/engine.test.js`  (`decideMany(n)` returns `n` distinct posters, now-playing first and in the centre slot, pinned poster honoured, fewer than `n` available -> as many as exist)
  2. `npm test`
  3. `npm run test:e2e -- multi`  (1920x1080, `fillMode:'multi'`, `fillCount:3`: three `.stage` elements, each inside the viewport, bounding boxes pairwise disjoint, equal heights; with `mock.play(3)` the centre poster is item 3; `fillCount:2` -> two; portrait viewport -> one stage; rotation 90 on a portrait physical screen behaves as landscape logic dictates; offline cached posters fill all slots; pixel shift moves all stages together)
  4. `npm run test:e2e -- rotation pixel-shift fill`  (single-stage behaviour is unchanged when `fillMode` is not `multi`)
- **Notes/hazards:**
  - Q12: droppable; schedule last. `display.js` assumes one stage, one pair of cross-fade layers and one frame; refactor to a list of slot objects behind the same public API (`show`, `apply`, `layout`, `posterSize`).
  - Image requests triple: size each by its slot's `posterSize()`, and let cache-first absorb repeats.
  - `architecture` tag: `/arch-review` of the slot design before it is accepted; `/neuroarxiv` is not needed (layout, no novel mechanism).

### 35. `frame-per-source` — Choose the frame by poster source

- **Goal:** Use one frame while something plays and another for random picks, with no new artwork yet.
- **Findings:** U8 · **Requirements:** R-FRM-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `frame-rotation`, `bulb-animation`
- **Output:** `js/frame-rotation.js`, `tests/frame-rotation.test.js`, `js/main.js`, `js/display.js`, `index.html`, `tests/e2e/frame-per-source.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/frame-rotation.test.js`  (`frameForSource(settings, source, rotatedId)`: `now-playing`/`static` -> `frameId` (or the rotation pick); `random`/`cache` -> `frameIdRandom` when set, else same as `frameId`)
  2. `npm test`
  3. `npm run test:e2e -- frame-per-source`  (`frameId:'marquee'`, `frameIdRandom:'marquee-glow'` as stand-ins: idle random poster -> `#frame` src ends `marquee-glow.png`; `mock.play(3)` -> `marquee.png`; `mock.stop()` -> back to glow; `frameIdRandom:''` -> always `marquee.png`; the frame switch coincides with the poster cross-fade and bulbs re-detect)
  4. `! grep -rq 'coming-attractions' js/frames.js sw.js`  (nothing is registered before its PNG exists)
  5. `node scripts/check-precache.mjs`
- **Notes/hazards:**
  - A built-in frame must not appear in `FRAMES`/`SHELL` before its file exists: a missing precache file fails the service-worker install and the app loses offline mode (`cache.addAll` rejects).
  - Settings UI gets a second frame select (`frameIdRandom`) next to the first, with 'Same as above' as the default option.

### 36. `coming-attractions-artwork` — Owner supplies the 'Coming Attractions' frame

- **Goal:** A `marquee-coming-attractions.png` with the same geometry as `marquee.png` exists in `assets/frames/`.
- **Findings:** U8 · **Requirements:** R-FRM-1
- **Mode:** hitl · **Tags:** — · **Blocked by:** `frame-per-source`
- **Output:** `assets/frames/marquee-coming-attractions.png`
- **Acceptance criteria:**
  1. `file assets/frames/marquee-coming-attractions.png | grep -q '1080 x 1688, 8-bit/color RGBA'`
  2. `test "$(stat -c%s assets/frames/marquee-coming-attractions.png)" -lt 1500000`
  3. narrated: the owner confirms the header reads COMING ATTRACTIONS, the bulb border and the transparent poster window match `marquee.png` (open `design/RetroFrame.pdn` in Paint.NET, replace the header text, export PNG with alpha). The reviewer looks at both images side by side.
- **Notes/hazards:**
  - Q4 ruling: if the answer is 'generate', replace this phase with an afk phase that scripts the header swap; the recommendation is the human-made asset because no zero-dependency PNG tooling exists.
  - Also acceptable: variants for `marquee-narrow` and `marquee-glow`; only the main one is required.

### 37. `coming-attractions-register` — Register the Coming Attractions frame

- **Goal:** Add the new frame to `FRAMES` and the precache once its PNG exists, and verify its window.
- **Findings:** U8 · **Requirements:** R-FRM-1
- **Mode:** afk · **Tags:** ui · **Blocked by:** `coming-attractions-artwork`
- **Output:** `js/frames.js`, `sw.js`, `tests/frames.test.js`, `tests/e2e/coming-attractions.spec.mjs`
- **Acceptance criteria:**
  1. `node scripts/check-precache.mjs`  (the PNG is listed in `SHELL` and exists)
  2. `npm run test:e2e -- coming-attractions`  (loads the PNG in the page, runs `detectWindow`, and asserts the registered `window` for `marquee-coming-attractions` equals it within 0.5 percentage points on each of x, y, w, h; `frameIdRandom:'marquee-coming-attractions'` with an idle random poster shows that frame; bulbs detected >= 40)
  3. `node --test tests/frames.test.js`
  4. `npm test`
  5. `grep -q 'marquee-coming-attractions' js/frames.js && grep -q 'marquee-coming-attractions' sw.js`
- **Notes/hazards:**
  - Measure the window with the browser (the spec prints the numbers) rather than guessing; copy them into `FRAMES`.
  - The Settings frame list is built from `FRAMES`, so the select picks it up automatically.

### 38. `remote-config-server` — LAN pairing server for phone configuration

- **Goal:** Add `serve.mjs --remote`: a second, allowlist-only LAN listener and a loopback queue the display polls.
- **Findings:** U6 · **Requirements:** R-REM-1
- **Mode:** afk · **Tags:** architecture, risk:high · **Blocked by:** `device-helper-server`
- **Output:** `scripts/remote.mjs`, `scripts/serve.mjs`, `scripts/net.mjs`, `remote/index.html`, `remote/remote.js`, `remote/remote.css`, `tests/remote.test.js`
- **Acceptance criteria:**
  1. `node --test tests/remote.test.js`  (spawned `serve.mjs --remote`: `GET /__remote/info` and `GET /__remote/pending` from loopback return the URL, current code and queue and are 403 from the LAN address; `POST /__remote/apply` with a wrong code -> 403 and an empty queue; 5 wrong codes lock that client for 60 s (doubling); correct code + `{rotation: 90}` -> queued; correct code + a patch containing `plexToken`, `serverUrl`, `settingsPinHash` or `settingsPinSalt` -> rejected whole with 400; unknown keys and wrong types rejected; body over 4 KB -> 413; codes rotate after 10 min and are single-session; `POST /__remote/ack` clears the queue; the LAN listener serves only `/`, `/remote.js`, `/remote.css` and `/__remote/apply`)
  2. `npm test`
  3. `! grep -nE 'plexToken|X-Plex-Token|serverUrl' remote/index.html remote/remote.js`  (the phone page never knows a secret)
  4. `grep -q '/__remote/' scripts/serve.mjs scripts/remote.mjs`
  5. `git diff --quiet HEAD -- js css index.html sw.js`
  6. narrated: `/arch-review` of the pairing design (code lifetime, lockout, allowlist, loopback queue) and a reviewer attempt to apply a patch without the code, with a replayed code after rotation, and from a spoofed `Host`.
- **Notes/hazards:**
  - Q2 ruling needed (recommended option A). The LAN listener binds `--remote-host` (default first non-internal IPv4) on `--remote-port` (default 8090) and is a separate `http.Server` from the loopback app server, so enabling it does not expose the app, `config.json` or the helper.
  - Allowlist of patchable keys: rotation, rotateSeconds, frameId, frameIdRandom, frameRotation, fillMode, fillCount, sleep*, idleSleepHours, nightDim*, frameBrightness, maxContentRating, showMeta, showProgress, showPlayer, pixelShift, bulbAnimation; plus actions `next`, `pause`, `pin`. Everything else rejected.
  - Codes: 6 digits from `crypto.randomInt`, compared with `crypto.timingSafeEqual`; per-IP attempt counters; plain HTTP, so the code is sniffable on the LAN (documented; conflicts with an isolated VLAN).
  - Pending queue max 20 entries; the display acks after applying.

### 39. `remote-config-ui` — QR code and display-side remote client

- **Goal:** Show a QR code in Settings and the first-run card, and apply phone patches through `applySettings`.
- **Findings:** U6 · **Requirements:** R-REM-1
- **Mode:** afk · **Tags:** architecture, ui · **Blocked by:** `remote-config-server`, `ui-rotation-shell`
- **Output:** `js/remote.js`, `js/vendor/qrcode.js`, `js/vendor/LICENSE-qrcode.txt`, `tests/qr.test.js`, `package.json`, `package-lock.json` (only if `npm install` runs), `index.html`, `css/app.css`, `js/settings-ui.js`, `js/main.js`, `sw.js`, `tests/e2e/remote.spec.mjs`
- **Acceptance criteria:**
  1. `node --test tests/qr.test.js`  (the encoder output for `http://192.168.1.20:8090/?c=123456` is decoded back to exactly that string by `jsqr` (a devDependency); versions up to 10, ECC level M)
  2. `npm test`
  3. `npm run test:e2e -- remote`  (harness `serveArgs: ['--remote']`: Settings and the empty state show `#remote-qr` with a `data-url` attribute; a second browser context acting as the phone opens that URL (LAN address replaced by 127.0.0.1), enters nothing but the code carried in the URL, sets rotation 90 and the display rotates within 10 s; a phone patch containing `plexToken` is rejected; without `--remote` the QR section is hidden; the QR payload contains no token; at display rotation 90 the QR block is upright)
  4. `node scripts/check-precache.mjs`
  5. `! grep -nE 'plexToken|X-Plex-Token' js/remote.js`
  6. `test -s js/vendor/LICENSE-qrcode.txt && node -e "const p=require('./package.json'); if (p.dependencies) process.exit(1)"`
  7. narrated: `/tool-fit review` of the vendored encoder (licence, pinned version, size) before it is accepted; `dependency-audit` of the new devDependency.
- **Notes/hazards:**
  - Q3 ruling: recommended vendoring `qrcode-generator` (MIT) as one file under `js/vendor/` with its licence and pinned version in the header comment; if ruled B, write a minimal encoder with the same test.
  - The QR encodes only the pairing URL. It must be regenerated when the code rotates.
  - The display polls `/__remote/pending` every 5 s while visible; 404 or network error means 'no remote server' and hides the section (no console error spam).
  - Remote patches go through `applySettings` and honour the kiosk PIN only for the Settings sheet, not for the phone (the pairing code is the credential).

### 40. `real-server-validation-extended` — Validate the (verify) items on real hardware and a real server

- **Goal:** A human confirms or corrects every parameter, flag and command the spec marked (verify).
- **Findings:** V1 · **Requirements:** R-VAL-2
- **Mode:** hitl · **Tags:** — · **Blocked by:** `validation-checklists`, `content-rating-filter`, `connection-card-and-libraries`, `now-playing-extras`, `device-helper-server`, `docs-hardening`
- **Output:** `docs/validation/real-server-extended.md`
- **Acceptance criteria:**
  1. `! grep -q 'PENDING' docs/validation/real-server-extended.md`
  2. `grep -Eq '^Overall: (PASS|FAIL \(.+\))$' docs/validation/real-server-extended.md`
  3. `! grep -Eq 'X-Plex-Token=[A-Za-z0-9_-]{15,}' docs/validation/real-server-extended.md`
  4. narrated: every FAIL row names the phase to reopen (for example `content-rating-filter` if Plex's `contentRating` parameter differs); the conductor routes those through reconcile. Rows marked `skip if no Pi` may be `SKIPPED` with a reason.
- **Notes/hazards:**
  - Do this before `docs-features` and `release-bump` so verified facts, not guesses, reach the README.

### 41. `docs-features` — README and Roadmap match what shipped

- **Goal:** Update the feature table, shortcuts, project layout and Roadmap to 2.1.0 reality.
- **Findings:** — · **Requirements:** R-DOC-7
- **Mode:** afk · **Tags:** docs · **Blocked by:** `remote-config-ui`, `multi-poster-layout`, `fill-blur-and-info`, `coming-attractions-register`, `now-playing-extras`, `touch-and-labels`, `settings-time-and-advanced`, `position-drag-nudge`, `actionable-errors`, `real-server-validation-extended`
- **Output:** `README.md`, `Roadmap.md`
- **Acceptance criteria:**
  1. `for f in js/*.js scripts/*.mjs; do grep -q "$(basename "$f")" README.md || { echo "undocumented: $f"; exit 1; }; done`  (project layout lists every module and script)
  2. `for k in 'Sleep' 'Pixel shift' 'Kiosk' 'PIN' 'Content rating' 'Fill' 'Remote' 'Progress' 'Coming Attractions' 'Recommended protection' 'npm run test:e2e'; do grep -qiF -- "$k" README.md || { echo "missing: $k"; exit 1; }; done`
  3. `grep -qi 'shortcuts overlay' README.md`  (the shortcut section documents the `?` overlay)
  4. `! sed -n '/Ideas/,$p' Roadmap.md | grep -qE 'Scheduled dimming|Playback progress|Remote control'`  (shipped items left the ideas list)
  5. `test -z "$(git diff --name-only HEAD | grep -vE '^(README|Roadmap)\.md$')"`
  6. narrated: `/doc-review` band and `keep-docs-current` over `git diff --name-only 3a7b688..HEAD`; screenshots (`assets/screenshots/`) are not regenerated here.
- **Notes/hazards:**
  - `Findings` is `—` because this is documentation of shipped work, not a finding delivery. Verified facts from `real-server-extended.md` replace (verify) labels in README.

### 42. `release-bump` — Bump the version once

- **Goal:** Set `VERSION` to 2.1.0 in `sw.js`, `js/main.js` and `package.json` so installed clients update.
- **Findings:** — · **Requirements:** R-REL-1
- **Mode:** afk · **Tags:** publish · **Blocked by:** `docs-features`, `real-server-validation-extended`, `multi-poster-layout`, `remote-config-ui`, `coming-attractions-register`, `recommended-protection-preset`, `p2-gate`, `p1-gate`
- **Output:** `sw.js`, `js/main.js`, `package.json`, `package-lock.json` (only if it exists), `tests/e2e/release.spec.mjs`
- **Acceptance criteria:**
  1. `node -e "const fs=require('fs');const g=(f)=>fs.readFileSync(f,'utf8').match(/VERSION = '([^']+)'/)[1];const a=g('sw.js'),b=g('js/main.js'),c=require('./package.json').version;if(!(a===b&&b===c&&a==='2.1.0')){console.error(a,b,c);process.exit(1)}"`
  2. `npm test`
  3. `npm run test:e2e`  (includes `release.spec.mjs`: with service workers enabled the cache `shell-2.1.0` exists after activation and no `shell-2.0.0` cache remains)
  4. `node scripts/check-precache.mjs`
  5. `test "$(git diff --name-only HEAD | sort | tr '\n' ' ')" = "js/main.js package.json sw.js tests/e2e/release.spec.mjs "`  (nothing else changed; with a lockfile, add it to the expected list)
  6. narrated: `publish` routing: full `code-review` of the 2.0.0..2.1.0 range, `security-scan` over the repo, `dependency-audit` (devDependencies only), `scrub-pii` on `docs/validation/*` and `docs/security/*`.
- **Notes/hazards:**
  - Decision (Q6): one bump here, not per phase. Per-phase bumps would make every phase edit three shared lines and conflict, and installed clients would auto-reload into half-finished work.
  - Do not tag, push or publish anything: the conductor owns that decision and `irreversible` actions are separate.

### 43. `p3-gate` — Milestone 4 gate

- **Goal:** Release candidate: everything passes on a clean tree at 2.1.0.
- **Findings:** U6, U7, U8, U9, V1 · **Requirements:** R-REM-1, R-FILL-1, R-FILL-2, R-FRM-1, R-NP-1, R-VAL-2, R-DOC-7, R-REL-1
- **Mode:** afk · **Tags:** — · **Blocked by:** `release-bump`
- **Output:** none (verification-only phase)
- **Acceptance criteria:**
  1. `npm test`
  2. `npm run test:e2e`
  3. `node scripts/check-precache.mjs`
  4. `grep -Eq '^Overall: (PASS|FAIL \(.+\))$' docs/validation/real-server-extended.md`
  5. `test -z "$(git status --porcelain -- . ':!.orchestrator')"`
  6. narrated: `/phase-gate`; final read of every row in the traceability matrix against `git log 3a7b688..HEAD`.
- **Notes/hazards:**
  - Verification-only phase: no Output.

### 44. `purge-git-history` — OPTIONAL: purge config.js from git history

- **Goal:** Remove `config.js` (the leaked token) from every commit and force-push, only if the owner chooses to.
- **Findings:** S1 · **Requirements:** R-SEC-2
- **Mode:** hitl · **Tags:** irreversible, risk:high · **Blocked by:** `rotate-plex-token`, `p3-gate`
- **Output:** `docs/security/history-purge.md`
- **Acceptance criteria:**
  1. `test -z "$(git log --all --oneline -- config.js)"`
  2. `grep -qx 'Purged: yes' docs/security/history-purge.md`
  3. `git fsck --no-dangling >/dev/null 2>&1`
  4. narrated: the conductor skips this phase unless the owner answers Q8 with 'purge'. Before the approval pause the independent precondition review (target commit, clean tree, suite green, exact command) is written; the owner runs the force-push themselves.
- **Notes/hazards:**
  - Hand-off checklist: (1) `git clone --mirror` a backup somewhere safe; (2) install `git-filter-repo` **(verify the package name for your OS)**; (3) in a fresh clone: `git filter-repo --invert-paths --path config.js`; (4) re-add `origin`; (5) `git push --force-with-lease --all && git push --force --tags`; (6) tell every collaborator to re-clone; (7) ask GitHub support to drop cached views and check forks if the repo was public; (8) record `Purged: yes` and the date in `docs/security/history-purge.md`.
  - Irreversible: every SHA changes, so run it last (it is blocked by `p3-gate`). Rotation (`rotate-plex-token`) is what actually removes the risk; a purge only removes the evidence. Do not rewrite history on the branch the conductor is committing to while it is running.

---

## Dependency graph

`phase -> blocked by` (real prerequisites only; the first column is the plan number, which implies no order beyond the arrows).

| # | Phase | Mode | Blocked by |
|---|---|---|---|
| 1 | `e2e-harness` | afk | — |
| 2 | `settings-and-schedule-core` | afk | `e2e-harness` |
| 3 | `rotate-plex-token` | hitl | — |
| 4 | `serve-config-guard` | afk | — |
| 5 | `layout-rotation-fix` | afk | `e2e-harness` |
| 6 | `cache-first-fetch` | afk | `e2e-harness`, `settings-and-schedule-core` |
| 7 | `status-indicator` | afk | `e2e-harness`, `settings-and-schedule-core` |
| 8 | `ui-rotation-shell` | afk | `layout-rotation-fix`, `status-indicator`, `settings-and-schedule-core` |
| 9 | `validation-checklists` | afk | — |
| 10 | `real-server-validation` | hitl | `validation-checklists`, `cache-first-fetch`, `serve-config-guard` |
| 11 | `p0-gate` | afk | `layout-rotation-fix`, `ui-rotation-shell`, `cache-first-fetch`, `serve-config-guard`, `status-indicator`, `rotate-plex-token`, `real-server-validation` |
| 12 | `pixel-shift` | afk | `ui-rotation-shell`, `settings-and-schedule-core` |
| 13 | `frame-brightness` | afk | `settings-and-schedule-core` |
| 14 | `sleep-mode` | afk | `settings-and-schedule-core` |
| 15 | `bulb-animation` | afk | `settings-and-schedule-core`, `sleep-mode` |
| 16 | `frame-rotation` | afk | `settings-and-schedule-core`, `bulb-animation` |
| 17 | `content-rating-filter` | afk | `settings-and-schedule-core` |
| 18 | `kiosk-and-pin` | afk | `ui-rotation-shell`, `settings-and-schedule-core` |
| 19 | `device-helper-server` | afk | `serve-config-guard` |
| 20 | `device-helper-integration` | afk | `device-helper-server`, `sleep-mode`, `frame-brightness` |
| 21 | `pi-stability` | afk | `sleep-mode`, `settings-and-schedule-core` |
| 22 | `recommended-protection-preset` | afk | `sleep-mode`, `frame-brightness`, `pixel-shift`, `bulb-animation`, `pi-stability`, `content-rating-filter` |
| 23 | `docs-hardening` | afk | `cache-first-fetch`, `serve-config-guard`, `kiosk-and-pin`, `device-helper-server`, `sleep-mode`, `pi-stability`, `recommended-protection-preset` |
| 24 | `p1-gate` | afk | `pixel-shift`, `frame-brightness`, `sleep-mode`, `bulb-animation`, `frame-rotation`, `content-rating-filter`, `kiosk-and-pin`, `device-helper-integration`, `pi-stability`, `recommended-protection-preset`, `docs-hardening` |
| 25 | `connection-card-and-libraries` | afk | `e2e-harness` |
| 26 | `settings-time-and-advanced` | afk | `e2e-harness` |
| 27 | `actionable-errors` | afk | `connection-card-and-libraries` |
| 28 | `touch-and-labels` | afk | `kiosk-and-pin` |
| 29 | `metadata-overlay` | afk | `content-rating-filter`, `settings-and-schedule-core` |
| 30 | `position-drag-nudge` | afk | `ui-rotation-shell`, `settings-and-schedule-core` |
| 31 | `p2-gate` | afk | `connection-card-and-libraries`, `settings-time-and-advanced`, `actionable-errors`, `touch-and-labels`, `metadata-overlay`, `position-drag-nudge` |
| 32 | `now-playing-extras` | afk | `metadata-overlay`, `pixel-shift` |
| 33 | `fill-blur-and-info` | afk | `metadata-overlay`, `ui-rotation-shell` |
| 34 | `multi-poster-layout` | afk | `fill-blur-and-info`, `now-playing-extras` |
| 35 | `frame-per-source` | afk | `frame-rotation`, `bulb-animation` |
| 36 | `coming-attractions-artwork` | hitl | `frame-per-source` |
| 37 | `coming-attractions-register` | afk | `coming-attractions-artwork` |
| 38 | `remote-config-server` | afk | `device-helper-server` |
| 39 | `remote-config-ui` | afk | `remote-config-server`, `ui-rotation-shell` |
| 40 | `real-server-validation-extended` | hitl | `validation-checklists`, `content-rating-filter`, `connection-card-and-libraries`, `now-playing-extras`, `device-helper-server`, `docs-hardening` |
| 41 | `docs-features` | afk | `remote-config-ui`, `multi-poster-layout`, `fill-blur-and-info`, `coming-attractions-register`, `now-playing-extras`, `touch-and-labels`, `settings-time-and-advanced`, `position-drag-nudge`, `actionable-errors`, `real-server-validation-extended` |
| 42 | `release-bump` | afk | `docs-features`, `real-server-validation-extended`, `multi-poster-layout`, `remote-config-ui`, `coming-attractions-register`, `recommended-protection-preset`, `p2-gate`, `p1-gate` |
| 43 | `p3-gate` | afk | `release-bump` |
| 44 | `purge-git-history` | hitl | `rotate-plex-token`, `p3-gate` |

### Waves (longest-path levels)

Phases in one wave have no path between them (given the `Blocked by` edges), so they are dependency-concurrent. Output overlap then splits each wave into the concurrent groups below.

| Wave | Phases |
|---|---|
| 0 | `e2e-harness`, `rotate-plex-token`, `serve-config-guard`, `validation-checklists` |
| 1 | `settings-and-schedule-core`, `layout-rotation-fix`, `device-helper-server`, `connection-card-and-libraries`, `settings-time-and-advanced` |
| 2 | `cache-first-fetch`, `status-indicator`, `frame-brightness`, `sleep-mode`, `content-rating-filter`, `actionable-errors`, `remote-config-server` |
| 3 | `ui-rotation-shell`, `real-server-validation`, `bulb-animation`, `device-helper-integration`, `pi-stability`, `metadata-overlay` |
| 4 | `p0-gate`, `pixel-shift`, `frame-rotation`, `kiosk-and-pin`, `position-drag-nudge`, `fill-blur-and-info`, `remote-config-ui` |
| 5 | `recommended-protection-preset`, `touch-and-labels`, `now-playing-extras`, `frame-per-source` |
| 6 | `docs-hardening`, `p2-gate`, `multi-poster-layout`, `coming-attractions-artwork` |
| 7 | `p1-gate`, `coming-attractions-register`, `real-server-validation-extended` |
| 8 | `docs-features` |
| 9 | `release-bump` |
| 10 | `p3-gate` |
| 11 | `purge-git-history` |

### Phases that can run concurrently

Waves are a planning aid: the conductor computes the real frontier live from `Blocked by`, and the Output-overlap rule applies across waves too (a wave-3 phase and a wave-2 phase that share a path are serialised). Within each wave, phases are packed greedily into groups whose Output paths are pairwise disjoint (and which do not both edit `scripts/mock-plex.mjs`); phases in the same group may run at the same time, groups of one wave run one after another. `hitl` phases never occupy an agent and always run alongside.

| Wave | Concurrent group |
|---|---|
| 0 | `e2e-harness` ‖ `serve-config-guard` ‖ `validation-checklists` |
| 0 | `rotate-plex-token` (hitl: owner acts, no agent) |
| 1 | `settings-and-schedule-core` ‖ `layout-rotation-fix` ‖ `device-helper-server` |
| 1 | `connection-card-and-libraries` (alone: shares Output with a wave-mate) |
| 1 | `settings-time-and-advanced` (alone: shares Output with a wave-mate) |
| 2 | `cache-first-fetch` ‖ `remote-config-server` |
| 2 | `status-indicator` (alone: shares Output with a wave-mate) |
| 2 | `frame-brightness` (alone: shares Output with a wave-mate) |
| 2 | `sleep-mode` (alone: shares Output with a wave-mate) |
| 2 | `content-rating-filter` (alone: shares Output with a wave-mate) |
| 2 | `actionable-errors` (alone: shares Output with a wave-mate) |
| 3 | `ui-rotation-shell` (alone: shares Output with a wave-mate) |
| 3 | `real-server-validation` (hitl: owner acts, no agent) |
| 3 | `bulb-animation` (alone: shares Output with a wave-mate) |
| 3 | `device-helper-integration` (alone: shares Output with a wave-mate) |
| 3 | `pi-stability` (alone: shares Output with a wave-mate) |
| 3 | `metadata-overlay` (alone: shares Output with a wave-mate) |
| 4 | `p0-gate` (gate: verifies the whole tree, runs alone) |
| 4 | `pixel-shift` (alone: shares Output with a wave-mate) |
| 4 | `frame-rotation` (alone: shares Output with a wave-mate) |
| 4 | `kiosk-and-pin` (alone: shares Output with a wave-mate) |
| 4 | `position-drag-nudge` (alone: shares Output with a wave-mate) |
| 4 | `fill-blur-and-info` (alone: shares Output with a wave-mate) |
| 4 | `remote-config-ui` (alone: shares Output with a wave-mate) |
| 5 | `recommended-protection-preset` (alone: shares Output with a wave-mate) |
| 5 | `touch-and-labels` (alone: shares Output with a wave-mate) |
| 5 | `now-playing-extras` (alone: shares Output with a wave-mate) |
| 5 | `frame-per-source` (alone: shares Output with a wave-mate) |
| 6 | `docs-hardening` ‖ `multi-poster-layout` |
| 6 | `p2-gate` (gate: verifies the whole tree, runs alone) |
| 6 | `coming-attractions-artwork` (hitl: owner acts, no agent) |
| 7 | `p1-gate` (gate: verifies the whole tree, runs alone) |
| 7 | `coming-attractions-register` (alone: shares Output with a wave-mate) |
| 7 | `real-server-validation-extended` (hitl: owner acts, no agent) |
| 8 | `docs-features` |
| 9 | `release-bump` |
| 10 | `p3-gate` (gate: verifies the whole tree, runs alone) |
| 11 | `purge-git-history` (hitl: owner acts, no agent) |

### Critical path

`e2e-harness` -> `settings-and-schedule-core` -> `sleep-mode` -> `bulb-animation` -> `frame-rotation` -> `frame-per-source` -> `coming-attractions-artwork` -> `coming-attractions-register` -> `docs-features` -> `release-bump` -> `p3-gate` -> `purge-git-history`  (12 phases)

### Finding coverage (also in `docs/spec.md`, Traceability matrix)

Every finding ID is delivered by at least one phase (enablers and gates, whose `Findings:` line starts with `—` or which only verify, are left out of this table):

| Finding | Phase(s) |
|---|---|
| F1 | `layout-rotation-fix` |
| F2 | `ui-rotation-shell` |
| F3 | `cache-first-fetch` |
| F4 | `serve-config-guard`, `docs-hardening` |
| F5 | `status-indicator` |
| S1 | `rotate-plex-token`, `purge-git-history` |
| V1 | `validation-checklists`, `real-server-validation`, `real-server-validation-extended` |
| U1 | `connection-card-and-libraries` |
| U2 | `settings-time-and-advanced` |
| U3 | `settings-time-and-advanced` |
| U4 | `connection-card-and-libraries` |
| U5 | `position-drag-nudge` |
| U6 | `remote-config-server`, `remote-config-ui` |
| U7 | `fill-blur-and-info`, `multi-poster-layout` |
| U8 | `frame-per-source`, `coming-attractions-artwork`, `coming-attractions-register` |
| U9 | `now-playing-extras` |
| U10 | `metadata-overlay` |
| U11 | `touch-and-labels` |
| U12 | `touch-and-labels` |
| U13 | `touch-and-labels` |
| U14 | `actionable-errors` |
| E1 | `sleep-mode` |
| E2 | `pixel-shift` |
| E3 | `bulb-animation` |
| E4 | `frame-brightness` |
| E5 | `frame-rotation` |
| E6 | `device-helper-server`, `device-helper-integration` |
| E7 | `docs-hardening` |
| E8 | `cache-first-fetch`, `docs-hardening` |
| E9 | `device-helper-integration`, `pi-stability` |
| E10 | `pi-stability` |
| E11 | `docs-hardening` |
| E12 | `kiosk-and-pin` |
| E13 | `docs-hardening` |
| E14 | `content-rating-filter` |
| E15 | `docs-hardening` |
| E16 | `kiosk-and-pin` |
| E17 | `docs-hardening` |
