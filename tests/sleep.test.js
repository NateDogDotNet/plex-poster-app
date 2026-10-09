import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSleep, MANUAL_WAKE_MS } from '../js/sleep.js';
import { defaults } from '../js/settings.js';

const at = (h, m = 0, day = 5) => new Date(2026, 0, day, h, m);
const HOUR = 3600_000;

// Settings with the schedule on (01:00-07:00 unless overridden) and nothing else.
const cfg = (o = {}) => ({ ...defaults(), sleepEnabled: true, ...o });
const decide = (o) => decideSleep({ now: at(3), settings: cfg(), lastPlaybackAt: at(2).getTime(), playingNow: false, manualWakeUntil: 0, clockOk: true, ...o });

test('inside the window the display sleeps for the schedule', () => {
  assert.deepEqual(decide(), { asleep: true, why: 'schedule' });
  assert.deepEqual(decide({ now: at(1, 0) }), { asleep: true, why: 'schedule' });
});

test('outside the window the display is awake', () => {
  assert.deepEqual(decide({ now: at(12) }), { asleep: false, why: '' });
  assert.deepEqual(decide({ now: at(7, 0) }), { asleep: false, why: '' });
  assert.deepEqual(decide({ now: at(0, 59) }), { asleep: false, why: '' });
});

test('a window crossing midnight sleeps on both sides of it', () => {
  const settings = cfg({ sleepStart: '22:00', sleepEnd: '06:00' });
  for (const [h, asleep] of [[21, false], [22, true], [23, true], [0, true], [5, true], [6, false], [12, false]]) {
    assert.equal(decide({ settings, now: at(h) }).asleep, asleep, `hour ${h}`);
  }
});

test('idle sleep starts at exactly N hours without playback', () => {
  const settings = cfg({ sleepEnabled: false, idleSleepHours: 2 });
  const last = at(12).getTime();
  assert.deepEqual(decide({ settings, now: new Date(last + 2 * HOUR - 1), lastPlaybackAt: last }), { asleep: false, why: '' });
  assert.deepEqual(decide({ settings, now: new Date(last + 2 * HOUR), lastPlaybackAt: last }), { asleep: true, why: 'idle' });
  assert.deepEqual(decide({ settings, now: new Date(last + 30 * HOUR), lastPlaybackAt: last }), { asleep: true, why: 'idle' });
});

test('idle sleep is independent of sleepEnabled', () => {
  const last = at(12).getTime();
  const now = new Date(last + 61 * 60_000);
  assert.equal(decide({ settings: cfg({ sleepEnabled: true, idleSleepHours: 1 }), now: at(12, 0), lastPlaybackAt: last - 2 * HOUR }).why, 'idle');
  assert.equal(decide({ settings: cfg({ sleepEnabled: false, idleSleepHours: 1 }), now, lastPlaybackAt: last }).why, 'idle');
});

test('playback wakes the display during the window when wakeOnPlayback is on', () => {
  assert.deepEqual(decide({ playingNow: true }), { asleep: false, why: '' });
});

test('playback does not wake the display when wakeOnPlayback is off', () => {
  const settings = cfg({ wakeOnPlayback: false });
  assert.deepEqual(decide({ settings, playingNow: true }), { asleep: true, why: 'schedule' });
});

test('playback ending puts the display back to sleep', () => {
  assert.equal(decide({ playingNow: true }).asleep, false);
  assert.equal(decide({ playingNow: false }).asleep, true);
});

test('manual wake lasts 60 s, then the display sleeps again', () => {
  assert.equal(MANUAL_WAKE_MS, 60_000);
  const now = at(3);
  const until = now.getTime() + MANUAL_WAKE_MS;
  assert.deepEqual(decide({ now, manualWakeUntil: until }), { asleep: false, why: 'manual wake' });
  assert.deepEqual(decide({ now: new Date(until - 1), manualWakeUntil: until }), { asleep: false, why: 'manual wake' });
  assert.deepEqual(decide({ now: new Date(until), manualWakeUntil: until }), { asleep: true, why: 'schedule' });
});

test('manual wake also lifts idle sleep and beats wakeOnPlayback being off', () => {
  const last = at(12).getTime();
  const now = new Date(last + 3 * HOUR);
  const settings = cfg({ sleepEnabled: false, idleSleepHours: 1, wakeOnPlayback: false });
  assert.equal(decide({ settings, now, lastPlaybackAt: last }).asleep, true);
  assert.deepEqual(decide({ settings, now, lastPlaybackAt: last, manualWakeUntil: now.getTime() + 1 }), { asleep: false, why: 'manual wake' });
});

test('a manual wake while nothing would sleep the display is not reported', () => {
  assert.deepEqual(decide({ now: at(12), manualWakeUntil: at(12).getTime() + 1000 }), { asleep: false, why: '' });
});

test('sleepEnabled:false with idleSleepHours:0 never sleeps', () => {
  const settings = cfg({ sleepEnabled: false, idleSleepHours: 0 });
  for (const h of [0, 3, 12, 23]) assert.equal(decide({ settings, now: at(h), lastPlaybackAt: 0 }).asleep, false, `hour ${h}`);
});

test('clockOk:false ignores the schedule but not idle sleep', () => {
  assert.deepEqual(decide({ clockOk: false }), { asleep: false, why: '' });
  const settings = cfg({ idleSleepHours: 1 });
  const last = at(3).getTime();
  assert.deepEqual(decide({ settings, clockOk: false, lastPlaybackAt: last, now: new Date(last + 2 * HOUR) }), { asleep: true, why: 'idle' });
});

test('an empty window (start === end) never sleeps', () => {
  assert.equal(decide({ settings: cfg({ sleepStart: '03:00', sleepEnd: '03:00' }) }).asleep, false);
});

test('the schedule wins the label when both triggers hold', () => {
  const settings = cfg({ idleSleepHours: 1 });
  assert.deepEqual(decide({ settings, lastPlaybackAt: 0 }), { asleep: true, why: 'schedule' });
});
