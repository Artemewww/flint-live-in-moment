/**
 * Проверка подписи Telegram WebApp initData + заслон от форжа апдейтов.
 *
 * Функция verifyInitData задублирована в пяти файлах API НАМЕРЕННО: импорт из
 * api/_lib/ роняет функции на Vercel в рантайме (см. HANDOFF.md). Цена
 * дублирования — копии расходятся: в fundraisers.ts однажды не оказалось
 * проверки auth_date, и перехваченная подпись там жила вечно.
 *
 * Поэтому тест проверяет не эталон, а сами копии: вырезает функцию из
 * исходника каждого файла и гоняет по одинаковым сценариям.
 *
 * Второй тест в этом файле — заслон от форжа апдейтов в вебхуке: он вырезает
 * проверку `trustedUpdate` из api/telegram/webhook.ts. Появление именно этой
 * проверки потребовал инцидент 28.09 (в members попала строка telegram_id=1,
 * first_name='probe' — её создал upsert отметки живости по подделанному телу
 * апдейта).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const BOT_TOKEN = '123456:TEST-token';
const MAX_AGE_SEC = 24 * 60 * 60;

const COPIES = [
  'api/events.ts',
  'api/register.ts',
  'api/profile.ts',
  'api/fundraisers.ts',
  'api/admin/events.ts',
];

type Verify = (initData: string) => { id: number } | null;

/** Достаёт verifyInitData из файла и собирает в вызываемую функцию. */
function loadCopy(file: string): Verify {
  const src = fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
  const m = src.match(/^function verifyInitData\([\s\S]*?^}/m);
  if (!m) throw new Error(`verifyInitData не найдена в ${file}`);
  const js = ts.transpileModule(m[0], { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const fn = new Function('crypto', 'Buffer', 'BOT_TOKEN', 'INITDATA_MAX_AGE_SEC', `${js}\nreturn verifyInitData;`)(
    crypto, Buffer, BOT_TOKEN, MAX_AGE_SEC,
  );
  // Одни копии берут токен аргументом, другие — из окружения модуля.
  return (initData: string) => fn(initData, BOT_TOKEN);
}

/** Подписывает initData так же, как это делает Telegram. */
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = () => Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 377551019, first_name: 'Тест' });

describe.each(COPIES)('verifyInitData в %s', (file) => {
  const verify = loadCopy(file);

  test('принимает свежую подпись и отдаёт telegram_id', () => {
    const r = verify(sign({ auth_date: String(now()), user }));
    expect(r?.id).toBe(377551019);
  });

  test('отклоняет подпись чужим токеном', () => {
    expect(verify(sign({ auth_date: String(now()), user }, '999:other'))).toBeNull();
  });

  test('отклоняет подделанного пользователя', () => {
    const good = new URLSearchParams(sign({ auth_date: String(now()), user }));
    good.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }));
    expect(verify(good.toString())).toBeNull();
  });

  test('отклоняет подпись старше 24 часов (replay)', () => {
    expect(verify(sign({ auth_date: String(now() - MAX_AGE_SEC - 60), user }))).toBeNull();
  });

  test('отклоняет подпись без auth_date', () => {
    expect(verify(sign({ user }))).toBeNull();
  });

  test('отклоняет пустую строку, отсутствие hash и мусор', () => {
    expect(verify('')).toBeNull();
    expect(verify(`auth_date=${now()}&user=${encodeURIComponent(user)}`)).toBeNull();
    expect(verify('%%%не-initData')).toBeNull();
  });

  test('отклоняет подпись без пользователя', () => {
    expect(verify(sign({ auth_date: String(now()) }))).toBeNull();
  });
});

/**
 * ЗАСЛОН ОТ ФОРЖА АПДЕЙТОВ (webhook.ts).
 *
 * Тест вырезает trustedUpdate из вебхука и проверяет ровно два свойства:
 *   1. настоящий апдейт Telegram проходит (иначе бот перестанет работать);
 *   2. подделка, которой 28.09 создали строку telegram_id=1 / 'probe', НЕ проходит.
 * Второе свойство — регрессия: если кто-то уберёт проверку, тест упадёт.
 */
describe('trustedUpdate в вебхуке', () => {
  const loadTrusted = (): (u: any) => { ok: boolean; reason: string; tgId: number } => {
    const file = path.join(__dirname, '../../telegram/webhook.ts');
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/^function trustedUpdate\([\s\S]*?^}/m);
    if (!m) throw new Error('trustedUpdate не найдена в api/telegram/webhook.ts');
    const js = ts.transpileModule(m[0], { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    return new Function(`${js}\nreturn trustedUpdate;`)() as any;
  };

  const trusted = loadTrusted();
  const realUser = { id: 377551019, first_name: 'Артём', username: 'Demarts' };

  test('принимает настоящее сообщение', () => {
    expect(trusted({ update_id: 100500, message: { from: realUser, text: 'привет' } }).ok).toBe(true);
  });

  test('принимает настоящую кнопку', () => {
    const u = { update_id: 100501, callback_query: { id: '4382', from: realUser, data: 'home' } };
    expect(trusted(u)).toEqual({ ok: true, reason: '', tgId: 377551019 });
  });

  test('принимает пользователя без @ника (nickname необязателен)', () => {
    const u = { update_id: 100502, message: { from: { id: 555, first_name: 'Гость' } } };
    expect(trusted(u).ok).toBe(true);
  });

  test('ОТКЛОНЯЕТ воспроизведённую подделку telegram_id=1 / probe', () => {
    // Именно такое тело ушло на вебхук: id=1, имя 'probe', без update_id.
    const forged = { message: { from: { id: 1, first_name: 'probe' } } };
    const r = trusted(forged);
    expect(r.ok).toBe(false);
    expect(r.tgId).toBe(0);
  });

  test('без update_id (так и пришла подделка probe) — отказ, даже если id правдоподобен', () => {
    // Настоящий Telegram всегда кладёт update_id. Его отсутствие — признак
    // самодельного запроса, а не апдейта, поэтому отказываем всем таким.
    const forged = { message: { from: { id: 500123456, first_name: 'probe' } } };
    expect(trusted(forged)).toEqual({ ok: false, reason: 'update_id', tgId: 0 });
  });

  test('ОТКЛОНЯЕТ подделку кнопки «костяка» без callback_query.id', () => {
    const forged = { update_id: 43, callback_query: { from: realUser, data: 'approve_1' } };
    expect(trusted(forged)).toEqual({ ok: false, reason: 'callback_query', tgId: 0 });
  });

  test('ОТКЛОНЯЕТ нулевой, отрицательный и нечисловой id', () => {
    expect(trusted({ update_id: 1, message: { from: { id: 0, first_name: 'x' } } }).ok).toBe(false);
    expect(trusted({ update_id: 1, message: { from: { id: -5, first_name: 'x' } } }).ok).toBe(false);
    expect(trusted({ update_id: 1, message: { from: { id: 'abc', first_name: 'x' } } }).ok).toBe(false);
  });

  test('ОТКЛОНЯЕТ подмену типов в полях пользователя', () => {
    expect(trusted({ update_id: 1, message: { from: { id: 5, first_name: 42 } } }).ok).toBe(false);
    expect(trusted({ update_id: 1, message: { from: { id: 5, first_name: '' } } }).ok).toBe(false);
    expect(trusted({ update_id: 1, message: { from: { id: 5, first_name: 'ok', username: { a: 1 } } } }).ok).toBe(false);
  });

  test('ОТКЛОНЯЕТ апдейт без отправителя и без update_id', () => {
    expect(trusted({ update_id: 7 }).ok).toBe(false);
    expect(trusted({ message: { from: realUser } }).ok).toBe(false);
    expect(trusted({}).ok).toBe(false);
    expect(trusted(null).ok).toBe(false);
  });
});

