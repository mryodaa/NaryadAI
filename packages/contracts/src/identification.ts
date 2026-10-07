// Как двойник узнаёт, где кузов: точки отметки (сканер 1С:MES, RFID тележки, трекинг ПЛК,
// инструмент поста, мастер) и справочник цветов из производственного заказа 1С.
// Без зависимостей — используется и в интерфейсе.
import type { ModelId, SourceId } from './plant';

// ---------------------------------------------------------------------------
// Способы отметки кузова

export const ID_METHODS = ['mes_scan', 'rfid', 'plc_tracking', 'tool_result', 'manual'] as const;
export type IdMethod = (typeof ID_METHODS)[number];

export interface IdMethodDef {
  label: string;
  /** Простыми словами — для подсказки и мастера подключения */
  about: string;
  icon: string;
  /** С какой ступени внедрения такие отметки есть */
  stage: 0 | 1 | 2;
  /** Система-источник отметки */
  source: SourceId;
}

export const ID_METHOD_DEF: Record<IdMethod, IdMethodDef> = {
  mes_scan: { label: 'Сканер 1С:MES', about: 'Оператор сканирует штрихкод кузова ручным терминалом, отметка уходит в 1С:MES', icon: 'scan-barcode', stage: 0, source: 'mes' },
  rfid: { label: 'RFID тележки', about: 'Считыватель у станции читает метку тележки-салазок с кузовом', icon: 'radio-tower', stage: 1, source: 'plc' },
  plc_tracking: { label: 'Трекинг ПЛК', about: 'Контроллер конвейера знает, какой кузов на какой позиции', icon: 'cpu', stage: 1, source: 'plc' },
  tool_result: { label: 'Инструмент поста', about: 'Гайковёрт или тестер отдаёт результат операции с VIN', icon: 'drill', stage: 1, source: 'plc' },
  manual: { label: 'Мастер', about: 'Мастер отмечает кузов с телефона', icon: 'smartphone', stage: 0, source: 'master' },
};

/** Где стоит точка: на входе или выходе участка, станции, или у оборудования (вход и выход с него) */
export type IdPointRole = 'stage_entry' | 'stage_exit' | 'station_entry' | 'station_exit' | 'equipment';

// ---------------------------------------------------------------------------
// Цвета кузова (из производственного заказа 1С:ERP/MES)

export const COLOR_FINISHES = ['solid', 'metallic', 'pearl'] as const;
export type ColorFinish = (typeof COLOR_FINISHES)[number];

export interface ColorDef {
  code: string;
  name: string;
  hex: string;
  finish: ColorFinish;
  /** Для каких моделей доступен (5 цветов на модель); нет — для любых */
  models?: ModelId[];
}

/** 8 автомобильных цветов; коды и названия условные — точный справочник берётся из 1С завода */
export const DEFAULT_COLORS: ColorDef[] = [
  { code: 'W01', name: 'Белый', hex: '#eeeeea', finish: 'solid', models: ['onix', 'cobalt', 'j7'] },
  { code: 'S02', name: 'Серебристый металлик', hex: '#b4b8bc', finish: 'metallic', models: ['onix', 'cobalt', 'j7'] },
  { code: 'G03', name: 'Серый графит', hex: '#5b6067', finish: 'metallic', models: ['onix', 'cobalt'] },
  { code: 'K04', name: 'Чёрный', hex: '#1b1d20', finish: 'metallic', models: ['onix', 'cobalt', 'j7'] },
  { code: 'B05', name: 'Тёмно-синий', hex: '#1f2f4d', finish: 'pearl', models: ['j7'] },
  { code: 'R06', name: 'Красный', hex: '#8e1d22', finish: 'metallic', models: ['onix'] },
  { code: 'Y07', name: 'Бежевый', hex: '#c9b99a', finish: 'metallic', models: ['cobalt'] },
  { code: 'N08', name: 'Коричневый', hex: '#5a4334', finish: 'metallic', models: ['j7'] },
];

/** Доли цветов в заказах (условно, по типичному спросу): белый ~35%, серебристый и серый ~25%, чёрный ~15%, остальные ~25% */
export const COLOR_WEIGHT: Record<string, number> = { W01: 35, S02: 14, G03: 11, K04: 15, B05: 9, R06: 9, Y07: 8, N08: 8 };

/** Цвета модели с долями (сумма — 1) */
export function colorMix(colors: readonly ColorDef[], model: ModelId): { code: string; share: number }[] {
  const own = colors.filter((c) => !c.models || c.models.includes(model));
  const total = own.reduce((a, c) => a + (COLOR_WEIGHT[c.code] ?? 5), 0) || 1;
  return own.map((c) => ({ code: c.code, share: (COLOR_WEIGHT[c.code] ?? 5) / total }));
}
