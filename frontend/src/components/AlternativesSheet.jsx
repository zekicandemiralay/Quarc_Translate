import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2 } from 'lucide-react';
import Modal from './Modal';
import { alternativesRequest } from '../lib/api';
import { sameRendering } from '../lib/tappable';
import { copyText } from '../lib/clipboard';
import { toast } from '../store/toastStore';

// What was asked before, so reopening a sentence is instant (and costs the server nothing).
const memory = new Map();

/**
 * Other translations of one sentence. Tapping a row swaps that sentence in the result.
 * `unit` = { src, out } — the original sentence and the translation that is shown now.
 */
export default function AlternativesSheet({ unit, source, target, targetRtl, onPick, onClose }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', list: [] });

  useEffect(() => {
    if (!unit) return undefined;
    const key = `${source}\u0000${target}\u0000${unit.src}`;
    if (memory.has(key)) {
      setState({ status: 'done', list: memory.get(key) });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', list: [] });
    alternativesRequest({ text: unit.src, source, target, signal: controller.signal })
      .then((res) => {
        memory.set(key, res.alternatives || []);
        setState({ status: 'done', list: res.alternatives || [] });
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setState({ status: 'error', list: [] });
      });
    return () => controller.abort();
  }, [unit, source, target]);

  if (!unit) return null;

  // The shown translation is always on the list (marked), even if the model's n-best no longer contains it.
  const list = state.list.some((a) => sameRendering(a, unit.out)) ? state.list : [unit.out, ...state.list];
  const others = list.filter((a) => !sameRendering(a, unit.out)).length;

  return (
    <Modal open onClose={onClose} title={t('alternatives.title')}>
      <div className="px-5 pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('alternatives.original')}</p>
        <p className="mt-1 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300" dir="auto" data-testid="alt-original">
          {unit.src}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5" data-testid="alternatives">
        {state.status === 'loading' && (
          <p className="flex items-center gap-2 px-2 py-4 text-sm text-neutral-500" data-testid="alt-loading">
            <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" /> {t('alternatives.loading')}
          </p>
        )}
        {state.status === 'error' && (
          <p className="px-2 py-4 text-sm text-red-500" role="alert">
            {t('alternatives.failed')}
          </p>
        )}
        {state.status === 'done' && (
          <ul className="flex flex-col gap-1.5">
            {list.map((alt) => {
              const current = sameRendering(alt, unit.out);
              return (
                <li key={alt} className={`flex items-stretch gap-1 rounded-2xl ${current ? 'bg-accent-soft dark:bg-accent/15' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
                  <button
                    onClick={() => onPick(alt)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-2xl px-3.5 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5"
                    aria-label={`${t('alternatives.use')}: ${alt}`}
                    data-testid="alt-option"
                    data-current={current}
                  >
                    <span className="min-w-0 flex-1 whitespace-pre-line break-words" dir={targetRtl ? 'rtl' : 'ltr'} lang={target}>
                      {alt}
                    </span>
                    {current && (
                      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">
                        <Check size={14} aria-hidden="true" /> {t('alternatives.current')}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={async () => (await copyText(alt)) && toast(t('translate.copied'))}
                    className="icon-btn my-auto mr-1 shrink-0"
                    aria-label={t('translate.copy')}
                    title={t('translate.copy')}
                  >
                    <Copy size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {state.status === 'done' && others === 0 && (
          <p className="px-2 pt-3 text-sm text-neutral-500" data-testid="alt-none">
            {t('alternatives.none')}
          </p>
        )}
      </div>
    </Modal>
  );
}
