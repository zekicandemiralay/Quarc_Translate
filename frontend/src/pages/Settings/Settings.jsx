import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import usePrefsStore from '../../store/prefsStore';
import { getLanguages } from '../../lib/languages';
import { getPlatform, getCurrentVersion, checkForUpdate, installUpdate } from '../../lib/updateCheck';

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl bg-white dark:bg-neutral-800">{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-700">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-700">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-white shadow dark:bg-neutral-900' : 'text-neutral-500'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const prefs = usePrefsStore((s) => s.prefs);
  const update = usePrefsStore((s) => s.update);

  const [languages, setLanguages] = useState([]);
  const platform = getPlatform();
  const [version, setVersion] = useState(null);
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, error: '' });

  useEffect(() => {
    getLanguages()
      .then(setLanguages)
      .catch(() => {});
  }, []);

  useEffect(() => {
    getCurrentVersion(platform).then(setVersion);
  }, [platform]);

  async function handleCheck() {
    setUpdateState({ status: 'checking', info: null, error: '' });
    try {
      const info = await checkForUpdate();
      setUpdateState({ status: info ? 'available' : 'current', info, error: '' });
    } catch (err) {
      setUpdateState({ status: 'error', info: null, error: err.message });
    }
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="safe-top flex items-center gap-3 py-4">
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
        </header>

        <Section title={t('settings.defaults')}>
          <Row label={t('settings.defaultSource')}>
            <select
              value={prefs.source_lang}
              onChange={(e) => update({ source_lang: e.target.value })}
              className="rounded-lg bg-neutral-100 px-2 py-1 text-sm dark:bg-neutral-700"
            >
              <option value="auto">{t('translate.detectLanguage')}</option>
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.defaultTarget')}>
            <select
              value={prefs.target_lang}
              onChange={(e) => update({ target_lang: e.target.value })}
              className="rounded-lg bg-neutral-100 px-2 py-1 text-sm dark:bg-neutral-700"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              value={prefs.theme}
              onChange={(v) => update({ theme: v })}
              options={[
                { value: 'auto', label: t('settings.themeAuto') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          </Row>
          <Row label={t('settings.language')}>
            <Segmented
              value={prefs.language}
              onChange={(v) => update({ language: v })}
              options={[
                { value: 'en', label: 'English' },
                { value: 'tr', label: 'Türkçe' },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.about')}>
          <Row label={t('settings.version')}>
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{version || '—'}</span>
          </Row>

          {platform !== 'web' && (
            <div className="border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-700">
              <button
                onClick={handleCheck}
                disabled={updateState.status === 'checking'}
                className="w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium disabled:opacity-50 dark:bg-neutral-700"
              >
                {updateState.status === 'checking' ? t('settings.checking') : t('settings.checkForUpdates')}
              </button>

              {updateState.status === 'current' && (
                <p className="mt-2 text-center text-xs text-neutral-500">{t('settings.upToDate')}</p>
              )}
              {updateState.status === 'error' && (
                <p className="mt-2 text-center text-xs text-red-500">{t('settings.updateFailed')}</p>
              )}
              {updateState.status === 'available' && updateState.info && (
                <div className="mt-3 rounded-xl bg-accent/10 p-3">
                  <p className="text-sm font-medium">
                    {t('settings.updateAvailable', { version: updateState.info.latest })}
                  </p>
                  <button
                    onClick={() => installUpdate(platform, updateState.info.url, updateState.info.latest)}
                    className="mt-2 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white"
                  >
                    {t('settings.install')}
                  </button>
                </div>
              )}
            </div>
          )}

          {platform === 'web' && (
            <div className="px-4 py-3">
              <a
                href="https://github.com/zekicandemiralay/Quarc_Translate/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg bg-neutral-100 py-2 text-center text-sm font-medium dark:bg-neutral-700"
              >
                {t('settings.downloadPage')}
              </a>
            </div>
          )}
        </Section>

        <Section title={t('settings.account')}>
          <Row label={t('settings.signedInAs', { username: user?.username || '' })}>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded-lg bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500"
            >
              {t('auth.logout')}
            </button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
