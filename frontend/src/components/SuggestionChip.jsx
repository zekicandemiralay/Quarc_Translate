import { Lightbulb, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeSuggestion } from '../lib/suggestion';

/**
 * "Did you mean: bugün çok güzel?" — shown under the source box when the engine found a typo or Turkish
 * text typed without ç ğ ı ö ş ü. Nothing changes unless the person taps Use.
 */
export default function SuggestionChip({ suggestion, onUse, onDismiss }) {
  const { t } = useTranslation();
  const view = describeSuggestion(suggestion);

  return (
    <div className="mx-3 mb-1 flex animate-fade-in items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10" data-testid="suggestion">
      <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="text-neutral-600 dark:text-neutral-300">{t('translate.didYouMean')} </span>
        {view.mode === 'text' ? (
          <span className="whitespace-pre-line break-words" data-testid="suggestion-text">
            {view.pieces.map((p, i) => (
              <span key={i} className={p.changed ? 'font-semibold text-amber-800 underline decoration-amber-400 decoration-2 underline-offset-2 dark:text-amber-300' : ''}>
                {p.t}
              </span>
            ))}
          </span>
        ) : (
          <span data-testid="suggestion-text">
            {view.shown.map((c, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <span className="text-neutral-500 line-through">{c.from}</span> → <span className="font-semibold text-amber-800 dark:text-amber-300">{c.to}</span>
              </span>
            ))}
            {view.more > 0 && <span className="text-neutral-500"> {t('translate.moreChanges', { count: view.more })}</span>}
          </span>
        )}
      </div>
      <button onClick={onUse} className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600" data-testid="suggestion-use">
        {t('translate.useSuggestion')}
      </button>
      <button onClick={onDismiss} className="shrink-0 rounded-full p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t('translate.dismissSuggestion')} data-testid="suggestion-dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
