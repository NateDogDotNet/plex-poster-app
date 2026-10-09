// Pure sleep decision (sleep schedule and idle sleep). No DOM, no clock reads: main.js passes everything in.

import { inWindow } from './schedule.js';

/** How long a touch or key press keeps the display awake. */
export const MANUAL_WAKE_MS = 60_000;

/**
 * Decides whether the display should be black right now.
 *
 *   now             Date (wall clock; the schedule uses its local time)
 *   settings        sleepEnabled, sleepStart, sleepEnd, idleSleepHours, wakeOnPlayback
 *   lastPlaybackAt  ms (same clock as now.getTime()) of the last poll that saw playback
 *   playingNow      the last poll saw a matching session
 *   manualWakeUntil ms; a user touch or key press sets it to now + MANUAL_WAKE_MS
 *   clockOk         isPlausibleClock(now); the schedule waits for it, idle sleep does not
 *
 * Returns { asleep, why }: why is 'schedule' or 'idle' while asleep, 'manual wake' while a manual
 * wake is holding off a sleep, and '' otherwise.
 */
export function decideSleep({ now, settings, lastPlaybackAt = 0, playingNow = false, manualWakeUntil = 0, clockOk = true }) {
  const t = now.getTime();
  const idleMs = settings.idleSleepHours * 3600_000;
  const why =
    settings.sleepEnabled && clockOk && inWindow(now, settings.sleepStart, settings.sleepEnd)
      ? 'schedule'
      : idleMs > 0 && t - lastPlaybackAt >= idleMs
        ? 'idle'
        : '';
  if (!why || (playingNow && settings.wakeOnPlayback)) return { asleep: false, why: '' };
  if (t < manualWakeUntil) return { asleep: false, why: 'manual wake' };
  return { asleep: true, why };
}
