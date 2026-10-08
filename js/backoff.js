// Exponential backoff with jitter for retrying failed Plex requests.

export function createBackoff({ baseMs = 5000, maxMs = 300000, factor = 2, jitter = 0.2, random = Math.random } = {}) {
  let attempt = 0;
  return {
    /** Delay before the next retry; each call doubles it up to maxMs. */
    next() {
      const raw = Math.min(maxMs, baseMs * factor ** attempt);
      attempt++;
      const spread = raw * jitter;
      return Math.round(raw - spread + random() * spread * 2);
    },
    reset() {
      attempt = 0;
    },
    get attempt() {
      return attempt;
    },
  };
}
