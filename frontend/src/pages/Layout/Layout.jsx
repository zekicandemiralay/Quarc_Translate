import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { History, Languages, Settings } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useUpdateStore from '../../store/updateStore';
import UpdateBanner from '../../components/UpdateBanner';

const ITEMS = [
  { to: '/', key: 'translate', Icon: Languages, end: true },
  { to: '/history', key: 'history', Icon: History },
  { to: '/settings', key: 'settings', Icon: Settings },
];

export default function Layout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const ensureChecked = useUpdateStore((s) => s.ensureChecked);
  const update = useUpdateStore((s) => (s.dismissed ? null : s.update));
  const dismissUpdate = useUpdateStore((s) => s.dismiss);

  useEffect(() => {
    ensureChecked();
  }, [ensureChecked]);

  return (
    <div className="flex h-full flex-col">
      <UpdateBanner update={update} onDismiss={dismissUpdate} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* desktop: side rail */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 md:flex">
          <div className="flex items-center gap-2.5 px-1">
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
            <span className="font-semibold">{t('app.name')}</span>
          </div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Main">
            {ITEMS.map(({ to, key, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                data-testid={`nav-${key}`}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-accent-soft text-accent dark:bg-accent/20' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`
                }
              >
                <Icon size={19} aria-hidden="true" />
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
          <p className="mt-auto truncate border-t border-neutral-200 px-1 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">{user?.username}</p>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* phone: tab bar */}
        <nav className="safe-bottom flex shrink-0 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 md:hidden" aria-label="Main">
          {ITEMS.map(({ to, key, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={`nav-${key}`}
              className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              <Icon size={22} aria-hidden="true" />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
