// The whole UI shell rotates with the stage (F2, R-ROT-2, D2).
// Every case names pixelShift: false (convention 7).

import assert from 'node:assert/strict';
import { withApp, shot } from './lib.mjs';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
];
const ELEMENTS = {
  controls: '#controls',
  toast: '#toast',
  emptyCard: '.empty-card',
  settings: '#settings',
  diagnostics: '#diagnostics',
};

const seedFor = (rotation, rotateUi) => (app) => ({
  plexToken: 'demo-token',
  serverUrl: `http://127.0.0.1:${app.mockPort}`,
  libraryKey: '1',
  rotation,
  rotateUi,
  pixelShift: false,
});

const settled = (page) => page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 15000 });

/** Opens every element in turn and returns { angle, box } for each of ELEMENTS. */
async function measure(page, app, label) {
  await page.goto(app.url);
  await page.waitForFunction(
    () => document.getElementById('frame').naturalWidth > 0 && [...document.querySelectorAll('.poster-layer')].some((i) => i.naturalWidth > 0),
    null,
    { timeout: 15000 },
  );
  await settled(page);

  const read = (selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const t = getComputedStyle(el).transform;
      let angle = 0;
      if (t && t !== 'none') {
        const [a, b] = t.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
        angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
        angle = ((angle % 360) + 360) % 360;
      }
      return { angle, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, shown: r.width > 0 && r.height > 0 };
    }, selector);

  const out = {};

  // Controls: wake them, then click the pin button, which raises a real toast.
  await page.mouse.move(40, 40);
  await page.waitForFunction(() => document.getElementById('controls').classList.contains('visible'));
  await settled(page);
  out.controls = await read(ELEMENTS.controls);
  await shot(page, `${label}-controls`);
  await page.click('#controls [data-action="pin"]');
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  // The pin toast names a random poster; fix the text so boxes compare across runs.
  await page.evaluate(() => (document.getElementById('toast').textContent = 'Pinned a poster.'));
  await settled(page);
  out.toast = await read(ELEMENTS.toast);

  // Empty state: the app only shows it on a fatal error, so unhide it directly.
  await page.evaluate(() => (document.getElementById('empty').hidden = false));
  out.emptyCard = await read(ELEMENTS.emptyCard);
  await page.evaluate(() => (document.getElementById('empty').hidden = true));

  for (const [key, shortcut, id] of [['settings', 's', 'settings'], ['diagnostics', 'd', 'diagnostics']]) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(shortcut);
    await page.waitForFunction((i) => document.getElementById(i).open, id);
    await settled(page);
    out[key] = await read(ELEMENTS[key]);
    await shot(page, `${label}-${key}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction((i) => !document.getElementById(i).open, id);
  }
  return out;
}

/** Bounding box in the viewer's frame (the screen frame rotated back by `rotation`). */
function viewerRect(box, rotation, vw, vh) {
  const th = (rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(th));
  const s = Math.round(Math.sin(th));
  const cx = (box.left + box.right) / 2 - vw / 2;
  const cy = (box.top + box.bottom) / 2 - vh / 2;
  const x = cx * c + cy * s;
  const y = -cx * s + cy * c;
  const sideways = rotation === 90 || rotation === 270;
  const hw = (sideways ? box.height : box.width) / 2;
  const hh = (sideways ? box.width : box.height) / 2;
  const uw = sideways ? vh : vw;
  const uh = sideways ? vw : vh;
  return { gapRight: uw / 2 - (x + hw), gapBottom: uh / 2 - (y + hh), gapTop: y - hh + uh / 2, width: hw * 2, height: hh * 2, uw, uh };
}

const inside = (b, vw, vh) => b.left >= -1 && b.top >= -1 && b.right <= vw + 1 && b.bottom <= vh + 1;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

for (const viewport of VIEWPORTS) {
  const { width: vw, height: vh } = viewport;

  // rotateUi true: every element carries the stage rotation and stays on screen.
  for (const rotation of [90, 180, 270]) {
    const name = `${vw}x${vh} rotation ${rotation} rotateUi on`;
    await withApp({ settings: seedFor(rotation, true), viewport }, async ({ page, app }) => {
      const r = await measure(page, app, `${vw}x${vh}-r${rotation}`);
      for (const key of Object.keys(ELEMENTS)) {
        assert.ok(r[key].shown, `${name}: ${key} is displayed`);
        assert.equal(r[key].angle, rotation, `${name}: ${key} angle`);
        assert.ok(inside(r[key].box, vw, vh), `${name}: ${key} inside viewport ${JSON.stringify(r[key].box)}`);
      }
      const c = viewerRect(r.controls.box, rotation, vw, vh);
      assert.ok(near(c.gapRight, 12, 2) && near(c.gapBottom, 12, 2), `${name}: controls at the viewer's bottom-right ${JSON.stringify(c)}`);
      for (const key of ['settings', 'diagnostics']) {
        const d = viewerRect(r[key].box, rotation, vw, vh);
        assert.ok(near(d.gapRight, 0) && near(d.gapTop, 0) && near(d.height, d.uh, 1), `${name}: ${key} docked to the viewer's right edge ${JSON.stringify(d)}`);
      }
      const t = viewerRect(r.toast.box, rotation, vw, vh);
      assert.ok(near(t.gapBottom, 88, 2), `${name}: toast 88px above the viewer's bottom ${JSON.stringify(t)}`);
      console.log(`  ok  ${name}`);
    });
  }

  // rotateUi false: nothing is rotated, whatever the stage does.
  for (const rotation of [90, 180, 270]) {
    const name = `${vw}x${vh} rotation ${rotation} rotateUi off`;
    await withApp({ settings: seedFor(rotation, false), viewport }, async ({ page, app }) => {
      const r = await measure(page, app, `${vw}x${vh}-r${rotation}-off`);
      for (const key of Object.keys(ELEMENTS)) {
        assert.ok(r[key].shown, `${name}: ${key} is displayed`);
        assert.equal(r[key].angle, 0, `${name}: ${key} not rotated`);
      }
      console.log(`  ok  ${name}`);
    });
  }

  // Rotation 0: rotateUi on and off give the same boxes.
  let on;
  let off;
  await withApp({ settings: seedFor(0, true), viewport }, async ({ page, app }) => {
    on = await measure(page, app, `${vw}x${vh}-r0`);
  });
  await withApp({ settings: seedFor(0, false), viewport }, async ({ page, app }) => {
    off = await measure(page, app, `${vw}x${vh}-r0-off`);
  });
  for (const key of Object.keys(ELEMENTS)) {
    assert.equal(on[key].angle, 0, `${vw}x${vh} rotation 0: ${key} angle`);
    for (const side of ['left', 'top', 'right', 'bottom']) {
      assert.ok(near(on[key].box[side], off[key].box[side]), `${vw}x${vh} rotation 0: ${key} ${side} ${on[key].box[side]} vs ${off[key].box[side]}`);
    }
  }
  console.log(`  ok  ${vw}x${vh} rotation 0 matches rotateUi off`);
}

// Short landscape viewport: a long toast must wrap inside the viewer's width, not the physical one.
const SHORT = { width: 844, height: 390 };
const LONG_TOAST = 'Pinned a poster for the whole evening, so the rotation will not change it until you unpin it from the controls bar. Done.';
for (const rotation of [90, 270]) {
  const name = `${SHORT.width}x${SHORT.height} rotation ${rotation} long toast`;
  await withApp({ settings: seedFor(rotation, true), viewport: SHORT }, async ({ page, app }) => {
    await page.goto(app.url);
    await page.waitForFunction(() => document.getElementById('frame').naturalWidth > 0, null, { timeout: 15000 });
    await settled(page);
    await page.evaluate((text) => {
      const t = document.getElementById('toast');
      t.textContent = text;
      t.hidden = false;
    }, LONG_TOAST);
    await settled(page);
    const box = await page.evaluate(() => {
      const r = document.getElementById('toast').getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    assert.ok(inside(box, SHORT.width, SHORT.height), `${name}: toast inside viewport ${JSON.stringify(box)}`);
    console.log(`  ok  ${name}`);
  });
}
