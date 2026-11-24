// Text handed to the app from outside, so it can be translated at once:
//   Android   "Share → Quarc Translate" and the "Translate" entry in the text-selection menu
//             (native plugin IncomingText),
//   PWA       the installed web app as a share target (/?text=… — see manifest.json),
//   anywhere  a link such as  https://…:4003/?text=Hello&to=tr
import { create } from 'zustand';

/** Who is waiting for incoming text: the Translate page picks it up and clears it. */
const useIncomingStore = create((set) => ({
  pending: null, // { text, source?, target? }
  push: (payload) => set({ pending: payload }),
  take: () => {
    let taken = null;
    set((s) => {
      taken = s.pending;
      return { pending: null };
    });
    return taken;
  },
}));

export default useIncomingStore;

const MAX = 5000;

export function textFromUrl(search) {
  const p = new URLSearchParams(search);
  // A share from a browser puts the page address in `url`; a share from another app puts the text in `text`.
  const parts = [p.get('text') || p.get('q'), p.get('url')].filter(Boolean);
  const text = [...new Set(parts)].join('\n').slice(0, MAX);
  if (!text.trim()) return null;
  return { text, source: p.get('from') || undefined, target: p.get('to') || undefined };
}

export function consumeUrl() {
  if (typeof window === 'undefined') return null;
  const found = textFromUrl(window.location.search);
  if (found) window.history.replaceState({}, '', window.location.pathname);
  return found;
}

const plugin = () => (window?.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.IncomingText ?? null : null);

async function takeFromAndroid() {
  const p = plugin();
  if (!p) return;
  try {
    const { text } = await p.takePending();
    if (text && text.trim()) useIncomingStore.getState().push({ text: text.slice(0, MAX) });
  } catch {
    /* plugin missing in an older APK */
  }
}

let started = false;

/** Call once at start-up: picks up a share that launched the app and listens for later ones. */
export function startIncoming() {
  if (started) return;
  started = true;
  const fromUrl = consumeUrl();
  if (fromUrl) useIncomingStore.getState().push(fromUrl);

  const p = plugin();
  if (p) {
    takeFromAndroid();
    p.addListener?.('incoming', takeFromAndroid);
  }
}
