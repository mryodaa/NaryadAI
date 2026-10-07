// Пароль команды на входе в приложение. Шлюз закрывает API, WebSocket и файлы интерфейса без cookie входа;
// здесь — экран ввода, пока вход не выполнен (в разработке интерфейс отдаёт Vite, и закрыть его может только он).
// Пока вход не выполнен, приложение не подключается к данным двойника.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import { useTranslation } from '../i18n/store';
import { LanguageSwitcher } from './LanguageSwitcher';

type State = 'checking' | 'offline' | 'locked' | 'open';

export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');

  // спрашиваем шлюз; бесплатный хостинг просыпается до минуты — повторяем, пока не ответит
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const ask = () =>
      fetch('/api/v1/auth/status', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ ok: boolean }>) : Promise.reject(new Error(String(r.status)))))
        .then((j) => !stop && setState(j.ok ? 'open' : 'locked'))
        .catch(() => {
          if (stop) return;
          setState((s) => (s === 'checking' || s === 'offline' ? 'offline' : s));
          timer = window.setTimeout(ask, 2000);
        });
    void ask();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (state === 'open') return <>{children}</>;
  if (state === 'locked') return <PasswordScreen onOpen={() => setState('open')} />;
  return <Waiting offline={state === 'offline'} />;
}

function Waiting({ offline }: { offline: boolean }) {
  const { lang } = useTranslation();
  const text = offline
    ? lang === 'kk'
      ? 'Сандық егіз іске қосылуда…'
      : lang === 'en'
        ? 'Starting the digital twin…'
        : 'Запускаем двойник…'
    : '';
  return (
    <div className="grid min-h-screen place-items-center bg-page">
      <div className="flex items-center gap-2 text-lg text-ink-2" role="status">
        <LoaderCircle className="size-6 animate-spin text-accent" aria-hidden />
        {text}
      </div>
    </div>
  );
}

function PasswordScreen({ onOpen }: { onOpen: () => void }) {
  const { lang } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const L = {
    title: lang === 'kk' ? 'Allur сандық егізі' : lang === 'en' ? 'Allur digital twin' : 'Цифровой двойник Allur',
    hint: lang === 'kk' ? 'Команданың прототипі. Кіру үшін құпиясөзді енгізіңіз.' : lang === 'en' ? 'Team prototype. Enter the password to continue.' : 'Прототип команды. Введите пароль, чтобы войти.',
    label: lang === 'kk' ? 'Құпиясөз' : lang === 'en' ? 'Password' : 'Пароль',
    submit: lang === 'kk' ? 'Кіру' : lang === 'en' ? 'Sign in' : 'Войти',
    wrong: lang === 'kk' ? 'Құпиясөз қате' : lang === 'en' ? 'Wrong password' : 'Неверный пароль',
    many: lang === 'kk' ? 'Әрекет тым көп. 10 минуттан кейін қайталаңыз' : lang === 'en' ? 'Too many attempts. Try again in 10 minutes' : 'Слишком много попыток. Попробуйте через 10 минут',
    offline: lang === 'kk' ? 'Сервермен байланыс жоқ' : lang === 'en' ? 'No connection to the server' : 'Нет связи с сервером',
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (r.ok) return onOpen();
      setError(r.status === 429 ? L.many : L.wrong);
      setPassword('');
    } catch {
      setError(L.offline);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-page px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-pop ring-1 ring-line">
        <div className="mb-5 flex items-start justify-between gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <LanguageSwitcher compact />
        </div>
        <h1 className="text-[1.375rem] font-semibold leading-tight">{L.title}</h1>
        <p className="mb-5 mt-1 text-ink-2">{L.hint}</p>
        <label htmlFor="access-password" className="mb-1.5 block font-semibold">
          {L.label}
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            id="access-password"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'access-error' : undefined}
            className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-xl tracking-[0.2em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {L.submit}
        </button>
        <p id="access-error" role="alert" className="mt-3 min-h-[1.4em] text-[0.9375rem] font-medium text-st-fault-ink">
          {error}
        </p>
      </form>
    </main>
  );
}
