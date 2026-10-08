// Pure local-time helpers shared by the schedule features (sleep, night dim, daily reload).
// Callers pass `now`; nothing here reads the clock or touches the DOM.

/** A Pi has no RTC, so a clock before this year is treated as not yet set. Bump it when it ages. */
export const MIN_PLAUSIBLE_YEAR = 2026;

const DAY_MS = 86400_000;

/** 'HH:MM' (00:00-23:59) -> minutes since midnight, or null. */
export function parseHHMM(s) {
  const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * True when the local wall-clock time of `date` is inside [start, end). Windows may cross
 * midnight; start === end is an empty window (never inside), not 24 h. Bad input is outside.
 */
export function inWindow(date, start, end) {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e || !validDate(date)) return false;
  const m = date.getHours() * 60 + date.getMinutes();
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Local time of day on the given calendar day; a time skipped by spring-forward resolves to the transition instant. */
function occurrence(y, mo, d, h, mi) {
  const c = new Date(y, mo, d, h, mi);
  if (c.getHours() === h && c.getMinutes() === mi) return c.getTime();
  // Nonexistent local time: walk back to the first valid instant after the gap.
  let t = c.getTime();
  const off = c.getTimezoneOffset();
  for (let i = 0; i < 360 && new Date(t - 60_000).getTimezoneOffset() === off; i++) t -= 60_000;
  return t;
}

/**
 * Milliseconds from `date` to the next local occurrence of 'HH:MM' strictly after it.
 * Always finite and > 0; unparseable input falls back to 24 h so a timer can never spin.
 */
export function msUntilNext(date, hhmm) {
  const mins = parseHHMM(hhmm);
  if (mins === null || !validDate(date)) return DAY_MS;
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  const now = date.getTime();
  let t = occurrence(date.getFullYear(), date.getMonth(), date.getDate(), h, mi);
  if (t <= now) t = occurrence(date.getFullYear(), date.getMonth(), date.getDate() + 1, h, mi);
  const ms = t - now;
  return Number.isFinite(ms) && ms > 0 ? ms : DAY_MS;
}

/** False until the system clock looks set (year >= MIN_PLAUSIBLE_YEAR). */
export function isPlausibleClock(date) {
  return validDate(date) && date.getFullYear() >= MIN_PLAUSIBLE_YEAR;
}
