import StorePromo from '../../components/StorePromo';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Download, LogOut } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import usePrefsStore from '../../store/prefsStore';
import { toast } from '../../store/toastStore';
import { exportHistory, fetchEngineModels } from '../../lib/api';
import { cachedLanguages, getLanguages, sortedLanguages } from '../../lib/languages';
import { getPlatform, getCurrentVersion, checkForUpdate, installUpdate } from '../../lib/updateCheck';
import { Row, Section, Segmented, Switch } from '../../components/controls';

const STATE_STYLE = {
  loaded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  absent: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
};

function LanguagePacks() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const load = () =>
      fetchEngineModels()
        .then((d) => alive && (setData(d), setFailed(false)))
        .catch(() => alive && setFailed(true));
    load();
    const id = setInterval(load, 4000); // downloads in progress update live
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const downloaded = (data?.models || []).filter((m) => m.state !== 'absent');

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm" aria-expanded={open} data-testid="packs-toggle">
        <span>{t('settings.packs')}</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800" data-testid="packs">
          <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">{t('settings.packsHint')}</p>
          {failed && <p className="text-xs text-red-500">{t('settings.packsLoadFailed')}</p>}
          {data && (
            <>
              <p className="mb-2 text-xs text-neutral-500">{t('settings.packsGeneral', { model: data.generalModel })}</p>
              {downloaded.length === 0 && <p className="text-sm text-neutral-500">{t('settings.packsEmpty')}</p>}
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {downloaded.map((m) => (
                  <li key={m.key} className="py-2" data-testid="pack">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">{m.label}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_STYLE[m.state] || 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'}`}>
                        {t(`settings.packState.${m.state}`, { defaultValue: m.state })}
                        {typeof m.pct === 'number' ? ` ${m.pct}%` : ''}
                      </span>
                    </div>
                    {m.error && <p className="mt-1 text-xs text-red-500">{m.error}</p>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-neutral-400">
                {data.ramUsedMb} / {data.ramBudgetMb} MB
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ExportRow() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function download(format) {
    setBusy(true);
    try {
      const blob = await exportHistory(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quarc-translate-history.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast(t('settings.exportFailed'), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row label={t('settings.export')}>
      <div className="flex gap-2">
        {['json', 'csv'].map((f) => (
          <button key={f} disabled={busy} onClick={() => download(f)} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700" data-testid={`export-${f}`}>
            <Download size={13} /> {f === 'json' ? t('settings.exportJson') : t('settings.exportCsv')}
          </button>
        ))}
      </div>
    </Row>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const prefs = usePrefsStore((s) => s.prefs);
  const update = usePrefsStore((s) => s.update);

  const [languages, setLanguages] = useState(cachedLanguages);
  const platform = getPlatform();
  const [version, setVersion] = useState(null);
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, error: '' });

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => {});
  }, []);

  useEffect(() => {
    getCurrentVersion(platform).then(setVersion);
  }, [platform]);

  const options = useMemo(() => sortedLanguages(languages, ui), [languages, ui]);

  async function handleCheck() {
    setUpdateState({ status: 'checking', info: null, error: '' });
    try {
      const info = await checkForUpdate();
      setUpdateState({ status: info ? 'available' : 'current', info, error: '' });
    } catch (err) {
      setUpdateState({ status: 'error', info: null, error: err.message });
    }
  }

  const select = 'max-w-[11rem] rounded-lg bg-neutral-100 px-2 py-1.5 text-sm dark:bg-neutral-800';

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-2xl px-3 pb-8 md:px-6">
        <header className="safe-top py-4 md:pt-6">
          <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        </header>

        <Section title={t('settings.defaults')}>
          <Row label={t('settings.defaultSource')}>
            <select value={prefs.source_lang} onChange={(e) => update({ source_lang: e.target.value })} className={select} data-testid="default-source">
              <option value="auto">{t('translate.detectLanguage')}</option>
              {options.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('settings.defaultTarget')}>
            <select value={prefs.target_lang} onChange={(e) => update({ target_lang: e.target.value })} className={select} data-testid="default-target">
              {options.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title={t('settings.translation')}>
          <Row label={t('settings.live')} hint={t('settings.liveHint')}>
            <Switch checked={prefs.live} onChange={(v) => update({ live: v })} label={t('settings.live')} testId="live-switch" />
          </Row>
          <Row label={t('settings.saveHistory')} hint={t('settings.saveHistoryHint')}>
            <Switch checked={prefs.save_history} onChange={(v) => update({ save_history: v })} label={t('settings.saveHistory')} testId="history-switch" />
          </Row>
          <Row label={t('settings.textSize')}>
            <Segmented
              value={prefs.font_size}
              onChange={(v) => update({ font_size: v })}
              testId="text-size"
              options={[
                { value: 's', label: t('settings.sizeS') },
                { value: 'm', label: t('settings.sizeM') },
                { value: 'l', label: t('settings.sizeL') },
                { value: 'xl', label: t('settings.sizeXL') },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              value={prefs.theme}
              onChange={(v) => update({ theme: v })}
              testId="theme"
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
              testId="app-language"
              options={[
                { value: 'en', label: 'English' },
                { value: 'tr', label: 'Türkçe' },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.data')}>
          <LanguagePacks />
          {platform !== 'android' && <ExportRow />}
        </Section>

        <Section title={t('settings.about')}>
          <Row label={t('settings.version')}>
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{version || '—'}</span>
          </Row>

          {platform !== 'web' && (
            <div className="border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800">
              <button
                onClick={handleCheck}
                disabled={updateState.status === 'checking'}
                className="w-full rounded-lg bg-neutral-100 py-2 text-sm font-medium disabled:opacity-50 dark:bg-neutral-800"
              >
                {updateState.status === 'checking' ? t('settings.checking') : t('settings.checkForUpdates')}
              </button>

              {updateState.status === 'current' && <p className="mt-2 text-center text-xs text-neutral-500">{t('settings.upToDate')}</p>}
              {updateState.status === 'error' && <p className="mt-2 text-center text-xs text-red-500">{t('settings.updateFailed')}</p>}
              {updateState.status === 'available' && updateState.info && (
                <div className="mt-3 rounded-xl bg-accent/10 p-3">
                  <p className="text-sm font-medium">{t('settings.updateAvailable', { version: updateState.info.latest })}</p>
                  <button onClick={() => installUpdate(platform, updateState.info.url, updateState.info.latest)} className="mt-2 w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white">
                    {t('settings.install')}
                  </button>
                </div>
              )}
              <StorePromo />
            </div>
          )}

          {platform === 'web' && (
            <div className="px-4 py-3">
              <a href="https://github.com/zekicandemiralay/Quarc_Translate/releases/latest" target="_blank" rel="noopener noreferrer" className="block w-full rounded-lg bg-neutral-100 py-2 text-center text-sm font-medium dark:bg-neutral-800">
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500"
              data-testid="logout"
            >
              <LogOut size={14} /> {t('auth.logout')}
            </button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
