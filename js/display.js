// Renders the frame and poster: sizing, rotation and cross-fades.

import { detectWindow, findFrame, NO_FRAME, CUSTOM_FRAME_ID } from './frames.js';
import { posterBox, stageSize } from './layout.js';

const POSTER_ASPECT = 2 / 3;

export function createDisplay(root = document) {
  const el = {
    stage: root.getElementById('stage'),
    box: root.getElementById('poster-box'),
    layers: [root.getElementById('poster-a'), root.getElementById('poster-b')],
    frame: root.getElementById('frame'),
    title: root.getElementById('title-card'),
  };
  let settings = null;
  let frame = { src: '', window: NO_FRAME.window, aspect: POSTER_ASPECT };
  let front = 0;
  const objectUrls = new WeakMap();

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
    document.documentElement.style.setProperty('--fade-ms', `${settings.crossfadeMs}ms`);
    return box;
  }

  return {
    async apply(s) {
      settings = s;
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
      next.src = url;
      next.alt = poster.title ? `Poster: ${poster.title}` : 'Poster';
      try {
        await next.decode();
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
        setTimeout(() => {
          if (!prev.classList.contains('active')) {
            URL.revokeObjectURL(old);
            objectUrls.delete(prev);
            prev.removeAttribute('src');
          }
        }, (settings?.crossfadeMs ?? 0) + 200);
      }
    },

    setTitle(poster) {
      const show = Boolean(settings?.showTitle && poster?.title);
      el.title.hidden = !show;
      el.title.textContent = show ? [poster.title, poster.year && `(${poster.year})`].filter(Boolean).join(' ') : '';
    },
  };
}
