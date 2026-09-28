# Безопасность

## ⚠️ Открытый вопрос: токен в `git remote`

`git remote -v` в этом репозитории показывает URL с **личным GitHub-токеном
открытым текстом**:

```
origin  https://Artemewww:<TOKEN>@github.com/Artemewww/flint-live-in-moment.git
```

Токен лежит в `.git/config`, попадает в логи, скриншоты и в вывод `git remote -v`.
Токен с областью `repo` даёт полный доступ к репозиторию.

**Действия:**
1. Отозвать токен: GitHub → Settings → Developer settings → Personal access tokens.
2. Переключиться на SSH:
   ```bash
   git remote set-url origin git@github.com:Artemewww/flint-live-in-moment.git
   ```
   либо на `gh auth login` / credential manager, чтобы токен не хранился в конфиге.

---

## Проверки, сделанные аудитом 29.09.2026

| Проверка | Результат |
|---|---|
| `.env*` в `.gitignore` | ✅ `.gitignore:7` покрывает `.env`, `.env.local` |
| `.env` когда-либо в истории git | ✅ нет, только `.env.example` |
| `service_role` в `src/` | ✅ не найден, живёт только в env Vercel |
| Подпись `initData` | ✅ HMAC + `timingSafeEqual` + TTL |
| Апдейты вебхука | ✅ `trustedUpdate` — валидация формы апдейта |
| Rate-limit | ✅ `bot_sessions`-бэкенд (переживает инстансы Vercel) |
| CSP и security-заголовки | ✅ `vercel.json` |

## ❗ Требует ручной проверки (нет доступа из кода)

**`VITE_GEMINI_API_KEY`** — если эта переменная задана в Vercel, она попадает
в **публичный** JS-бандл (префикс `VITE_` означает «встроить в клиент»), и ключ
Gemini сможет скачать любой посетитель. Проверить панель Vercel → Settings →
Environment Variables. Если переменная есть — отозвать ключ в Google AI Studio,
удалить переменную, пользоваться серверным `/api/ai`.

## Как сообщить об уязвимости

Не открывайте публичный issue. Напишите владельцу клуба напрямую.
