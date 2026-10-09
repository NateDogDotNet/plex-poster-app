# Decision log

Decisions that bind the integration plan (`docs/integration-plan.md`) and spec (`docs/spec.md`). Every entry here binds.

## Stop 1 — 2026-10-08, owner answer "approve, defaults"

- **D1 Plan size: lean.** Defer to `Roadmap.md` with reasons: phone remote config (U6), multi-poster landscape layout (part of U7), frame-per-source and Coming Attractions artwork (U8), animated bulbs (E3), frame rotation (E5). U7 is delivered by the blurred-backdrop and info-panel fill modes. Target is about 24 phases.
- **D2 Rotated screens (F2).** The whole UI shell (controls, toast, status, empty card, dialogs) rotates with the stage. Setting `rotateUi` defaults to true; OS-level rotation with `rotateUi` off stays a documented option.
- **D3 Keyboardless first run.** When the app is not configured, it starts the plex.tv PIN flow automatically and shows the code large and upright on the empty-state card, refreshing it on expiry. Local-network discovery stays on the Roadmap only and is not part of this plan.
- **D4 Sleep.** Idle sleep (no playback for N hours) defaults off and is not in the protection preset. Scheduled sleep shows pure black while the wake lock stays held, so playback can wake the screen (`wakeOnPlayback` defaults to true). The README says to turn off OS screen blanking. Releasing the wake lock is not used as a sleep mechanism.
- **D5 Content filter.** The maximum rating applies to random posters and to cached (offline) posters. It also applies to now-playing when a limit is set (on by default, switchable). An owner-pinned poster is exempt. Common country prefixes (`gb/`, `de/`, `au/`, `ca/`, `fr/`, `nl/`) map onto the US ladder; unrated items are excluded while a limit is set. The limit is its own "household with children" toggle and is not part of the protection preset.
- **D6 Protection defaults.**
  - On by default: cache-first fetch, pixel shift (with a 1–2 s glide), quiet status dot.
  - Off by default: night dim (which includes a whole-poster dim option) and sleep. The bulb effect is deferred under D1.
  - Daily reload is on by default only where it is safe: a service worker controls the page and a no-store probe of `index.html` succeeds. Otherwise it is skipped.
- **D7 Phone remote.** Deferred (D1). If revisited: the QR code appears only inside PIN-locked settings, and no protective setting can be changed from the phone.
- **D8 Device helper.** Scope is screen power (HDMI-CEC via `cec-ctl`/`cec-client`, output off/on via `wlr-randr` with the compositor environment passed through) and CPU temperature. Brightness control is dropped. The helper is loopback-only and opt-in.
- **D9 Local server.** `scripts/serve.mjs` serves an allowlist of app paths (`index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`, `assets/`). `config.json` is served only to loopback clients. The Host check compares the hostname only and ignores the port, and `X-Forwarded-For`/`Forwarded` are never consulted.
- **D10 Kiosk recovery.** Holding OK/Enter for 3 s reveals the controls, as well as a long-press. A documented PIN reset works through a loopback-only `config.json` flag.
- **D11 Release gate.** The 2.1 release requires `Rotated: yes` (token rotated) and `Overall: PASS` on the core and extended real-server validation. Optional and deferred phases never block the release. A failed validation reopens the phase it names.
- **D12 Parallel work.** Phases that run at the same time each run in their own git worktree with their own e2e ports.
- **D13 End of the run.** Work is pushed to the working branch only. A PR or merge happens only when the owner asks, so there is no `publish` tag.
- **D14 Git history.** The token is rotated (required). The `config.js` history purge is skipped unless the repository is public or shared; if it is ever run, it is a separate irreversible approval.
- **D15 Test tooling.** Playwright is a devDependency with a committed `package-lock.json`. The app keeps zero runtime dependencies.
- **D16 Drafter readings accepted.**
  - The client-side PIN is deterrence, and the UI says so.
  - `VERSION` is bumped once, at release. The rationale is clean releases, not that per-phase bumps reload clients: any `sw.js` edit already triggers an update.
  - Core and extended real-server validation stay as separate phases.

## Stop 3 — 2026-10-08, owner answer "Approve" (items 1–3; item 4, token rotation, still open)

- **D17 Resolved review finding.** The first `validation-checklists` doc review's Criticals (row C07 token display, row C03 cancel/expiry, citing D11) are resolved by the r2/r3 rewrites.
- **D18 Conductor rulings kept.**
  - Dev server: a symlink whose real path leaves the served root is 404, and any dotfile path segment is 404, even under `css/`, `js/`, `assets/` (applies D9 and R-SEC-1).
  - Test harness (H1): each browser spec has a deadline (`E2E_SPEC_TIMEOUT`, default 180 s), spec process groups are killed on deadline, exit and signals, and the CI job has `timeout-minutes: 20`.
  - Device helper (K1 / Q-dhs1, Q-dhs2): auto-detect order is cec-ctl, then cec-client, then wlr-randr (the last only with `--helper-output`). Screen-on uses `cec-ctl --image-view-on` (verify on hardware). Error codes: 413 oversized body, 503 busy, no strategy or missing Wayland env, 504 timeout, 502 failed.
- **D19 Minor findings shipped as is.**
  - X1: a cross-site request to 127.0.0.1 for config.json gets 200, but no CORS header is sent, so no other site's page can read it. Cold M2/M3 stay as they are.
  - H2: a non-numeric `E2E_SPEC_TIMEOUT` times every spec out.
  - H3: the harness sweep comment wording.

## Stop 4 — 2026-10-09, owner answer "Defaults" (items 1–3; item 4, token rotation, still open)

- **D20 Device helper past the retry cap.** One more owner-authorised round for `device-helper-server`, limited to: a test that the real process-group liveness check sees a live member (A6-1), a per-test time limit on the deadline test (A6-2), and refusing to start when a helper option is given without a value (C6-3). Shipped as is: A6-3 (a successful command whose background child holds stdout gets 504; the group is still killed), A6-4 (the reply waits up to 10 s only when a member survives SIGKILL), C6-1 (`setsid` escapes a process-group kill), C6-2 (no SIGTERM handler in `serve.mjs`; under systemd `KillMode=control-group` stopping the service kills the command — the `docs` phase says so), C6-4 (theoretical pid-reuse window in the post-command kill).
- **D21 Conductor rulings kept.**
  - K2: helper status names the temperature source (`thermal_zone0`, `vcgencmd` or null).
  - K3: new numeric settings — junk or blank → default, out of range → clamp, counts rounded.
  - K4: a cached poster that fails to decode is deleted and downloaded once; no retry loop.
  - K5: offline `cache.random()` can return a corrupt entry; fixed in `content-rating-filter`, which edits that function.
  - K7: the sleep e2e "wake lock held" check is `__wakeLock.held === 1` with `releases` unchanged (the stub counts).
  - K8: after every helper command, success or failure, its process group is killed and awaited before the lock is released.
  - K9: playback always restarts the idle-sleep clock (`wakeOnPlayback:false` keeps only the scheduled veil); Pause stops playback-wake polling; open Settings/Diagnostics dialogs render above the veil.
- **D22 No poster blacklist (K6).** A poster whose image keeps failing to decode is downloaded once per rotation and skipped; the app does not stop trying it.
