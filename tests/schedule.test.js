import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHHMM, inWindow, msUntilNext, isPlausibleClock, MIN_PLAUSIBLE_YEAR } from '../js/schedule.js';

const at = (h, m, day = 5, month = 0, year = 2026) => new Date(year, month, day, h, m);
const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

test('parseHHMM returns minutes since midnight or null', () => {
  assert.equal(parseHHMM('00:00'), 0);
  assert.equal(parseHHMM('04:30'), 270);
  assert.equal(parseHHMM('23:59'), 1439);
  for (const bad of ['24:00', '12:60', '7:00', '', 'x', null, undefined, 5]) assert.equal(parseHHMM(bad), null, String(bad));
});

test('inWindow same-day window is start-inclusive, end-exclusive', () => {
  assert.equal(inWindow(at(9, 0), '09:00', '17:00'), true);
  assert.equal(inWindow(at(16, 59), '09:00', '17:00'), true);
  assert.equal(inWindow(at(17, 0), '09:00', '17:00'), false);
  assert.equal(inWindow(at(8, 59), '09:00', '17:00'), false);
});

test('inWindow handles windows crossing midnight', () => {
  assert.equal(inWindow(at(22, 0), '22:00', '07:00'), true);
  assert.equal(inWindow(at(23, 30), '22:00', '07:00'), true);
  assert.equal(inWindow(at(0, 0), '22:00', '07:00'), true);
  assert.equal(inWindow(at(2, 0), '01:00', '07:00'), true);
  assert.equal(inWindow(at(6, 59), '22:00', '07:00'), true);
  assert.equal(inWindow(at(7, 0), '22:00', '07:00'), false);
  assert.equal(inWindow(at(12, 0), '22:00', '07:00'), false);
  assert.equal(inWindow(at(21, 59), '22:00', '07:00'), false);
});

test('inWindow treats start === end as empty, and bad input as outside', () => {
  for (const h of [0, 3, 12, 23]) assert.equal(inWindow(at(h, 0), '03:00', '03:00'), false);
  assert.equal(inWindow(at(3, 0), 'bad', '07:00'), false);
  assert.equal(inWindow(new Date(NaN), '01:00', '07:00'), false);
});

test('isPlausibleClock uses the year constant', () => {
  assert.equal(MIN_PLAUSIBLE_YEAR, 2026);
  assert.equal(isPlausibleClock(new Date(1970, 0, 1)), false);
  assert.equal(isPlausibleClock(new Date(2025, 11, 31, 23, 59)), false);
  assert.equal(isPlausibleClock(new Date(2026, 0, 1)), true);
  assert.equal(isPlausibleClock(new Date(2026, 9, 8)), true);
  assert.equal(isPlausibleClock(new Date(NaN)), false);
  assert.equal(isPlausibleClock(undefined), false);
});

test('msUntilNext is strictly after now', () => {
  assert.equal(msUntilNext(at(3, 0), '04:00'), 3600_000);
  assert.equal(msUntilNext(at(4, 0), '04:00'), 24 * 3600_000);
  assert.equal(msUntilNext(at(5, 0), '04:00'), 23 * 3600_000);
  assert.equal(msUntilNext(new Date(at(4, 0).getTime() - 1), '04:00'), 1);
});

test('msUntilNext never returns negative, NaN or zero, even on bad input', () => {
  for (const bad of ['', 'x', '25:00', null]) {
    const ms = msUntilNext(at(3, 0), bad);
    assert.ok(Number.isFinite(ms) && ms > 0, String(bad));
  }
  const ms = msUntilNext(new Date(NaN), '04:00');
  assert.ok(Number.isFinite(ms) && ms > 0);
});

for (const time of ['04:00', '02:30', '01:30', '00:00', '23:59']) {
  test(`400-day fire/re-arm simulation for ${time} fires once per local date (TZ=${process.env.TZ ?? 'default'})`, () => {
    let now = new Date(2026, 0, 1, 0, 0, 0).getTime();
    const seen = new Set();
    const end = now + 400 * 86400_000;
    let fires = 0;
    while (true) {
      const ms = msUntilNext(new Date(now), time);
      assert.ok(Number.isFinite(ms) && ms > 0, `bad delay ${ms} at ${new Date(now).toString()}`);
      assert.ok(ms <= 25 * 3600_000, `delay too long: ${ms}`);
      now += ms;
      if (now > end) break;
      const day = localDay(now);
      assert.equal(seen.has(day), false, `fired twice on ${day}`);
      seen.add(day);
      fires++;
    }
    assert.ok(fires >= 399 && fires <= 401, `fires=${fires}`);
  });
}

const offsetAt = (t) => new Date(t).getTimezoneOffset();
const wallMinutes = (t) => new Date(t).getHours() * 60 + new Date(t).getMinutes();
const toHHMM = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const zoneHasDst = offsetAt(new Date(2026, 0, 1)) !== offsetAt(new Date(2026, 6, 1));

/** Finds the local dates in 2026 whose midnight-to-midnight span contains an offset change. */
function transitionDays(kind) {
  const found = [];
  for (let d = 0; d < 366; d++) {
    const start = new Date(2026, 0, 1 + d, 0, 0).getTime();
    const end = new Date(2026, 0, 1 + d + 1, 0, 0).getTime();
    for (let t = start; t < end; t += 60_000) {
      const delta = offsetAt(t) - offsetAt(t - 60_000);
      if ((kind === 'fall' && delta < 0) || (kind === 'spring' && delta > 0)) {
        // getTimezoneOffset is positive west of UTC: a fall-back makes it grow
        found.push({ start, end, tr: t, diff: Math.abs(delta) });
      }
    }
  }
  return found;
}
const fallDays = () => transitionDays('spring'); // offset grows => clocks go back
const springDays = () => transitionDays('fall'); // offset shrinks => clocks go forward

test('spring-forward: a nonexistent local time fires at the first valid instant after it', (t) => {
  const days = springDays();
  if (!zoneHasDst) {
    t.diagnostic(`TZ=${process.env.TZ ?? 'default'} has no DST in 2026: no spring-forward day to check`);
    assert.equal(days.length, 0);
    return;
  }
  assert.ok(days.length >= 1, 'a DST zone must have a spring-forward day in 2026');
  for (const { tr, diff } of days) {
    const gapStart = wallMinutes(tr - 60_000) + 1; // first nonexistent wall minute
    const time = toHHMM(gapStart + Math.floor(diff / 2));
    const before = new Date(tr - 2 * 3600_000);
    const fire = before.getTime() + msUntilNext(before, time);
    assert.equal(fire, tr, `${time} on a spring-forward night fires at the transition instant`);
  }
});

test('fall-back: a repeated time fires once; inWindow is true at both occurrences', (t) => {
  const days = fallDays();
  if (!zoneHasDst) {
    t.diagnostic(`TZ=${process.env.TZ ?? 'default'} has no DST in 2026: no fall-back day to check`);
    assert.equal(days.length, 0);
    return;
  }
  assert.ok(days.length >= 1, 'a DST zone must have a fall-back day in 2026');
  let checked = 0;
  for (const { start, end, tr, diff } of days) {
    // The wall-clock minutes [wall(tr), wall(tr)+diff) happen twice; pick the middle one.
    const target = wallMinutes(tr) + Math.floor(diff / 2);
    const time = toHHMM(target);
    // Scan exactly one local date: both hits must be on that same date.
    const hits = [];
    for (let x = start; x < end; x += 60_000) {
      if (wallMinutes(x) === target % 1440) hits.push(new Date(x));
    }
    assert.equal(hits.length, 2, `${time} occurs twice on the fall-back date`);
    assert.equal(localDay(hits[0].getTime()), localDay(hits[1].getTime()), 'both occurrences are on the same local date');
    const winStart = toHHMM(target - 30);
    const winEnd = toHHMM(target + 60);
    for (const h of hits) {
      assert.equal(inWindow(h, winStart, winEnd), true, `${winStart}-${winEnd} at ${h.toString()}`);
      if (time === '01:30') assert.equal(inWindow(h, '01:00', '07:00'), true);
    }
    // The job fires once, at the first occurrence; neither occurrence re-arms onto the same date.
    const first = hits[0];
    const prev = new Date(first.getTime() - 60_000);
    assert.equal(prev.getTime() + msUntilNext(prev, time), first.getTime(), 'fires at the first occurrence');
    for (const h of hits) {
      const after = new Date(h.getTime() + msUntilNext(h, time));
      assert.notEqual(localDay(after.getTime()), localDay(first.getTime()), 'does not fire again the same date');
    }
    checked++;
  }
  assert.ok(checked >= 1);
});
