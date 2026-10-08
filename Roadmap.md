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
