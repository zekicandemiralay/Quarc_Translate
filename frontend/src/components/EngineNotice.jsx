import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Shown while the server downloads the language pack for a pair — the very first
 * time a language is used. It replaces what used to be a bare "engine unavailable".
 */
export default function EngineNotice({ preparing, languages }) {
  const { t } = useTranslation();
  if (!preparing) return null;

  const name = (code) => languages.find((l) => l.code === code)?.nameEn || code?.toUpperCase();
  const [from, to] = (preparing.pair || '').split('-');
  const pair = from && to ? `${name(from)} → ${name(to)}` : t('translate.translating');
  const stage = t(`preparing.${preparing.stage}`, { defaultValue: t('preparing.queued') });

  return (
    <div className="mt-3 animate-fade-in rounded-2xl bg-accent-soft p-4 dark:bg-accent/15" role="status" data-testid="preparing">
      <div className="flex items-center gap-3">
        <Loader2 size={20} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('preparing.title', { pair })}</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-300">{stage}</p>
        </div>
        {typeof preparing.pct === 'number' && <span className="text-sm font-semibold tabular-nums text-accent">{preparing.pct}%</span>}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent/20">
        {typeof preparing.pct === 'number' ? (
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${preparing.pct}%` }} />
        ) : (
          <div className="h-full w-2/5 animate-indeterminate rounded-full bg-accent" />
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">{t('preparing.note')}</p>
    </div>
  );
}
