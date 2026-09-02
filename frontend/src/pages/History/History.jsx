import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchHistory, setFavorite, deleteHistoryItem, clearHistory } from '../../lib/api';

export default function History() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesOnly]);

  function load() {
    setLoading(true);
    setError('');
    fetchHistory({ favorite: favoritesOnly })
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function toggleFavorite(entry) {
    const next = !entry.is_favorite;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, is_favorite: next ? 1 : 0 } : e)));
    try {
      await setFavorite(entry.id, next);
    } catch {
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, is_favorite: entry.is_favorite } : e)));
    }
  }

  async function remove(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteHistoryItem(id);
    } catch {
      load();
    }
  }

  async function handleClear() {
    const message = favoritesOnly ? t('history.clearAllConfirm') : t('history.clearConfirm');
    if (!window.confirm(message)) return;
    try {
      await clearHistory(!favoritesOnly);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function reuse(entry) {
    navigate('/', { state: { reuse: entry } });
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('history.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-neutral-200 p-0.5 text-xs dark:bg-neutral-700">
            <button
              onClick={() => setFavoritesOnly(false)}
              className={`rounded-md px-2.5 py-1 font-medium ${!favoritesOnly ? 'bg-white shadow dark:bg-neutral-900' : 'text-neutral-500'}`}
            >
              {t('history.all')}
            </button>
            <button
              onClick={() => setFavoritesOnly(true)}
              className={`rounded-md px-2.5 py-1 font-medium ${favoritesOnly ? 'bg-white shadow dark:bg-neutral-900' : 'text-neutral-500'}`}
            >
              {t('history.favoritesOnly')}
            </button>
          </div>
          {entries.length > 0 && (
            <button onClick={handleClear} className="text-xs text-red-500 hover:underline">
              {t('history.clear')}
            </button>
          )}
        </div>
      </header>

      {loading && <p className="text-sm text-neutral-500">{t('app.loading')}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && entries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
          <p className="font-medium">{t('history.empty')}</p>
          <p className="mt-1 text-sm text-neutral-500">{t('history.emptyHint')}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span>
                {(entry.detected_lang || entry.source_lang).toUpperCase()} → {entry.target_lang.toUpperCase()}
              </span>
              <span>{new Date(entry.created_at).toLocaleString()}</span>
            </div>
            <button onClick={() => reuse(entry)} className="block w-full text-left">
              <p className="truncate text-sm">{entry.source_text}</p>
              <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{entry.translated_text}</p>
            </button>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <button onClick={() => toggleFavorite(entry)} className="text-base leading-none">
                {entry.is_favorite ? '⭐' : '☆'}
              </button>
              <button onClick={() => reuse(entry)} className="text-neutral-500 hover:underline dark:text-neutral-400">
                {t('history.reuse')}
              </button>
              <button onClick={() => remove(entry.id)} className="ml-auto text-red-500 hover:underline">
                {t('app.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
