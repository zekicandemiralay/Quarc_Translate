// Turns "translate this text" into the right sequence of server requests.
// No React in here: the Translate page drives it, the tests drive it directly.
//
//   - long text is cut into chunks (segments.js) that are translated two at a time,
//     and the result grows on screen as the chunks arrive;
//   - a chunk already translated (same text, same languages) is not asked for again,
//     so editing one paragraph only re-translates that paragraph;
//   - "the language pack is still downloading" (the very first use of a language)
//     is waited out with a progress notification, instead of failing;
//   - busy / rate-limited / dropped-connection answers are retried a few times.

import { ApiError } from './api';
import { splitForRequests, joinChunks } from './segments';

const PARALLEL = 2;
const PREPARE_DEADLINE_MS = 25 * 60 * 1000; // a first-time download+conversion takes minutes, not hours
const MAX_RETRIES = 2;

const abortError = () => {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
};

export const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * One list of pieces for the whole text. Sentence ids become "<chunk>:<sentence>" so they are unique across chunks.
 * Returns nulls when the server sent no segments (an older server), and the app then just shows plain text.
 */
function assemble(chunks, results) {
  let any = false;
  const segments = [];
  const units = {};
  chunks.forEach((chunk, i) => {
    const res = results[i];
    if (res.segments) {
      any = true;
      for (const s of res.segments) segments.push({ t: s.t, u: s.u == null ? null : `${i}:${s.u}` });
      (res.units || []).forEach((u, k) => {
        units[`${i}:${k}`] = u;
      });
    } else {
      segments.push({ t: res.translatedText ?? '', u: null });
    }
    if (chunk.sep) segments.push({ t: chunk.sep, u: null });
  });
  return any ? { segments, units } : { segments: null, units: null };
}

export function createTranslator({ api, sleep = defaultSleep, now = Date.now, cacheSize = 500, chunkLimit } = {}) {
  const cache = new Map(); // `${source}\0${target}\0${chunk}` → response (insertion order = age)

  const remember = (key, value) => {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  };

  /** One chunk, with every retry rule. */
  async function ask({ text, source, target, signal, onPreparing }) {
    const started = now();
    let transient = 0;
    let limited = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      try {
        const res = await api.translateRequest({ text, source, target, signal });
        onPreparing?.(null);
        return res;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (!(err instanceof ApiError)) throw err;

        if (err.code === 'model_preparing') {
          if (now() - started > PREPARE_DEADLINE_MS) throw err;
          onPreparing?.({ stage: err.details.stage, pct: err.details.pct ?? null, pair: err.details.pair, model: err.details.model });
          await sleep(Math.min(Math.max((err.details.retryAfter || 3) * 1000, 1500), 8000), signal);
          continue;
        }
        if (err.code === 'rate_limited' && limited++ < 3) {
          await sleep(Math.min((err.details.retryAfter || 2) * 1000, 10000), signal);
          continue;
        }
        const retryable = err.code === 'network' || err.code === 'busy' || [502, 503, 504].includes(err.status);
        if (retryable && err.code !== 'model_failed' && transient++ < MAX_RETRIES) {
          await sleep(transient === 1 ? 800 : 2000, signal);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * @param {object} p
   * @param {string} p.text
   * @param {string} p.source   language code or 'auto'
   * @param {string} p.target
   * @param {AbortSignal} [p.signal]
   * @param {(p: {text: string, done: number, total: number}) => void} [p.onProgress]  text so far (finished leading chunks)
   * @param {(p: {stage, pct, pair, model} | null) => void} [p.onPreparing]
   * @returns {Promise<{text, detected, confidence, hint, sameLanguage, cached, route, chunks}>}
   */
  async function run({ text, source, target, signal, onProgress, onPreparing }) {
    const chunks = splitForRequests(text, chunkLimit);
    const total = chunks.length;
    if (!total || !text.trim()) return { text: '', segments: null, units: null, detected: null, confidence: null, hint: null, sameLanguage: false, cached: true, route: null, chunks: 0 };

    // One detection for the whole text, so every chunk is translated from the same language
    // (a short chunk like "Hotel" would otherwise be guessed on its own).
    let effectiveSource = source;
    let detected = null;
    let confidence = null;
    const worth = chunks.filter((c) => !c.blank);
    if (source === 'auto' && worth.length > 1) {
      try {
        const d = await api.detectRequest(text.slice(0, 2000), signal);
        if (d?.language && d.confidence >= 0.3) effectiveSource = d.language;
        detected = d?.language || null;
        confidence = d?.confidence ?? null;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        // detection is an optimisation: fall back to detecting per chunk
      }
    }

    if (effectiveSource !== 'auto' && effectiveSource === target) {
      return { text, segments: null, units: null, detected, confidence, hint: null, sameLanguage: source === 'auto', cached: true, route: null, chunks: total };
    }

    const results = new Array(total).fill(null);
    let done = 0;
    let allCached = true;
    let next = 0;
    let best = null; // response of the longest chunk: its detection/hint/route describe the text best

    const publish = () => {
      if (!onProgress) return;
      let upTo = 0;
      while (upTo < total && results[upTo] !== null) upTo++;
      const partial = joinChunks(chunks.slice(0, upTo), results.slice(0, upTo).map((r) => r.translatedText));
      onProgress({ text: partial, done, total });
    };

    async function worker() {
      while (next < total) {
        const i = next++;
        const chunk = chunks[i];
        if (chunk.blank) {
          results[i] = { translatedText: chunk.text };
        } else {
          const key = `${effectiveSource}\u0000${target}\u0000${chunk.text}`;
          let res = cache.get(key);
          if (res) {
            remember(key, res);
          } else {
            allCached = false;
            res = await ask({ text: chunk.text, source: effectiveSource, target, signal, onPreparing });
            if (res.translatedText || !chunk.text.trim()) remember(key, res);
          }
          results[i] = res;
          if (!best || chunk.text.length > best.length) best = { length: chunk.text.length, res };
        }
        done++;
        publish();
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(PARALLEL, total); w++) workers.push(worker());
    try {
      await Promise.all(workers);
    } catch (err) {
      next = total; // stop the other worker from starting more chunks
      throw err;
    }

    const r = best?.res || {};
    if (detected === null) {
      detected = r.detectedLang || null;
      confidence = r.confidence ?? null;
    }
    const sameLanguage = source === 'auto' && !!detected && detected === target && (confidence ?? 0) >= 0.5;
    const pieces = sameLanguage ? { segments: null, units: null } : assemble(chunks, results);
    return {
      text: sameLanguage ? text : joinChunks(chunks, results.map((x) => x.translatedText)),
      // The result as tappable sentences (see lib/tappable.js); null when the server predates them.
      segments: pieces.segments,
      units: pieces.units,
      detected,
      confidence,
      hint: source === 'auto' ? null : r.hint || null,
      sameLanguage,
      cached: allCached,
      route: r.route || null,
      chunks: total,
    };
  }

  return { run, clear: () => cache.clear(), get size() { return cache.size; } };
}
