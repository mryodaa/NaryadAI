import { useTranslation } from '../i18n/store';

export function Placeholder({ title, stage }: { title: string; stage: string }) {
  const { t } = useTranslation();
  return (
    <main className="px-4 pt-3 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight max-sm:text-[1.375rem]">{title}</h1>
      <p className="mt-3 text-lg text-ink-2">{t.common.willAppearAtStage(stage)}</p>
    </main>
  );
}

