# Plex Poster Display — Product and Technical Spec

Baseline: commit `3a7b688` (v2.0.0, PWA rewrite). Target: v2.1.0. Companion plan: `docs/integration-plan.md`.

## Goal

A poster display that can run unattended, 24/7, on any screen in the house without damaging that screen, leaking the owner's Plex access, or needing a keyboard to set up.

## Personas and use cases

| Persona | Setup | What matters |
|---|---|---|
| **Hallway-OLED owner** | 55" OLED mounted in portrait, Raspberry Pi 4 behind it running Chromium `--kiosk`, on 24/7, kids in the house | No burn-in (static frame, bulbs, status text), no SD-card wear, screen off when nobody is home, kids cannot reconfigure or reach the token, random posters stay age-appropriate, no keyboard on the device |
| **Wall-tablet owner** | Android/iPad tablet in a stand, installed PWA, touch only | Touch-friendly controls (no accidental taps), battery safety when always charging, swipe-back or pinch must not leave the app, config from the tablet itself |
| **Landscape-TV owner** | 1920x1080 TV driven by a Pi or Chromecast-class browser, rotation 0 or a screen mounted sideways | A portrait poster fills only about a third of the screen, so fill modes matter. Rotation must not clip. Remote-control navigation, no mouse |

Use cases: UC1 show what is playing now; UC2 rotate random posters when idle; UC3 survive Plex or network outages; UC4 first-time setup without a keyboard; UC5 leave it alone for months; UC6 hand the device to a household with children.

## Principles

1. **Zero runtime dependencies, no build step.** Plain ES modules, static files. Dev-only dependencies (the e2e harness) are allowed and must not appear in `dependencies`. A vendored single-file library is a runtime dependency and needs an explicit decision (Q3).
2. **Works offline and with no backend.** The app is fully functional as static files. Anything that needs a process (device helper, phone config) is opt-in, loopback-first, and the app degrades silently when it is absent.
3. **Protect the hardware by default.** Imperceptible protections default on; protections the user would notice (blanking, dimming, content limits) default off but are one tap away through a **Recommended protection** preset (R-PROT-5).
4. **Secrets stay on the device.** The Plex token never appears in a URL, a QR code, a log line, an export (unless ticked), or a response to a non-loopback client.
5. **Match the existing idiom.** Pure logic in small modules with `node --test` tests; DOM glue in `main.js`, `display.js`, `settings-ui.js`.
6. **Facts we cannot verify here are marked (verify)** and collected in `docs/validation/` for the hardware/real-server phases.

## Requirements

Priorities: **P0** fix-first, **P1** protection, **P2** polish, **P3** bigger features. Each requirement names the finding IDs it answers. Acceptance statements are written so a script can check them; the plan turns them into commands.

### Rotation and layout

**R-ROT-1 (P0, F1) Rotated stage stays centred and on screen.** `.stage` is a flex/grid child of `.app` (`css/app.css`); at rotation 90/270 on a landscape viewport the stage is laid out at swapped dimensions (`stageSize()` in `js/layout.js`), so its layout box (e.g. 1080x1687 in a 1920x1080 viewport) is taller than the container, grows the grid row, and the rotated result lands about 300 px low and clipped. Fix: take the stage out of flow and centre it on the viewport centre (absolute at 50%/50% with `translate(-50%, -50%)` composed before `rotate`).
- At 1920x1080 and 1080x1920, for each rotation 0/90/180/270: `#stage` and `#frame` bounding boxes lie inside the viewport (tolerance 1 px) and their centre is within 1 px of the viewport centre.
- The stage's rotated bounding box is the largest that fits the viewport for that rotation (no needless shrink): its limiting dimension equals the viewport dimension within 2 px.
- `.app` has no scroll overflow (`scrollHeight == clientHeight`).
- Existing `tests/layout.test.js` still passes unchanged.

**R-ROT-2 (P0, F2) The UI shell rotates with the stage.** Settings sheet, controls, toast, status indicator, empty-state card, diagnostics and any new dialog read upright for the viewer when rotation is 90/180/270. New setting `rotateUi` (default true) lets OS-level-rotation users turn it off. Decision pending: Q1 (recommended: rotate the shell, document OS-level rotation as the preferred path for Pi).
- With rotation 90, 180 and 270 and `rotateUi` true, the computed transform of each of `#controls`, `#toast`, `.empty-card`, `#settings`, `#diagnostics` equals the stage rotation, and each element's bounding box (opened/visible) lies inside the viewport.
- With `rotateUi` false, none of those elements carries a rotation.
- Rotation 0 is byte-for-byte unchanged in layout (bounding boxes equal pre-change values).
- Top-layer `<dialog>` elements are not affected by ancestor transforms; each dialog is rotated by its own rule.

### Status indicator

**R-STAT-1 (P0, F5) No persistent status text.** `#status` (re-rendered every second with a countdown) becomes: visible only while the controls are visible; otherwise, when there is something to report (paused, offline), a small low-contrast dot (`#status-dot`, at most 8 px, at most 40% opacity) that changes corner position on a slow cycle (every 5 minutes). When all is well and controls are hidden nothing is drawn. The 1 s `setInterval(updateStatus)` in `js/main.js` runs only while the pill is visible. New setting `statusIndicator` (`dot` default, `off`).
- With the mock server stopped and controls idle-hidden, `#status` is hidden, `#status-dot` is visible and no larger than 8x8 px; after waking the controls `#status` shows the retry countdown.
- With everything healthy and controls hidden, neither element is visible.
- The dot's position differs after the cycle interval (tested with a fake clock) and is always inside the safe viewport area.

### Poster cache and SD-card wear

**R-CACHE-1 (P0, F3, E8) Cache-first poster fetch.** `fetchImage()` in `js/main.js` must consult `poster-cache.js` before the network. A cache entry is valid when its stored `thumb` equals the requested poster's `thumb` (Plex changes the thumb path when artwork changes) and its stored pixel size is at least the requested size. On a hit nothing is downloaded and nothing is written to the Cache API. On a miss the existing download-and-put path runs. Corner cases: `directImages` mode (CORS blocked) is unchanged; a cache read error falls back to the network.
- Showing 8 distinct posters 3 times each causes at most 8 `/photo/:/transcode` requests (counted by the mock's stats endpoint) and at most 8 Cache API writes.
- Unit tests cover: hit, miss, thumb changed, stored smaller than requested, storage error.
- A poster whose artwork changed is re-downloaded exactly once.

**R-CACHE-2 (P0, F3) Cache sized to the pool.** New setting `posterCacheLimit` (default 100, range 10-300). `createPosterCache` reads the limit lazily so a settings change applies without reload. With the default random pool of 100 titles, steady state is zero downloads and zero writes per rotation (previously 288 of each per day at 5-minute rotation). Index metadata stores the pixel size.

### Security

**R-SEC-1 (P0, F4) `config.json` is loopback-only.** `scripts/serve.mjs` serves `/config.json` only to requests whose socket peer address is loopback (`127.0.0.0/8`, `::1`, `::ffff:127.x`); others get 403. The check runs after path normalisation so `//config.json`, `/./config.json`, `/%63onfig.json` and `/config.json/` cannot bypass it. For loopback requests the `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (DNS-rebinding guard). Other files stay public. Exports an `isLoopback(addr)` helper reused by R-HELP-1 and R-REM-1.
- Started with `--host 0.0.0.0`: `GET /config.json` from loopback returns 200; from the machine's LAN address returns 403; `GET /index.html` from the LAN address returns 200.
- Unit tests for `isLoopback` cover IPv4, IPv6, IPv4-mapped IPv6, empty/undefined.

**R-SEC-2 (P0, S1) Token rotation.** The first commit (`5c4a716`) contains `config.js` with a real Plex token; it remains in git history. The owner must rotate the token (a human act, `mode: hitl`) and record the receipt. Purging history (`git filter-repo` plus force-push) is optional, `irreversible`, and offered only if the owner chooses it (Q8).
- `docs/security/token-rotation.md` records the date and "old token rejected" proof (HTTP 401 from plex.tv for the old token).
- If the owner opts in to a purge, no commit reachable from any ref contains `config.js`.

### Real-server validation

**R-VAL-1 (P0, V1) Core validation against a real Plex server.** Only the mock has been exercised. A human runs the checklist (`docs/validation/real-server-core.md`) against a real server and the real plex.tv: sign-in PIN flow, server discovery and `firstReachable` connection choice, CORS on the `/photo/:/transcode` blob download (so cache-first works instead of `directImages` fallback), `/status/sessions` shape, behaviour over http LAN vs https `plex.direct`. Failures become new fix phases through the orchestrator's reconcile step.

**R-VAL-2 (P3, V1) Extended validation.** `docs/validation/real-server-extended.md` covers everything marked (verify) below: `contentRating` filter parameter and values, `totalSize` for library counts, `viewOffset`/`duration`/`Player.title`, Chromium flag names, and (optional, on a Pi) CEC/vcgencmd/wlr-randr/ddcutil commands.
- Both result files contain no `PENDING` marker and each ends with an `Overall: PASS` or `Overall: FAIL (<phase to open>)` line written by the human.

### Settings UI

**R-SET-1 (P2, U1) Connected summary.** When `isConfigured()` the settings sheet opens with a summary card "Connected to {serverName} · {libraryName} · Change" instead of the Sign-in button. "Change" reveals the existing sign-in and manual controls. First run (not configured) is unchanged.

**R-SET-2 (P2, U2) Time in minutes.** "Change poster every" becomes a preset group 1 / 5 / 15 / 60 minutes plus "Custom…" (a number field in minutes). Storage stays `rotateSeconds` (no migration); a stored value that matches no preset selects Custom and shows minutes (fractional allowed to one decimal; minimum 10 s still enforced by the schema).

**R-SET-3 (P2, U3) Advanced fold.** Now-playing poll interval, random pool size and cross-fade move into a collapsed "Advanced" `<details>`; the content is unchanged and still reaches `read()`.

**R-SET-4 (P2, U4) Library labels with counts.** Options read "Movies · 1,240 titles", from `/library/sections/{key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0` and its `totalSize` attribute **(verify)**. If the count is missing or the request fails, the label falls back to the title alone. Counts load lazily and never block the connection test.

**R-SET-5 (P2, U5) Direct poster positioning.** A "Position poster" mode collapses the sheet to a slim bar (a modal dialog's backdrop would swallow pointer events) and enables: drag on the poster to move it, arrow keys to nudge by 0.1 % (Shift = 1 %), `+`/`-` for size. The pure drag-to-percent maths lives in a new module with unit tests. Sliders remain.
- Dragging the poster by 100 px on a 1000 px stage changes `posterOffsetX` by 10 % (rotation 0) and by the equivalent rotated amount at 90/180/270.
- Esc or Done restores the sheet with the new values; Cancel on the sheet reverts them.

**R-SET-6 (P2, U14) Errors carry their fix.** `kind: 'auth'` (token rejected) shows a **Sign in again** button that opens settings and starts the PIN flow; `kind: 'network'`/`'timeout'` shows **Diagnostics** and **Test connection** buttons; `kind: 'empty'` offers **Turn off "unwatched only"**. This applies to the empty-state card, the connection test result and the toast.

### Controls and input

**R-CTRL-1 (P2, U11) Control labels.** Each control button gets a visible `title` on hover/focus (a CSS tooltip, not only the native title) and, on touch devices (`(hover: none)`), a visible text label under the icon. Setting `controlLabels` (`auto` default: labels on touch only; `always`; `never`).

**R-CTRL-2 (P2, U12) First tap only wakes.** With controls hidden, a tap anywhere (including on a control's position) only reveals the controls; no action fires. The `click` generated after the revealing `pointerdown` is swallowed. A second tap activates. Mouse and keyboard behaviour is unchanged.

**R-CTRL-3 (P2, U13) Shortcut overlay.** Pressing `?` (or a "Keyboard shortcuts" button in Diagnostics and a `?` control hint) opens a dialog listing every shortcut, generated from the same table that drives `KEYS` in `js/main.js` so the two cannot drift. Esc closes. Disabled shortcuts (R-KIOSK-1) are not listed.

### Frame, brightness and bulbs

**R-FRM-1 (P3, U8) Frame per poster source.** The header says "Now Showing" while something plays and "Coming Attractions" for random picks. New setting `frameIdRandom` (`''` = same as `frameId`). Source mapping: `now-playing` and `static` use `frameId`; `random` and `cache` use `frameIdRandom` when set. The cross-fade between frames follows the poster fade. New artwork is the user's asset by recommendation (Q4): a hitl phase delivers `assets/frames/marquee-coming-attractions.png`; until it exists the feature is inert and the app behaves as today. A built-in frame must never be registered in `FRAMES`/`sw.js` before its PNG exists (a missing file fails the service-worker install).

**R-FRM-2 (P1, E5) Frame rotation.** Setting `frameRotation` (`off` default, `daily`, `weekly`) with `frameRotationIds` (comma-separated frame ids; empty = all built-ins). The chosen frame is a pure function of the local date, so a reload never changes it mid-day. It applies at local midnight (daily) or Monday 00:00 (weekly), by cross-fading.

**R-FRM-3 (P1, E3) Animated bulbs.** Varies the brightest static pixels (the 50-odd bulbs in the marquee PNGs). The frame is a raster PNG, so bulbs are located at runtime: after the frame image loads, a pure `detectBulbs()` in `js/frames.js` samples a downscaled canvas (same technique as `detectFromImage` in `js/display.js`), thresholds bright warm pixels and returns blob centroids as percentages. A `#bulbs` layer of at most 80 absolutely positioned dots (radial-gradient, `mix-blend-mode: screen` off by default) is animated with CSS keyframes that change **opacity only** (compositor-thread, no layout/paint), with staggered delays so a slow twinkle/chase runs over a 6-10 s period at 35-100 % opacity. Setting `bulbAnimation` (default true). Disabled when `prefers-reduced-motion: reduce`, when the frame is `none` or cross-origin (canvas tainted), and while asleep. Cost target: no measurable main-thread work while idle; at most 80 layers.
- `detectBulbs` on a synthetic image with 10 bright squares returns 10 centroids within 1 % of truth; on `assets/frames/marquee.png` it returns at least 40 bulbs, all inside the frame border (outside the poster window).
- With animation on, `#bulbs` children exist and use only `opacity` in their keyframes (probe the stylesheet).

**R-FRM-4 (P1, E4) Frame brightness.** Setting `frameBrightness` (10-100, default 100) applies `filter: brightness()` to the frame image only (a static layer: rasterised once, not per frame). Night dim: `nightDim` (default false), `nightDimStart` 22:00, `nightDimEnd` 07:00, `nightDimLevel` 60; evaluated every minute and eased over 60 s so the change is not a jump. The poster is untouched. With the device helper (R-HELP-1) a "real brightness" option may drive hardware brightness; it is a separate toggle.

### Now playing and overlays

**R-NP-1 (P3, U9) Now-playing extras.** A 3 px progress bar along the bottom edge of the poster window (inside `.stage`, so it moves with pixel shift) driven by `viewOffset`/`duration` from `/status/sessions`, extended between polls with a linear CSS transition and frozen while the session is paused. A "Playing in {Player.title}" label in the info area (setting `showPlayer`, default false; `showProgress` default true). `pickNowPlaying` / `toPoster` carry `viewOffset`, `duration`, `playerTitle`; the engine exposes the latest session snapshot even when the poster does not change.
- With the mock playing item 3 at offset 600 s of 6000 s, the bar is at 10 % (±1 %) and advances after a poll with a later offset; paused freezes it; stop removes it.

**R-NP-2 (P2, U10) Metadata overlay instead of duplicate title.** The title overlay duplicates the title printed on posters. `showTitle` stays (default false, unchanged behaviour); new `showMeta` (default false) shows content rating, runtime and year, e.g. "PG-13 · 2 h 14 m · 1993", in the same overlay slot. Missing fields are omitted. Poster descriptors and the poster-cache index carry `contentRating`, `duration`, `year`.

### Fill modes

**R-FILL-1 (P3, U7) Landscape fill: blur and info panel.** `fillMode` (`none` default). `blur`: a backdrop made from the current poster, downscaled once to a tiny canvas (about 24 px wide) and scaled up by CSS (smooth upscaling is the blur; **no `filter: blur()` or `backdrop-filter`**, which are expensive on a Pi GPU), dimmed to at most 25 % brightness for OLED safety. `info`: a side panel (title, tagline/summary trimmed to 300 chars, runtime, rating, year) beside the poster, shown only when the effective aspect is landscape. Both are off in portrait. Crossfade follows the poster.

**R-FILL-2 (P3, U7) Landscape fill: multiple posters.** `fillMode: multi` with `fillCount` 2-3 shows N framed posters side by side on landscape (rotation-aware). The centre one is the now-playing/pinned poster when present; others are distinct random picks. Architecturally invasive (`display.js` assumes one stage); delivered as its own droppable phase (Q12).

### Remote configuration

**R-REM-1 (P3, U6) Configure from a phone.** The display shows a QR code in Settings and in the first-run empty state. The phone opens a small standalone page and changes non-secret settings (rotation presets, frame, rotation, fill mode, sleep schedule, brightness, content rating, next/pause/pin). Transport (Q2, recommended): `scripts/serve.mjs --remote` starts a second LAN listener that serves only the phone page and `/__remote/*`; the display page (loopback) polls the loopback-only `GET /__remote/pending` and applies patches through `applySettings`. Safeguards: one-time pairing code (6 digits, rotates every 10 min, single use per session), 5 wrong attempts lock for 60 s (doubling), key allowlist that excludes `plexToken`, `serverUrl`, `settingsPinHash`, `settingsPinSalt`; QR encodes `http://{lan-ip}:{port}/?c={code}` only; the token never leaves the display. With no `--remote` server the QR section is hidden (static hosting keeps working). Plain HTTP on the LAN exposes the code to sniffing; the doc says so, and notes it conflicts with an isolated IoT VLAN (R-DOC-5).
- A phone-page POST with a wrong code is rejected and the pending queue stays empty; with the right code, a patch containing `plexToken` is rejected whole; a patch with `rotation: 90` is applied by the display within 10 s (polling).
- QR round trip: the encoder output decodes to the exact URL (test-time decoder is a devDependency, Q3).

### Sleep and protection

**R-PROT-1 (P1, E1) Sleep.** Two triggers, either sufficient: a daily schedule (`sleepEnabled`, `sleepStart`, `sleepEnd`; windows may cross midnight; device local time) and idle sleep (`idleSleepHours` > 0 hours with no playback; 0 = off). Asleep means: a pure black full-screen veil (`#sleep-veil`), controls and status hidden, poster fetches suspended (now-playing polling continues, at most every `nowPlayingPollSeconds`), bulbs stopped, the screen wake lock **released** so OS/TV power saving can act, and (when available) display power off through the helper (R-HELP-1). Wake: playback starts (`wakeOnPlayback`, default true, also during the scheduled window), the scheduled window ends, or a user touch/key/click (manual wake for 60 s, then back to sleep if the trigger still holds). On wake, the wake lock is re-acquired and a poster is fetched at once. Defaults: schedule off, idle sleep off, **Recommended protection** sets 01:00-07:00 and 3 h idle.
- Pure state machine `decideSleep({now, settings, lastPlaybackAt, playingNow, manualWakeUntil})` is unit tested for midnight-crossing windows, idle expiry, playback wake, manual wake.
- E2E with a fake clock: at 02:00 inside the window the veil is visible and the (stubbed) wake lock is released; `POST /__mock/play` wakes within one poll interval and the wake lock is held again.

**R-PROT-2 (P1, E2) Pixel shift / orbit.** The stage moves a few pixels every `pixelShiftMinutes` (default 3) along a fixed 9-point orbit that never repeats the same position consecutively. This requires a margin: when `pixelShift` is on (default true) `stageSize()` sizes the stage to 97 % of the available box (a 1.5 % margin per side), giving about ±1.5 % of travel (about 16 px on a 1080-wide screen). The offset uses the individual `translate` property (applied before `rotate`, so it is in screen space at every rotation). Pure `shiftOffset(step, marginPx)` is unit tested: bounded by the margin, no immediate repeats, covers all 9 points. Shift steps use no animation longer than 2 s.
- With `pixelShift` on, the stage bounding box stays inside the viewport at every step and rotation; with it off, `stageSize` output equals today's.

**R-PROT-3 (P1, E10) Daily self-reload.** `dailyReload` (default true) reloads the page at `dailyReloadTime` (04:00 local) and on the first wake from sleep if the last reload was more than 12 h ago, but never while settings or diagnostics are open. State survives (settings are in localStorage; pause is intentionally not).

**R-PROT-4 (P1, E9) No expensive compositing.** Remove `backdrop-filter: blur(8px)` from `.sheet` (replaced by a slightly more opaque panel). No new rule may use `backdrop-filter` or animated `filter`.

**R-PROT-5 (P1) Recommended protection preset.** One button in Settings > Display protection applies: sleep 01:00-07:00, idle sleep 3 h, night dim on at 60 %, pixel shift on, bulbs on, daily reload on, max content rating PG-13. It shows what it changes before saving. It never touches the connection.

### Device helper

**R-HELP-1 (P1, E6) Optional Pi helper.** `scripts/device-helper.mjs`, mounted by `scripts/serve.mjs --helper`, provides what a page cannot: display power, real brightness, CPU temperature. All endpoints are under `/__helper/`, answer only loopback peers whose `Host` is loopback, require the custom header `X-Poster-Helper: 1` (forces a CORS preflight that is never granted, so other websites cannot drive it), and never use a shell (`execFile` with fixed argument arrays and validated numeric/boolean inputs). Strategies, each detected at start and overridable by flags **(verify all on hardware)**:
- Power: `cec-client` (`on 0` / `standby 0` through stdin), `vcgencmd display_power 0|1`, `wlr-randr --output <name> --off|--on`.
- Brightness: `ddcutil setvcp 10 <0-100>`, or write `/sys/class/backlight/*/brightness`.
- Temperature: `/sys/class/thermal/thermal_zone0/temp` divided by 1000 (`vcgencmd measure_temp` as fallback).
- `GET /__helper/status` returns `{power, brightness, temperature, tempC}` where each strategy field is the chosen strategy or `null`. A fake mode (`--helper-fake`) returns canned values and records calls for tests. Opt-in; documented in README.
- A non-loopback peer, a missing header, a bad Host or an out-of-range value gets 403/400 and runs no command (asserted with an injected fake `execFile`).

**R-HELP-2 (P1, E9) Integration and temperature.** `js/helper.js` probes `/__helper/status` at boot (404 or network error means "no helper", silent); when `deviceHelper` is on and the helper exists: sleep calls power off/on (R-PROT-1), Diagnostics shows "CPU temperature", and the brightness slider offers "Also set real screen brightness". All of it no-ops on static hosting.

### Kiosk

**R-KIOSK-1 (P1, E12) Kiosk mode and PIN.** `kioskMode` hides the controls entirely: pointer movement and taps never reveal them. A 3-second press-and-hold in the **bottom-right corner as the viewer sees it** (a 96x96 px zone mapped through `rotation` when `rotateUi` is on, Q1) reveals them for 15 s. `settingsPinHash`/`settingsPinSalt` hold a salted SHA-256 (Web Crypto; fallback to a plain pure-JS hash when `crypto.subtle` is unavailable on an insecure origin). When a PIN is set it is required to open Settings, Diagnostics, reset, import, and Show token. Five wrong tries lock for 60 s (doubling to 15 min). `disableShortcuts` ignores all keyboard shortcuts including `?`. A PIN is a deterrent against children and visitors; anyone with browser devtools or filesystem access can bypass it (stated in the UI and README, Q11).
- Unit tests: hash/verify, lockout schedule, corner-zone mapping at all four rotations.
- E2E: in kiosk mode `pointermove`/tap never adds `.visible`; a 3 s hold in the corner does; Settings then asks for the PIN; a wrong PIN does not open it.
- Export never includes `settingsPinHash`/`settingsPinSalt` even with "include token" ticked.

**R-KIOSK-2 (P1, E16) Show token behind the PIN.** `#token-toggle` ("Show") requires the PIN when one is set; it re-hides the field when the sheet closes.

### Content filter

**R-FILT-1 (P1, E14) Maximum content rating for random posters.** `maxContentRating` (`''` = no limit; `G`, `PG`, `PG-13`, `R`, `NC-17`). Applied to random pool loading only; now-playing and an owner-pinned poster are deliberate and not filtered. Request-side: Plex's `contentRating` filter on `/library/sections/{key}/all` **(verify parameter name, multi-value syntax and whether Plex normalises `TV-*` and country-prefixed values)**. Client-side safety net, always applied: after the response, drop items whose `contentRating` is above the limit on this ladder: `G=TV-Y=TV-G < PG=TV-Y7=TV-PG < PG-13=TV-14 < R=TV-MA < NC-17`; country-prefixed values (e.g. `gb/15`) and missing/unknown ratings are **excluded** while a limit is set (Q7). Because filtering shrinks the pool, the request oversamples (size x3, cap 500). The pool cache key includes the limit; an empty result produces the existing "No posters found" error with a hint to raise the limit.
- Unit tests over every ladder rung, unknown, country-prefixed, missing, and the oversample size.
- Against the mock (extended with `contentRating`, and honouring the filter parameter), a PG-13 limit never yields an R title across 50 picks.

### Documentation

**R-DOC-1 (P1, E7) Smart plug fallback.** README explains scheduling a smart plug (or router/TV timer) to cut power at night as the belt-and-braces to software sleep, including the caution about powering a Pi: shut down cleanly (cron/systemd) before power cut or use read-only root (R-DOC-2).
**R-DOC-2 (P1, E8) SD-card wear.** Cache-first is R-CACHE-1; README documents read-only overlay filesystem via `raspi-config` (Performance Options > Overlay File System) and keeping Chromium's disk cache in RAM (`--disk-cache-dir=/dev/shm/chromium-cache`, `--disk-cache-size=...`) **(verify)**.
**R-DOC-3 (P1, E11) Tablet battery.** README warns that tablets held at 100 % charge 24/7 risk battery swelling; use the vendor charge limit (e.g. 80 %) or a smart plug.
**R-DOC-4 (P1, E13) Kiosk flags.** README lists Chromium flags that stop swipe-back and pinch leaving the app: `--overscroll-history-navigation=0` and `--disable-pinch` **(verify names and that they still exist in the installed Chromium; newer builds may need `--disable-features=OverscrollHistoryNavigation`)**, with `--kiosk --noerrdialogs --disable-session-crashed-bubble --app=...`.
**R-DOC-5 (P1, E17) Network isolation.** README: put the display on an IoT/guest VLAN that can reach only the Plex server on port 32400 (and plex.tv over 443 if using sign-in or relay); notes that phone config (R-REM-1) needs the phone to reach the display, which isolation may block.
**R-DOC-6 (P1, E15) Managed user.** README: connect with a Plex Home managed user restricted to one library, so a stolen device's token exposes only that library.
**R-DOC-7 (P3) Feature docs.** README feature table, shortcut table, project layout and Roadmap.md updated to match what shipped.

### Release

**R-REL-1 (P3) Single version bump.** `VERSION` in `sw.js`, `js/main.js` and `package.json` is bumped to `2.1.0` once, in the final `release-bump` phase (decision; Q6). Every phase that adds a file to `js/` also adds it to `SHELL` in `sw.js` (CI already fails otherwise), checked by `scripts/check-precache.mjs`.

## Non-goals

| Non-goal | Reason |
|---|---|
| Multiple libraries mixed in the random pool, collections, genre/decade filters, "recently added" mode (Roadmap.md ideas) | Not in the findings; the library picker and pool code would change shape. Stay on the roadmap |
| Server-side PIN enforcement or real authentication | The app has no backend by design. The PIN deters casual use (Q11) |
| Hardware sleep without a helper | A web page cannot power a display; the page releases its wake lock and shows black, and docs recommend a smart plug (R-DOC-1) |
| Rotating the OS or compositor | Out of scope; the recommended Pi path is OS rotation with `rotateUi` off (R-ROT-2) |
| A native or Electron wrapper | Violates the zero-dependency, install-as-PWA principle |
| Generating "Coming Attractions" artwork by pixel-editing the PNG in Node | No zero-dependency PNG decoder/encoder; recommended path is a human-made asset (Q4) |
| Burn-in "guarantees" | Mitigations only; documented as such |
| Blurring with `filter`/`backdrop-filter` | Pi GPU cost; use the downscaled-canvas technique (R-FILL-1) |

## Settings model changes

All new keys are added to `SCHEMA` in `js/settings.js` in one phase (`settings-and-schedule-core`) with sanitisers that coerce bad input to the default, so later phases consume them and do not edit the schema. New helper sanitiser `hhmm` (`HH:MM`, 00:00-23:59, else default). Existing keys are unchanged. `EXPORT_VERSION` stays 1 (purely additive: older exports import with defaults; a new export imported by an older app has its unknown keys dropped by `sanitize`). `settingsPinHash` and `settingsPinSalt` are never exported, with or without the include-token tick (new `NEVER_EXPORT_KEYS`). `config.json` provisioning accepts all keys except those two.

| Key | Default | Rule | Protects / why | Req |
|---|---|---|---|---|
| `rotateUi` | `true` | bool | UI reads upright | R-ROT-2 |
| `statusIndicator` | `'dot'` | `dot`\|`off` | no static text | R-STAT-1 |
| `posterCacheLimit` | `100` | 10-300 | SD wear | R-CACHE-2 |
| `maxContentRating` | `''` (off) | `''`,G,PG,PG-13,R,NC-17 | kids; off so nothing vanishes | R-FILT-1 |
| `sleepEnabled` | `false` | bool | would blank the screen unasked | R-PROT-1 |
| `sleepStart` / `sleepEnd` | `'01:00'` / `'07:00'` | hhmm | | R-PROT-1 |
| `idleSleepHours` | `0` (off) | 0-48 | | R-PROT-1 |
| `wakeOnPlayback` | `true` | bool | | R-PROT-1 |
| `pixelShift` | `true` | bool | imperceptible | R-PROT-2 |
| `pixelShiftMinutes` | `3` | 1-60 | | R-PROT-2 |
| `bulbAnimation` | `true` | bool | varies brightest static pixels; subtle | R-FRM-3 |
| `frameBrightness` | `100` | 10-100 | | R-FRM-4 |
| `nightDim` | `false` | bool | visible change, so opt-in | R-FRM-4 |
| `nightDimStart` / `nightDimEnd` | `'22:00'` / `'07:00'` | hhmm | | R-FRM-4 |
| `nightDimLevel` | `60` | 10-100 | | R-FRM-4 |
| `frameRotation` | `'off'` | off\|daily\|weekly | visible change, opt-in | R-FRM-2 |
| `frameRotationIds` | `''` (all built-in) | string | | R-FRM-2 |
| `frameIdRandom` | `''` (= `frameId`) | string | | R-FRM-1 |
| `dailyReload` | `true` | bool | sheds Chromium memory growth; invisible | R-PROT-3 |
| `dailyReloadTime` | `'04:00'` | hhmm | | R-PROT-3 |
| `kioskMode` | `false` | bool | | R-KIOSK-1 |
| `disableShortcuts` | `false` | bool | | R-KIOSK-1 |
| `settingsPinHash` / `settingsPinSalt` | `''` | hex string | | R-KIOSK-1/2 |
| `deviceHelper` | `false` | bool | opt-in, runs commands | R-HELP-2 |
| `controlLabels` | `'auto'` | auto\|always\|never | | R-CTRL-1 |
| `showMeta` | `false` | bool | | R-NP-2 |
| `showProgress` | `true` | bool | | R-NP-1 |
| `showPlayer` | `false` | bool | | R-NP-1 |
| `fillMode` | `'none'` | none\|blur\|info\|multi | lit pixels on OLED, opt-in | R-FILL-1/2 |
| `fillCount` | `2` | 2-3 | | R-FILL-2 |

Each feature phase adds its own controls to the settings sheet (a new "Display protection" fieldset in `index.html` / `js/settings-ui.js` for the P1 keys); the schema phase adds keys only. Migration impact: none for stored settings (`load()` runs `sanitize`, which fills the new keys). Legacy-key migration is untouched. `showTitle` keeps its meaning. A 2.0.0 install upgrading to 2.1.0 therefore gains pixel shift, bulb animation and daily reload (all imperceptible) and nothing else.

Defaults that protect without surprising: pixel shift 3 min, bulb animation, daily reload 04:00, cache limit 100, status dot are on. Blanking, dimming, content limits, frame rotation, kiosk, helper and fill modes are off, reachable through R-PROT-5.

## Security and privacy

- **Token storage**: `localStorage` on the device. Never in URLs, QR codes, helper or remote responses, diagnostics (already truncated to 4 characters), or exports unless ticked.
- **Git history** holds an old token (S1): rotate it; purge optional.
- **`config.json`** is a token file: loopback-only (R-SEC-1), git-ignored, and README says to delete it after first run.
- **Local helper and remote servers** are the only listening surfaces: both are opt-in flags, share `isLoopback`, check `Host`, never use a shell, validate every input, and have no CORS grant. The remote listener is the only LAN-exposed surface and is allowlist-only.
- **PIN** is client-side deterrence, not authentication.
- **Least privilege Plex access**: managed user restricted to one library (R-DOC-6); IoT VLAN (R-DOC-5).
- **Privacy**: "Playing in {room}" and user names are shown on the display only; nothing is sent anywhere except to the user's own Plex server and plex.tv for sign-in.

## Open questions

Each has a recommended default, its cost, and the phases it blocks. They are also appended to `.orchestrator/questions.md`.

| # | Question | Options | Recommended default and cost | Blocks |
|---|---|---|---|---|
| Q1 | F2: rotate the whole UI shell, or make OS rotation the recommended path and rotate the stage only? | A rotate shell and dialogs; B stage only, document OS rotation | **A**, with `rotateUi` to turn it off and OS rotation documented for Pi. Cost: top-layer `<dialog>` ignores ancestor transforms, so each dialog needs its own rotated width/height rules (about 60 lines CSS, e2e-covered) | `ui-rotation-shell`, `kiosk-and-pin` (corner mapping) |
| Q2 | U6: how do phone settings reach a static-app display? | A `serve.mjs --remote` LAN listener with pairing code; B one-time settings link (blob in URL hash) that the owner types/scans into the display; C no remote | **A**. Cost: needs the Node server on the display; plain-HTTP LAN; conflicts with an isolated VLAN. B cannot carry phone to display without a channel | `remote-config-server`, `remote-config-ui` |
| Q3 | QR encoder: vendor a library or write one? | A vendor `qrcode-generator` (MIT, single file, pinned) under `js/vendor/` with licence; B hand-written minimal encoder; C server renders SVG | **A** + `jsqr` as a devDependency for round-trip tests. Cost: about 40 KB precached, one vendored runtime file (breaks "zero deps" in letter; needs `/tool-fit review`) | `remote-config-ui` |
| Q4 | U8: who produces the "Coming Attractions" frame? | A user draws it (hitl); B generated by text-swapping the header band | **A**. Cost: feature inert until the user supplies the PNG; B needs a PNG encoder/decoder or a dependency and risks a poor result | `coming-attractions-artwork`, `coming-attractions-register` |
| Q5 | e2e harness dependency | A devDependency `playwright@1.56.1` + fallback to the global install; B global only; C no browser tests | **A**. Cost: `npm install` fetches a dev-only package; the harness resolves the global copy at `/opt/node22/lib/node_modules/playwright` when the local one is absent; runtime stays dependency-free | `e2e-harness` |
| Q6 | When to bump `VERSION` (`sw.js`, `js/main.js`, `package.json`)? | A once, in a final `release-bump`; B in every phase that changes precached files | **A**. Cost: installed clients do not auto-update mid-development; benefit: phases do not conflict on three version strings | `release-bump` |
| Q7 | E14: unrated/unknown or country-prefixed ratings when a limit is set | A exclude; B include; C map known prefixes | **A (exclude)**. Cost: libraries with unrated or foreign-rated films shrink; the empty-pool error explains it | `content-rating-filter` |
| Q8 | S1: purge `config.js` from git history? | A rotate only; B rotate + `git filter-repo` + force-push | **A**; B only if the repo is shared or public. Cost of B: rewrites every SHA, breaks open clones, irreversible | `purge-git-history` |
| Q9 | E1: should playback wake the display during the scheduled sleep window? | A yes; B no (stay black until window ends) | **A** (`wakeOnPlayback`). Cost: a late-night movie wakes the screen | `sleep-mode` |
| Q10 | Which protections default on? | table in *Settings model changes* | As tabled (imperceptible on, noticeable off, preset in one tap). Cost: a new 24/7 install is not blanked at night until the owner presses Recommended protection | `settings-and-schedule-core` |
| Q11 | Is a client-side PIN acceptable? | A yes, documented as deterrence; B also require a helper-side check | **A**. Cost: devtools/filesystem access bypasses it | `kiosk-and-pin` |
| Q12 | Keep U7 option "2-3 posters side by side"? | A include as its own phase; B drop | **A, droppable**. Cost: large change to `display.js`; schedule last in P3 | `multi-poster-layout` |
| Q13 | V1 is fix-first but the contentRating/totalSize/viewOffset checks cannot be run until those features exist. Split into two hitl phases? | A core in P0, extended in P3; B one phase at the end | **A**. Cost: the human is asked twice; benefit: sign-in/CORS/discovery problems surface before anything is built on them | `real-server-validation`, `real-server-validation-extended` |

### (verify) list carried into V1

Plex `contentRating` filter parameter and multi-value syntax (R-FILT-1); `totalSize` with `X-Plex-Container-Size=0` (R-SET-4); `viewOffset`, `duration`, `Player.title` in `/status/sessions` (R-NP-1); `X-Plex-Container-Size` oversampling limits; plex.tv endpoints used by sign-in over https; Chromium flags (R-DOC-4, R-DOC-2); `cec-client`, `vcgencmd display_power` on KMS drivers, `wlr-randr` output names, `ddcutil` VCP 0x10, backlight sysfs permissions (R-HELP-1); individual `translate` property support in the target Chromium (R-PROT-2); Plex "sign out of all devices" rotating the account token (R-SEC-2); plex.tv `GET /api/v2/user` returning 401 for a revoked token (R-SEC-2).

## Traceability matrix

| Finding | Requirement(s) | Plan phase(s) |
|---|---|---|
| F1 | R-ROT-1 | `layout-rotation-fix` |
| F2 | R-ROT-2 | `ui-rotation-shell` |
| F3 | R-CACHE-1, R-CACHE-2 | `cache-first-fetch` |
| F4 | R-SEC-1 | `serve-config-guard` |
| F5 | R-STAT-1 | `status-indicator` |
| S1 | R-SEC-2 | `rotate-plex-token`, `purge-git-history` |
| V1 | R-VAL-1, R-VAL-2 | `validation-checklists`, `real-server-validation`, `real-server-validation-extended` |
| U1 | R-SET-1 | `connection-card-and-libraries` |
| U2 | R-SET-2 | `settings-time-and-advanced` |
| U3 | R-SET-3 | `settings-time-and-advanced` |
| U4 | R-SET-4 | `connection-card-and-libraries` |
| U5 | R-SET-5 | `position-drag-nudge` |
| U6 | R-REM-1 | `remote-config-server`, `remote-config-ui` |
| U7 | R-FILL-1, R-FILL-2 | `fill-blur-and-info`, `multi-poster-layout` |
| U8 | R-FRM-1 | `frame-per-source`, `coming-attractions-artwork`, `coming-attractions-register` |
| U9 | R-NP-1 | `now-playing-extras` |
| U10 | R-NP-2 | `metadata-overlay` |
| U11 | R-CTRL-1 | `touch-and-labels` |
| U12 | R-CTRL-2 | `touch-and-labels` |
| U13 | R-CTRL-3 | `touch-and-labels` |
| U14 | R-SET-6 | `actionable-errors` |
| E1 | R-PROT-1 | `sleep-mode` |
| E2 | R-PROT-2 | `pixel-shift` |
| E3 | R-FRM-3 | `bulb-animation` |
| E4 | R-FRM-4 | `frame-brightness` |
| E5 | R-FRM-2 | `frame-rotation` |
| E6 | R-HELP-1, R-HELP-2 | `device-helper-server`, `device-helper-integration` |
| E7 | R-DOC-1 | `docs-hardening` |
| E8 | R-CACHE-1, R-DOC-2 | `cache-first-fetch`, `docs-hardening` |
| E9 | R-PROT-4, R-HELP-2 | `pi-stability`, `device-helper-integration` |
| E10 | R-PROT-3 | `pi-stability` |
| E11 | R-DOC-3 | `docs-hardening` |
| E12 | R-KIOSK-1 | `kiosk-and-pin` |
| E13 | R-DOC-4 | `docs-hardening` |
| E14 | R-FILT-1 | `content-rating-filter` |
| E15 | R-DOC-6 | `docs-hardening` |
| E16 | R-KIOSK-2 | `kiosk-and-pin` |
| E17 | R-DOC-5 | `docs-hardening` |

Supporting requirements with no finding of their own: R-PROT-5 (`recommended-protection-preset`), R-DOC-7 (`docs-features`), R-REL-1 (`release-bump`).
