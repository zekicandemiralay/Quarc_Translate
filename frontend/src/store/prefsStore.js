import { create } from 'zustand';
import { fetchPrefs, updatePrefs } from '../lib/api';

const DEFAULTS = { source_lang: 'auto', target_lang: 'en', theme: 'auto', language: 'en' };

const usePrefsStore = create((set, get) => ({
  prefs: DEFAULTS,
  loaded: false,

  async load() {
    try {
      const prefs = await fetchPrefs();
      set({ prefs: { ...DEFAULTS, ...prefs }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  // Optimistic — applies locally right away, rolls back if the server
  // rejects it (e.g. a stale request landing after a newer one).
  async update(patch) {
    const prev = get().prefs;
    set({ prefs: { ...prev, ...patch } });
    try {
      const prefs = await updatePrefs(patch);
      set({ prefs: { ...DEFAULTS, ...prefs } });
    } catch {
      set({ prefs: prev });
    }
  },
}));

export default usePrefsStore;
