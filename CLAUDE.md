# CLAUDE.md — Проект smit34.ru (новый сайт 2027smit)

## Что это за проект

Сайт интернет-провайдера СмИТ (Волгоград). Одностраничник на React/Babel inline (без сборщика), Tailwind CSS CDN.
Основной файл: `index.html` — содержит весь код (2800+ строк).

**Продакшн:** `https://smit34.ru` → `/var/www/smit34.ru/index.html`
**SSH:** `ssh root@31.44.7.144` (без пароля, ключ настроен)

---

## Деплой

```bash
# Загрузить index.html на сервер
scp "d:/DevTools/Database/2027smit/index.html" root@31.44.7.144:/var/www/smit34.ru/index.html

# Права после загрузки
ssh root@31.44.7.144 "chmod 755 /var/www/smit34.ru/index.html && chown smit34ftp:www-data /var/www/smit34.ru/index.html"
```

---

## Архитектура index.html

**Стек:** React 18 + Babel (inline JSX), Tailwind CSS CDN, Lucide React, GSAP
**Нет:** npm, webpack, node_modules — всё через CDN в `<head>`

### Ключевые компоненты (всё в одном файле)

| Компонент | Строки | Назначение |
|---|---|---|
| `GlassCard` | ~440 | Переиспользуемая карточка с glassmorphism |
| `Badge` | ~473 | Бейдж-тег |
| `renderNoticeBlocks()` | ~480 | Рендер блоков модального окна из JSON |
| `AIWidget` | ~569 | Чат + голосовой ассистент (плавающая кнопка) |
| `App` | ~1205 | Основной компонент страницы |

### AI-виджет (`AIWidget`)
- **Чат:** POST `https://aida.smit34.ru/chat` → GPT-4o-mini (AIDA backend)
- **Голос:** Gemini 2.5 Flash Native Audio Live WebSocket (`wss://generativelanguage.googleapis.com/...`)
- **Relay:** после голосовой сессии транскрипт релеится в AIDA через `/chat` для создания лида
- **API ключ Gemini:** `AIzaSyDlnPbUWTe-ZVYiaTrZ7zayE7QMP4-Dha4` (строка ~518)
- **sessionId** генерируется при монтировании, prefix `widget_` для relay сессий

### Модальное окно объявлений
- Конфиг загружается с: `https://aida.smit34.ru/modal-config`
- Показывается через 5 сек после загрузки (если `enabled: true`)
- Cookie `smit27_modal_shown` — защита от повторного показа
- Управление: Telegram-бот (команда `/modal`) → `aida-cache-bot` сервис

### Cookie consent
- Показывается через 15 сек при первом визите (localStorage `smit_cookie_consent_time`)
- Автоскрывается через 10 сек
- Glassmorphism стиль

---

## AIDA Backend (сервер 31.44.7.144)

| Файл | Назначение |
|---|---|
| `/var/www/aida-gpt/server.py` | FastAPI, порт 8900, основной AI backend |
| `/var/www/aida-gpt/modal_manager_addon.py` | Управление модальными окнами через бота |
| `/var/www/aida-gpt/telegram_cache_bot.py` | Telegram-бот (сервис `aida-cache-bot`) |
| `/var/www/aida-gpt/modal-config.json` | Конфиг модального окна (читается /modal-config) |
| `/var/www/smit34.ru/js/modal-config.json` | Конфиг для старого сайта (синхронизируется) |

### API эндпоинты AIDA

| Эндпоинт | Метод | Описание |
|---|---|---|
| `/chat` | POST | Основной чат с GPT |
| `/modal-config` | GET | Конфиг модального окна (CORS *) |
| `/modal-config` | POST | Обновить конфиг (header `X-Admin-Token: smit-modal-2027`) |
| `/health` | GET | Health check |

### Telegram-бот команды (модалки)
```
/modal          — статус + inline меню
/modal_on       — включить модалку
/modal_off      — выключить
/modal_set      — заменить контент (следующим сообщением)
/modal_add      — добавить абзац
/modal_title    — изменить заголовок
/modal_clear    — очистить контент
/modal_every    — показывать при каждой загрузке
/modal_once     — показывать раз в сутки
```

### Перезапуск сервисов
```bash
systemctl restart aida-gpt        # API сервер
systemctl restart aida-cache-bot  # Telegram бот
```

---

## Аналитика

- **Яндекс.Метрика:** счётчик `105460811` (строки ~163-175 index.html)
  - Включены: webvisor, clickmap, ecommerce, accurateTrackBounce, trackLinks
- **Цели:** `trackGoal('click_ai')`, `trackGoal('click_phone')` и др. через `window.ym()`

---

## AmoCRM / FreeScout

- **AmoCRM:** `pavelsmit34ru.amocrm.ru` — создание лидов через AIDA backend (`create_lead`)
  - ⚠️ Требует активной подписки. Ошибка 402 = закончилась оплата
- **FreeScout:** `support.smit34.ru` — тикеты создаются через `create_freescout_ticket`
  - Тикеты с префиксом `Заявка AI:` = созданы через AI-виджет

---

## Важные детали

- Старый сайт: `/var/www/smit34.ru/index2.html` (переименован 2026-02-16)
- Бэкап: `/var/www/smit34.ru/index_back.html`
- Nginx проксирует `aida.smit34.ru` → `127.0.0.1:8900`
- modal_manager_addon.py при `save_config` пишет **одновременно** в оба JSON файла (smit34.ru и aida-gpt)
