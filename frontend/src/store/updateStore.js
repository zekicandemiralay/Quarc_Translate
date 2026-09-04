import { create } from 'zustand';
import { checkForUpdate } from '../lib/updateCheck';

// Backs the startup update banner — checked automatically when the app opens,
// not only from the Settings screen, matching Quarc Music/Notes/Weather.
// A Zustand store rather than component state so the check runs once per app
// session even if the component tree remounts.
const useUpdateStore = create((set, get) => ({
  update: null,
  checked: false,
  dismissed: false,

  ensureChecked() {
    if (get().checked) return;
    set({ checked: true });
    // Delayed so it doesn't compete with the first translation the user is
    // probably already typing — an update banner can afford to arrive late.
    setTimeout(async () => {
      try {
        set({ update: await checkForUpdate() });
      } catch {
        /* no banner is not worth surfacing an error for */
      }
    }, 6000);
  },

  dismiss: () => set({ dismissed: true }),
}));

export default useUpdateStore;
