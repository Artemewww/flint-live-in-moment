import { checkRateLimit, resetStore, cleanExpired } from '../ratelimit';

beforeEach(() => {
  resetStore();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('checkRateLimit', () => {
  it('должен разрешить первый запрос', () => {
    const result = checkRateLimit('test-key', 3, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('должен разрешить до лимита', () => {
    checkRateLimit('key', 3, 60000);
    checkRateLimit('key', 3, 60000);
    const result = checkRateLimit('key', 3, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('должен заблокировать при превышении лимита', () => {
    checkRateLimit('key', 2, 60000);
    checkRateLimit('key', 2, 60000);
    const result = checkRateLimit('key', 2, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('должен сбросить после окончания окна', () => {
    checkRateLimit('key', 1, 60000);
    const blocked = checkRateLimit('key', 1, 60000);
    expect(blocked.allowed).toBe(false);

    // Прошло 60 секунд
    jest.advanceTimersByTime(60001);

    const allowed = checkRateLimit('key', 1, 60000);
    expect(allowed.allowed).toBe(true);
  });

  it('должен работать с разными ключами независимо', () => {
    checkRateLimit('key-a', 1, 60000);
    const resultA = checkRateLimit('key-a', 1, 60000);
    expect(resultA.allowed).toBe(false);

    const resultB = checkRateLimit('key-b', 1, 60000);
    expect(resultB.allowed).toBe(true);
  });
});

describe('cleanExpired', () => {
  it('должен очистить просроченные записи', () => {
    checkRateLimit('old', 1, 1000);
    checkRateLimit('fresh', 1, 60000);

    jest.advanceTimersByTime(2000);

    const cleaned = cleanExpired();
    expect(cleaned).toBe(1);
  });
});