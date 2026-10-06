// «Почему?»: правило или модель, входные данные с источниками, вывод, допущения.
import type { Explain } from '@allur/contracts/ref';
import { SourceBadge } from './SourceBadge';

export function ExplainView({ explain }: { explain: Explain }) {
  return (
    <div className="flex flex-col gap-4 text-base">
      <section>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-3">Как считает двойник</h3>
        <p className="leading-snug">{explain.rule}</p>
      </section>
      {explain.inputs.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-ink-3">На каких данных</h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface">
            {explain.inputs.map((i, k) => (
              <li key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
                <span className="flex items-center gap-2 text-ink-2">
                  <SourceBadge source={i.source} compact />
                  {i.label}
                </span>
                <span className="num font-semibold">{i.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl bg-accent-bg px-3 py-2.5">
        <h3 className="mb-0.5 text-sm font-semibold uppercase tracking-wide text-accent-ink">Вывод</h3>
        <p className="font-medium leading-snug">{explain.conclusion}</p>
      </section>
      {explain.assumptions && explain.assumptions.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-3">Допущения</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
            {explain.assumptions.map((a, k) => (
              <li key={k}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
