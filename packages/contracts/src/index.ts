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
export type * from './snapshot';
