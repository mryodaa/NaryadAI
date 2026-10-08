// Откуда отчёты берут данные: ядро двойника, журнал мастера и запросы, события по VIN, прогноз.
// Это те же объекты, из которых шлюз отдаёт экраны, поэтому цифры в файле и на экране совпадают.
import { SOURCE_BY_ID, STOP_REASON_RU, type CanonicalEvent, type CrewRequest, type DefectDecision, type RequestStatus, type SourceId } from '@allur/contracts';
import type { MonthForecast, Twin } from '@allur/twin-core';
import type { Crew } from '../crew';
import { fmtDateTime } from './format';
import { PLANT_NAME } from './model';

export interface ReportSource {
  twin: Twin;
  crew: Crew;
  now: number;
  /** Начало текущего прогона: журнал мастера есть только с этого момента */
  runStartMs: number;
  eventsByVin(vin: string): CanonicalEvent[];
  forecast(): MonthForecast | null;
}

/** Общие параметры запроса отчёта */
export interface ReportParams {
  area?: string;
  shift?: string;
  date?: string;
  from?: string;
  to?: string;
  vin?: string;
  incidentId?: string;
  /** Кто формирует: имя мастера или роль; внешняя система — без него */
  by?: string;
}

export class ReportError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function areaName(src: ReportSource, id: string, short = false): string {
  const st = src.twin.plant.stageById.get(id);
  return st ? (short ? st.short : st.name) : id;
}

export function eqName(src: ReportSource, id: string | undefined | null): string {
  if (!id) return '—';
  return src.twin.plant.equipmentById.get(id)?.name ?? id;
}

/** Шапка: завод, участок, период, когда и кем сформирован */
export function baseMeta(src: ReportSource, p: ReportParams, rows: [string, string][]): [string, string][] {
  return [
    ['Завод', PLANT_NAME],
    ...rows,
    ['Сформирован', `${fmtDateTime(src.now)} (время завода, UTC+5; часы демонстрации)`],
    ['Кем', p.by?.trim() ? p.by.trim().slice(0, 80) : 'Цифровой двойник по запросу API'],
  ];
}

export const SOURCE_RU = (s: string | undefined | null): string => {
  if (!s) return '—';
  const words: Record<string, string> = {
    plc: 'Контроллер',
    mes: '1С:MES',
    qls: '1С:QLS',
    wms: '1С:WMS',
    erp: '1С:ERP',
    camera: 'Камера',
    master: 'Мастер',
    signal: 'Сигнал → мастер',
    import: 'Импорт таблиц',
    twin: 'Двойник',
    inferred: 'Двойник (по разрыву прохода)',
    rfid: 'RFID',
  };
  return words[s] ?? SOURCE_BY_ID[s as SourceId]?.name ?? s;
};

export const stopReasonRu = (r: string | undefined): string | null => (r ? (STOP_REASON_RU as Record<string, string>)[r] ?? r : null);

export const DECISION_RU: Record<DefectDecision | 'rework' | 'scrap', string> = {
  polish: 'Полировка',
  repaint: 'Перекраска',
  to_qc: 'В ОТК',
  rework: 'Доработка',
  scrap: 'Списание',
};

export const REQUEST_STATUS_RU: Record<RequestStatus, string> = {
  sent: 'Отправлен, не просмотрен',
  viewed: 'Просмотрен, без ответа',
  accepted: 'Принят мастером',
  counter: 'Мастер предложил иначе',
  cant: 'Мастер: не могу',
  done: 'Сделано',
};

const CANT_RU: Record<string, string> = { no_people: 'нет людей', no_parts: 'нет запчастей', no_window: 'нет окна в работе' };

/** Ход запроса словами: встречное предложение мастера и ответ руководителя */
export function requestTrail(r: CrewRequest): string {
  const parts: string[] = [];
  if (r.counter) parts.push(`Мастер предложил: ${r.counter.at ? fmtDateTime(Date.parse(r.counter.at)) : 'другое время'}${r.counter.text ? ` («${r.counter.text}»)` : ''}`);
  if (r.managerAnswer) parts.push(r.managerAnswer === 'agree' ? 'Руководитель согласился' : 'Руководитель оставил как было');
  if (r.cantReason) parts.push(`Не может: ${CANT_RU[r.cantReason] ?? r.cantReason}${r.cantText ? ` («${r.cantText}»)` : ''}`);
  if (r.workOrderAt) parts.push(`Наряд в цех на ${fmtDateTime(Date.parse(r.workOrderAt))}`);
  return parts.join('; ');
}
