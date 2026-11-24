import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import { apiUrl } from '../../lib/apiUrl';
import StoreLoginButton from '../../components/StoreLoginButton';

const field =
  'rounded-xl border border-neutral-300 bg-transparent px-3.5 py-2.5 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        const res = await fetch(apiUrl('/api/auth/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Sign up failed');
        }
        await useAuthStore.getState().checkSession();
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="safe-top flex h-full min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/logo.png" alt="Quarc Translate" className="h-16 w-16 rounded-2xl" />
          <h1 className="text-lg font-semibold">{t('auth.signInToAccount')}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('auth.sharedNote')}</p>
        </div>
        <StoreLoginButton
          onSignedIn={async () => {
            await useAuthStore.getState().checkSession();
            navigate('/');
          }}
        />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input className={field} placeholder={t('auth.username')} aria-label={t('auth.username')} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" autoFocus data-testid="username" />
          <input className={field} placeholder={t('auth.password')} aria-label={t('auth.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} data-testid="password" />
          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="mt-2 rounded-xl bg-accent px-3 py-2.5 font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50" data-testid="submit">
            {mode === 'login' ? t('auth.login') : t('auth.signup')}
          </button>
        </form>
        <button className="mt-4 w-full text-center text-sm text-neutral-500 hover:underline" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? t('auth.needAccount') : t('auth.haveAccount')}
        </button>
      </div>
    </div>
  );
}
