import { apiUrl } from './apiUrl';

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const fetchLanguages = () => request('/api/translate/languages');

export const translateText = (text, source, target) =>
  request('/api/translate', { method: 'POST', body: JSON.stringify({ text, source, target }) });

export const fetchHistory = ({ limit = 50, offset = 0, favorite = false } = {}) =>
  request(`/api/history?limit=${limit}&offset=${offset}${favorite ? '&favorite=true' : ''}`);

export const setFavorite = (id, favorite) =>
  request(`/api/history/${id}/favorite`, { method: 'PATCH', body: JSON.stringify({ favorite }) });

export const deleteHistoryItem = (id) => request(`/api/history/${id}`, { method: 'DELETE' });

export const clearHistory = (keepFavorites = false) =>
  request(`/api/history${keepFavorites ? '?keepFavorites=true' : ''}`, { method: 'DELETE' });

export const fetchPrefs = () => request('/api/prefs');

export const updatePrefs = (patch) => request('/api/prefs', { method: 'PUT', body: JSON.stringify(patch) });
