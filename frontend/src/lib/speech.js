// "Listen": reads text aloud with the device's own voices (Web Speech API).
// Free, offline and private — nothing is sent anywhere. Availability depends on
// the voices installed on the phone/computer, so the UI asks hasVoice() first.
import { speechTag } from './languages';

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';

/** Voices load asynchronously (Chrome/Android); wait for them, but never forever. */
export function voicesReady(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const synth = window.speechSynthesis;
    const have = synth.getVoices();
    if (have.length) return resolve(have);
    const done = () => {
      synth.removeEventListener?.('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

/** The best installed voice for a language code, or null. */
export function pickVoice(voices, code) {
  const tag = speechTag(code).toLowerCase();
  const base = code.toLowerCase();
  const matching = voices.filter((v) => {
    const l = v.lang.toLowerCase().replace('_', '-');
    return l === tag || l.split('-')[0] === base;
  });
  if (!matching.length) return null;
  return (
    matching.find((v) => v.lang.toLowerCase().replace('_', '-') === tag && v.localService) ||
    matching.find((v) => v.lang.toLowerCase().replace('_', '-') === tag) ||
    matching.find((v) => v.localService) ||
    matching[0]
  );
}

export async function hasVoice(code) {
  return !!pickVoice(await voicesReady(), code);
}

/** Chrome silently stops long utterances after ~15 s, so read sentence by sentence. */
export function chunkForSpeech(text, max = 220) {
  const pieces = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    let buf = '';
    for (const s of line.split(/(?<=[.!?…。！？؟])\s*/)) {
      if (!s) continue;
      if (buf && (buf + ' ' + s).length > max) {
        pieces.push(buf);
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
      while (buf.length > max) {
        const at = buf.lastIndexOf(' ', max);
        const cut = at > max * 0.4 ? at : max;
        pieces.push(buf.slice(0, cut));
        buf = buf.slice(cut).trim();
      }
    }
    if (buf) pieces.push(buf);
  }
  return pieces;
}

let generation = 0;

export function stopSpeaking() {
  generation++;
  if (speechSupported()) window.speechSynthesis.cancel();
}

/**
 * Reads `text` aloud. Resolves when it has finished or was stopped; rejects with
 * Error('no-voice') when this device has no voice for the language.
 */
export async function speak(text, code, { rate = 1, onStart } = {}) {
  if (!speechSupported()) throw new Error('unsupported');
  const voice = pickVoice(await voicesReady(), code);
  if (!voice) throw new Error('no-voice');

  stopSpeaking();
  const mine = generation;
  const synth = window.speechSynthesis;
  onStart?.();

  for (const piece of chunkForSpeech(text)) {
    if (mine !== generation) return;
    await new Promise((resolve) => {
      const u = new window.SpeechSynthesisUtterance(piece);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = rate;
      u.onend = resolve;
      u.onerror = resolve;
      synth.speak(u);
    });
  }
}
