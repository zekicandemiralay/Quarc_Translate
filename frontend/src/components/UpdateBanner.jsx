import { useTranslation } from 'react-i18next';
import { installUpdate } from '../lib/updateCheck';

/**
 * The startup "a new version is available" strip — shown automatically, without
 * the user needing to go into Settings. Normal document flow (not a fixed
 * overlay), so it pushes the app down rather than covering the nav.
 *
 * Only ever appears on the desktop and Android builds: checkForUpdate() returns
 * null on web, where there's no installed version to compare against.
 */
export default function UpdateBanner({ update, onDismiss }) {
  const { t } = useTranslation();
  if (!update) return null;

  function handleInstall() {
    installUpdate(update.platform, update.url, update.latest);
    onDismiss();
  }

  return (
    <div className="safe-top flex items-center justify-center gap-2 bg-emerald-700 px-4 py-1.5 text-center text-xs font-medium text-white">
      <span aria-hidden="true">🔄</span>
      <span>{t('settings.updateAvailable', { version: update.latest })}</span>
      <button onClick={handleInstall} className="underline underline-offset-2 hover:text-emerald-200">
        {t('settings.install')}
      </button>
      <button onClick={onDismiss} aria-label={t('app.close')} className="hover:text-emerald-200">
        ✕
      </button>
    </div>
  );
}
