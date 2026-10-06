export function Placeholder({ title, stage }: { title: string; stage: string }) {
  return (
    <main className="px-4 pt-3 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="mt-3 text-lg text-ink-2">Экран появится на этапе {stage}.</p>
    </main>
  );
}
