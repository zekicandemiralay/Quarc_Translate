// The language list: fetched once, remembered on the device (so the pickers work
// when the server is briefly unreachable), named in the app's own language.
import { fetchLanguages } from './api';

const STORE_KEY = 'quarc_translate_languages_v2';
let inflight = null;

/** The list from the last successful visit, or []. Never throws. */
export function cachedLanguages() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Fresh list from the server (one request shared by every caller); falls back to the cached one. */
export function getLanguages() {
  if (!inflight) {
    inflight = fetchLanguages()
      .then((list) => {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(list));
        } catch {
          /* storage full or blocked: the list still works for this session */
        }
        return list;
      })
      .catch((err) => {
        inflight = null; // let the next caller retry instead of remembering a failure
        const stale = cachedLanguages();
        if (stale.length) return stale;
        throw err;
      });
  }
  return inflight;
}

const displayNames = new Map();

/** "Turkish" in English, "Türkçe" in Turkish… falls back to the English name the server sent. */
export function localizedName(lang, uiLanguage) {
  if (!lang) return '';
  try {
    if (!displayNames.has(uiLanguage)) displayNames.set(uiLanguage, new Intl.DisplayNames([uiLanguage], { type: 'language' }));
    const name = displayNames.get(uiLanguage).of(lang.code);
    if (name && name.toLowerCase() !== lang.code) return name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1);
  } catch {
    /* old WebView without Intl.DisplayNames */
  }
  return lang.nameEn || lang.name || lang.code;
}

export const byCode = (list) => new Map(list.map((l) => [l.code, l]));

/** Languages sorted by their name in the UI language (Turkish collation for Turkish). */
export function sortedLanguages(list, uiLanguage) {
  const collator = new Intl.Collator(uiLanguage);
  return [...list]
    .map((l) => ({ ...l, label: localizedName(l, uiLanguage) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/** Case/diacritic-insensitive match of a search box against every spelling of a language. */
export function matchesQuery(lang, query, uiLanguage) {
  const q = query.trim().toLocaleLowerCase(uiLanguage);
  if (!q) return true;
  const fold = (s) => s.toLocaleLowerCase(uiLanguage).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const needle = fold(q);
  return [lang.code, lang.name, lang.nameEn, lang.label, localizedName(lang, uiLanguage)].filter(Boolean).some((s) => fold(s).includes(needle));
}

/** Most recently used first, no duplicates, at most `max`. */
export function pushRecent(recent, code, max = 6) {
  if (!code || code === 'auto') return recent;
  return [code, ...recent.filter((c) => c !== code)].slice(0, max);
}

/** BCP-47 tag used for speech and for `lang=` attributes. */
export function speechTag(code) {
  return { zh: 'zh-CN', pt: 'pt-PT', no: 'nb-NO', ms: 'ms-MY', sr: 'sr-RS', ka: 'ka-GE', hy: 'hy-AM' }[code] || code;
}
