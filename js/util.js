// Small shared helpers: safe storage, event log, toast, ids.

/** localStorage that never throws (private mode, blocked storage) — falls back to memory. */
export function safeStorage() {
  const memory = new Map();
  let ls = null;
  try {
    ls = window.localStorage;
    const probe = '__probe__';
    ls.setItem(probe, probe);
    ls.removeItem(probe);
  } catch {
    ls = null;
  }
  return {
    persistent: Boolean(ls),
    getItem: (k) => {
      try {
        return ls ? ls.getItem(k) : memory.has(k) ? memory.get(k) : null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        if (ls) ls.setItem(k, v);
        else memory.set(k, String(v));
      } catch {
        memory.set(k, String(v));
      }
    },
    removeItem: (k) => {
      try {
        if (ls) ls.removeItem(k);
      } catch {
        // ignore
      }
      memory.delete(k);
    },
  };
}

export function clientId(storage) {
  const KEY = 'plexPoster.clientId';
  let id = storage.getItem(KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    storage.setItem(KEY, id);
  }
  return id;
}

/** Ring buffer of recent events for the diagnostics panel. */
export function createLog(limit = 60) {
  const entries = [];
  const listeners = new Set();
  const add = (level, message) => {
    entries.unshift({ at: new Date(), level, message });
    entries.length = Math.min(entries.length, limit);
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[poster] ${message}`);
    listeners.forEach((fn) => fn());
  };
  return {
    entries,
    info: (m) => add('info', m),
    warn: (m) => add('warn', m),
    error: (m) => add('error', m),
    onChange: (fn) => listeners.add(fn),
  };
}

let toastTimer;
export function toast(message, { action, onAction, ms = 5000 } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small primary';
    b.textContent = action;
    b.addEventListener('click', () => {
      el.hidden = true;
      onAction?.();
    });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
