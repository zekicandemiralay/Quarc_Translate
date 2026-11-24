import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import Modal from './Modal';
import { byCode, matchesQuery, sortedLanguages } from '../lib/languages';

/**
 * The language button in the bar and the searchable sheet behind it.
 * Names are shown in the app's language ("Almanca" in Turkish) with the language's own
 * name beside it ("Deutsch"), so a language can be found by either.
 */
export default function LanguagePicker({ value, onChange, languages, allowAuto = false, detected = null, recent = [], testId }) {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => sortedLanguages(languages, ui), [languages, ui]);
  const index = useMemo(() => byCode(sorted), [sorted]);

  const current = index.get(value);
  const detectedLang = detected ? index.get(detected) : null;

  let label;
  if (value === 'auto') {
    label = detectedLang ? t('translate.detectedAs', { language: detectedLang.label }) : t('translate.detectLanguage');
  } else {
    label = current?.label || value.toUpperCase();
  }

  const shown = sorted.filter((l) => matchesQuery(l, query, ui));
  const recents = query ? [] : recent.map((c) => index.get(c)).filter(Boolean);

  function pick(code) {
    setOpen(false);
    setQuery('');
    if (code !== value) onChange(code);
  }

  const row = (lang) => (
    <button
      key={lang.code}
      onClick={() => pick(lang.code)}
      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
      data-testid={`lang-${lang.code}`}
    >
      <span>
        <span className="font-medium">{lang.label}</span>
        {lang.name !== lang.label && <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">{lang.name}</span>}
      </span>
      {value === lang.code && <Check size={18} className="text-accent" />}
    </button>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid={testId}
        className="flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft dark:hover:bg-accent/15"
      >
        {value === 'auto' && <Sparkles size={15} aria-hidden="true" />}
        <span className="truncate">{label}</span>
        <ChevronDown size={15} aria-hidden="true" className="shrink-0 opacity-70" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('picker.title')}>
        <div className="px-5 pb-3">
          <label className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
            <Search size={16} className="text-neutral-400" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('picker.search')}
              aria-label={t('picker.search')}
              className="w-full bg-transparent text-sm outline-none"
              data-testid="lang-search"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {allowAuto && !query && (
            <button
              onClick={() => pick('auto')}
              className="mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
              data-testid="lang-auto"
            >
              <span className="flex items-center gap-2 font-medium">
                <Sparkles size={16} className="text-accent" aria-hidden="true" /> {t('translate.detectLanguage')}
              </span>
              {value === 'auto' && <Check size={18} className="text-accent" />}
            </button>
          )}
          {recents.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('picker.recent')}</p>
              {recents.map(row)}
              <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('picker.all')}</p>
            </>
          )}
          {shown.map(row)}
          {!shown.length && <p className="px-3 py-6 text-center text-sm text-neutral-500">{t('picker.none', { query })}</p>}
        </div>
      </Modal>
    </>
  );
}
