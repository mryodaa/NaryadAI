// Тела запросов рабочего места мастера (REST /api/v1/crew/...).
import { z } from 'zod';
import { CANT_REASONS, NO_REASONS, STOP_REASONS, DEFECT_DECISIONS } from './crew';
import { AreaIdSchema, Timestamp } from './events';

export const SignalAnswerRequest = z
  .object({
    action: z.enum(['yes', 'no', 'later']),
    noReason: z.enum(NO_REASONS).optional(),
    by: z.string().max(120).optional(),
  })
  .meta({ id: 'SignalAnswerRequest', description: 'Ответ мастера на сигнал: «Да», «Нет» с причиной, «Позже»' });

export const LogEntryRequest = z
  .object({
    /** нет — новая запись мастера («+»), есть — правка записи журнала */
    entryId: z.string().max(120).optional(),
    area: AreaIdSchema,
    equipmentId: z.string().max(64).optional(),
    from: Timestamp.optional(),
    to: Timestamp.optional(),
    facts: z.string().max(300).optional(),
    reason: z.enum(STOP_REASONS).optional(),
    decision: z.enum(DEFECT_DECISIONS).optional(),
    comment: z.string().max(300).optional(),
    needHelp: z.boolean().optional(),
    by: z.string().max(120).optional(),
  })
  .meta({ id: 'LogEntryRequest', description: 'Запись журнала смены: причина простоя в одно касание, комментарий по желанию' });

/** Ответ мастера на запрос руководителя: «просмотрено» ставится само, остальное — одним-двумя касаниями */
export const RequestAnswerRequest = z
  .object({
    action: z.enum(['view', 'accept', 'counter', 'cant', 'done']),
    /** «Предложить иначе»: своё время */
    at: Timestamp.optional(),
    /** Одна строка по желанию: «в 16:00 нет наладчика» */
    text: z.string().max(200).optional(),
    cantReason: z.enum(CANT_REASONS).optional(),
    by: z.string().max(120).optional(),
  })
  .meta({ id: 'RequestAnswerRequest', description: 'Ответ мастера на запрос: принять, предложить иначе, не могу, сделано' });

/** Руководитель на «предложено иначе»: согласен или оставить как было */
export const ManagerAnswerRequest = z
  .object({ answer: z.enum(['agree', 'keep']), by: z.string().max(120).optional() })
  .meta({ id: 'ManagerAnswerRequest', description: 'Ответ руководителя на предложение мастера' });

export type SignalAnswerRequest = z.infer<typeof SignalAnswerRequest>;
export type RequestAnswerRequest = z.infer<typeof RequestAnswerRequest>;
export type ManagerAnswerRequest = z.infer<typeof ManagerAnswerRequest>;
export type LogEntryRequest = z.infer<typeof LogEntryRequest>;
