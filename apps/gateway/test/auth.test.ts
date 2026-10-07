import { describe, expect, it } from 'vitest';
import { createGate, isInternal, sessionToken } from '../src/auth';

describe('пароль команды', () => {
  // пароль команды в репозитории не хранится — механизм проверяем на своём пароле из окружения
  const gate = createGate({ ACCESS_PASSWORD: 'тестовый-пароль' });

  it('пускает по верному паролю и не пускает по чужому', () => {
    expect(gate.enabled).toBe(true);
    expect(gate.check(sessionToken('тестовый-пароль'))).toBe(true);
    expect(gate.check(sessionToken('12345678'))).toBe(false);
    expect(gate.check('не токен')).toBe(false);
  });

  it('по умолчанию вход включён (хеш пароля команды), выключается переменной', () => {
    const team = createGate({});
    expect(team.enabled).toBe(true);
    expect(team.check(sessionToken('12345678'))).toBe(false);
    expect(createGate({ ACCESS_GATE: 'off' }).enabled).toBe(false);
  });

  it('без пароля — только запросы изнутри контейнера, не через прокси', () => {
    expect(isInternal('127.0.0.1', {})).toBe(true);
    expect(isInternal('::ffff:127.0.0.1', {})).toBe(true);
    expect(isInternal('127.0.0.1', { 'x-forwarded-for': '203.0.113.5' })).toBe(false);
    expect(isInternal('10.0.0.7', {})).toBe(false);
  });
});
