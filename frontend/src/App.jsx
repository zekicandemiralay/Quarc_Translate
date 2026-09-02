import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import i18n from './i18n';
import useAuthStore from './store/authStore';
import usePrefsStore from './store/prefsStore';
import Login from './pages/Login/Login';
import Layout from './pages/Layout/Layout';
import TranslatePage from './pages/Translate/Translate';
import History from './pages/History/History';
import Settings from './pages/Settings/Settings';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const loadPrefs = usePrefsStore((s) => s.load);
  const theme = usePrefsStore((s) => s.prefs.theme);
  const language = usePrefsStore((s) => s.prefs.language);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (user) loadPrefs();
  }, [user, loadPrefs]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (language) i18n.changeLanguage(language);
  }, [language]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<TranslatePage />} />
        <Route path="history" element={<History />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
