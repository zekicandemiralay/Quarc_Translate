import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import tr from './tr.json';

// The saved choice first, otherwise the device's language (Turkish or English).
const initial = (() => {
  try {
    const saved = localStorage.getItem('language');
    if (saved === 'en' || saved === 'tr') return saved;
  } catch {
    /* blocked storage */
  }
  return /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en';
})();

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('language', lng);
  } catch {
    /* non-fatal */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

export default i18n;
