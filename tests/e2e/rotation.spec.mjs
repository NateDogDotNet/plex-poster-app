// Rotated stage is centred and fully on screen (F1, R-ROT-1).
// Every case names pixelShift: false (convention 7): pixel shift would move the stage.

import assert from 'node:assert/strict';
import { withApp } from './lib.mjs';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 1280, height: 800 },
];
const ROTATIONS = [0, 90, 180, 270];

const seedFor = (rotation) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  rotation,
  pixelShift: false,
});

for (const viewport of VIEWPORTS) {
  for (const rotation of ROTATIONS) {
    const name = `${viewport.width}x${viewport.height} rotation ${rotation}`;
    await withApp({ settings: seedFor(rotation), viewport }, async ({ page, app }) => {
      await page.goto(app.url);
      await page.waitForFunction(
        () => document.getElementById('frame').naturalWidth > 0 && [...document.querySelectorAll('.poster-layer')].some((i) => i.naturalWidth > 0),
        null,
        { timeout: 15000 },
      );
      // Let the rotation transition and the poster cross-fade finish.
      await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 15000 });

      const m = await page.evaluate(() => {
        const box = (id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const app = document.querySelector('.app');
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          stage: box('stage'),
          frame: box('frame'),
          scrollH: app.scrollHeight,
          clientH: app.clientHeight,
          scrollW: app.scrollWidth,
          clientW: app.clientWidth,
        };
      });

      for (const id of ['stage', 'frame']) {
        const b = m[id];
        const where = `${name} #${id} ${JSON.stringify(b)}`;
        assert.ok(b.left >= -1 && b.top >= -1 && b.right <= m.vw + 1 && b.bottom <= m.vh + 1, `inside viewport: ${where}`);
        assert.ok(Math.abs((b.left + b.right) / 2 - m.vw / 2) <= 1, `centred horizontally: ${where}`);
        assert.ok(Math.abs((b.top + b.bottom) / 2 - m.vh / 2) <= 1, `centred vertically: ${where}`);
        const limiting = Math.min(Math.abs(b.width - m.vw), Math.abs(b.height - m.vh));
        assert.ok(limiting <= 2, `limiting dimension fills the viewport (off by ${limiting}): ${where}`);
      }
      assert.equal(m.scrollH, m.clientH, `${name}: .app scrollHeight == clientHeight`);
      assert.equal(m.scrollW, m.clientW, `${name}: .app scrollWidth == clientWidth`);
      console.log(`  ok  ${name}`);
    });
  }
}
