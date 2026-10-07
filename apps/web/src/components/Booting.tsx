// Пока нет связи с двойником (бесплатный хостинг просыпается до минуты) — понятная заглушка.
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from '../i18n/store';

export function Booting({ message }: { message?: string | null }) {
  const { lang } = useTranslation();
  const defaultMsg =
    lang === 'kk' ? 'Сандық егіз іске қосылуда…' : lang === 'en' ? 'Starting digital twin…' : 'Запускаем двойник…';
  const desc =
    lang === 'kk'
      ? 'Шлюзге қосылып, 1С жүйесінен тарих жүктелуде. Тегін хостингте алғашқы қосылу бір минутқа дейін уақыт алуы мүмкін.'
      : lang === 'en'
        ? 'Connecting to gateway and loading history from 1C. Free hosting initial start may take up to a minute.'
        : 'Подключаемся к шлюзу и загружаем историю из 1С. На бесплатном хостинге первый запуск занимает до минуты.';

  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <div className="flex max-w-[32rem] flex-col items-center gap-4 text-center">
        <LoaderCircle className="size-12 animate-spin text-accent" aria-hidden />
        <h1 className="text-[1.75rem] font-semibold">{message ?? defaultMsg}</h1>
        <p className="text-lg text-ink-2">{desc}</p>
      </div>
    </div>
  );
}

