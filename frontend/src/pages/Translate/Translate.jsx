import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import usePrefsStore from '../../store/prefsStore';
import { translateText, setFavorite } from '../../lib/api';
import { getLanguages } from '../../lib/languages';
import LanguageSelect from './LanguageSelect';

const DEBOUNCE_MS = 500;
const CHAR_LIMIT = 5000;

export default function TranslatePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = usePrefsStore((s) => s.prefs);
  const updatePrefs = usePrefsStore((s) => s.update);

  const [languages, setLanguages] = useState([]);
  const [langError, setLangError] = useState('');
  const [sourceLang, setSourceLang] = useState(prefs.source_lang);
  const [targetLang, setTargetLang] = useState(prefs.target_lang);
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [detectedLang, setDetectedLang] = useState(null);
  const [entryId, setEntryId] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const timerRef = useRef(null);
  const requestIdRef = useRef(0);
  const prefsAppliedRef = useRef(false);

  // Apply the saved default languages once prefs finish loading, without
  // clobbering a language the user has already picked this session.
  useEffect(() => {
    if (prefsAppliedRef.current) return;
    if (!prefs.source_lang && !prefs.target_lang) return;
    prefsAppliedRef.current = true;
    setSourceLang(prefs.source_lang);
    setTargetLang(prefs.target_lang);
  }, [prefs.source_lang, prefs.target_lang]);

  useEffect(() => {
    getLanguages()
      .then(setLanguages)
      .catch((err) => setLangError(err.message));
  }, []);

  // Coming from History's "Use again".
  useEffect(() => {
    const reuse = location.state?.reuse;
    if (!reuse) return;
    setSourceLang(reuse.source_lang);
    setTargetLang(reuse.target_lang);
    setSourceText(reuse.source_text);
    setTranslatedText(reuse.translated_text);
    setDetectedLang(reuse.detected_lang);
    setEntryId(reuse.id);
    setIsFavorite(!!reuse.is_favorite);
    navigate('.', { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const runTranslate = useCallback(
    (text, source, target) => {
      if (!text.trim()) {
        setTranslatedText('');
        setDetectedLang(null);
        setEntryId(null);
        setIsFavorite(false);
        setError('');
        return;
      }
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');
      translateText(text, source, target)
        .then((res) => {
          if (requestId !== requestIdRef.current) return;
          setTranslatedText(res.translatedText);
          setDetectedLang(res.detectedLang);
          setEntryId(res.id);
          setIsFavorite(false);
        })
        .catch((err) => {
          if (requestId !== requestIdRef.current) return;
          setError(err.message || t('translate.engineUnavailable'));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    },
    [t]
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleChange(text) {
    setSourceText(text);
    clearTimeout(timerRef.current);
    if (text.length > CHAR_LIMIT) {
      setError(t('translate.tooLong'));
      return;
    }
    timerRef.current = setTimeout(() => runTranslate(text, sourceLang, targetLang), DEBOUNCE_MS);
  }

  function handleLangChange(which, value) {
    const nextSource = which === 'source' ? value : sourceLang;
    const nextTarget = which === 'target' ? value : targetLang;
    setSourceLang(nextSource);
    setTargetLang(nextTarget);
    updatePrefs(which === 'source' ? { source_lang: value } : { target_lang: value });
    clearTimeout(timerRef.current);
    runTranslate(sourceText, nextSource, nextTarget);
  }

  function handleSwap() {
    const resolvedSource = sourceLang === 'auto' ? detectedLang : sourceLang;
    if (!resolvedSource) return; // nothing detected yet — nothing sensible to swap to
    const nextSource = targetLang;
    const nextTarget = resolvedSource;
    setSourceLang(nextSource);
    setTargetLang(nextTarget);
    updatePrefs({ source_lang: nextSource, target_lang: nextTarget });

    const nextText = translatedText;
    setSourceText(nextText);
    setTranslatedText('');
    setDetectedLang(null);
    runTranslate(nextText, nextSource, nextTarget);
  }

  function handleClear() {
    clearTimeout(timerRef.current);
    requestIdRef.current++; // cancel any in-flight response
    setSourceText('');
    setTranslatedText('');
    setDetectedLang(null);
    setEntryId(null);
    setIsFavorite(false);
    setError('');
  }

  async function handleCopy() {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  async function toggleFavorite() {
    if (!entryId) return;
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await setFavorite(entryId, next);
    } catch {
      setIsFavorite(!next);
    }
  }

  const detectedLangName = detectedLang && languages.find((l) => l.code === detectedLang)?.name;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1">
          <LanguageSelect
            value={sourceLang}
            onChange={(v) => handleLangChange('source', v)}
            languages={languages}
            includeAuto
            detectedLabel={
              detectedLangName
                ? `${t('translate.detectLanguage')} (${detectedLangName})`
                : t('translate.detectLanguage')
            }
          />
        </div>
        <button
          onClick={handleSwap}
          disabled={sourceLang === 'auto' && !detectedLang}
          title={t('translate.swapLanguages')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-lg hover:bg-neutral-200 disabled:opacity-30 dark:hover:bg-neutral-700"
        >
          ⇄
        </button>
        <div className="flex-1">
          <LanguageSelect value={targetLang} onChange={(v) => handleLangChange('target', v)} languages={languages} />
        </div>
      </div>

      {langError && <p className="mb-2 text-sm text-red-500">{t('translate.engineUnavailable')}</p>}

      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
          <textarea
            value={sourceText}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t('translate.sourcePlaceholder')}
            className="min-h-[10rem] flex-1 resize-none rounded-t-2xl bg-transparent p-4 text-lg outline-none"
            autoFocus
          />
          <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            <span className={sourceText.length > CHAR_LIMIT ? 'text-red-500' : ''}>
              {t('translate.charLimit', { count: sourceText.length, limit: CHAR_LIMIT })}
            </span>
            {sourceText && (
              <button onClick={handleClear} className="hover:underline">
                {t('translate.clear')}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="min-h-[10rem] flex-1 whitespace-pre-wrap p-4 text-lg">
            {loading ? (
              <span className="text-neutral-400">{t('translate.translating')}</span>
            ) : error ? (
              <span className="text-red-500">{error}</span>
            ) : (
              translatedText || <span className="text-neutral-400">{t('translate.translationPlaceholder')}</span>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2 text-xs dark:border-neutral-700">
            <button
              onClick={toggleFavorite}
              disabled={!entryId}
              title={isFavorite ? t('translate.unstar') : t('translate.star')}
              className="text-base disabled:opacity-30"
            >
              {isFavorite ? '⭐' : '☆'}
            </button>
            {translatedText && (
              <button onClick={handleCopy} className="text-neutral-500 hover:underline dark:text-neutral-400">
                {copied ? t('translate.copied') : t('translate.copy')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
