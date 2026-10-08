# Real-server validation: core (V1, R-VAL-1)

Template for a human to fill in against a real Plex server and the real plex.tv. Only `Overall: PASS` closes the `real-server-validation` phase (D11). A FAIL names the phase to reopen.

**Secrets rule: never paste a token or a full `X-Plex-Token` URL into this file.** When you copy Diagnostics text into Notes, check it first and delete any token or URL that carries one.

Result values: PASS | FAIL (<phase to reopen>) | SKIPPED (<reason>, extended Pi rows only)

How to fill in: replace the placeholder after each `Result:` with PASS or FAIL, write what you saw after `Notes:`, then replace the last line with `Overall: PASS` once every row is PASS. Core rows may not be SKIPPED.

Setup: run `npm start` on the display device (or any machine on the LAN), open `http://localhost:8080` in Chromium, and open the Settings sheet. Start with a cleared site (DevTools > Application > Clear site data) so no earlier sign-in is reused. Move any `config.json` beside `index.html` aside for this run. Have a Plex account that owns at least one server, ideally two.

## A. Sign-in and discovery

- [ ] V1-C01 — Open Settings and press the Sign in with Plex button — expected: a panel shows a 4-character code with a link to plex.tv/link within a few seconds, and there is no console error — Result: PENDING — Notes:
- [ ] V1-C02 — On a second device open plex.tv/link, enter the code and approve — expected: within about 5 s (up to about 10 s per unreachable address) the code panel closes without a manual refresh and the line beside Test connection reads `✓ <server name> (v<version>) — N libraries` — Result: PENDING — Notes:
- [ ] V1-C03 — Press Sign in with Plex, do not approve, and wait for the code to expire (about 15 min; note the real lifetime in Notes) — expected: the panel status reads `Code expired — try again.` and Sign in with Plex is enabled again; pressing it gets a new code, and no spinner or "Waiting" text is left behind — Result: PENDING — Notes:
- [ ] V1-C04 — Press Sign in with Plex, then press Cancel in the code panel — expected: the code panel closes with no message and Sign in with Plex is enabled again; pressing it starts a fresh code — Result: PENDING — Notes:
- [ ] V1-C05 — Sign in again and approve. If the account has two or more servers, a Server select appears; open it and check the names (shared servers carry a ` (shared)` suffix) — expected: every server you own or share appears once, none duplicated, with no CORS or network error in the console; with one server there is no Server select and that server is used — Result: PENDING — Notes:
- [ ] V1-C06 — Pick a server, press Save, then open Diagnostics (press D or the info button) and read the `Server` line. Write in Notes whether the address is a local plex.direct, local http, remote plex.direct or relay address (do not paste the full line if it carries a token) — expected: the line shows the server name and the address it picked; firstReachable tries the local `https` `*.plex.direct` address first, then local `http`, then remote `https`, then relay — Result: PENDING — Notes:
- [ ] V1-C07 — From a machine off the LAN (or with the LAN address blocked), repeat V1-C06 — expected: firstReachable picks the `*.plex.direct` https address, the `Server` line shows it, the library still loads, and the console shows no mixed-content error — Result: PENDING — Notes:

## B. Token, URL test and libraries

- [ ] V1-C08 — Press Test connection in Settings. Then open the Enter token and server manually fold, change Server URL to a wrong address and press Test connection again, then restore it — expected: the first test reads `✓ <server name> (v<version>) — N libraries`; the wrong URL reads `✗ ` followed by an error message; the Diagnostics `Token` row shows at most the first 4 characters of the token followed by `…`, and no other part of the token appears in the toast, Diagnostics or Recent events — Result: PENDING — Notes:
- [ ] V1-C09 — Open the Library select in Settings, choose a library, press Save, and reload the page — expected: your movie and TV libraries are listed with their real titles, and after the reload the Diagnostics `Library` row names the chosen library — Result: PENDING — Notes:
- [ ] V1-C10 — Reload the page with the saved settings and wait for the first poster — expected: a real poster from the chosen library shows; if the library is empty the "No posters found" message appears instead — Result: PENDING — Notes:

## C. Now playing and sessions

- [ ] V1-C11 — Turn on Show what's playing right now, press Save, start playback of a movie on any Plex client, and wait one "Check for now playing every" interval. In DevTools > Network open the `/status/sessions` response (do not copy the request URL, it carries a token) — expected: the app shows that title's poster as now playing, and the session entry has the fields the app reads: `type`, `thumb` (for an episode `grandparentThumb`), `User.title` and `Player.state`; the Diagnostics `Now playing` row reads `on` (or `on for <user>`), the `Poster` row ends `— now-playing`, and there is no console error. For extended fields (`viewOffset`, `duration`, `Player.title`) see the extended file — Result: PENDING — Notes:
- [ ] V1-C12 — Pause that playback and wait one poll interval — expected: `/status/sessions` still lists the session with `Player.state` equal to `paused`, and the poster stays on screen — Result: PENDING — Notes:
- [ ] V1-C13 — Stop playback and wait one poll interval — expected: the display returns to random posters — Result: PENDING — Notes:

## D. Images, CORS and cache

- [ ] V1-C14 — Open DevTools > Network, filter for `/photo/:/transcode`, and let a poster load. Check status and console only; do not copy the request URL, it carries `X-Plex-Token` — expected: the blob download succeeds (status 200) with no CORS error in the console — Result: PENDING — Notes:
- [ ] V1-C15 — Open Diagnostics and read the Image mode line — expected: `Image mode: downloaded + cached`, not `direct`; if it says `direct (no offline cache)`, the transcoder blocked the blob download and the `directImages` fallback is in use, which is a FAIL against `cache-first-fetch` — Result: PENDING — Notes:
- [ ] V1-C16 — With posters cached, disconnect the network (DevTools > Network > Offline) and do not touch the screen or mouse for at least 5 s, and wait for the next change (status dot built by `status-indicator`; FAIL reopens it) — expected: a cached poster is shown, the status dot reflects the offline state, and the screen is not blank — Result: PENDING — Notes:

## E. Soak

- [ ] V1-C17 — Leave the display running for 24 h with the Diagnostics panel closed. At the start and the end record the Chromium Task Manager (Shift+Esc) memory for the tab in Notes, then reopen Diagnostics and the DevTools Console. Note start and end time, poster count and any errors in Notes — expected: still changing posters, no growing error list, no frozen image, and end memory not more than about double the start reading — Result: PENDING — Notes:

Overall: PENDING
