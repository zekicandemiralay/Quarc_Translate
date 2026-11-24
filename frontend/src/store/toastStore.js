import { create } from 'zustand';

let seq = 0;

/** Tiny transient messages ("Copied", "No voice for Turkish on this device"). */
const useToastStore = create((set, get) => ({
  toasts: [],
  show(message, { kind = 'info', ms = 2200 } = {}) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { id, message, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms);
  },
}));

export const toast = (message, opts) => useToastStore.getState().show(message, opts);

export default useToastStore;
