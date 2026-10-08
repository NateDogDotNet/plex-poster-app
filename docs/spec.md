# Plex Poster Display — Product and Technical Spec

Baseline: commit `3a7b688` (v2.0.0, PWA rewrite). Run start: `46257c3` (the commit that recorded the owner's rulings). Target: v2.1.0. Companion plan: `docs/integration-plan.md`. Binding rulings: `docs/decisions.md` (D1-D16); every behaviour below that a ruling set cites its D-entry.

Revision r3 (planning re-dispatch): lean scope per D1, rulings D2-D16 applied, the r1 review findings closed, and the r2 confirmation findings (N1-N10) closed. Q19-Q23 were settled by the conductor at the r2 confirmation (see *Open questions*).

## Goal

A poster display that can run unattended, 24/7, on any screen in the house without damaging that screen, leaking the owner's Plex access, or needing a keyboard to set up.

## Personas and use cases

| Persona | Setup | What matters |
|---|---|---|
| **Hallway-OLED owner** | 55" OLED mounted in portrait, Raspberry Pi 4 behind it running Chromium `--kiosk`, on 24/7, kids in the house | No burn-in (static frame, status text), no SD-card wear, screen off when nobody is home, kids cannot reconfigure or reach the token, random posters stay age-appropriate, no keyboard on the device |
| **Wall-tablet owner** | Android/iPad tablet in a stand, installed PWA, touch only | Touch-friendly controls (no accidental taps), battery safety when always charging, swipe-back or pinch must not leave the app, config from the tablet itself |
| **Landscape-TV owner** | 1920x1080 TV driven by a Pi or Chromecast-class browser, rotation 0 or a screen mounted sideways | A portrait poster fills only about a third of the screen, so fill modes matter. Rotation must not clip. Remote-control (D-pad) navigation, no mouse |

Use cases: UC1 show what is playing now; UC2 rotate random posters when idle; UC3 survive Plex or network outages; UC4 first-time setup without a keyboard (R-FIRST-1, D3); UC5 leave it alone for months; UC6 hand the device to a household with children.

## Principles

1. **Zero runtime dependencies, no build step.** Plain ES modules, static files. Dev-only dependencies (the Playwright e2e harness) are allowed, must appear only under `devDependencies`, and need a committed `package-lock.json` (D15).
2. **Works offline and with no backend.** The app is fully functional as static files. Anything that needs a process (the device helper) is opt-in, loopback-only, and the app degrades silently when it is absent.
3. **Protect the hardware by default.** Imperceptible protections default on; protections the user would notice (blanking, dimming, content limits) default off but are one tap away (R-PROT-5; the content limit is its own toggle, D5).
4. **Secrets stay off the display surface.** The Plex token is never placed in a QR code, an export (unless ticked), a log line, a helper response or a receipt. It does appear in Plex request URLs (`X-Plex-Token` query parameter, and in `<img src>` when `directImages` is on) because the Plex API and `<img>` need it; this is by design and not changed here. Any command a human runs against plex.tv sends the token as a header, never in a URL.
5. **Match the existing idiom.** Pure logic in small modules with `node --test` tests; DOM glue in `main.js`, `display.js`, `settings-ui.js`.
6. **Facts we cannot verify here are marked (verify)** and collected in `docs/validation/` for the hardware/real-server phases.

## Supported topologies

**R-TOPO-1 (P1, sceptic M2) Which device setups are supported.** A page served over plain `http://<lan-ip>` is an insecure context: no service worker, no install prompt, no Cache API (so no offline posters), no Wake Lock, no `crypto.subtle` (the PIN uses a fallback hasher, R-KIOSK-1). The supported topologies are:
- **Kiosk Pi, local server:** Chromium on the Pi opens `http://localhost:8080` served by `scripts/serve.mjs` on the same Pi. `localhost` is a secure context, so everything works.
- **Installed tablet or TV browser:** the app must be hosted over https (any static host) so it is a secure context; Plex is then reached through its `*.plex.direct` https address after sign-in. `serve.mjs` features (config guard, helper) do not apply to this topology.
- **Tablet loading the Pi's http LAN address:** works as a plain web page only; the docs say what is lost and recommend one of the two topologies above.
- Acceptance: the README has a "Supported setups" section naming these three topologies and the missing capabilities for the third (checked by `docs`); Diagnostics shows `Secure context: yes|no` and `Service worker: controlling|none` (checked in `pi-stability`).

## Requirements

Priorities: **P0** fix-first, **P1** protection, **P2** polish, **P3** bigger features. Each requirement names the finding IDs it answers. Every requirement carries acceptance bullets written so a script can check them; the plan turns them into commands. Pixel shift (R-PROT-2) is on by default, so every e2e spec that measures stage geometry runs with `pixelShift:false` seeded by the harness unless it is testing pixel shift.

### Rotation and layout

**R-ROT-1 (P0, F1) Rotated stage stays centred and on screen.** `.stage` is a flex/grid child of `.app` (`css/app.css`); at rotation 90/270 on a landscape viewport the stage is laid out at swapped dimensions (`stageSize()` in `js/layout.js`), so its layout box (e.g. 1080x1687 in a 1920x1080 viewport) is taller than the container, grows the grid row, and the rotated result lands about 300 px low and clipped. Fix: take the stage out of flow and centre it on the viewport centre (absolute at 50%/50% with `translate(-50%, -50%)` composed in `transform` before `rotate`; the individual `translate` property stays free for pixel shift).
- At 1920x1080, 1080x1920 and 1280x800, for each rotation 0/90/180/270 with `pixelShift:false`: `#stage` and `#frame` bounding boxes lie inside the viewport (tolerance 1 px) and their centre is within 1 px of the viewport centre.
- The stage's rotated bounding box is the largest that fits the viewport for that rotation: its limiting dimension equals the viewport dimension within 2 px.
- `.app` has no scroll overflow (`scrollHeight == clientHeight`).
- Existing `tests/layout.test.js` still passes unchanged.

**R-ROT-2 (P0, F2; D2) The UI shell rotates with the stage.** Controls, toast, status indicator, empty-state card, Settings sheet, Diagnostics and every new dialog read upright for the viewer at rotation 90/180/270. Setting `rotateUi` (default true) turns this off for users who rotate the OS instead (documented as an option; OS rotation with `rotateUi` off and app rotation 0 stays supported).
- With rotation 90, 180 and 270 and `rotateUi` true, the computed transform angle of each of `#controls`, `#toast`, `.empty-card`, `#settings`, `#diagnostics` and `#status-dot` (checked in `status-indicator`, where the dot is created) equals the stage rotation, and each element's bounding box (opened/visible) lies inside the viewport.
- The controls bar sits at the viewer's bottom-right at every rotation.
- With `rotateUi` false, none of those elements carries a rotation.
- Rotation 0 layout is unchanged (bounding boxes equal the `rotateUi:false` values).
- A top-layer `<dialog>` ignores ancestor transforms, so each dialog gets its own rotation rule driven by `--ui-rotation`, `--vw`, `--vh` set by `display.layout()`. The backdrop stays full-screen.

### Status indicator

**R-STAT-1 (P0, F5) No persistent status text.** `#status` (re-rendered every second with a countdown) becomes: visible only while the controls are visible; otherwise, when there is something to report (paused, offline), a small low-contrast dot (`#status-dot`, at most 8 px, at most 40% opacity) that changes corner position on a slow cycle (every 5 minutes, by whole steps). When all is well and controls are hidden nothing is drawn. The 1 s `setInterval(updateStatus)` in `js/main.js` runs only while the pill is visible. Setting `statusIndicator` (`dot` default, `off`). On by default (D6).
- With the mock server stopped and controls idle-hidden, `#status` is hidden, `#status-dot` is visible and no larger than 8x8 px with opacity at most 0.4; after waking the controls `#status` shows the retry countdown.
- With everything healthy and controls hidden, neither element is visible, and a `MutationObserver` on `#status` records 0 mutations over 3 s.
- The dot's corner differs after the cycle interval (fake clock) and is always inside the viewport; `statusIndicator:'off'` hides it.

### Poster cache and SD-card wear

**R-CACHE-1 (P0, F3, E8) Cache-first poster fetch.** `fetchImage()` in `js/main.js` must consult `poster-cache.js` before the network. A cache entry is valid when its stored `thumb` equals the requested poster's `thumb` (Plex changes the thumb path when artwork changes) and its stored pixel size is at least the requested size. On a hit nothing is downloaded and nothing is written to the Cache API. On a miss the existing download-and-put path runs. Corner cases: `directImages` mode (CORS blocked) is unchanged; a cache read error falls back to the network. On by default (D6).
- Showing 8 distinct posters 3 times each causes at most 8 `/photo/:/transcode` requests (counted by the mock's stats endpoint) and at most 8 Cache API writes.
- Unit tests cover: hit, miss, thumb changed, stored smaller than requested, stored larger, storage error.
- A poster whose artwork changed is re-downloaded exactly once.

**R-CACHE-2 (P0, F3) Cache sized to the pool.** New setting `posterCacheLimit` (default 100, range 10-300). `createPosterCache` reads the limit lazily so a settings change applies without reload. With the default random pool of 100 titles, steady state is zero downloads and zero writes per rotation (previously 288 of each per day at 5-minute rotation). Index metadata stores the pixel size.
- A unit test shows the limit read as a function on every `put` and eviction removing the evicted Cache API entries.
- After the 8 posters are cached and the page reloaded, showing the same 8 again produces 0 transcode requests.

### Security

**R-SEC-1 (P0, F4; D9) The local server serves only the app, and `config.json` only to loopback.** `scripts/serve.mjs` serves an **allowlist** of paths: `/` and `index.html`, `manifest.webmanifest`, `sw.js`, and anything under `css/`, `js/` and `assets/`. `config.json` is served only to a request whose socket peer address is loopback (`127.0.0.0/8`, `::1`, `::ffff:127.x`) **and** whose `Host` hostname is `localhost`, `127.0.0.1` or `[::1]`. Everything else (`.orchestrator/`, `docs/`, `README.md`, `package.json`, `tests/`, `scripts/`, dotfiles) is 404 for every client. The path is normalised (decoded, `.`/`..` resolved, trailing slash stripped, case-folded for the `config.json` test) before either rule is applied. The Host check compares the **hostname only** and ignores the port (browsers send `localhost:8080`); parse it with `new URL('http://' + host).hostname`. `X-Forwarded-For` and `Forwarded` are never consulted. Exports `isLoopback(addr)` and `isLoopbackHost(hostHeader)` from `scripts/net.mjs`, reused by R-HELP-1.
- Started with `--host 0.0.0.0`: `GET /config.json` from loopback with `Host: localhost:<port>` returns 200; from the machine's LAN address returns 403; a request from the LAN address that sends `X-Forwarded-For: 127.0.0.1` still returns 403; `GET /index.html` from the LAN address returns 200.
- From the LAN address, `/.orchestrator/x.md`, `/docs/spec.md`, `/package.json` and `/README.md` return 404, as do `//config.json`, `/./config.json`, `/%63onfig.json`, `/config.json/` and `/CONFIG.JSON` (none returns 200).
- A loopback peer sending `Host: evil.example` or `Host: localhost.evil.com` is refused for `config.json`; `Host: localhost:8080` and `Host: [::1]:8080` are accepted.
- Unit tests for `isLoopback` cover IPv4, IPv6, IPv4-mapped IPv6, empty and undefined; for `isLoopbackHost` cover with and without port. The integration test spawns the server on a free port, never a fixed one, so concurrent worktrees do not collide (D12).

**R-SEC-2 (P0, S1; D14) Token rotation.** The first commit (`5c4a716`) contains `config.js` with a real Plex token; it remains in git history. The owner must rotate the token (a human act, `mode: hitl`) and record a receipt. The hand-off lists both rotation routes **(verify which one revokes the leaked token)**: (a) plex.tv > Account > Authorized Devices, remove the device or sign out everywhere; (b) change the account password and tick "Sign out of connected devices". The owner's rejection check sends the token as an `X-Plex-Token` request header read from a file descriptor, never in a URL or on the command line. Purging history (`git filter-repo` plus force-push) is optional, irreversible, **skipped unless the owner says the repository is public or shared**, and outside the release path.
- `docs/security/token-rotation.md` records `Rotated: yes`, the date, the method and "old token rejected (HTTP 401)".
- The receipt contains no token-like string (no `X-Plex-Token` text and no alphanumeric run of 20 or more characters).
- If the owner opts in to a purge, a fresh clone of `origin` has no commit that touches `config.js`.

### Real-server validation

**R-VAL-1 (P0, V1; D11) Core validation against a real Plex server.** Only the mock has been exercised. A human runs the checklist (`docs/validation/real-server-core.md`) against a real server and the real plex.tv: sign-in PIN flow through the **Sign in with Plex** button, server discovery and `firstReachable` connection choice, CORS on the `/photo/:/transcode` blob download (so cache-first works instead of the `directImages` fallback), `/status/sessions` shape, behaviour over http LAN vs https `plex.direct`. The automatic first-run code (R-FIRST-1) is built by `settings-sheet`, which the core validation does not wait for, so it is checked in the extended file (R-VAL-2). Failures reopen the phase the failing row names.
- The file contains no `PENDING` and ends with exactly `Overall: PASS`. A FAIL keeps the phase open; it is never accepted.

**R-VAL-2 (P3, V1; D11) Extended validation.** `docs/validation/real-server-extended.md` covers the automatic first-run code (R-FIRST-1: unconfigured display shows the code, approving it at plex.tv/link signs in) and everything marked (verify) below: `contentRating` filter parameter and values (including country-prefixed values), `totalSize` for library counts, `viewOffset`/`duration`/`Player.title`, Chromium flag and policy names, package names on both Pi OS releases, and (rows marked `skip if no Pi`) `cec-ctl`/`cec-client`/`wlr-randr` power control with the compositor environment, `thermal_zone0`, and "window still full-screen after power off/on".
- The file contains no `PENDING`, may mark Pi-only rows `SKIPPED` with a reason, and ends with exactly `Overall: PASS`. A FAIL keeps the phase open.

### First run

**R-FIRST-1 (P2, UC4, sceptic I7; D3) Keyboardless first run.** When the app is not configured, it starts the plex.tv PIN flow automatically and shows the code **large and upright** on the empty-state card, refreshing it when it expires. The Settings dialog is not forced open. After approval the existing post-sign-in flow runs unchanged (server discovery, library choice). The card keeps an "Open settings" button for manual entry. Local-network discovery is not part of this plan (D3; Roadmap only).
- Unconfigured, with plex.tv intercepted by the test: the empty-state card shows the code (`#signin-code-large`) in a font at least 64 px tall without any click, a `POST /api/v2/pins` was made once, and Settings is not open.
- When the intercepted pin expires, a new code replaces it and exactly one new pin is created.
- At rotation 90 the code block is upright (transform angle equals the rotation, R-ROT-2).
- A configured app (or one provisioned by `config.json`, intercepted by `context.route`) makes no `/api/v2/pins` request.
- A plex.tv network failure does not loop: at most one retry every 30 s and no console error spam.

### Settings UI

**R-SET-1 (P2, U1) Connected summary.** When `isConfigured()` the settings sheet opens with a summary card "Connected to {serverName} · {libraryName} · Change" instead of the Sign-in button. "Change" reveals the existing sign-in and manual controls. First run (not configured) shows the sign-in controls as before.
- Configured: `#connected-card` is visible with the server and library names and a Change button, and `#signin-btn` is hidden until Change is pressed.
- Not configured: `#signin-btn` and the first-run hint are visible and `#connected-card` is hidden.

**R-SET-2 (P2, U2) Time in minutes.** "Change poster every" becomes a preset group 1 / 5 / 15 / 60 minutes plus "Custom…" (a number field in minutes). Storage stays `rotateSeconds` (no migration); a stored value that matches no preset selects Custom and shows minutes (fractional allowed to one decimal; the schema minimum of 10 s still applies).
- Preset buttons save 60/300/900/3600; Custom `2.5` saves 150; a stored 420 opens as Custom showing `7`; a value below 10 s clamps to 10.
- The rotation field's label no longer contains the word "seconds".

**R-SET-3 (P2, U3) Advanced fold.** Now-playing poll interval, random pool size and cross-fade move into a collapsed "Advanced" `<details id="advanced">`; the content is unchanged and still reaches `read()`.
- `details#advanced` is closed by default and contains `nowPlayingPollSeconds`, `randomPoolSize`, `crossfadeMs`; changing a field inside it and saving persists it.

**R-SET-4 (P2, U4) Library labels with counts.** Options read "Movies · 1,240 titles", from `/library/sections/{key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0` and its `totalSize` attribute **(verify)**. If the count is missing or the request fails, the label falls back to the title alone. Counts load lazily and never block the connection test.
- With the mock the option reads `Movies · 8 titles`; with the count request failing (HTTP 500) it reads `Movies` and the connection test still succeeds; Music is not listed.
- A unit test reads `totalSize` from JSON and XML containers and returns `null` on error or a missing attribute.

**R-SET-5 (P2, U5) Direct poster positioning.** A "Position poster" mode collapses the sheet to a slim bar (a modal dialog's backdrop would swallow pointer events) and enables: drag on the poster to move it, arrow keys to nudge by 0.1 % (Shift = 1 %), `+`/`-` for size. The pure drag-to-percent maths lives in a new module with unit tests. Sliders remain.
- Dragging the poster by 100 px on a 1000 px stage changes `posterOffsetX` by 10 % (rotation 0) and by the equivalent rotated amount at 90/180/270.
- ArrowRight nudges +0.1, Shift+ArrowRight +1.0; `+`/`-` change size; values clamp to [-100, 100].
- Esc or Done restores the sheet with the new values; Cancel on the sheet reverts them. Arrow keys do not trigger global shortcuts while in position mode.

**R-SET-6 (P2, U14) Errors carry their fix.** `kind: 'auth'` (token rejected) shows a **Sign in again** button that opens settings and starts the PIN flow; `kind: 'network'`/`'timeout'` shows **Diagnostics** and **Test connection** buttons; `kind: 'empty'` offers **Turn off "unwatched only"**. This applies to the empty-state card, the connection test result and the toast.
- Token `bad`: the empty-state card shows **Sign in again**; pressing it starts a pin request (intercepted plex.tv).
- Mock down: **Diagnostics** and **Test connection** appear and work.
- Mock empty: **Turn off "unwatched only"** appears; pressing it saves `unwatchedOnly:false` and refreshes. The connection-test result carries the same buttons.

### Controls and input

**R-CTRL-1 (P2, U11) Control labels.** Each control button gets a visible label: a CSS tooltip on hover/focus, and on touch devices (`(hover: none)`) a text label under the icon. Setting `controlLabels` (`auto` default: labels on touch only; `always`; `never`).
- With `(hover: none)` emulated, each of the 7 control buttons shows a text label; on desktop only a tooltip on hover/focus and no persistent label; `always`/`never` override.

**R-CTRL-2 (P2, U12; sceptic I10) First tap only wakes the controls.** The first tap swallows the click **only when all hold**: the controls were hidden when the pointer went down, the target is inside `#controls` (or is the bare stage), no dialog is open, and `pointerType !== 'mouse'`. The `click` generated after the revealing `pointerdown` is swallowed; a second tap activates. Mouse and keyboard behaviour is unchanged. A tap inside an open Settings or Diagnostics dialog, or on a button in the empty-state card, is never swallowed.
- Touch, controls hidden: a tap on the Settings button's position reveals the controls and does not open Settings; the second tap opens it; the same for Pin and Rotate (rotation unchanged after the first tap).
- Touch, Settings open for longer than the controls' hide delay: a tap on Save is not swallowed. Touch, empty-state card: a tap on "Open settings" is not swallowed.
- A mouse click on a visible button works on the first click.

**R-CTRL-3 (P2, U13) Shortcut overlay.** Pressing `?` (or a "Keyboard shortcuts" button in Diagnostics) opens a dialog listing every shortcut, generated from the same table that drives `KEYS` in `js/main.js` so the two cannot drift. Esc closes. With `disableShortcuts` the overlay is not listed or opened.
- The table has `r p space o f s d ?` with a label each and no duplicate keys; `listShortcuts({disableShortcuts:true})` is empty.
- `?` opens the dialog with at least 8 entries generated from the table (at rotation 90 `#shortcuts`' computed angle is 90 and its box lies inside the viewport); Esc closes it; with `disableShortcuts:true`, `?` does nothing.

### Frame brightness

**R-FRM-4 (P1, E4) Frame brightness and night dim.** Setting `frameBrightness` (10-100, default 100) applies `filter: brightness()` to the frame image. Night dim: `nightDim` (default **false**, D6), `nightDimStart` 22:00, `nightDimEnd` 07:00, `nightDimLevel` 60, and `nightDimTarget` (`frame` default | `stage`; `stage` also dims the poster, D6 "whole-poster dim option"). The level is recomputed **once a minute in whole steps** (no CSS transition and no animated filter, resolving the conflict with R-PROT-4): dimming ramps in over the first 10 minutes after `nightDimStart` and out over the last 10 minutes before `nightDimEnd`, so the change is never a jump. The filter is placed on `#frame` (target `frame`) or `#stage` (target `stage`) only. Schedules wait for a plausible clock (R-PROT-6). With the device helper there is no hardware brightness (dropped, D8).
- Pure `effectiveBrightness(now, settings)` is unit tested: manual level, night window incl. midnight crossing, the 10-minute ramps at both boundaries, `min` of manual and night level, `nightDim:false`, and a DST night.
- At 12:00 with `nightDim` on, `#frame` computes `filter: none`; at 23:00 `brightness(0.6)` (±0.02); `frameBrightness:50` gives `brightness(0.5)`; the poster layers have `filter: none` when the target is `frame`.
- With target `stage`, `#stage` carries `brightness(0.6)` at 23:00 and `#frame` carries none.
- `css/app.css` has no `transition` on `filter` and no `will-change: filter`.

### Now playing and overlays

**R-NP-1 (P2, U9) Now-playing extras.** A 3 px progress bar along the bottom edge of the poster window (inside `.stage`, so it moves with pixel shift) driven by `viewOffset`/`duration` from `/status/sessions`, extended between polls with one linear CSS transition and frozen while the session is paused. A "Playing in {Player.title}" label in the info area (setting `showPlayer`, default false; `showProgress` default true). `pickNowPlaying` / `toPoster` carry `viewOffset`, `duration`, `playerTitle`; the engine exposes the latest session snapshot even when the poster does not change. `viewOffset`, `duration` and `Player.title` are **(verify)**; Plex updates `viewOffset` only when the client reports its timeline (about every 10 s), so the bar may jump on a poll.
- With the mock playing item 3 at offset 600 s of 6000 s, `#progress` is at 10 % (±1 %) of the poster window and advances to 20 % after a poll with a later offset; paused freezes it; stop removes it; `showProgress:false` hides it; the bar is inside `#stage` and 3 px high.
- `showPlayer:true` shows `Playing in Living Room`; the default hides it.
- Unit tests: `pickNowPlaying` carries the three fields from JSON and XML sessions; the engine exposes the snapshot when the poster is unchanged; paused state is carried.

**R-NP-2 (P2, U10) Metadata overlay instead of duplicate title.** The title overlay duplicates the title printed on posters. `showTitle` stays (default false, unchanged behaviour); new `showMeta` (default false) shows content rating, runtime and year, e.g. "PG-13 · 2 h 14 m · 1972", in the same overlay slot. Missing fields are omitted. Poster descriptors and the poster-cache index carry `duration` and `year` (and `contentRating`, added by R-FILT-1).
- `showMeta:true` renders text matching `^PG-13 · 2 h 14 m · 1972$` for the mock's item 3; missing fields leave no stray separators; `showMeta:false` and `showTitle:false` hide the card; `showTitle:true` alone behaves as in 2.0.0.
- `formatRuntime(8040000)` is `2 h 14 m`, `formatRuntime(2880000)` is `48 m`, missing is empty.

### Fill modes

**R-FILL-1 (P2, U7) Landscape fill: blur and info panel.** `fillMode` (`none` default | `blur` | `info`). `blur`: a backdrop made from the current poster, downscaled once to a tiny canvas (48 px wide, which avoids visible banding at large scale) and scaled up by CSS (smooth upscaling is the blur; **no `filter: blur()` and no `backdrop-filter`**, which are expensive on a Pi GPU), dimmed to at most 25 % brightness for OLED safety. `info`: a side panel (title, summary trimmed to 300 characters, runtime, rating, year) beside the poster, shown only when the effective aspect is landscape. Both are off in portrait. Crossfade follows the poster. Multi-poster layouts are deferred (D1).
- 1920x1080, rotation 0, `blur`: `#fill-backdrop` exists with a canvas intrinsic width at most 64 px and effective brightness at most 0.25; no element has a computed blur `filter` or `backdrop-filter`.
- `info`: `#info-panel` shows title, runtime, rating, year and a summary of at most 301 characters; in a portrait viewport (or rotation 90 on a portrait screen that makes the effective aspect portrait) neither mode renders; `none` matches today.
- `isLandscape({w,h,rotation})` accounts for 90/270; `trimSummary(text, 300)` cuts on a word boundary with an ellipsis.

### Sleep and protection

**R-PROT-1 (P1, E1; D4) Sleep.** Two triggers, either sufficient: a daily schedule (`sleepEnabled` default **false**, `sleepStart`, `sleepEnd`; windows may cross midnight; device local time) and idle sleep (`idleSleepHours` > 0 hours with no playback; **0 = off, the default**; its help text says the screen stays black between movies). Asleep means: a pure black full-screen veil (`#sleep-veil`), controls and status hidden, poster fetches suspended (now-playing polling continues, at most every `nowPlayingPollSeconds`), and, when the device helper is on and available, display power off (R-HELP-2). **The screen wake lock stays held** while asleep so the panel stays lit and playback can wake it; releasing the wake lock is not used as a sleep mechanism, because re-acquiring a lock does not wake a screen the OS already blanked. The README tells Pi/Android users to turn OS screen blanking off. Wake: playback starts (`wakeOnPlayback`, default true, also during the scheduled window), the scheduled window ends, or a user touch/key/click (manual wake for 60 s, then back to sleep if the trigger still holds). On wake a poster is fetched at once. Schedules wait for a plausible clock (R-PROT-6).
- Pure state machine `decideSleep({now, settings, lastPlaybackAt, playingNow, manualWakeUntil, clockOk})` is unit tested: midnight-crossing windows, idle expiry at N hours, playback wake with `wakeOnPlayback` true and false, manual wake then back to sleep, `sleepEnabled:false` with `idleSleepHours:0` never sleeps, `clockOk:false` ignores the schedule but not idle sleep.
- E2E with a fake clock inside 01:00-07:00: `#sleep-veil` is visible and opaque black, controls hidden, `window.__wakeLock.held === true` with zero releases, no `/photo/:/transcode` request is made while asleep (counted with `page.on('request')`); `mock.play()` hides the veil within one poll interval and a poster is shown; idle sleep with `idleSleepHours:1` and 61 simulated minutes without playback sleeps; a key press wakes for 60 s then sleeps again; `wakeOnPlayback:false` keeps the veil during the window.
- Diagnostics shows the local time and `Sleep: awake|asleep (schedule|idle)`.

**R-PROT-2 (P1, E2; D6) Pixel shift with a glide.** The stage moves a few pixels every `pixelShiftMinutes` (default 3) along a fixed 9-point orbit that never repeats the same position consecutively. This requires a margin: when `pixelShift` is on (default **true**, D6) `stageSize()` sizes the stage to 97 % of the available box (a 1.5 % margin per side), giving about ±1.5 % of travel. The offset uses the individual `translate` property (composed before `rotate`, so it is in screen space at every rotation). Each step **glides** over 1.5 s (`transition: translate 1.5s ease-in-out`), not a jump, and the transition is removed under `prefers-reduced-motion`. Pure `shiftOffset(step, marginPx)` is unit tested.
- `shiftOffset` is bounded by the margin, never returns the same point twice in a row, visits 9 distinct points in 9 steps and is deterministic; `stageSize` with `margin: 0.015` is 97 % of the margin-less size on the limiting axis; without margin it equals today's output.
- With a fake clock and `pixelShiftMinutes: 3`, 20 steps at rotations 0 and 90 on 1920x1080 and 1080x1920 give at least 9 distinct `translate` values and stage and frame bounding boxes inside the viewport at every step (measured after the glide settles).
- `.stage` computes a `transition` that includes `translate` with a duration between 1 s and 2 s; with emulated reduced motion it does not.
- `pixelShift:false` leaves no `translate` and a stage equal to the margin-less size.

**R-PROT-3 (P1, E10; D6) Guarded daily self-reload.** `dailyReload` (default **true**) reloads the page at `dailyReloadTime` (04:00 local) and on the first wake from sleep if the last reload was more than 12 h ago, but never while settings or diagnostics are open and never during a fade. **Guard (D6):** the reload happens only when `navigator.serviceWorker.controller` is set **and** a `fetch('index.html', {cache: 'no-store'})` probe succeeds just before reloading (`sw.js` sends requests whose `cache` mode is `no-store` straight to the network instead of answering from the shell cache, so the probe really reaches the app server); otherwise it is skipped and the reason logged (an http LAN origin has no service worker, and a reload while the host is down would leave a dead browser error page). A guard against loops: `plexPoster.lastReload` is written before reloading and a second reload within 10 minutes is refused. Tablet note: in a browser tab (not an installed PWA) a reload drops Fullscreen API state, which needs a user gesture to re-enter; installed PWAs and `--kiosk` Chromium are unaffected, and the README says so. Schedules wait for a plausible clock (R-PROT-6).
- Fake clock 03:59:30, service worker allowed: a reload happens at 04:00; none while Settings or Diagnostics is open (retried after close); `dailyReload:false` none; with the **app server** unreachable at 04:00 (probe fails; the spec stops its own `serve.mjs` child, or aborts the probe with an offline emulation that also covers service-worker fetches; never `mock.down()`, which only stops the Plex mock) none and a logged skip; with service workers blocked (no controller) none and a logged skip.
- On wake from sleep with `plexPoster.lastReload` older than 12 h exactly one reload, newer none; after a reload settings persist and `paused` is cleared.
- A `fetch('index.html', {cache: 'no-store'})` from a page controlled by the service worker is served by the network: it fails when the app server is stopped, and `sw.js` still serves the cached shell to ordinary requests and navigations when it is.
- Diagnostics shows `Daily reload: active|skipped (reason)`.

**R-PROT-4 (P1, E9) No expensive compositing.** Remove `backdrop-filter: blur(8px)` from `.sheet` (replaced by a slightly more opaque panel). No rule may use `backdrop-filter`; no `filter` is animated or transitioned (brightness changes are stepped, R-FRM-4). Also `overscroll-behavior: none` on `html, body` (sceptic M9) as the in-page backstop for swipe-back (R-DOC-4).
- `css/app.css` contains no `backdrop-filter` and no `will-change: filter`.
- `html` and `body` compute `overscroll-behavior: none`.

**R-PROT-5 (P1; D4, D5, D6) Recommended protection preset.** One button in Settings > Display protection applies: sleep schedule on 01:00-07:00, night dim on at level 60 with target `stage` (Q20), pixel shift on, daily reload on. It shows what it will change before saving. **It does not turn on idle sleep (D4) and does not set a content limit (D5).** It never touches the connection, `maxContentRating` or `limitNowPlaying`.
- Clicking it lists the keys it will change; Cancel changes nothing; Apply then Save persists `sleepEnabled:true`, `sleepStart:'01:00'`, `sleepEnd:'07:00'`, `nightDim:true`, `nightDimLevel:60`, `nightDimTarget:'stage'`, `pixelShift:true`, `dailyReload:true`.
- `idleSleepHours`, `maxContentRating`, `limitNowPlaying`, `plexToken`, `serverUrl` and `libraryKey` are unchanged after Apply.

**R-PROT-6 (P1, sceptic M4/M5) Schedules wait for a plausible clock and survive DST.** A Pi has no RTC: until NTP syncs, local time can be years off. `isPlausibleClock(date)` is true for a year of 2026 or later (Q23); until it is true the sleep, night-dim and daily-reload schedules do nothing and Diagnostics says `Clock not set`. The schedule helpers (`inWindow`, `msUntilNext`) are correct across daylight-saving changes: a window of 01:00-07:00 on a change night, and a 02:30 job on a spring-forward night (the time does not exist) and a fall-back night (it occurs twice).
- Unit tests, run with `TZ=America/New_York` and `TZ=Europe/London`: simulating 400 consecutive days of fire-and-re-arm with `msUntilNext`, every local date fires exactly once for `04:00` and for `02:30`, `msUntilNext` is never negative or NaN, and `inWindow('01:00','07:00')` is true at 01:30 on both occurrences of 01:30 on a fall-back night.
- `isPlausibleClock(new Date(1970,0,1))` is false and `isPlausibleClock(new Date(2026,9,8))` is true.

### Device helper

**R-HELP-1 (P1, E6; D8) Optional Pi helper: power and temperature.** `scripts/device-helper.mjs`, mounted by `scripts/serve.mjs --helper`, provides what a page cannot: **screen power and CPU temperature**. Brightness control is dropped (D8: consumer TVs rarely implement DDC/CI and HDMI outputs have no backlight sysfs). All endpoints are under `/__helper/`, answer only loopback peers whose `Host` hostname passes `isLoopbackHost` (R-SEC-1), require the custom header `X-Poster-Helper: 1` (forces a CORS preflight that is never granted, so other websites cannot drive it), and never use a shell (`execFile` with fixed argument arrays and validated boolean inputs). The helper is loopback-only and opt-in (`--helper`). Power strategies, each detected at start and overridable by flags **(verify all on hardware)**:
- `cec-ctl` (v4l-utils, `/dev/cec0`, needs the `video` group): `cec-ctl -d /dev/cec0 --to 0 --standby` and `--image-view-on`.
- `cec-client` (libcec): `standby 0` / `on 0` through stdin.
- `wlr-randr --output <name> --off|--on`, run with the compositor environment passed through: `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR` taken from the helper's own environment or from `--helper-wayland-display` / `--helper-xdg-runtime-dir` (a `systemctl --user` service starts outside the compositor session and has neither).
- Temperature: `/sys/class/thermal/thermal_zone0/temp` divided by 1000 (`vcgencmd measure_temp` as fallback).
- `GET /__helper/status` returns `{power, temperature, tempC}` where `power` is the chosen strategy or `null`. A fake mode (`--helper-fake`) returns canned values, records calls for tests and lists them at `GET /__helper/calls` (fake mode only; 404 otherwise, same guards). Documented in the README.
- A non-loopback peer, a missing header, a hostile Host or a non-boolean `on` gets 403/400 and runs no command (asserted with an injected fake `execFile`); a bad `X-Forwarded-For` has no effect.
- `POST /__helper/brightness` does not exist (404).

**R-HELP-2 (P1, E6, E9) Integration and temperature.** `js/helper.js` probes `/__helper/status` at boot (404 or network error means "no helper", silent); when `deviceHelper` (default false) is on and the helper exists: sleep calls power off after the veil is up and power on before the poster fetch on wake (R-PROT-1), and Diagnostics shows "CPU temperature". All of it no-ops on static hosting. A V1-extended row checks that after power off then on the window is still full-screen and playback wakes within a bounded time (a power cycle can renegotiate the display and hide the page).
- A 404 or network error gives `available:false` without throwing; every request carries `X-Poster-Helper: 1`; failures are logged once, not every tick.
- With `--helper --helper-fake`, entering sleep makes `GET /__helper/calls` show power off and waking shows power on; with `deviceHelper:false` or no `--helper` the page makes no `/__helper/` request after the initial probe and logs no console error.

### Kiosk

**R-KIOSK-1 (P1, E12; D10) Kiosk mode, PIN and recovery.** `kioskMode` hides the controls entirely (they are `inert`, so Tab cannot reach them): pointer movement and taps never reveal them. Two reveals work: a 3-second press-and-hold in the **bottom-right corner as the viewer sees it** (a 96x96 px zone mapped through `rotation` when `rotateUi` is on), and **holding OK/Enter for 3 s** (for D-pad remotes); either reveals the controls for 15 s, and both still work when `disableShortcuts` is on. `settingsPinHash`/`settingsPinSalt` hold a salted SHA-256 (Web Crypto; fallback to a plain pure-JS hash when `crypto.subtle` is unavailable on an insecure origin). When a PIN is set it is required to open Settings, Diagnostics, reset, import, and Show token. Five wrong tries lock for 60 s (doubling to 15 min). `disableShortcuts` ignores all keyboard shortcuts including `?`. **A PIN is a deterrent against children and visitors, not authentication; anyone with browser devtools or filesystem access can bypass it, and the UI and README say so (D16).**
**PIN recovery (D10):** on every load the app fetches `config.json` (served to loopback clients only, R-SEC-1); if it contains `"resetPin": true` the stored `settingsPinHash`, `settingsPinSalt` and the lockout are cleared. A non-loopback client never receives `config.json`, so a PIN cannot be reset over the network. Diagnostics shows `PIN reset flag present` while the flag is in the file, and the README says to remove it afterwards (Q21).
- Unit tests: hash/verify with salt, lockout schedule, corner-zone mapping at all four rotations, hold timer cancelling on movement over 12 px or early release.
- E2E: in kiosk mode `pointermove`/tap/key never adds `.visible`; a 3 s hold in the corner does, for 15 s, at rotation 0 and 90; a 3 s Enter hold does, also with `disableShortcuts:true`; with a PIN set, `s` and the Settings button show the PIN dialog (on-screen keypad usable by touch; at rotation 90 `#pin-dialog`'s computed angle is 90 and its box lies inside the viewport); a wrong PIN keeps Settings closed; the correct PIN opens it.
- With a PIN set and `config.json` intercepted by `context.route` to return `{"resetPin": true}`, after load Settings opens without a PIN and the PIN material is gone from `localStorage`; without the flag the PIN stays.
- Export never includes `settingsPinHash`/`settingsPinSalt` even with "include token" ticked, and an import file containing them is ignored.

**R-KIOSK-2 (P1, E16) Show token behind the PIN.** `#token-toggle` ("Show") requires the PIN when one is set; it re-hides the field when the sheet closes.
- With a PIN set, pressing Show opens the PIN dialog; a wrong PIN leaves the field masked; the correct PIN reveals it; closing the sheet masks it again.

### Content filter

**R-FILT-1 (P1, E14; D5) Maximum content rating.** The limit is a "Household with children" toggle in Settings (UI-only: on reveals the rating select defaulting to `PG-13`, off stores `maxContentRating: ''`); it is **not** part of the protection preset. `maxContentRating` (`''` = no limit; `G`, `PG`, `PG-13`, `R`, `NC-17`) applies to:
- **random posters** (pool loading) — request-side Plex `contentRating` filter **(verify parameter name, multi-value syntax and normalisation)** whose value list contains every ladder value at or below the limit **and** every mapped country-prefixed value at or below it (so `PG-13` sends `G`, `PG`, `PG-13`, the `TV-` equivalents and `gb/U`, `gb/PG`, `gb/12`, `gb/12A`, `de/0` and the rest of the table), plus a client-side filter that is the guarantee;
- **cached (offline) posters** — `js/poster-cache.js` index entries gain `contentRating`, and `cache.random()` skips entries above the limit; entries without a stored rating (cached before 2.1) are skipped while a limit is set;
- **now-playing** — when a limit is set and `limitNowPlaying` (default **true**, switchable) is on, a playing item above the limit (or unrated) is treated as nothing playing and the display shows a random allowed poster.
An **owner-pinned** poster is exempt. Client-side ladder: `G=TV-Y=TV-G < PG=TV-Y7=TV-PG < PG-13=TV-14 < R=TV-MA < NC-17`. Country-prefixed values map onto that ladder (table below, Q19); **unrated, missing and unmapped values are excluded while a limit is set**. Because filtering shrinks the pool, the request oversamples (size x3, cap 500). The pool cache key includes the limit; an empty result produces the existing "No posters found" error with a hint to raise the limit.

| Prefix | Mapping to the US ladder (ruled, Q19) |
|---|---|
| `gb/` | `U`=G, `PG`=PG, `12`/`12A`=PG-13, `15`=R, `18`=NC-17 |
| `de/` | `0`=G, `6`=PG, `12`=PG-13, `16`=R, `18`=NC-17 |
| `au/` | `G`=G, `PG`=PG, `M`=PG-13, `MA15+`=R, `R18+`=NC-17 |
| `ca/` | `G`=G, `PG`=PG, `14A`=PG-13, `18A`=R, `R`=NC-17 |
| `fr/` | `U`=G, `10`=PG, `12`=PG-13, `16`=R, `18`=NC-17 |
| `nl/` | `AL`=G, `6`/`9`=PG, `12`/`14`=PG-13, `16`=R, `18`=NC-17 |

- Unit tests over every ladder rung, every table row, the request value list (every allowed ladder value and every mapped prefixed value at or below the limit, nothing above), an unmapped prefixed value (`gb/XX`), unrated, missing, the oversample size, the pool cache key, the cache-index skip, and the now-playing rule (above limit, unrated, `limitNowPlaying:false`, pinned exempt).
- Against the mock (its 8 titles carry G, PG, PG-13, R, TV-MA, `gb/12`, `gb/15` and no rating, and it honours the filter parameter as a list), a PG-13 limit shows only the G, PG, PG-13 and `gb/12` titles across 50 picks (never R, TV-MA, `gb/15` or the unrated one); under `R` the R and TV-MA titles also appear (same rung); with no limit all 8 appear. NC-17 is covered by the unit tests.
- A cached R poster is never shown by the offline fallback under PG-13, and a playing R title under PG-13 is not displayed (the next random allowed poster is).
- The preset (R-PROT-5) leaves `maxContentRating` and `limitNowPlaying` unchanged.

### Documentation

**R-DOC-1 (P1, E7) Smart plug fallback.** README explains scheduling a smart plug (or router/TV timer) to cut power at night as the belt-and-braces to software sleep, including the caution about powering a Pi: shut down cleanly (cron/systemd) before power cut or use read-only root (R-DOC-2).
- README contains `smart plug`, a clean-shutdown caution and a link to the overlay section.

**R-DOC-2 (P1, E8; sceptic M3) SD-card wear and the overlay filesystem.** Cache-first is R-CACHE-1; README documents read-only overlay filesystem via `raspi-config` (Performance Options > Overlay File System) and keeping Chromium's disk cache in RAM (`--disk-cache-dir=/dev/shm/chromium-cache`, `--disk-cache-size=...`) **(verify)**. **With the overlay enabled every write is lost on reboot** (settings in `localStorage`, the poster cache, the PIN lockout): the documented order is "configure everything, then enable the overlay", and later changes need the overlay switched off.
- README contains `Overlay File System`, `disk-cache-dir` and a sentence that settings, cache and lockout are lost on reboot with the overlay on.

**R-DOC-3 (P1, E11) Tablet battery.** README warns that tablets held at 100 % charge 24/7 risk battery swelling; use the vendor charge limit (e.g. 80 %) or a smart plug.
- README contains `swelling` and a charge-limit recommendation.

**R-DOC-4 (P1, E13; sceptic M9) Kiosk flags.** README lists Chromium flags that stop swipe-back and pinch leaving the app: `--overscroll-history-navigation=0` and `--disable-pinch` **(verify names and that they still exist in the installed Chromium; newer builds may need `--disable-features=OverscrollHistoryNavigation`, and the flag is reported not to stop swipe-back on every touch build, so the in-page `overscroll-behavior: none` of R-PROT-4 is the backstop)**, with `--kiosk --noerrdialogs --disable-session-crashed-bubble --app=...`. The tablet-fullscreen note of R-PROT-3 lives here.
- README contains both flags, `overscroll-behavior`, and the fullscreen note.

**R-DOC-5 (P1, E17) Network isolation.** README: put the display on an IoT/guest VLAN that can reach only the Plex server on port 32400 (and plex.tv over 443 if using sign-in or relay).
- README contains `VLAN` and `32400`.

**R-DOC-6 (P1, E15) Managed user.** README: connect with a Plex Home managed user restricted to one library, so a stolen device's token exposes only that library.
- README contains `managed user` and `Plex Home`.

**R-DOC-7 (P2) Feature docs and Roadmap.** README feature table, shortcut table (including the `?` overlay), project layout (every `js/*.js` and `scripts/*.mjs`), `npm run test:e2e` and the topologies of R-TOPO-1 match what shipped. `Roadmap.md` drops shipped ideas (scheduled dimming/sleep, playback progress) and gains an entry for each item deferred by D1: phone remote configuration (extends the existing "Remote control" idea; if revisited, the QR code appears only inside PIN-locked settings and no protective setting can be changed from the phone, D7), multi-poster landscape layout, frame per poster source with "Coming Attractions" artwork, animated frame bulbs, frame rotation.
- Every module and script file name appears in the README; the Roadmap contains one heading per deferred item and no longer lists the shipped ideas.

**R-DOC-8 (P1, sceptic M6/M7) Pi OS recipe.** README: turn off Pi OS screen blanking; set the Chromium policy `DeveloperToolsAvailability` to `2` (otherwise a USB keyboard shows the token in two keystrokes); the Chromium package is `chromium-browser` on Bookworm and `chromium` on Trixie **(verify)**; autostart via labwc `autostart` (Wayland) or XDG autostart (X11) **(verify)**; remove `config.json` after first run and delete a `resetPin` flag after using it. It also covers: (D2) rotating the OS or compositor instead of the app, with `rotateUi` turned off and the app rotation left at 0, as a supported option; (D8) the CEC helper needs `hdmi_force_hotplug=1` in the Pi boot config so the HDMI output stays enumerated while the TV is off, and the user must be in the `video` group for `/dev/cec0` **(verify both)**; (Q23) Pi OS `fake-hwclock` restores the last shutdown time, so after a long power-off the clock looks plausible but is stale until NTP syncs, and schedules can be briefly wrong until then.
- README contains `DeveloperToolsAvailability`, `chromium-browser`, `chromium`, `labwc`, `screen blanking`, `rotateUi`, `hdmi_force_hotplug`, `video group` and `fake-hwclock`.

**R-DOC-9 (P1, sceptic M2) Supported setups.** README has the "Supported setups" section of R-TOPO-1, the `config.json` loopback and reverse-proxy warning (a proxy on the same machine makes every client look like loopback), the helper section and the PIN-is-deterrence statement.
- README contains `Supported setups`, `reverse proxy`, `--helper` and `deterrent`.

### Upgrade and release

**R-UPG-1 (P2, sceptic M8) One-time "What's new in 2.1" toast.** After the upgrade, a configured install shows once a toast "What's new in 2.1: display protection options" with an **Open settings** action. The seen marker is `plexPoster.whatsNew` (a plain key, not a setting). A fresh (unconfigured) install never sees it.
- With `plexPoster.whatsNew` unset and the app configured, the toast appears once and not after a reload; unconfigured never; the e2e harness seeds the marker so other specs are unaffected.

**R-REL-1 (P3; D11, D13, D16) Single version bump and release gate.** `VERSION` in `sw.js`, `js/main.js` and `package.json` is bumped to `2.1.0` once, in the final `release-bump` phase. The rationale is clean releases, not that per-phase bumps reload clients (any `sw.js` edit already triggers a service-worker update). Every phase that adds a file to `js/` also adds it to `SHELL` in `sw.js`, checked recursively by `scripts/check-precache.mjs`. The release requires `Rotated: yes` in the token receipt and `Overall: PASS` in both validation files; optional and deferred phases never block it. The run pushes to its working branch only (D13); a PR or merge happens only when the owner asks.
- `release-bump` is blocked by `rotate-plex-token`, `real-server-validation` and `real-server-validation-extended`; its criteria check `Rotated: yes` and `Overall: PASS` in both files, the three versions equal `2.1.0`, `npm test`, `npm run test:e2e` and the precache check; the release e2e seeds a stale `shell-2.0.0` cache and asserts it is deleted and `shell-2.1.0` exists after activation.

## Non-goals and deferred (D1)

| Item | Finding | Reason | Where it goes |
|---|---|---|---|
| Phone remote configuration (QR code, pairing code, LAN listener, vendored QR encoder) | U6 (was R-REM-1) | Largest new attack surface for the smallest gain; conflicts with the PIN, the kids persona and VLAN isolation; cannot solve UC4, which R-FIRST-1 solves. If revisited the QR appears only inside PIN-locked settings and no protective setting can be changed from the phone (D7) | deferred (D1) → Roadmap "Remote control" |
| Multi-poster landscape layout (2-3 posters side by side) | U7 multi-poster part (was R-FILL-2) | Refactor of `display.js` that assumes one stage; lights more OLED area; blur and info panel already deliver U7 | deferred (D1) → Roadmap |
| Frame per poster source and "Coming Attractions" artwork | U8 (was R-FRM-1) | Cosmetic header change, inert until the owner draws artwork; needs a human asset | deferred (D1) → Roadmap |
| Animated frame bulbs | E3 (was R-FRM-3) | The overlay does not rest the underlying bulb pixels and an infinite animation keeps the Pi compositing around the clock | deferred (D1) → Roadmap |
| Frame rotation (daily/weekly frame) | E5 (was R-FRM-2) | The three built-in frames place their bulb rings within about 1.5 points of each other, so rotating gives little relief beyond pixel shift | deferred (D1) → Roadmap |
| Hardware brightness through the helper | E6 part | DDC/CI is absent on consumer TVs, HDMI has no backlight sysfs (D8) | dropped |
| Local-network Plex server discovery | — | Roadmap only (D3); GDM needs a UDP listener in `serve.mjs` | Roadmap (exists) |
| Multiple libraries mixed in the random pool, collections, genre/decade filters, "recently added" mode | Roadmap ideas | Not in the findings; the library picker and pool code would change shape | stay on the Roadmap |
| Server-side PIN enforcement or real authentication | — | The app has no backend by design; the PIN deters casual use (D16) | — |
| Hardware sleep without a helper | — | A web page cannot power a display; it shows black and the docs recommend a smart plug (R-DOC-1) | — |
| Rotating the OS or compositor | — | Out of scope; OS rotation with `rotateUi` off is a supported option (R-ROT-2) | — |
| A native or Electron wrapper | — | Violates the zero-dependency, install-as-PWA principle | — |
| Burn-in "guarantees" | — | Mitigations only; documented as such | — |
| Blurring with `filter`/`backdrop-filter` | — | Pi GPU cost; use the downscaled-canvas technique (R-FILL-1) | — |
| A pull request or merge to `main` | — | The run pushes to its branch only (D13) | — |

## Settings model changes

All new keys are added to `SCHEMA` in `js/settings.js` in one phase (`settings-and-schedule-core`) with sanitisers that coerce bad input to the default, so later phases consume them and do not edit the schema. New helper sanitiser `hhmm` (`HH:MM`, 00:00-23:59, else default). Existing keys are unchanged. `EXPORT_VERSION` stays 1 (purely additive: older exports import with defaults; a new export imported by an older app has its unknown keys dropped by `sanitize`). `settingsPinHash` and `settingsPinSalt` are never exported and never accepted from an import file (new `NEVER_EXPORT_KEYS`). `config.json` provisioning accepts all settings keys except those two, plus the control flag `resetPin` (not a setting).

| Key | Default | Rule | Protects / why | Req |
|---|---|---|---|---|
| `rotateUi` | `true` | bool | UI reads upright (D2) | R-ROT-2 |
| `statusIndicator` | `'dot'` | `dot`\|`off` | no static text; on (D6) | R-STAT-1 |
| `posterCacheLimit` | `100` | 10-300 | SD wear; cache-first on (D6) | R-CACHE-2 |
| `maxContentRating` | `''` (off) | `''`,G,PG,PG-13,R,NC-17 | its own "household with children" toggle (D5) | R-FILT-1 |
| `limitNowPlaying` | `true` | bool | applies the limit to now-playing when a limit is set (D5) | R-FILT-1 |
| `sleepEnabled` | `false` | bool | would blank the screen unasked (D6) | R-PROT-1 |
| `sleepStart` / `sleepEnd` | `'01:00'` / `'07:00'` | hhmm | | R-PROT-1 |
| `idleSleepHours` | `0` (off) | 0-48 | off and not in the preset (D4) | R-PROT-1 |
| `wakeOnPlayback` | `true` | bool | (D4) | R-PROT-1 |
| `pixelShift` | `true` | bool | on (D6) | R-PROT-2 |
| `pixelShiftMinutes` | `3` | 1-60 | | R-PROT-2 |
| `frameBrightness` | `100` | 10-100 | | R-FRM-4 |
| `nightDim` | `false` | bool | visible change, off (D6) | R-FRM-4 |
| `nightDimStart` / `nightDimEnd` | `'22:00'` / `'07:00'` | hhmm | | R-FRM-4 |
| `nightDimLevel` | `60` | 10-100 | | R-FRM-4 |
| `nightDimTarget` | `'frame'` | `frame`\|`stage` | whole-poster dim option (D6) | R-FRM-4 |
| `dailyReload` | `true` | bool | on where safe; the guard decides (D6) | R-PROT-3 |
| `dailyReloadTime` | `'04:00'` | hhmm | | R-PROT-3 |
| `kioskMode` | `false` | bool | | R-KIOSK-1 |
| `disableShortcuts` | `false` | bool | | R-KIOSK-1 |
| `settingsPinHash` / `settingsPinSalt` | `''` | hex string | never exported or imported | R-KIOSK-1/2 |
| `deviceHelper` | `false` | bool | opt-in, runs commands (D8) | R-HELP-2 |
| `controlLabels` | `'auto'` | auto\|always\|never | | R-CTRL-1 |
| `showMeta` | `false` | bool | | R-NP-2 |
| `showProgress` | `true` | bool | | R-NP-1 |
| `showPlayer` | `false` | bool | | R-NP-1 |
| `fillMode` | `'none'` | none\|blur\|info | lit pixels on OLED, opt-in | R-FILL-1 |

Removed from r1 by D1: `bulbAnimation`, `frameRotation`, `frameRotationIds`, `frameIdRandom`, `fillCount` and the `multi` fill value. Non-setting storage keys: `plexPoster.lastReload`, `plexPoster.pinLock`, `plexPoster.whatsNew`.

Each feature phase adds its own controls to the settings sheet (a new "Display protection" fieldset in `index.html` / `js/settings-ui.js` for the P1 keys); the schema phase adds keys only. Migration impact: none for stored settings (`load()` runs `sanitize`, which fills the new keys). Legacy-key migration is untouched. `showTitle` keeps its meaning. A 2.0.0 install upgrading to 2.1.0 therefore gains cache-first fetching, pixel shift (with a 3 % smaller stage), the status dot and the guarded daily reload, and nothing else; it sees the one-time toast of R-UPG-1.

## Security and privacy

- **Token handling**: stored in `localStorage` on the device. Never in a QR code, helper response, receipt, Diagnostics (already truncated to 4 characters), log line, or export unless ticked. It does appear in Plex request URLs by design (principle 4).
- **Git history** holds an old token (S1): rotate it (required); purge optional and skipped unless the repository is public or shared (D14).
- **`config.json`** is a token file: loopback-only with a hostname-only Host check (R-SEC-1), git-ignored, and the README says to delete it after first run. The server serves an allowlist of app paths only (D9).
- **Local helper** is the only listening surface the plan adds: opt-in `--helper`, loopback-only, shares `isLoopback`/`isLoopbackHost`, custom header, never a shell, validated inputs, no CORS grant (D8).
- **PIN** is client-side deterrence, not authentication; the UI says so (D16). Recovery is a loopback `config.json` flag (D10).
- **Least privilege Plex access**: managed user restricted to one library (R-DOC-6); IoT VLAN (R-DOC-5).
- **Privacy**: "Playing in {room}" and user names are shown on the display only; nothing is sent anywhere except to the user's own Plex server and plex.tv for sign-in.

## Open questions

The owner ruled on Q1-Q18 at stop 1 (`docs/decisions.md`, `.orchestrator/questions.md` rulings section). The r2 plan applies them as follows:

| # | Question | Ruling | Applied in |
|---|---|---|---|
| Q1 | Rotate the whole UI shell? | Yes (D2) | R-ROT-2 |
| Q2, Q3 | Phone remote transport, QR encoder | Deferred (D1, D7) | Non-goals |
| Q4 | Coming Attractions artwork | Deferred (D1) | Non-goals |
| Q5 | e2e dependency | Playwright devDependency + committed lockfile (D15) | `e2e-harness` |
| Q6 | When to bump `VERSION` | Once at release; rationale corrected (D16) | R-REL-1 |
| Q7 | Unrated and country-prefixed ratings | Map prefixes, exclude unrated (D5) | R-FILT-1 |
| Q8 | Purge `config.js` from history | Rotate; skip purge unless public or shared (D14) | R-SEC-2 |
| Q9 | Playback wakes the display | Yes; wake lock stays held (D4) | R-PROT-1 |
| Q10 | Which protections default on | Per D6 | Settings table |
| Q11 | Client-side PIN | Accepted as deterrence, UI says so (D16) | R-KIOSK-1 |
| Q12 | Multi-poster layout | Cut (D1) | Non-goals |
| Q13 | Core and extended validation | Separate, both PASS (D11) | R-VAL-1/2 |
| Q14-Q18 | Release path, worktrees, publish, daily reload, serve allowlist | D11, D12, D13, D6, D9 | R-REL-1, plan conventions, R-PROT-3, R-SEC-1 |

Settled by the conductor at the r2 confirmation (`.orchestrator/questions.md`, "Conductor-alone rulings"; listed to the owner at the next stop):

| # | Question | Ruling | Applied in |
|---|---|---|---|
| Q19 | R-FILT-1: exact values of the country-prefix mapping table | The table above is accepted; real stored strings are verified in extended validation | `content-rating-filter`, `real-server-validation-extended` |
| Q20 | R-PROT-5: which target does the preset's night dim use? | The whole stage (`nightDimTarget:'stage'`), shown as an untickable row; `frame` stays the schema default | `recommended-protection-preset` |
| Q21 | R-KIOSK-1: is `resetPin` one-shot? | No: honoured on every load while present; Diagnostics warns; the README says to remove it | `kiosk-and-pin`, `docs` |
| Q22 | R-NP-1: keep the "Playing in {Player.title}" label? | Keep it, default off (D1 does not defer U9) | `metadata-and-now-playing` |
| Q23 | R-PROT-6: how is a plausible clock defined? | Year >= 2026 as a constant in `js/schedule.js` plus re-evaluation on a clock jump; the README notes that `fake-hwclock` restores a stale time after a long power-off | `settings-and-schedule-core`, `docs` |

### (verify) list carried into V1

Plex `contentRating` filter parameter, multi-value syntax and real country-prefixed values (R-FILT-1); `totalSize` with `X-Plex-Container-Size=0` (R-SET-4); `viewOffset`, `duration`, `Player.title` in `/status/sessions` (R-NP-1); `X-Plex-Container-Size` oversampling limits; plex.tv endpoints used by sign-in over https; which rotation route (Authorized Devices removal vs password change with "Sign out of connected devices") revokes the leaked token, and plex.tv `GET /api/v2/user` returning 401 for a revoked token (R-SEC-2); Chromium flags and the `DeveloperToolsAvailability` policy (R-DOC-4, R-DOC-8); Chromium package names on Bookworm and Trixie, labwc and XDG autostart (R-DOC-8); `cec-ctl`, `cec-client`, `wlr-randr` output names with the compositor environment, `/dev/cec0` group access, and window state after a power cycle (R-HELP-1/2); individual `translate` property support in the target Chromium (R-PROT-2); `thermal_zone0` (R-HELP-1); Wake Lock behaviour on the Pi's Chromium under labwc (R-PROT-1).

## Traceability matrix

| Finding | Requirement(s) | Plan phase(s) |
|---|---|---|
| F1 | R-ROT-1 | `rotation-layout-and-shell` |
| F2 | R-ROT-2 | `rotation-layout-and-shell` |
| F3 | R-CACHE-1, R-CACHE-2 | `cache-first-fetch` |
| F4 | R-SEC-1 | `serve-config-guard` |
| F5 | R-STAT-1 | `status-indicator` |
| S1 | R-SEC-2 | `rotate-plex-token`, `purge-git-history` (optional) |
| V1 | R-VAL-1, R-VAL-2 | `validation-checklists`, `real-server-validation`, `real-server-validation-extended` |
| U1 | R-SET-1 | `settings-sheet` |
| U2 | R-SET-2 | `settings-sheet` |
| U3 | R-SET-3 | `settings-sheet` |
| U4 | R-SET-4 | `settings-sheet` |
| U5 | R-SET-5 | `position-drag-nudge` |
| U6 | R-REM-1 (dropped) | deferred (D1) |
| U7 | R-FILL-1; multi-poster part dropped | `fill-blur-and-info`; multi-poster part deferred (D1) |
| U8 | R-FRM-1 (dropped) | deferred (D1) |
| U9 | R-NP-1 | `metadata-and-now-playing` |
| U10 | R-NP-2 | `metadata-and-now-playing` |
| U11 | R-CTRL-1 | `touch-and-labels` |
| U12 | R-CTRL-2 | `touch-and-labels` |
| U13 | R-CTRL-3 | `touch-and-labels` |
| U14 | R-SET-6 | `settings-sheet` |
| E1 | R-PROT-1, R-PROT-6 | `sleep-mode`, `settings-and-schedule-core` |
| E2 | R-PROT-2 | `pixel-shift` |
| E3 | R-FRM-3 (dropped) | deferred (D1) |
| E4 | R-FRM-4 | `frame-brightness` |
| E5 | R-FRM-2 (dropped) | deferred (D1) |
| E6 | R-HELP-1, R-HELP-2 | `device-helper-server`, `device-helper-integration` |
| E7 | R-DOC-1 | `docs` |
| E8 | R-CACHE-1, R-DOC-2 | `cache-first-fetch`, `docs` |
| E9 | R-PROT-4, R-HELP-2 | `pi-stability`, `device-helper-integration` |
| E10 | R-PROT-3 | `pi-stability` |
| E11 | R-DOC-3 | `docs` |
| E12 | R-KIOSK-1 | `kiosk-and-pin` |
| E13 | R-DOC-4 | `docs` |
| E14 | R-FILT-1 | `content-rating-filter` |
| E15 | R-DOC-6 | `docs` |
| E16 | R-KIOSK-2 | `kiosk-and-pin` |
| E17 | R-DOC-5 | `docs` |
| D1 | Non-goals and deferred table | `docs` (Roadmap entries) |
| D3 | R-FIRST-1 | `settings-sheet` |

Supporting requirements with no finding of their own: R-TOPO-1, R-DOC-8, R-DOC-9 (`docs`), R-DOC-7 (`docs`), R-PROT-5 and R-UPG-1 (`recommended-protection-preset`), R-REL-1 (`release-bump`).
