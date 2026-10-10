// Renders the frame and poster: sizing, rotation and cross-fades.

import { detectWindow, findFrame, NO_FRAME, CUSTOM_FRAME_ID } from './frames.js';
import { formatRuntime } from './plex.js';
import { posterBox, stageSize } from './layout.js';

const POSTER_ASPECT = 2 / 3;
// A decode that has not settled by now never will (the same bound main.js puts on a poster download).
const DECODE_TIMEOUT_MS = 20000;

/** img.decode() that rejects instead of staying pending when the image cannot settle. */
function decodeWithin(img, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Image decode timed out.')), ms);
  });
  return Promise.race([img.decode(), limit]).finally(() => clearTimeout(timer));
}

export function createDisplay(root = document) {
  const el = {
    stage: root.getElementById('stage'),
    box: root.getElementById('poster-box'),
    layers: [root.getElementById('poster-a'), root.getElementById('poster-b')],
    frame: root.getElementById('frame'),
    title: root.getElementById('title-card'),
    progress: root.getElementById('progress'),
    playerLabel: root.getElementById('player-label'),
  };
  let settings = null;
  let nowPlaying = null; // { session, at }: what setNowPlaying last drew, so a settings change can redraw it
  let frame = { src: '', window: NO_FRAME.window, aspect: POSTER_ASPECT };
  let front = 0;
  const objectUrls = new WeakMap();
  // Which draw owns each layer. A cleanup timer may only touch a layer its own draw still owns:
  // removing src before a load finishes leaves decode() pending forever, which stalled rotation.
  const owners = new WeakMap();
  let drawSeq = 0;

  async function loadFrame(s) {
    const builtIn = findFrame(s.frameId);
    const src = s.frameId === CUSTOM_FRAME_ID ? s.customFrameUrl : builtIn?.src ?? findFrame('marquee').src;
    if (!src) {
      frame = { src: '', window: NO_FRAME.window, aspect: POSTER_ASPECT };
      el.frame.hidden = true;
      el.frame.removeAttribute('src');
      return;
    }
    if (src === frame.src) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    try {
      await img.decode();
    } catch {
      throw new Error(`Could not load frame image "${src}".`);
    }
    let win = builtIn && s.frameId !== CUSTOM_FRAME_ID ? builtIn.window : null;
    if (!win) win = detectFromImage(img) || NO_FRAME.window;
    frame = { src, window: win, aspect: img.naturalWidth / img.naturalHeight };
    el.frame.src = src;
    el.frame.hidden = false;
  }

  function detectFromImage(img) {
    try {
      // Sample at reduced size: plenty of precision for percentages, much cheaper.
      const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return detectWindow(ctx.getImageData(0, 0, c.width, c.height));
    } catch {
      return null; // cross-origin frame: canvas is tainted
    }
  }

  function layout() {
    if (!settings) return null;
    const { width, height } = stageSize({
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      aspect: frame.aspect,
      rotation: settings.rotation,
    });
    el.stage.style.width = `${width}px`;
    el.stage.style.height = `${height}px`;
    el.stage.style.setProperty('--rotation', `${settings.rotation}deg`);

    // The UI shell follows the stage unless rotateUi is off (OS-level rotation). --vw/--vh are the
    // screen's size as the viewer sees it, used by the controls, toast and top-layer dialogs.
    const uiRotation = settings.rotateUi === false ? 0 : settings.rotation;
    const uiSideways = uiRotation === 90 || uiRotation === 270;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--ui-rotation', `${uiRotation}deg`);
    rootStyle.setProperty('--vw', `${uiSideways ? window.innerHeight : window.innerWidth}px`);
    rootStyle.setProperty('--vh', `${uiSideways ? window.innerWidth : window.innerHeight}px`);

    const box = posterBox({
      stageW: width,
      stageH: height,
      win: frame.window,
      scale: settings.posterScale,
      offsetX: settings.posterOffsetX,
      offsetY: settings.posterOffsetY,
    });
    Object.assign(el.box.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    el.box.style.setProperty('--poster-fit', settings.posterFit);
    rootStyle.setProperty('--fade-ms', `${settings.crossfadeMs}ms`);
    return box;
  }

  function drawNowPlaying(session, elapsed) {
    const bar = el.progress;
    const showBar = Boolean(settings?.showProgress && session && session.duration > 0);
    bar.hidden = !showBar;
    bar.style.transition = 'none';
    if (showBar) {
      const playing = session.playerState === 'playing'; // paused and buffering sit still
      const offset = Math.min(session.duration, session.viewOffset + (playing ? elapsed : 0));
      bar.style.transform = `scaleX(${offset / session.duration})`;
      if (playing && offset < session.duration) {
        void bar.offsetWidth; // commit the start position, so the transition begins from it
        bar.style.transition = `transform ${session.duration - offset}ms linear`;
        bar.style.transform = 'scaleX(1)';
      }
    } else {
      bar.style.transform = 'scaleX(0)';
    }
    const label = settings?.showPlayer && session?.playerTitle ? `Playing in ${session.playerTitle}` : '';
    el.playerLabel.hidden = !label;
    el.playerLabel.textContent = label;
  }

  return {
    async apply(s) {
      const barOrLabelChanged = settings && (settings.showProgress !== s.showProgress || settings.showPlayer !== s.showPlayer);
      settings = s;
      // The bar and the label follow their settings at once, a live preview included; the poster on screen is unchanged.
      if (barOrLabelChanged) this.redrawNowPlaying();
      await loadFrame(s).catch((err) => {
        frame = { src: '', window: NO_FRAME.window, aspect: POSTER_ASPECT };
        el.frame.hidden = true;
        throw err;
      }).finally(layout);
      this.setTitle(this.currentPoster);
    },

    layout,

    /** Current poster box size in CSS pixels (used to request a right-sized image). */
    posterSize() {
      const b = layout();
      return b ? { width: b.width, height: b.height } : { width: 600, height: 900 };
    },

    currentPoster: null,

    /** Shows an image (Blob or URL) with a cross-fade. Resolves once it is visible. */
    async show(poster, image) {
      const next = el.layers[1 - front];
      const prev = el.layers[front];
      const url = image instanceof Blob ? URL.createObjectURL(image) : image;
      owners.set(next, ++drawSeq); // from here no earlier draw's timer may clear this layer
      const stale = objectUrls.get(next); // its earlier draw's timer will now skip it, so release here
      if (stale) {
        URL.revokeObjectURL(stale);
        objectUrls.delete(next);
      }
      next.src = url;
      next.alt = poster.title ? `Poster: ${poster.title}` : 'Poster';
      try {
        await decodeWithin(next, DECODE_TIMEOUT_MS);
      } catch {
        if (image instanceof Blob) URL.revokeObjectURL(url);
        throw new Error('Poster image could not be decoded.');
      }
      if (image instanceof Blob) objectUrls.set(next, url);
      next.classList.add('active');
      prev.classList.remove('active');
      front = 1 - front;
      this.currentPoster = poster;
      this.setTitle(poster);

      const old = objectUrls.get(prev);
      if (old) {
        const owner = owners.get(prev);
        setTimeout(() => {
          if (owners.get(prev) === owner && !prev.classList.contains('active')) {
            URL.revokeObjectURL(old);
            objectUrls.delete(prev);
            prev.removeAttribute('src');
          }
        }, (settings?.crossfadeMs ?? 0) + 200);
      }
    },

    /** The overlay slot: the 2.0.0 title line when `showTitle`, and "rating · runtime · year" when `showMeta`. */
    setTitle(poster) {
      const lines = [];
      if (settings?.showTitle && poster?.title) lines.push([poster.title, poster.year && `(${poster.year})`].filter(Boolean).join(' '));
      if (settings?.showMeta && poster) {
        const meta = [poster.contentRating, formatRuntime(poster.duration), poster.year].filter(Boolean).join(' · ');
        if (meta) lines.push(meta);
      }
      el.title.hidden = !lines.length;
      el.title.replaceChildren(
        ...lines.map((text) => {
          const line = document.createElement('div');
          line.textContent = text;
          return line;
        }),
      );
    },

    /**
     * The playback progress bar and the optional player label for the session on screen (null: neither).
     * The bar is set to where the session is (`viewOffset` of `duration`) and then given ONE linear transition to
     * the end lasting the remaining time, so it advances between polls with no timer; only a `playing` session moves (paused and buffering sit still).
     * The next poll sets it again, which is where a jump shows (Plex reports `viewOffset` every ~10 s).
     */
    setNowPlaying(session) {
      nowPlaying = session ? { session, at: Date.now() } : null;
      drawNowPlaying(session, 0);
    },

    /** Draws the last session again under the current settings, moved on by the time since it was drawn while it plays. */
    redrawNowPlaying() {
      if (nowPlaying) drawNowPlaying(nowPlaying.session, Date.now() - nowPlaying.at);
    },
  };
}
