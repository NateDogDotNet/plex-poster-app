// Pure geometry for placing the frame and poster on screen.

/**
 * Size of the stage (frame box) that fits the viewport for a given rotation.
 * When rotated 90/270 the stage is laid out against swapped viewport dimensions,
 * then rotated into place by CSS.
 */
export function stageSize({ viewportW, viewportH, aspect, rotation = 0 }) {
  const sideways = rotation === 90 || rotation === 270;
  const availW = sideways ? viewportH : viewportW;
  const availH = sideways ? viewportW : viewportH;
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  return { width: Math.floor(w), height: Math.floor(h) };
}

/**
 * Poster box inside the stage, in pixels relative to the stage's top-left.
 * `win` is the frame's transparent window in percent; scale grows/shrinks the
 * poster around the window centre and offsets nudge it by % of the stage.
 */
export function posterBox({ stageW, stageH, win, scale = 100, offsetX = 0, offsetY = 0 }) {
  const s = scale / 100;
  const w = (stageW * win.w * s) / 100;
  const h = (stageH * win.h * s) / 100;
  const cx = (stageW * (win.x + win.w / 2)) / 100 + (stageW * offsetX) / 100;
  const cy = (stageH * (win.y + win.h / 2)) / 100 + (stageH * offsetY) / 100;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
}

/**
 * Pixel size to request from the Plex transcoder. Rounded up to 100px steps so
 * small window resizes reuse the same cached image.
 */
export function requestSize({ width, height }, dpr = 1) {
  const step = (v) => Math.max(100, Math.ceil((v * Math.min(dpr, 3)) / 100) * 100);
  return { width: step(width), height: step(height) };
}
