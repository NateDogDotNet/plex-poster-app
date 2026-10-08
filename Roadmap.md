# Project Roadmap – Plex Poster Display

## ✅ Done in 2.0 (PWA rewrite)

- **Progressive web app**: manifest, icons, service worker, installable, auto-update
- **Offline poster caching**: last 30 posters in the Cache API, rotated while Plex is unreachable, with an "offline" indicator
- **Retry with backoff**: exponential backoff with jitter; status pill shows when the next retry happens
- **Position and scale poster**: size, X/Y offset and fit mode, relative to the frame's window, with live preview
- **Rotate display**: 0/90/180/270° via button, `O` key or settings
- **Toggle now playing**: on/off, optional per-user filter, optional TV episodes
- **Static poster**: pin the current poster from the controls; unpin from controls or settings
- **Config import/export**: JSON file with optional token, plus `config.json` provisioning
- **Pause refresh**: toggle with icon change, not persisted
- Sign in with Plex (plex.tv/link PIN) and automatic server/connection discovery
- Screen wake lock, auto-hiding cursor, keyboard shortcuts, diagnostics log

## 🔜 Ideas

### Auto-discover Plex servers on the local network
Find Plex servers on the LAN automatically so first-run setup is "pick your server, approve the code" instead of typing an IP address and port.

- **Why:** today a new display needs either *Sign in with Plex* (which finds servers through your plex.tv account) or a hand-typed `http://<ip>:32400`. Neither shows the servers on your network before you've signed in, and a keyboardless TV makes typing an address painful.
- **How it can work:**
  - **GDM (Plex's own LAN discovery):** Plex servers answer a UDP multicast/broadcast query (`M-SEARCH`, ports 32410–32414) with their name, port and machine id *(verify exact ports and reply format)*. Browsers can't send UDP, so this runs in the local `scripts/serve.mjs` as an opt-in, loopback-only endpoint (e.g. `GET /__discover`) that the app calls when it's served from that server.
  - **Browser-only fallback:** probe `http://localhost:32400/identity` and the page's own host on port 32400. `/identity` answers without a token and returns the server's machine id and version *(verify)*. This covers Plex running on the same machine as the display.
- **In the app:** a "Servers found on your network" list on the first-run screen. Picking one fills the server URL and starts the sign-in code flow; the token still comes from *Sign in with Plex* or manual entry, since discovery finds servers but never grants access.
- **Constraints:** discovery is opt-in, never sends the token anywhere, and works only on the local network segment (multicast doesn't cross VLANs, so an IoT-VLAN setup still needs sign-in or a manual URL). On an https-hosted copy, browsers block `http://` LAN addresses, so discovered servers are matched to their secure `plex.direct` address after sign-in.

### Scheduled dimming / sleep
Blank or dim the screen during configured hours (e.g. 1am–7am).

### Multiple libraries
Mix posters from several libraries (movies + TV) in the random pool.

### Collections & filters
Limit random posters to a Plex collection, genre or decade.

### "Coming soon" mode
Show recently added titles with a "Coming Soon" / "New Arrival" frame.

### Playback progress
Thin progress bar along the frame while something is playing.

### Remote control
Change poster or settings from a phone on the same network.
