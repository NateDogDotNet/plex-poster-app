# Project Roadmap – Plex Poster Display

This document outlines upcoming features and technical enhancements planned for the Plex Poster Display project. All listed improvements will maintain full compatibility with existing features including:
- Standalone browser operation
- Frame overlay support
- First-run localStorage configuration

---
## 🔜 Planned Enhancements

### 1. Offline Poster Caching
**Goal**: Improve robustness when Plex server is unavailable
- Store last successfully loaded poster in `localStorage` or `IndexedDB`
- Display cached poster during network outages
- Show discreet "Offline Mode" indicator

### 2. Retry Logic with Backoff
**Goal**: Prevent script failure in low-connectivity conditions
- Retry poster fetching with exponential backoff
- Log fetch errors to console
- Optionally show retry timer / status label in UI

### 3. Position and Scale Poster
**Goal**: Allow users to adjust the display of poster realitive to the overlay frame
- UI control to allow positioning of poster
- UI control to allow the scaling of the poster realitive to the overlay frame
- Save settings to `localStorage`

### 4. Rotate display
**Goal**: Allow user to change between vertical or horzontal display
- UI control to allow 90 degree rotation, of frame and poster, with every click
- Store setting in 'localStorage'

### 5. Togle Now Playing Poster
**Goal**: When a movie is being played, allows a setting to chose to show that poster insted of a random one
- UI togle control in Setting panel
- Store setting in `localStorage`

### 6. Static Poster
**Goal**: Allow user to choose just a single poster that does not change
- Allow user to configure a setting that will not change the poster and set it to a specfic library item.

### 7. Config Import/Export
**Goal**: Make it easy to clone setups across devices
- Allow export of current config as a JSON file
- Support drag-and-drop or file input to re-import a config
- Validate and apply config to localStorage on import

### 8. Pause Refresh
**Goal**: Allow user to to pause and restart the auto refresh.
- UI control quickly pause the refresh function
- UI when paused and un-pused the icon for the control changes appropratly
- Do Not Store setting in 'localStorage'
---
