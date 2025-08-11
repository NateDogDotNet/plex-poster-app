# Plex Poster Display

A **server‑less**, browser‑only dashboard that displays a Plex movie poster full‑screen with a decorative frame overlay.  Designed for Raspberry Pi kiosk setups or any always‑on display.

---
## Features

| ✓ | Capability |
|---|-------------|
| 🎞️ | Shows the poster for *now‑playing* movie; falls back to a random highly‑rated, unwatched title when idle |
| 🖼️ | Transparent **frame.png** overlays the poster and always fits the viewport |
| ↔️ | **Poster scale & position controls** – adjust size (%) and X/Y offset (%) relative to the frame |
| 🔄 | Auto‑refreshes on an interval (default 5 min) + manual refresh button |
| 🛠️ | In‑page settings form (saved to `localStorage`) – no config files needed |
| 📊 | Diagnostics panel shows last fetch status, poster source, and all settings |
| 🖱️ | Controls auto‑hide; appear on mouse movement |

---
## File Layout

```
plex‑poster-display/
├── index.html    # self‑contained app (HTML + CSS + JS)
├── frame.png     # your transparent overlay (replaceable)
└── README.md     # this file
```

---
## Quick Start

1. **Download / clone** this folder to your device.
2. Place your custom `frame.png` in the same directory (transparent PNG recommended).
3. Open `index.html` in a Chromium‑based or Firefox browser.
4. On first run you’ll be prompted for:
   * Plex token (find in Plex Web → Account → Copy token)
   * Plex server URL (e.g. `http://192.168.1.10:32400`)
   * Plex username (exactly as in Plex)
   * Library key (numeric section ID for Movies)
   * Refresh interval (ms)
   * Poster scale / offset settings (optional)
5. Click **Save** – settings persist in `localStorage`.
6. Enjoy a full‑screen poster & frame.  Use ⚙️ to reopen settings, 📊 for diagnostics, 🔄 to force refresh.

> **Security Note:** The Plex token is stored unencrypted in your browser’s localStorage.  Run this only on trusted, local devices.

---
## Kiosk Mode on Raspberry Pi (example)

```bash
sudo apt install chromium-browser
mkdir ~/poster-display && cp -r * ~/poster-display
cat <<'EOF' > ~/.config/lxsession/LXDE-pi/autostart
@chromium-browser --kiosk --app=file:///home/pi/poster-display/index.html
EOF
```
Reboot – the Pi boots straight into full‑screen poster display.

---
## Roadmap Highlights
See **Roadmap.md** for full list, including:
* Offline poster caching
* Retry / back‑off logic
* Screen rotation toggle
* Config import / export

---
## License
MIT – free for personal and private use.  Do **not** deploy publicly with your Plex token exposed.
