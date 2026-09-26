/**
 * Проверка подписи Telegram WebApp initData.
 *
 * Функция verifyInitData задублирована в пяти файлах API НАМЕРЕННО: импорт из
 * api/_lib/ роняет функции на Vercel в рантайме (см. HANDOFF.md). Цена
 * дублирования — копии расходятся: в fundraisers.ts однажды не оказалось
 * проверки auth_date, и перехваченная подпись там жила вечно.
 *
 * Поэтому тест проверяет не эталон, а сами копии: вырезает функцию из
 * исходника каждого файла и гоняет по одинаковым сценариям.
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
