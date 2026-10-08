import { z } from 'zod';

// Сообщения об ошибках валидации — по-русски (видны на экране «Источники данных»)
z.config(z.locales.ru());

export * from './plant';
export * from './time';
export * from './calendar';
export * from './vin';
export * from './scenarios';
export * from './events';
export * from './mqtt';
export * from './rest';
export * from './demo';
export * from './csv';
export * from './equipment-catalog';
export * from './plant-config';
export * from './plant-seed';
export * from './plant-model';
export * from './plant-validate';
export * from './plant-diff';
export * from './text-ru';
export * from './identification';
export * from './operations';
export * from './crew';
export * from './crew-api';
export type * from './snapshot';
