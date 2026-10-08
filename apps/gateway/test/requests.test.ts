// Запросы мастеру: наряд уходит в цех только после согласия мастера (или руководителя на его время).
import { describe, expect, it } from 'vitest';
import { SEED_MODEL, type WorkOrder } from '@allur/contracts';
import type { Incident, IncidentOption } from '@allur/twin-core';
import { RequestDesk } from '../src/requests';

const T0 = Date.parse('2026-10-07T13:40:00+05:00');
const iso = (ms: number) => new Date(ms).toISOString();

function setup() {
  const sent: WorkOrder[] = [];
  const desk = new RequestDesk(() => SEED_MODEL, (wo) => sent.push(wo));
  const option = {
    id: 'shift_change',
    title: 'Заменить фильтр Камеры-02 в пересменку (16:00)',
    workOrder: { action: 'replace_filter', area: 'paint', equipmentId: 'BOOTH-02', title: 'Замена фильтра', scheduledAt: '2026-10-07T16:00:00+05:00', durationMin: 20 },
  } as unknown as IncidentOption;
  const inc = { id: 'inc-quality-1', area: 'paint', title: 'Окраска: брак 10,7% и растёт', options: [option] } as unknown as Incident;
  const wo: WorkOrder = { workOrderId: 'wo-1', incidentId: inc.id, issuedAt: iso(T0), ...(option.workOrder as Omit<WorkOrder, 'workOrderId' | 'incidentId' | 'issuedAt'>) };
  const req = desk.create(inc, option, wo, Date.parse(wo.scheduledAt), 'Начальник производства', T0);
  return { desk, sent, req, inc, option };
}

describe('запрос мастеру', () => {
  it('работы на оборудовании участка — мастеру; «ничего не делать» — нет', () => {
    const { desk, inc, option } = setup();
    expect(desk.needsMaster(inc, option)).toBe(true);
    expect(desk.needsMaster(inc, { ...option, id: 'do_nothing' } as IncidentOption)).toBe(false);
  });

  it('пока мастер не ответил — наряд в цех не уходит; открыл — «просмотрено»', () => {
    const { desk, sent, req } = setup();
    expect(req.status).toBe('sent');
    desk.master(req.requestId, 'view', {}, T0 + 60_000);
    expect(req.status).toBe('viewed');
    expect(sent).toHaveLength(0);
  });

  it('«Принять» — наряд на срок руководителя', () => {
    const { desk, sent, req } = setup();
    desk.master(req.requestId, 'accept', {}, T0 + 60_000);
    expect(req.status).toBe('accepted');
    expect(sent).toHaveLength(1);
    expect(Date.parse(sent[0]!.scheduledAt)).toBe(Date.parse('2026-10-07T16:00:00+05:00'));
  });

  it('«Предложить иначе» → «Согласен» — наряд на время мастера; «Сделано» раньше — цех узнаёт сразу', () => {
    const { desk, sent, req } = setup();
    desk.master(req.requestId, 'counter', { at: '2026-10-07T14:10:00+05:00', text: 'в 16:00 нет наладчика' }, T0 + 60_000);
    expect(req.status).toBe('counter');
    expect(sent).toHaveLength(0);
    desk.manager(req.requestId, 'agree', T0 + 120_000);
    expect(req.status).toBe('accepted');
    expect(Date.parse(sent[0]!.scheduledAt)).toBe(Date.parse('2026-10-07T14:10:00+05:00'));
    desk.master(req.requestId, 'done', {}, T0 + 180_000);
    expect(req.status).toBe('done');
    expect(sent).toHaveLength(2);
    expect(Date.parse(sent[1]!.scheduledAt)).toBe(T0 + 180_000);
    expect(sent[1]!.durationMin).toBe(1);
  });

  it('«Оставить как было» — запрос снова у мастера, наряд не уходит', () => {
    const { desk, sent, req } = setup();
    desk.master(req.requestId, 'counter', { at: '2026-10-07T14:10:00+05:00' }, T0 + 60_000);
    desk.manager(req.requestId, 'keep', T0 + 120_000);
    expect(req.status).toBe('viewed');
    expect(req.managerAnswer).toBe('keep');
    expect(sent).toHaveLength(0);
  });

  it('«Сделано» после наряда, время которого прошло, — повторно в цех не уходит', () => {
    const { desk, sent, req } = setup();
    desk.master(req.requestId, 'accept', {}, T0);
    desk.master(req.requestId, 'done', {}, Date.parse('2026-10-07T16:30:00+05:00'));
    expect(sent).toHaveLength(1);
  });
});
