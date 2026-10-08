// Built-in frame overlays. `window` is the transparent opening the poster sits
// in, as percentages of the frame image (x/y are the top-left corner).
export const FRAMES = [
  {
    id: 'marquee',
    name: 'Marquee – Now Showing',
    src: 'assets/frames/marquee.png',
    window: { x: 7.3, y: 14.6, w: 85.6, h: 80.8 },
  },
  {
    id: 'marquee-narrow',
    name: 'Marquee – Now Showing (narrow)',
    src: 'assets/frames/marquee-narrow.png',
    window: { x: 7.4, y: 15.0, w: 85.5, h: 80.3 },
  },
  {
    id: 'marquee-glow',
    name: 'Marquee – Glow',
    src: 'assets/frames/marquee-glow.png',
    window: { x: 7.3, y: 16.0, w: 85.6, h: 78.9 },
  },
];

export const NO_FRAME = { id: 'none', name: 'No frame', src: '', window: { x: 0, y: 0, w: 100, h: 100 } };
export const CUSTOM_FRAME_ID = 'custom';

export function findFrame(id) {
  if (id === NO_FRAME.id) return NO_FRAME;
  return FRAMES.find((f) => f.id === id) || null;
}

/**
 * Finds the transparent window in a frame image by walking outwards from the
 * centre along the middle row and column. Returns null when the centre is
 * opaque (nothing to detect) or the pixels can't be read (cross-origin image).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} imageData RGBA pixels
 */
export function detectWindow({ width, height, data }, alphaThreshold = 128) {
  const alpha = (x, y) => data[(y * width + x) * 4 + 3];
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  if (alpha(cx, cy) >= alphaThreshold) return null;

  let left = cx, right = cx, top = cy, bottom = cy;
  while (left > 0 && alpha(left - 1, cy) < alphaThreshold) left--;
  while (right < width - 1 && alpha(right + 1, cy) < alphaThreshold) right++;
  while (top > 0 && alpha(cx, top - 1) < alphaThreshold) top--;
  while (bottom < height - 1 && alpha(cx, bottom + 1) < alphaThreshold) bottom++;

  const pct = (v, total) => Math.round((v / total) * 1000) / 10;
  return {
    x: pct(left, width),
    y: pct(top, height),
    w: pct(right - left + 1, width),
    h: pct(bottom - top + 1, height),
  };
}
