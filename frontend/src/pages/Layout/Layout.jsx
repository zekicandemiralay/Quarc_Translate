import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';

export default function Layout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-accent text-white'
        : 'text-neutral-700 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700'
    }`;

  return (
    <div className="flex h-screen flex-col md:flex-row">
      <aside className="safe-top flex flex-shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-700 dark:bg-neutral-800 md:w-56 md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center gap-2 px-1">
          <img src="/logo.png" alt="" className="h-7 w-7 rounded" />
          <span className="font-semibold">{t('app.name')}</span>
        </div>

        <nav className="flex items-center gap-1 md:mt-6 md:flex-col md:items-stretch md:gap-1">
          <NavLink to="/" end className={linkClass}>
            🌐 <span className="hidden sm:inline">{t('nav.translate')}</span>
          </NavLink>
          <NavLink to="/history" className={linkClass}>
            🕘 <span className="hidden sm:inline">{t('nav.history')}</span>
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            ⚙️ <span className="hidden sm:inline">{t('nav.settings')}</span>
          </NavLink>
        </nav>

        <div className="hidden md:mt-auto md:block md:border-t md:border-neutral-200 md:pt-3 md:dark:border-neutral-700">
          <p className="truncate px-1 text-xs text-neutral-500 dark:text-neutral-400">{user?.username}</p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
