# Plex Poster Display

An installable, offline-capable **progressive web app** that shows a Plex movie poster full-screen inside a decorative frame. It's built for Raspberry Pi kiosks, wall-mounted tablets and any other always-on screen.

There's no build step, no backend and no dependencies: just static files that talk to your Plex server directly from the browser.

![Poster inside the marquee frame](assets/screenshots/portrait.png)

---

## Features

| | |
|---|---|
| 🎬 **Now playing** | Shows the poster of whatever is playing, optionally only for one Plex user. TV episodes show the series poster. |
| 🎲 **Random rotation** | When nothing is playing, cycles through the top-rated (optionally unwatched) titles of a library, avoiding recent repeats. |
| 📌 **Pin a poster** | Keeps one poster on screen until you unpin it. |
| 🔐 **Sign in with Plex** | Enter a 4-character code at [plex.tv/link](https://plex.tv/link) from your phone. The app finds your servers and picks a working address. A manual token and URL are still supported. |
| 🖼️ **Frames** | Three built-in marquee frames, no frame, or your own transparent PNG. The poster window is detected automatically. |
| 📐 **Live layout controls** | Poster size, X/Y offset and fit mode, previewed live behind the settings panel. |
| 🔄 **Rotation** | 0/90/180/270° for portrait screens mounted sideways. |
| 📴 **Works offline** | The app shell is precached by a service worker. The last 30 posters are cached, so the display keeps rotating real artwork while Plex is down, then retries with exponential backoff. |
| ⏸️ **Pause** | Freezes the current poster (not persisted, so a reboot resumes). |
| 💡 **Kiosk niceties** | Screen wake lock, auto-hiding controls and cursor, full-screen, cross-fades, auto-update when a new version is deployed. |
| 💾 **Import / export** | Settings as JSON (token optional), or drop a `config.json` beside the app to provision a device. |
| 📊 **Diagnostics** | Connection state, cache, service worker and wake-lock status, plus a log of recent events. |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `R` | Next poster |
| `P` / `Space` | Pause / resume |
| `O` | Rotate 90° |
| `F` | Full screen |
| `S` | Settings |
| `D` | Diagnostics |

---

## Quick start

You need [Node.js](https://nodejs.org) 18+ only for the bundled dev server. Any static web server works.

```bash
npm start            # http://localhost:8080
```

Open the page and the settings panel appears:

1. Click **Sign in with Plex**, go to **plex.tv/link** on any device and enter the code. Or open *Enter token and server manually* and paste a token ([how to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)) and a URL such as `http://192.168.1.10:32400`.
2. Pick a **library**.
3. Press **Save**.

To try the app without a Plex server, run `npm run demo`. Then use token `demo-token` and server `http://localhost:32401`, which is a mock server with generated posters.

### Installing it as an app

Browsers only allow service workers (offline mode) and installation on **https** or **localhost**.

- **On the device itself** (recommended for a Pi): serve the app on `localhost` and open it there. Chrome or Edge will offer *Install*.
- **From other devices**: host the folder on https (GitHub Pages, Netlify, Caddy or nginx with a certificate, etc.).

> **https and your Plex server.** A page served over https can't call an `http://` Plex address, because the browser blocks it as mixed content. **Sign in with Plex** handles this by picking your server's secure `*.plex.direct` address automatically. If you enter a URL by hand on an https page, use that `https://…plex.direct:32400` address. Over `http://localhost`, a plain LAN address is fine.

---

## Raspberry Pi kiosk

```bash
sudo apt install -y chromium-browser nodejs git
git clone https://github.com/NateDogDotNet/plex-poster-app.git ~/poster-display

# serve the app on boot (systemd user service)
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/poster-display.service <<'EOF'
[Unit]
Description=Plex Poster Display web server
[Service]
ExecStart=/usr/bin/node %h/poster-display/scripts/serve.mjs --port 8080
Restart=always
[Install]
WantedBy=default.target
EOF
systemctl --user enable --now poster-display
sudo loginctl enable-linger "$USER"

# launch Chromium full-screen at login
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/poster-display.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Poster Display
Exec=chromium-browser --kiosk --noerrdialogs --disable-session-crashed-bubble --app=http://localhost:8080/
EOF
```

To set the Pi up without a keyboard, copy `config.example.json` to `config.json`, fill it in, and the app loads it on first run. `config.json` is git-ignored because it contains your token.

---

## Project layout

```
index.html              app shell (markup only)
manifest.webmanifest    PWA manifest
sw.js                   service worker (precache + offline shell)
css/app.css             styles
js/
  main.js               bootstrap: scheduling, offline fallback, controls, wake lock
  engine.js             decides which poster to show (pure, unit-tested)
  plex.js               Plex server + plex.tv client (sign-in, discovery)
  display.js            frame/poster rendering, rotation, cross-fade
  layout.js             geometry (pure, unit-tested)
  poster-cache.js       offline poster cache (Cache API)
  settings.js           schema, validation, migration, import/export
  settings-ui.js        settings panel
  frames.js             built-in frames + transparent-window detection
  backoff.js, util.js
assets/frames/          frame overlays (PNG with a transparent window)
assets/icons/           app icons
design/                 Paint.NET sources and poster-size notes
scripts/serve.mjs       zero-dependency static server (+ --mock)
scripts/mock-plex.mjs   fake Plex server for demos/tests
tests/                  node --test unit tests
```

### Adding a frame

Drop a PNG with a transparent window into `assets/frames/` and add it to `FRAMES` in `js/frames.js` (and to `SHELL` in `sw.js` so it works offline). You can also use **Frame → Custom image…** in settings, which detects the window automatically.

### Development

```bash
npm test     # unit tests (node --test, no dependencies)
npm run demo # app + mock Plex server
```

When you change any precached file, bump `VERSION` in `sw.js` (and in `js/main.js` and `package.json`). Installed clients pick up the new version and reload automatically.

---

## Security notes

- Your Plex token is stored in the browser's `localStorage` on the display device. Only run this on devices you trust.
- **Exported settings** leave the token out unless you tick *include token*.
- Never commit `config.json`. It's already in `.gitignore`.

## License

MIT
