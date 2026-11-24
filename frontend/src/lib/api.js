import { apiUrl } from './apiUrl';

/** Every failure from the server, with the `code` the backend sends so the UI can react to it. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = null;
/** Called once when the server says the login is gone (App wires this to the session check). */
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(path, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server', { code: 'network' });
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const { error, code, ...details } = data;
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(error || `Request failed (${res.status})`, { status: res.status, code: code || `http_${res.status}`, details });
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

// ── translation ────────────────────────────────────────────────────────────

export const fetchLanguages = () => request('/api/translate/languages');

/** One request to the engine. `save:false` — the app saves history itself when you stop typing. */
export const translateRequest = ({ text, source, target, signal }) =>
  request('/api/translate', { method: 'POST', body: { text, source, target, save: false }, signal });

export const detectRequest = (text, signal) => request('/api/translate/detect', { method: 'POST', body: { text }, signal });

/** "Did you mean…": Turkish typed without ç ğ ı ö ş ü, typos, missing accents. → { language, suggestion | null } */
export const suggestRequest = ({ text, source, signal }) => request('/api/translate/suggest', { method: 'POST', body: { text, source }, signal });

/** Other translations of ONE sentence (the model's n-best). → { alternatives: string[] } */
export const alternativesRequest = ({ text, source, target, signal }) =>
  request('/api/translate/alternatives', { method: 'POST', body: { text, source, target }, signal });

export const fetchEngineModels = () => request('/api/translate/models');

/** Asks the server to start fetching the language pack for a pair in the background. */
export const prepareModels = (source, target) =>
  request('/api/translate/prepare', { method: 'POST', body: { source, target } }).catch(() => null);

// ── history ────────────────────────────────────────────────────────────────

export const fetchHistory = ({ limit = 50, offset = 0, favorite = false, q = '', signal } = {}) => {
  const params = new URLSearchParams({ limit, offset });
  if (favorite) params.set('favorite', 'true');
  if (q) params.set('q', q);
  return request(`/api/history?${params}`, { signal });
};

export const saveHistory = (entry) => request('/api/history', { method: 'POST', body: entry });

export const setFavorite = (id, favorite) => request(`/api/history/${id}/favorite`, { method: 'PATCH', body: { favorite } });

export const deleteHistoryItem = (id) => request(`/api/history/${id}`, { method: 'DELETE' });

export const clearHistory = (keepFavorites = false) => request(`/api/history${keepFavorites ? '?keepFavorites=true' : ''}`, { method: 'DELETE' });

/** The whole history as a file (json | csv) → Blob. */
export async function exportHistory(format = 'json') {
  const res = await request(`/api/history/export?format=${format}`, { raw: true });
  return res.blob();
}

// ── preferences ────────────────────────────────────────────────────────────

export const fetchPrefs = () => request('/api/prefs');

export const updatePrefs = (patch) => request('/api/prefs', { method: 'PUT', body: patch });
