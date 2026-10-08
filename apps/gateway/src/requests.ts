// Запросы руководителя мастеру. Руководитель выбирает вариант по инциденту — мастер участка получает
// запрос со сроком. Наряд уходит в цех только после «Принять» мастера или «Согласен» руководителя на
// время, предложенное мастером. Мастер молчит — ничего не происходит: руководитель видит
// «просмотрено, без ответа» и сам решает, подойти ли.
import { toPlantIso, type CantReason, type CrewRequest, type PlantModel, type WorkOrder } from '@allur/contracts';
import type { Incident, IncidentOption } from '@allur/twin-core';

/** Работы на оборудовании участка — их делает смена мастера */
const MASTER_JOBS = new Set(['replace_filter', 'maintenance', 'repair', 'inspect']);

/** Что сделать — без времени: срок у запроса свой и может смениться после «Согласен» */
const JOB_RU: Record<string, string> = {
  replace_filter: 'Замена фильтра',
  maintenance: 'Плановое ТО',
  inspect: 'Осмотр',
  repair: 'Ремонт',
};

/** Кому: мастер участка (по-русски, для интеграторов; интерфейс подписывает сам) */
const MASTER_BY_KIND: Record<string, string> = {
  welding: 'Мастер сварки',
  painting: 'Мастер окраски',
  assembly: 'Мастер сборки',
  inspection: 'Мастер ОТК',
};

type Dispatch = (wo: WorkOrder, req: CrewRequest) => void;
export type RequestResult = { ok: true; request: CrewRequest } | { ok: false; status: number; message: string };

interface Item {
  req: CrewRequest;
  /** Наряд по варианту решения; null — работа без наряда в цех («час сверхурочно») */
  wo: WorkOrder | null;
  /** На какое время наряд ушёл в цех (null — ещё не ушёл) */
  sentFor: number | null;
}

export class RequestDesk {
  private items = new Map<string, Item>();
  private seq = 0;

  constructor(
    private plant: () => PlantModel,
    private dispatch: Dispatch,
  ) {}

  reset() {
    this.items.clear();
    this.seq = 0;
  }

  /** Нужен ли мастер: работы на оборудовании производственного участка. Склад и очередь моделей — сразу в системы завода */
  needsMaster(inc: Incident, option: IncidentOption): boolean {
    if (option.id === 'do_nothing' || option.id === 'postpone') return false;
    const area = option.workOrder?.area ?? inc.area;
    if (!this.plant().production.some((s) => s.id === area)) return false;
    return option.workOrder ? MASTER_JOBS.has(option.workOrder.action) : true;
  }

  create(inc: Incident, option: IncidentOption, wo: WorkOrder | null, dueAt: number, by: string | undefined, now: number): CrewRequest {
    const area = option.workOrder?.area ?? inc.area;
    const kind = this.plant().stageById.get(area)?.kind ?? '';
    const eqId = option.workOrder?.equipmentId ?? inc.equipmentId;
    const where = (eqId && this.plant().equipmentById.get(eqId)?.name) || (this.plant().stageById.get(area)?.short ?? area);
    const job = wo ? JOB_RU[wo.action] : undefined;
    const req: CrewRequest = {
      requestId: `req-${++this.seq}`,
      incidentId: inc.id,
      optionId: option.id,
      area,
      equipmentId: eqId,
      text: job ? `${job}: ${where}` : option.title,
      why: inc.title,
      recipient: MASTER_BY_KIND[kind] ?? 'Мастер участка',
      action: wo?.action,
      dueAt: toPlantIso(dueAt),
      status: 'sent',
      by: by ?? 'Руководитель',
      at: toPlantIso(now),
    };
    this.items.set(req.requestId, { req, wo, sentFor: null });
    return req;
  }

  /** Мастер: просмотрено (само), принять, предложить иначе, не могу, сделано */
  master(
    id: string,
    action: 'view' | 'accept' | 'counter' | 'cant' | 'done',
    opts: { at?: string; text?: string; cantReason?: CantReason },
    now: number,
  ): RequestResult {
    const it = this.items.get(id);
    if (!it) return { ok: false, status: 404, message: 'Запрос не найден' };
    const r = it.req;
    const waiting = r.status === 'sent' || r.status === 'viewed';
    switch (action) {
      case 'view':
        if (r.status === 'sent') {
          r.status = 'viewed';
          r.viewedAt = toPlantIso(now);
        }
        break;
      case 'accept':
        if (!waiting) return conflict(r);
        r.status = 'accepted';
        r.answeredAt = toPlantIso(now);
        this.send(it, Date.parse(r.dueAt), now, false);
        break;
      case 'counter':
        if (!waiting) return conflict(r);
        r.status = 'counter';
        r.counter = { at: opts.at, text: opts.text?.trim() || undefined };
        r.managerAnswer = undefined;
        r.answeredAt = toPlantIso(now);
        break;
      case 'cant':
        if (!waiting && r.status !== 'accepted') return conflict(r);
        r.status = 'cant';
        r.cantReason = opts.cantReason;
        r.cantText = opts.text?.trim() || undefined;
        r.answeredAt = toPlantIso(now);
        break;
      case 'done':
        if (r.status === 'done' || r.status === 'cant') return conflict(r);
        r.status = 'done';
        r.doneAt = toPlantIso(now);
        // сделали раньше назначенного времени (или наряд ещё не уходил) — цех узнаёт сразу;
        // время уже прошло — работа выполнена по наряду, повторять нечего
        if (it.sentFor === null || it.sentFor > now) this.send(it, now, now, true);
        break;
    }
    return { ok: true, request: r };
  }

  /** Руководитель на «предложено иначе»: «Согласен» — наряд на время мастера; «Оставить как было» — запрос снова у мастера */
  manager(id: string, answer: 'agree' | 'keep', now: number): RequestResult {
    const it = this.items.get(id);
    if (!it) return { ok: false, status: 404, message: 'Запрос не найден' };
    const r = it.req;
    if (r.status !== 'counter') return conflict(r);
    r.managerAnswer = answer;
    if (answer === 'agree') {
      if (r.counter?.at) r.dueAt = r.counter.at;
      r.status = 'accepted';
      this.send(it, Date.parse(r.dueAt), now, false);
    } else {
      r.status = 'viewed';
    }
    return { ok: true, request: r };
  }

  private send(it: Item, at: number, now: number, done: boolean) {
    if (!it.wo) return;
    const when = Math.max(at, now);
    // «Сделано» — работа уже выполнена: в цеху она занимает минуту, а не плановое время
    const wo: WorkOrder = { ...it.wo, scheduledAt: toPlantIso(when), durationMin: done ? 1 : it.wo.durationMin };
    it.sentFor = when;
    it.req.workOrderAt = wo.scheduledAt;
    this.dispatch(wo, it.req);
  }

  list(now: number): CrewRequest[] {
    return [...this.items.values()]
      .map((i) => i.req)
      .filter((r) => now - Date.parse(r.at) < 12 * 3600_000)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /** Запрос по инциденту — последний */
  forIncident(incidentId: string): CrewRequest | undefined {
    return [...this.items.values()].map((i) => i.req).filter((r) => r.incidentId === incidentId).pop();
  }
}

function conflict(r: CrewRequest): RequestResult {
  return { ok: false, status: 409, message: `Запрос уже в статусе «${r.status}»` };
}
