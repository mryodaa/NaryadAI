// Отчёт — нейтральная модель: шапка, итоговые цифры, таблицы и текст. Построители отчётов собирают её
// из тех же расчётов, что видны на экранах; рендеры превращают в PDF, Word, Excel и CSV одинаково.

export type ReportFormat = 'pdf' | 'docx' | 'xlsx' | 'csv';
export const REPORT_FORMATS: readonly ReportFormat[] = ['pdf', 'docx', 'xlsx', 'csv'];

/** Тип значения колонки: как показать в PDF/Word и какой числовой формат дать в Excel */
export type ColType = 'text' | 'int' | 'dec1' | 'pct' | 'minutes' | 'money' | 'datetime' | 'time' | 'date';

/** Значение ячейки: числа — числами (Excel считает), время — мс */
export type CellValue = string | number | null;

export interface Column {
  key: string;
  title: string;
  type: ColType;
  /** Ширина в Excel, символов (иначе — по содержимому) */
  width?: number;
  /** Доля ширины в PDF/Word */
  weight?: number;
}

export type Row = Record<string, CellValue>;

export interface ReportTable {
  /** Имя листа Excel (до 31 знака) */
  sheet?: string;
  title: string;
  columns: Column[];
  rows: Row[];
  /** Строка «Итого»: какие колонки суммировать (в Excel — формулой SUM) */
  sumColumns?: string[];
  /** Пояснение под таблицей */
  note?: string;
  /** Текст, если строк нет */
  empty: string;
  /** Выделить строку (например, простой без причины) */
  highlight?: (row: Row) => boolean;
  /** Только в PDF и Word (в Excel те же строки уже выделены на основном листе) */
  skipXlsx?: boolean;
}

export interface Kpi {
  label: string;
  value: CellValue;
  type: ColType;
  /** Подпись справа: «лимит 60 мин», «по линии» */
  note?: string;
  /** Отклонение от нормы — выделить */
  bad?: boolean;
}

export type Section =
  | { kind: 'kpis'; title: string; items: Kpi[] }
  | { kind: 'table'; table: ReportTable }
  | { kind: 'text'; title: string; lines: string[] };

export interface ReportDoc {
  title: string;
  /** Подзаголовок: участок и период словами */
  subtitle: string;
  /** Шапка: завод, участок, период, когда и кем сформирован */
  meta: [string, string][];
  sections: Section[];
  /** Имя файла без расширения, по-русски: Сводка_смены_Окраска_2026-10-08_смена-1 */
  fileBase: string;
  /** Альбомная страница PDF/Word для широких таблиц */
  landscape?: boolean;
  /** Excel: лист с итогом (шапка и цифры); таблицы — отдельными листами */
  summarySheet?: string;
  /** Excel: дополнительные листы (сводные формулами) — после основных */
  xlsxExtra?: (wb: import('exceljs').Workbook, sheets: Map<string, { ws: import('exceljs').Worksheet; firstRow: number; lastRow: number; colOf: (key: string) => string }>) => void;
}

/** Строка внизу каждой страницы и листа */
export const PROTOTYPE_NOTE = 'Прототип цифрового двойника. Данные синтетические, откалиброваны по данным кейса Allur';
export const PLANT_NAME = 'Автозавод Allur (Костанай), цех КСТ';
export const MONEY_NOTE = 'Денежные суммы — условные: параметры денег задаются в настройках и уточняются с заводом';
