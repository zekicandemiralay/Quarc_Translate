import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ClipboardPaste, Copy, Check, CornerDownLeft, Loader2, RotateCcw, Share2, Square, Star, Volume2, X } from 'lucide-react';
import usePrefsStore from '../../store/prefsStore';
import useIncomingStore from '../../lib/incoming';
import { toast } from '../../store/toastStore';
import { ApiError, translateRequest, detectRequest, saveHistory, setFavorite, prepareModels } from '../../lib/api';
import { createTranslator } from '../../lib/translator';
import { byCode, cachedLanguages, getLanguages, localizedName, pushRecent } from '../../lib/languages';
import { copyText, pasteText, canShare, shareText } from '../../lib/clipboard';
import { speak, speechSupported, stopSpeaking } from '../../lib/speech';
import LanguagePicker from '../../components/LanguagePicker';
import EngineNotice from '../../components/EngineNotice';

const CHAR_LIMIT = 5000;
const DEBOUNCE_MS = 350;
const COMMIT_AFTER_MS = 2500; // a translation is "kept" once you stop changing it for this long

// One translator for the whole app session: its memory of finished chunks survives switching pages.
const translator = createTranslator({ api: { translateRequest, detectRequest } });

const EMPTY = { text: '', status: 'idle', detected: null, confidence: null, hint: null, error: null, preparing: null, progress: null };
const NO_ENTRY = { id: null, favorite: false };

function describeError(t, err, limit) {
  if (!err) return '';
  if (err.code === 'local_too_long') return t('translate.tooLong', { limit });
  if (err.code === 'model_failed') return t('errors.model_failed', { message: err.message });
  const known = t(`errors.${err.code}`, { defaultValue: '' });
  return known || t('errors.generic', { message: err.message });
}

export default function TranslatePage() {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = usePrefsStore((s) => s.prefs);
  const prefsLoaded = usePrefsStore((s) => s.loaded);
  const updatePrefs = usePrefsStore((s) => s.update);
  const incoming = useIncomingStore((s) => s.pending);

  const [languages, setLanguages] = useState(cachedLanguages);
  const [sourceLang, setSourceLang] = useState(prefs.source_lang);
  const [targetLang, setTargetLang] = useState(prefs.target_lang);
  const [sourceText, setSourceText] = useState('');
  const [view, setView] = useState(EMPTY);
  const [entry, setEntry] = useState(NO_ENTRY);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(null);
  const [notice, setNotice] = useState('');

  // Latest values for the async code below (a timer or a response must not see stale state).
  const latest = useRef({});
  latest.current = { sourceText, sourceLang, targetLang, view, entry, prefs };

  const timer = useRef(null);
  const commitTimer = useRef(null);
  const controller = useRef(null);
  const pending = useRef(null); // the finished translation waiting to be saved
  const committed = useRef(''); // key of what was last saved
  const touchedLanguages = useRef(false);
  const textarea = useRef(null);

  const index = useMemo(() => byCode(languages), [languages]);
  const nameOf = useCallback((code) => (index.get(code) ? localizedName(index.get(code), ui) : (code || '').toUpperCase()), [index, ui]);
  const targetMeta = index.get(targetLang);

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => {});
  }, []);

  // Saved default languages, once — unless the person already picked something this session.
  useEffect(() => {
    if (!prefsLoaded || touchedLanguages.current) return;
    setSourceLang(prefs.source_lang);
    setTargetLang(prefs.target_lang);
  }, [prefsLoaded, prefs.source_lang, prefs.target_lang]);

  // ── keeping translations ───────────────────────────────────────────────────

  const commit = useCallback(async ({ favorite = false } = {}) => {
    clearTimeout(commitTimer.current);
    const snap = pending.current;
    if (!snap) return null;
    if (!favorite && !latest.current.prefs.save_history) return null;
    const key = `${snap.source}\u0000${snap.target}\u0000${snap.text}`;
    if (!favorite && committed.current === key) return null;
    try {
      const saved = await saveHistory({
        source_lang: snap.source,
        target_lang: snap.target,
        detected_lang: snap.detected,
        source_text: snap.text,
        translated_text: snap.translated,
        favorite,
      });
      committed.current = key;
      setEntry({ id: saved.id, favorite: !!saved.is_favorite });
      return saved;
    } catch {
      return null; // history is a convenience: never interrupt translating because it failed
    }
  }, []);

  const scheduleCommit = useCallback(
    (snap) => {
      pending.current = snap;
      clearTimeout(commitTimer.current);
      if (latest.current.prefs.save_history) commitTimer.current = setTimeout(() => commit(), COMMIT_AFTER_MS);
    },
    [commit]
  );

  // ── translating ────────────────────────────────────────────────────────────

  const run = useCallback(
    async ({ text = latest.current.sourceText, source = latest.current.sourceLang, target = latest.current.targetLang, flipped = false } = {}) => {
      clearTimeout(timer.current);
      controller.current?.abort();
      if (!text.trim()) {
        setView(EMPTY);
        setEntry(NO_ENTRY);
        pending.current = null;
        return;
      }
      if ([...text].length > CHAR_LIMIT) {
        setView({ ...EMPTY, status: 'error', error: new ApiError('too long', { code: 'local_too_long' }) });
        return;
      }

      const mine = new AbortController();
      controller.current = mine;
      setView((v) => ({ ...v, status: 'working', error: null, progress: null }));

      try {
        const res = await translator.run({
          text,
          source,
          target,
          signal: mine.signal,
          onProgress: ({ text: partial, done, total }) => {
            if (!mine.signal.aborted) setView((v) => ({ ...v, text: partial, progress: total > 1 && done < total ? { done, total } : null }));
          },
          onPreparing: (p) => {
            if (!mine.signal.aborted) setView((v) => ({ ...v, preparing: p }));
          },
        });
        if (mine.signal.aborted) return;

        // The text is already in the target language: translate to the language they use next instead.
        if (res.sameLanguage && source === 'auto' && !flipped) {
          const other = latest.current.prefs.recent_langs.find((c) => c !== res.detected && c !== target) || (res.detected === 'en' ? (ui === 'tr' ? 'tr' : 'es') : 'en');
          setNotice(t('translate.targetSwitched', { language: nameOf(other), from: nameOf(res.detected) }));
          setTargetLang(other);
          updatePrefs({ target_lang: other });
          return run({ text, source, target: other, flipped: true });
        }

        setView({ text: res.text, status: 'done', detected: res.detected, confidence: res.confidence, hint: res.hint, error: null, preparing: null, progress: null });
        setEntry(NO_ENTRY);
        scheduleCommit({ text, source, target, detected: res.detected, translated: res.text });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setView((v) => ({ ...v, status: 'error', error: err instanceof ApiError ? err : new ApiError(err?.message || 'failed', { code: 'generic' }), preparing: null, progress: null }));
      }
    },
    [nameOf, scheduleCommit, t, ui, updatePrefs]
  );

  function onType(text) {
    setSourceText(text);
    setNotice('');
    clearTimeout(timer.current);
    if (!text.trim()) {
      controller.current?.abort();
      setView(EMPTY);
      setEntry(NO_ENTRY);
      pending.current = null;
      return;
    }
    if (!latest.current.prefs.live) return;
    timer.current = setTimeout(() => run({ text }), [...text].length > 1500 ? 700 : DEBOUNCE_MS);
  }

  function changeLanguage(which, code) {
    touchedLanguages.current = true;
    let source = which === 'source' ? code : sourceLang;
    let target = which === 'target' ? code : targetLang;
    // Choosing the language that is already on the other side swaps them (the way phones do it).
    if (which === 'target' && code === sourceLang) source = targetLang;
    if (which === 'source' && code === targetLang) target = sourceLang === 'auto' ? (code === 'en' ? 'tr' : 'en') : sourceLang;
    setSourceLang(source);
    setTargetLang(target);
    setNotice('');
    let recent = pushRecent(prefs.recent_langs, code);
    if (source !== 'auto') recent = pushRecent(recent, source);
    updatePrefs({ source_lang: source, target_lang: target, recent_langs: recent });
    if (source !== 'auto') prepareModels(source, target); // fetch the language pack now, not at the first sentence
    if (sourceText.trim()) run({ source, target });
  }

  function swap() {
    const resolved = sourceLang === 'auto' ? view.detected : sourceLang;
    if (!resolved) return;
    touchedLanguages.current = true;
    const text = view.status === 'done' ? view.text : '';
    setSourceLang(targetLang);
    setTargetLang(resolved);
    updatePrefs({ source_lang: targetLang, target_lang: resolved });
    setSourceText(text);
    setNotice('');
    if (text.trim()) run({ text, source: targetLang, target: resolved });
    else setView(EMPTY);
  }

  function clearAll() {
    controller.current?.abort();
    clearTimeout(timer.current);
    commit();
    setSourceText('');
    setView(EMPTY);
    setEntry(NO_ENTRY);
    setNotice('');
    pending.current = null;
    textarea.current?.focus();
  }

  // ── from elsewhere: share sheet, "Translate" in the selection menu, links, History ──

  useEffect(() => {
    if (!incoming) return;
    const taken = useIncomingStore.getState().take();
    if (!taken?.text) return;
    if (taken.target) setTargetLang(taken.target);
    if (taken.source) setSourceLang(taken.source);
    touchedLanguages.current = true;
    setSourceText(taken.text);
    run({ text: taken.text, source: taken.source || latest.current.sourceLang, target: taken.target || latest.current.targetLang });
  }, [incoming, run]);

  useEffect(() => {
    const reuse = location.state?.reuse;
    if (!reuse) return;
    touchedLanguages.current = true;
    setSourceLang(reuse.source_lang);
    setTargetLang(reuse.target_lang);
    setSourceText(reuse.source_text);
    setView({ ...EMPTY, text: reuse.translated_text, status: 'done', detected: reuse.detected_lang });
    setEntry({ id: reuse.id, favorite: !!reuse.is_favorite });
    pending.current = { text: reuse.source_text, source: reuse.source_lang, target: reuse.target_lang, detected: reuse.detected_lang, translated: reuse.translated_text };
    committed.current = `${reuse.source_lang}\u0000${reuse.target_lang}\u0000${reuse.source_text}`;
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);

  // Leaving the page: stop talking, cancel work, keep what was translated.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      controller.current?.abort();
      stopSpeaking();
      if (pending.current && latest.current.prefs.save_history) commit();
    },
    [commit]
  );

  // The source box grows with its text.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.5))}px`;
  }, [sourceText]);

  // ── actions on the result ──────────────────────────────────────────────────

  async function paste() {
    const text = await pasteText();
    if (text === null) return toast(t('translate.pasteBlocked'));
    if (!text) return;
    onType(text);
    run({ text });
    textarea.current?.focus();
  }

  async function copy() {
    if (!view.text) return;
    if (await copyText(view.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
      toast(t('translate.copied'));
      commit();
    }
  }

  async function toggleSpeak(side) {
    if (speaking === side) {
      stopSpeaking();
      setSpeaking(null);
      return;
    }
    const text = side === 'source' ? sourceText : view.text;
    const code = side === 'source' ? (sourceLang === 'auto' ? view.detected : sourceLang) : targetLang;
    if (!text.trim() || !code) return;
    setSpeaking(side);
    try {
      await speak(text, code);
    } catch (err) {
      if (err.message === 'no-voice') toast(t('translate.noVoice', { language: nameOf(code) }), { kind: 'error' });
    } finally {
      setSpeaking((s) => (s === side ? null : s));
    }
    if (side === 'target') commit();
  }

  async function toggleFavorite() {
    if (view.status !== 'done' || !view.text) return;
    if (!entry.id) {
      await commit({ favorite: true });
      return;
    }
    const next = !entry.favorite;
    setEntry((e) => ({ ...e, favorite: next }));
    try {
      await setFavorite(entry.id, next);
    } catch {
      setEntry((e) => ({ ...e, favorite: !next }));
    }
  }

  const resolvedSource = sourceLang === 'auto' ? view.detected : sourceLang;
  const working = view.status === 'working';
  const overLimit = [...sourceText].length > CHAR_LIMIT;
  const hasText = sourceText.trim().length > 0;
  const canSpeak = speechSupported();

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-3 pb-6 md:px-6">
      {/* language bar */}
      <div className="safe-top sticky top-0 z-10 -mx-3 bg-neutral-50/90 px-3 pb-2 pt-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:pt-6 dark:bg-neutral-950/90">
        <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
          <div className="min-w-0 flex-1">
            <LanguagePicker
              testId="source-lang"
              value={sourceLang}
              onChange={(c) => changeLanguage('source', c)}
              languages={languages}
              allowAuto
              detected={sourceLang === 'auto' ? view.detected : null}
              recent={prefs.recent_langs}
            />
          </div>
          <button
            className="icon-btn shrink-0"
            onClick={swap}
            disabled={!resolvedSource || resolvedSource === targetLang}
            title={t('translate.swapLanguages')}
            aria-label={t('translate.swapLanguages')}
            data-testid="swap"
          >
            <ArrowLeftRight size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <LanguagePicker testId="target-lang" value={targetLang} onChange={(c) => changeLanguage('target', c)} languages={languages} recent={prefs.recent_langs} />
          </div>
        </div>
      </div>

      {notice && (
        <p className="mt-2 animate-fade-in rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="notice">
          {notice}
        </p>
      )}

      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 md:items-stretch">
        {/* source */}
        <section className="flex min-h-[11rem] flex-col md:min-h-[19rem] rounded-3xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
          <div className="relative flex-1 px-4 pt-4">
            <textarea
              ref={textarea}
              value={sourceText}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder={t('translate.sourcePlaceholder')}
              aria-label={t('translate.sourcePlaceholder')}
              dir="auto"
              lang={resolvedSource || undefined}
              rows={4}
              spellCheck={sourceLang !== 'auto'}
              autoFocus={typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches}
              data-testid="source"
              className="pane-text block max-h-[50vh] min-h-[7rem] w-full md:min-h-[12rem] resize-none bg-transparent pr-8 outline-none placeholder:text-neutral-400"
            />
            {hasText && (
              <button className="icon-btn absolute right-2 top-2 h-8 w-8" onClick={clearAll} aria-label={t('translate.clear')} title={t('translate.clear')} data-testid="clear">
                <X size={18} />
              </button>
            )}
          </div>

          {view.hint && sourceLang !== 'auto' && (
            <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm dark:bg-accent/15" data-testid="hint">
              <span>{t('translate.hint', { language: nameOf(view.hint.language) })}</span>
              <button className="font-semibold text-accent underline underline-offset-2" onClick={() => changeLanguage('source', view.hint.language)}>
                {t('translate.hintAction', { language: nameOf(view.hint.language) })}
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            {!hasText && (
              <button className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={paste} data-testid="paste">
                <ClipboardPaste size={16} /> {t('translate.paste')}
              </button>
            )}
            {hasText && canSpeak && (
              <button className="icon-btn" data-active={speaking === 'source'} onClick={() => toggleSpeak('source')} aria-label={speaking === 'source' ? t('translate.stopListening') : t('translate.listen')} title={t('translate.listen')} disabled={!resolvedSource}>
                {speaking === 'source' ? <Square size={16} /> : <Volume2 size={18} />}
              </button>
            )}
            <span className="flex-1" />
            {hasText && (
              <span className={`px-2 text-xs tabular-nums ${overLimit ? 'font-semibold text-red-500' : 'text-neutral-400'}`} data-testid="count">
                {t('translate.charCount', { count: [...sourceText].length, limit: CHAR_LIMIT })}
              </span>
            )}
            {!prefs.live && hasText && (
              <button className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50" onClick={() => run()} disabled={working || overLimit} data-testid="translate-now">
                <CornerDownLeft size={15} /> {t('translate.translateNow')}
              </button>
            )}
          </div>
        </section>

        {/* result */}
        <section className="flex min-h-[11rem] flex-col md:min-h-[19rem] rounded-3xl bg-neutral-100/70 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900/60 dark:ring-white/10">
          <div className="relative flex-1 px-4 pt-4" aria-live="polite">
            {view.status === 'error' ? (
              <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert" data-testid="error">
                <p>{describeError(t, view.error, CHAR_LIMIT)}</p>
                {view.error?.code !== 'local_too_long' && (
                  <button className="mt-2 inline-flex items-center gap-1.5 font-semibold underline underline-offset-2" onClick={() => run()}>
                    <RotateCcw size={14} /> {t('app.retry')}
                  </button>
                )}
              </div>
            ) : view.text ? (
              <p
                className={`pane-text whitespace-pre-wrap break-words pr-8 transition-opacity ${working ? 'opacity-50' : ''}`}
                dir={targetMeta?.rtl ? 'rtl' : 'ltr'}
                lang={targetLang}
                data-testid="result"
              >
                {view.text}
              </p>
            ) : (
              <p className="pane-text text-neutral-400" data-testid="result-placeholder">
                {working ? t('translate.translating') : t('translate.translationPlaceholder')}
              </p>
            )}
            {working && (
              <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 text-xs text-neutral-500" data-testid="working">
                <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
                {view.progress && t('translate.progress', view.progress)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            {view.text && view.status !== 'error' && (
              <>
                {canSpeak && (
                  <button className="icon-btn" data-active={speaking === 'target'} onClick={() => toggleSpeak('target')} aria-label={speaking === 'target' ? t('translate.stopListening') : t('translate.listen')} title={t('translate.listen')} data-testid="listen">
                    {speaking === 'target' ? <Square size={16} /> : <Volume2 size={18} />}
                  </button>
                )}
                <button className="icon-btn" onClick={copy} aria-label={t('translate.copy')} title={t('translate.copy')} data-testid="copy">
                  {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
                </button>
                {canShare() && (
                  <button className="icon-btn" onClick={() => shareText(view.text, t('app.name'))} aria-label={t('translate.share')} title={t('translate.share')}>
                    <Share2 size={18} />
                  </button>
                )}
                <span className="flex-1" />
                <button
                  className="icon-btn"
                  data-active={entry.favorite}
                  onClick={toggleFavorite}
                  disabled={working}
                  aria-pressed={entry.favorite}
                  aria-label={entry.favorite ? t('translate.unstar') : t('translate.star')}
                  title={entry.favorite ? t('translate.unstar') : t('translate.star')}
                  data-testid="star"
                >
                  <Star size={18} className={entry.favorite ? 'fill-amber-400 text-amber-400' : ''} />
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      <EngineNotice preparing={view.preparing} languages={languages} />
      {!prefs.live && !hasText && <p className="mt-3 px-1 text-xs text-neutral-500">{t('translate.liveOff')}</p>}
    </div>
  );
}
