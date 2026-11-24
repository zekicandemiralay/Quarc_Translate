// Client for the self-hosted translation engine (docker-compose service
// `translate-engine`): free, keyless, and the text never leaves your server.
//
// This is the only place that knows the engine's HTTP shape and the only place
// that turns its failures into ApiErrors the app can act on:
//   engine unreachable          → 502 engine_unavailable
//   engine too slow             → 504 engine_timeout
//   model still downloading     → 503 model_preparing  (+ stage, retryAfter)
//   too many requests queued    → 503 busy

const { ApiError } = require('../errors');

/** At most `limit` calls run at once; the rest wait (up to `maxQueue`). */
function createGate(limit, maxQueue = 64) {
  let active = 0;
  const waiting = [];
  // A finished task hands its slot straight to the next waiter (active stays
  // the same), so a caller arriving in between can never jump the queue.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async function run(task, signal) {
    if (active < limit) {
      active++;
    } else {
      if (waiting.length >= maxQueue) throw new ApiError(503, 'busy', 'The translation engine is busy, try again in a moment');
      await new Promise((resolve, reject) => {
        const entry = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          reject(signal.reason || new Error('aborted'));
        };
        waiting.push(entry);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function createEngineClient({ baseUrl: rawBaseUrl, timeoutMs = 45000, concurrency = 3, fetchImpl = fetch } = {}) {
  const baseUrl = String(rawBaseUrl).replace(/\/+$/, '');
  const gate = createGate(concurrency);

  async function call(path, { method = 'GET', body, signal, timeout = timeoutMs } = {}) {
    const signals = [AbortSignal.timeout(timeout)];
    if (signal) signals.push(signal);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if (signal?.aborted) throw err; // the caller gave up — not an engine problem
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new ApiError(504, 'engine_timeout', 'The translation engine took too long to answer');
      }
      throw new ApiError(502, 'engine_unavailable', 'The translation engine is unavailable right now', { detail: err.message });
    }

    if (res.ok) return res.json();

    const payload = await res.json().catch(() => ({}));
    // FastAPI wraps errors as { detail: ... }; the engine's own are { detail: { code, message, ... } }.
    const detail = typeof payload.detail === 'object' && payload.detail ? payload.detail : { message: payload.detail || payload.error };
    const message = detail.message || `Engine responded ${res.status}`;
    if (res.status === 503 && detail.code === 'model_preparing') {
      throw new ApiError(503, 'model_preparing', message, {
        model: detail.model,
        stage: detail.stage,
        pct: detail.pct ?? null, // download progress, when the engine knows it
        pair: detail.pair,
        retryAfter: detail.retryAfter ?? 3,
      });
    }
    if (res.status >= 400 && res.status < 500) {
      throw new ApiError(res.status === 422 ? 400 : res.status, detail.code || 'engine_rejected', message);
    }
    throw new ApiError(502, detail.code || 'engine_failed', message);
  }

  return {
    health: () => call('/health', { timeout: 5000 }),
    languages: () => call('/languages', { timeout: 10000 }),
    models: () => call('/models', { timeout: 10000 }),
    prepare: (pairs) => call('/models/prepare', { method: 'POST', body: { pairs }, timeout: 10000 }),
    detect: (text, signal) => call('/detect', { method: 'POST', body: { q: text }, signal, timeout: 10000 }),
    // "Did you mean…". The first call after a restart waits for the Turkish data to load once, hence the longer timeout.
    suggest: ({ text, source, signal }) => call('/suggest', { method: 'POST', body: { q: text, source }, signal, timeout: 20000 }),
    // Other translations of one sentence (the model's n-best). Goes through the same gate as translation: it is the same CPU work.
    alternatives: ({ text, source, target, signal }) =>
      gate(() => call('/alternatives', { method: 'POST', body: { q: text, source, target }, signal }), signal),
    translate: ({ text, source, target, signal }) =>
      gate(() => call('/translate', { method: 'POST', body: { q: text, source, target }, signal }), signal),
  };
}

module.exports = { createEngineClient, createGate };
