// Пока нет связи с двойником (бесплатный хостинг просыпается до минуты) — понятная заглушка.
import { LoaderCircle } from 'lucide-react';

export function Booting({ message }: { message?: string | null }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="flex max-w-[32rem] flex-col items-center gap-4 text-center">
        <LoaderCircle className="size-12 animate-spin text-accent" aria-hidden />
        <h1 className="text-[1.75rem] font-semibold">{message ?? 'Запускаем двойник…'}</h1>
        <p className="text-lg text-ink-2">
          Подключаемся к шлюзу и загружаем историю из 1С. На бесплатном хостинге первый запуск занимает до минуты.
        </p>
      </div>
    </div>
  );
}
