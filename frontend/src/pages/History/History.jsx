import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Copy, RotateCcw, Search, Star, Trash2, X } from 'lucide-react';
import { clearHistory, deleteHistoryItem, fetchHistory, setFavorite } from '../../lib/api';
import { byCode, cachedLanguages, getLanguages, localizedName } from '../../lib/languages';
import { groupByDay, timeOf } from '../../lib/dates';
import { copyText } from '../../lib/clipboard';
import { toast } from '../../store/toastStore';

const PAGE = 40;

export default function History() {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [languages, setLanguages] = useState(cachedLanguages);
  const requestId = useRef(0);

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (append = false) => {
      const mine = ++requestId.current;
      setLoading(true);
      setError('');
      try {
        const offset = append ? entries.length : 0;
        const rows = await fetchHistory({ limit: PAGE, offset, favorite: savedOnly, q: debounced });
        if (mine !== requestId.current) return;
        setEntries((prev) => (append ? [...prev, ...rows] : rows));
        setMore(rows.length === PAGE);
      } catch (err) {
        if (mine === requestId.current) setError(err.message || t('history.loadFailed'));
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedOnly, debounced, entries.length, t]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOnly, debounced]);

  const index = useMemo(() => byCode(languages), [languages]);
  const lang = (code) => (index.get(code) ? localizedName(index.get(code), ui) : (code || '').toUpperCase());
  const groups = useMemo(() => groupByDay(entries, ui), [entries, ui]);
  const heading = (h) => (h === 'today' ? t('history.today') : h === 'yesterday' ? t('history.yesterday') : h);

  async function toggleFavorite(entry) {
    const next = !entry.is_favorite;
    const patch = (value) => setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, is_favorite: value ? 1 : 0 } : e)));
    patch(next);
    try {
      await setFavorite(entry.id, next);
      if (savedOnly && !next) setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      patch(!next);
    }
  }

  async function remove(id) {
    const before = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteHistoryItem(id);
    } catch {
      setEntries(before);
    }
  }

  async function handleClear() {
    if (!window.confirm(savedOnly ? t('history.clearAllConfirm') : t('history.clearConfirm'))) return;
    try {
      await clearHistory(!savedOnly);
      load(false);
    } catch (err) {
      setError(err.message);
    }
  }

  const reuse = (entry) => navigate('/', { state: { reuse: entry } });
  const empty = !loading && entries.length === 0 && !error;

  return (
    <div className="mx-auto max-w-3xl px-3 pb-6 md:px-6">
      <header className="safe-top sticky top-0 z-10 -mx-3 bg-neutral-50/90 px-3 pb-3 pt-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:pt-6 dark:bg-neutral-950/90">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('history.title')}</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-neutral-200/70 p-0.5 text-xs dark:bg-neutral-800" role="tablist">
              {[
                [false, t('history.all')],
                [true, t('history.saved')],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  role="tab"
                  aria-selected={savedOnly === value}
                  onClick={() => setSavedOnly(value)}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${savedOnly === value ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
                  data-testid={value ? 'tab-saved' : 'tab-all'}
                >
                  {label}
                </button>
              ))}
            </div>
            {entries.length > 0 && (
              <button className="icon-btn text-red-500 hover:text-red-600" onClick={handleClear} aria-label={t('history.clear')} title={t('history.clear')} data-testid="clear-history">
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
          <Search size={16} className="text-neutral-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('history.search')}
            aria-label={t('history.search')}
            className="w-full bg-transparent text-sm outline-none"
            data-testid="history-search"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label={t('translate.clear')} className="text-neutral-400 hover:text-neutral-600">
              <X size={16} />
            </button>
          )}
        </label>
      </header>

      {error && (
        <p className="my-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {loading && entries.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">{t('app.loading')}</p>}

      {empty && (
        <div className="mt-6 rounded-3xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700" data-testid="empty">
          <p className="font-medium">{debounced ? t('history.emptySearch', { query: debounced }) : savedOnly ? t('history.emptySaved') : t('history.empty')}</p>
          {!debounced && <p className="mt-1 text-sm text-neutral-500">{savedOnly ? t('history.emptySavedHint') : t('history.emptyHint')}</p>}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.heading} className="mt-4">
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{heading(group.heading)}</h2>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.id} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10" data-testid="history-item">
                <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {lang(entry.detected_lang || entry.source_lang)} <ArrowRight size={12} aria-hidden="true" /> {lang(entry.target_lang)}
                  </span>
                  <span>{timeOf(entry.updated_at || entry.created_at, ui)}</span>
                </div>
                <button onClick={() => reuse(entry)} className="block w-full text-left" aria-label={t('history.reuse')}>
                  <p className="line-clamp-2 whitespace-pre-line text-sm" dir="auto">
                    {entry.source_text}
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm font-medium text-accent" dir="auto">
                    {entry.translated_text}
                  </p>
                </button>
                <div className="mt-2 flex items-center gap-1">
                  <button className="icon-btn h-8 w-8" data-active={!!entry.is_favorite} onClick={() => toggleFavorite(entry)} aria-pressed={!!entry.is_favorite} aria-label={entry.is_favorite ? t('translate.unstar') : t('translate.star')} data-testid="item-star">
                    <Star size={17} className={entry.is_favorite ? 'fill-amber-400 text-amber-400' : ''} />
                  </button>
                  <button
                    className="icon-btn h-8 w-8"
                    onClick={async () => (await copyText(entry.translated_text)) && toast(t('translate.copied'))}
                    aria-label={t('translate.copy')}
                  >
                    <Copy size={16} />
                  </button>
                  <button className="icon-btn h-8 w-8" onClick={() => reuse(entry)} aria-label={t('history.reuse')} title={t('history.reuse')}>
                    <RotateCcw size={16} />
                  </button>
                  <span className="flex-1" />
                  <button className="icon-btn h-8 w-8 hover:text-red-500" onClick={() => remove(entry.id)} aria-label={t('app.delete')} data-testid="item-delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {more && (
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="mx-auto mt-4 block rounded-full bg-neutral-200/70 px-5 py-2 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          data-testid="load-more"
        >
          {t('history.loadMore')}
        </button>
      )}
    </div>
  );
}
