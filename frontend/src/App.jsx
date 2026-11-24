import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import i18n from './i18n';
import useAuthStore from './store/authStore';
import usePrefsStore from './store/prefsStore';
import { setUnauthorizedHandler } from './lib/api';
import { startIncoming } from './lib/incoming';
import Login from './pages/Login/Login';
import Layout from './pages/Layout/Layout';
import TranslatePage from './pages/Translate/Translate';
import History from './pages/History/History';
import Settings from './pages/Settings/Settings';
import Toaster from './components/Toaster';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
        <img src="/logo.png" alt="" className="h-12 w-12 animate-pulse rounded-xl" />
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
  const fontSize = usePrefsStore((s) => s.prefs.font_size);

  useEffect(() => {
    checkSession();
    // A request the server answers with "not signed in" re-checks the session, which sends us to the login page.
    setUnauthorizedHandler(() => useAuthStore.getState().checkSession());
    startIncoming();
  }, [checkSession]);

  useEffect(() => {
    if (user) loadPrefs();
  }, [user, loadPrefs]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (language && language !== i18n.language) i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.textsize = fontSize || 'm';
  }, [fontSize]);

  return (
    <>
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
      <Toaster />
    </>
  );
}
