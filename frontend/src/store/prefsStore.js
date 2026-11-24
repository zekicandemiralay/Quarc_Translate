import { create } from 'zustand';
import { fetchPrefs, updatePrefs } from '../lib/api';

const KEY = 'quarc_translate_prefs_v2';
const PENDING_KEY = 'quarc_translate_prefs_pending_v2';

const deviceLanguage = () => (typeof navigator !== 'undefined' && /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en');

export const DEFAULTS = {
  source_lang: 'auto',
  target_lang: 'en',
  theme: 'auto',
  language: deviceLanguage(),
  font_size: 'm',
  live: true,
  suggestions: true,
  save_history: true,
  recent_langs: [],
};

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
};

/** Only the fields the server knows (it ignores the rest, but don't send noise). */
const clean = (prefs) => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, prefs[k]]));

const usePrefsStore = create((set, get) => ({
  // The last known values are applied immediately, so the right theme/language show
  // before the server answers and the app works with no connection at all.
  prefs: { ...DEFAULTS, ...(read(KEY) || {}) },
  loaded: false,

  async load() {
    try {
      // Changes made while offline go up first, so the server never overwrites them.
      const pending = read(PENDING_KEY);
      const server = pending ? await updatePrefs(pending) : await fetchPrefs();
      if (pending) write(PENDING_KEY, null);
      const prefs = { ...DEFAULTS, ...clean(server) };
      write(KEY, prefs);
      set({ prefs, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  /** Applies at once; the server catches up (and keeps retrying on the next start if offline). */
  async update(patch) {
    const prefs = { ...get().prefs, ...patch };
    write(KEY, prefs);
    set({ prefs });
    try {
      const server = await updatePrefs(patch);
      // Merge: a newer change made while this request was in flight must not be overwritten.
      const current = get().prefs;
      const merged = { ...DEFAULTS, ...clean(server) };
      const keep = Object.fromEntries(Object.keys(current).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(prefs[k])).map((k) => [k, current[k]]));
      const next = { ...merged, ...keep };
      write(KEY, next);
      set({ prefs: next });
      const pending = read(PENDING_KEY);
      if (pending) write(PENDING_KEY, null);
    } catch {
      write(PENDING_KEY, { ...(read(PENDING_KEY) || {}), ...patch });
    }
  },
}));

export default usePrefsStore;
