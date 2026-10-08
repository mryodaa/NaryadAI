// Рабочее место мастера: сигналы, журнал смены, запросы руководителя, сдача смены.
// Без зависимостей — используется и в интерфейсе. Схемы тел запросов — в crew-api.ts.
//
// Сигнал — не факт: всё, что заметили контроллеры, 1С:MES или камеры, остаётся «похоже, что…»,
// пока человек на месте не подтвердит. Мастер ничего не обязан нажимать: неотвеченный сигнал
// у руководителя так и остаётся «не проверено», а снявшаяся сама ситуация закрывается сама.
import type { AreaId, SourceId } from './plant';

/** open — ждёт взгляда мастера; later — отложен вниз списка; yes/no — ответ мастера; cleared — разрешилось само */
export type SignalStatus = 'open' | 'later' | 'yes' | 'no' | 'cleared';

/** Что заметили: стоит оборудование, нет прохода кузовов, встала часть станций, ждём комплекты, брак выше нормы */
export type SignalKind = 'stop' | 'no_flow' | 'reduced' | 'waiting' | 'quality';

/** «Нет» мастера: почему сигнал не подтвердился */
export const NO_REASONS = ['sensor_wrong', 'mes_missing', 'planned_stop', 'other'] as const;
export type NoReason = (typeof NO_REASONS)[number];

/** Причина простоя: единственное обязательное поле записи (мастер и сегодня его заполняет) */
export const STOP_REASONS = ['breakdown', 'setup', 'no_parts', 'no_people', 'quality', 'other'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** Брак по кузову: решение мастера */
export const DEFECT_DECISIONS = ['polish', 'repaint', 'to_qc'] as const;
export type DefectDecision = (typeof DEFECT_DECISIONS)[number];

/** «Не могу» на запрос руководителя */
export const CANT_REASONS = ['no_people', 'no_parts', 'no_window'] as const;
export type CantReason = (typeof CANT_REASONS)[number];

/** Категория простоя в 1С:MES для причины мастера */
export const STOP_REASON_CATEGORY: Record<StopReason, 'breakdown' | 'no_parts' | 'setup' | 'waiting' | 'other'> = {
  breakdown: 'breakdown',
  setup: 'setup',
  no_parts: 'no_parts',
  no_people: 'waiting',
  quality: 'other',
  other: 'other',
};

export const STOP_REASON_RU: Record<StopReason, string> = {
  breakdown: 'Поломка',
  setup: 'Наладка',
  no_parts: 'Нет деталей',
  no_people: 'Нет людей',
  quality: 'Качество',
  other: 'Другое',
};

export const NO_REASON_RU: Record<NoReason, string> = {
  sensor_wrong: 'датчик ошибся',
  mes_missing: 'нет отметки в MES',
  planned_stop: 'плановая остановка',
  other: 'другое',
};

export interface CrewSignal {
  /** Устойчивый номер: ключ инцидента двойника и момент начала */
  signalId: string;
  incidentId: string;
  area: AreaId;
  equipmentId?: string;
  /** По-русски, для интеграторов; интерфейс собирает текст сам из полей ниже */
  text: string;
  /** Заголовок инцидента двойника (по-русски) — для брака и ожидания комплектов */
  title: string;
  kind: SignalKind;
  /** С какого момента (для «стоит с 14:02») */
  since: string;
  /** Сколько минут длится на момент последнего пересчёта */
  minutes: number;
  /** Кто заметил: контроллер, 1С:MES, камера, 1С:QLS… */
  sources: SourceId[];
  /** Совпали два независимых источника — вероятно, но на месте не проверено */
  probable: boolean;
  openedAt: string;
  status: SignalStatus;
  noReason?: NoReason;
  /** Когда мастер отложил: «Позже» опускает карточку вниз */
  laterAt?: string;
  answeredBy?: string;
  closedAt?: string;
}

export interface LogEntry {
  entryId: string;
  area: AreaId;
  /** Ключ смены: 2026-10-07-1 */
  shift: string;
  kind: 'downtime' | 'defect';
  signalId?: string;
  incidentId?: string;
  equipmentId?: string;
  bodyId?: string;
  vin?: string;
  /** Брак по кузову: код дефекта и контрольная точка 1С:QLS */
  defect?: string;
  checkpoint?: string;
  from?: string;
  to?: string;
  /** Что уже известно: «Камера-01: давление краски ниже нормы, код E-212» */
  facts: string;
  code?: string;
  reason?: StopReason;
  decision?: DefectDecision;
  comment?: string;
  needHelp: boolean;
  /** Когда мастер попросил помощи и когда руководитель увидел просьбу */
  helpAt?: string;
  helpAckAt?: string;
  /** Откуда запись: мастер (сам или по сигналу), 1С:MES, контроллер, 1С:QLS */
  origin: 'master' | 'signal' | 'mes' | 'plc' | 'qls';
  by: string;
  at: string;
}

export type RequestStatus = 'sent' | 'viewed' | 'accepted' | 'counter' | 'cant' | 'done';

export interface CrewRequest {
  requestId: string;
  incidentId?: string;
  optionId?: string;
  area: AreaId;
  equipmentId?: string;
  /** Что сделать — вариант решения двойника (по-русски, интерфейс переводит) */
  text: string;
  /** Почему — заголовок инцидента (по-русски) */
  why: string;
  /** Кому: мастер участка */
  recipient: string;
  /** Вид работ наряда: replace_filter, maintenance, repair, inspect; нет — без наряда в цех */
  action?: string;
  /** Срок; после «Согласен» — время, предложенное мастером */
  dueAt: string;
  /** Наряд ушёл в цех на это время (после «Принять» или «Согласен») */
  workOrderAt?: string;
  status: RequestStatus;
  counter?: { at?: string; text?: string };
  cantReason?: CantReason;
  cantText?: string;
  managerAnswer?: 'agree' | 'keep';
  viewedAt?: string;
  answeredAt?: string;
  doneAt?: string;
  by: string;
  at: string;
}

export interface ShiftSummary {
  done: number;
  plan: number;
  downtimeMin: number;
  withoutReason: number;
  openRequests: number;
}

export interface ShiftClose {
  area: AreaId;
  shift: string;
  summary: ShiftSummary;
  note?: string;
  closedBy?: string;
  auto: boolean;
  at: string;
}

/** Вкладка «Смена»: выпуск по часам, простои, записи без причины, сдача смены */
export interface CrewShiftView {
  area: AreaId;
  shift: string | null;
  startsAt: string | null;
  endsAt: string | null;
  summary: ShiftSummary;
  /** По часам: план и факт выхода с участка */
  hours: { hour: string; plan: number; fact: number }[];
  /** Смена уже сдана (мастером или сама по времени) */
  close: ShiftClose | null;
  /** Заметка прошлой смены этого участка */
  prevNote: { note: string; by?: string; at: string } | null;
}

/** «Как было раньше»: прошлый случай с этим оборудованием */
export interface PastCase {
  from: string;
  minutes: number;
  /** Причина мастера в одно касание (журнал этого приложения) */
  reason?: StopReason;
  /** Причина словами (запись 1С:MES), по-русски */
  text?: string;
}

/** Всё рабочее место мастера одним сообщением (WebSocket {t:'crew'} и GET /api/v1/crew) */
export interface CrewView {
  at: string;
  signals: CrewSignal[];
  log: LogEntry[];
  requests: CrewRequest[];
  shiftCloses: ShiftClose[];
  /** За текущую смену: сколько сигналов каждого источника мастер не подтвердил */
  unconfirmedBySource: Partial<Record<SourceId, number>>;
}
