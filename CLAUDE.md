# CLAUDE.md — Проект smit34.ru (новый сайт 2027smit)

## Что это за проект

Сайт интернет-провайдера СмИТ (Волгоград). Одностраничник на React/Babel inline (без сборщика), Tailwind CSS CDN.
Основной файл: `index.html` — содержит весь код (2800+ строк).

**Продакшн:** `https://smit34.ru` → `/var/www/smit34.ru/index.html`
**SSH:** `ssh root@31.44.7.144` (без пароля, ключ настроен)

---

## Деплой

⚠️ **С 2026-08-17 сайт собирается.** Заливать `index.html` напрямую нельзя — в продакшн-версии нет ни Babel, ни Tailwind CDN, они заменены готовыми `js/app.*.js` и `css/app.*.css`.

```bash
cd d:/DevTools/Database/2027smit
bash deploy.sh          # сборка (node build.mjs) + выкладка index.html, js/, css/
```

- **Править нужно `index.html`** — он остаётся источником правды (JSX + классы Tailwind).
- `build.mjs` компилирует JSX через @babel/standalone → `dist/js/app.<hash>.js` (минификация esbuild)
  и собирает Tailwind CLI → `dist/css/app.<hash>.css`. Хэш в имени = вечный кэш.
- Инструменты сборки лежат в `d:/tmp/smitbuild` (npm: @babel/standalone, tailwindcss@3, esbuild).
  Если папки нет: `cd d:/tmp/smitbuild && npm i @babel/standalone tailwindcss@3.4.17 esbuild`.
- **Динамические классы Tailwind** (`bg-${news.categoryColor}-100` и т. п.) не видны сборщику —
  они перечислены в `safelist` внутри `build.mjs`. Добавляете новый цвет категории — впишите его туда.
- Бэкап дособорочной версии на сервере: `/var/www/smit34.ru/index_before_build_*.html`.

Прочие файлы (JSON с данными, картинки) заливаются обычным scp:
```bash
scp tariffs.json root@31.44.7.144:/var/www/smit34.ru/tariffs.json
ssh root@31.44.7.144 "chmod 644 /var/www/smit34.ru/tariffs.json && chown smit34ftp:www-data /var/www/smit34.ru/tariffs.json"
```

### Производительность (замеры после сборки)

| | было | стало |
|---|---|---|
| FCP десктоп | 3128 мс | **724 мс** |
| FCP мобильный (4× CPU throttle, Fast 3G) | 3548 мс | **768 мс** |
| load мобильный | 4220 мс | **1024 мс** |
| HTML | 207 КБ | 18 КБ + app.js 137 КБ + app.css 62 КБ |

nginx (`/etc/nginx/sites-available/smit34.ru`): `webp/avif/mp4/webm` кэшируются 30 дней
(`public, immutable`), `*.json` — `no-cache` (данные должны подхватываться сразу),
`index.html` — `no-store`.

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
| `AIWidget` | ~578 | Чат + голосовой ассистент (плавающая кнопка) |
| `App` | ~1205 | Основной компонент страницы |

### AI-виджет (`AIWidget`)
- **Чат:** POST `https://aida.smit34.ru/chat` → GPT-4o-mini (AIDA backend)
- **Голос:** Gemini 2.5 Flash Native Audio Live WebSocket (`wss://generativelanguage.googleapis.com/...`)
- **Relay:** после голосовой сессии транскрипт релеится в AIDA через `/chat` для создания лида
- **API ключ Gemini:** `AIzaSyDlnPbUWTe-ZVYiaTrZ7zayE7QMP4-Dha4` (строка ~518)
- **sessionId** генерируется при монтировании, prefix `widget_` для relay сессий
- **Режимы:** переключение Чат/Голос, голосовая диктовка в текстовое поле
- **Relay логика:** умный парсинг имени, телефона, адреса, тарифа из транскрипта (14 шагов диалога)

### Секция "Новости и события" (News)
- **Данные:** `news.json` рядом с index.html (грузится с cache-buster), состояние `allNews`
- **Структура новости:** `{id, date, category, categoryColor, title, excerpt, content(HTML), image, link/action}`
- **Рендеринг:** динамический `.slice(0, visibleNewsCount).map()` (строка ~2330)
- **Модальное окно:** NEWS MODAL (строки ~2768-2850) с полным контентом
  - Изображение в заголовке с градиентом overlay
  - HTML контент через `dangerouslySetInnerHTML`
  - Закрытие по backdrop/X, responsive дизайн
- **Подгрузка:** кнопка "Показать ещё" загружает +3 новости (строки ~2443-2450)
- **Изображения:** `https://storage.googleapis.com/uspeshnyy-projects/smit/smit34.ru/news/news[1-3].jpg`
- **Дизайн:** timeline с пульсирующими точками, glassmorphism карточки, glare/glow эффекты

### Модальное окно объявлений
- Конфиг загружается с: `https://aida.smit34.ru/modal-config`
- Показывается через 5 сек после загрузки (если `enabled: true`)
- Cookie `smit27_modal_shown` — защита от повторного показа
- Управление: Telegram-бот (команда `/modal`) → `aida-cache-bot` сервис
- ⚠️ В коде стоит жёсткое ограничение: не чаще **раза в 24 часа**
  (`localStorage.smit_notice_last_shown`), независимо от `showOnEveryPageLoad` в конфиге бота

### Cookie consent
- Показывается через 15 сек при первом визите, автоскрытие через 10 сек
- Отметка `localStorage.smit_cookie_consent_time` ставится **в момент показа**,
  а не только по клику «Принять» — иначе баннер возвращался бы при каждой загрузке

### Прямые ссылки (SPA-маршруты)
| URL | Действие |
|---|---|
| `/testspeed` | открывает замер скорости на вкладке «СмИТ» |
| `/covermap` | открывает карту покрытия |

Работают и как хеш (`#testspeed`, `#covermap`). На стороне nginx для них заданы
отдельные `location` с отдачей `index.html`.

### Медиа и анимации
- **Обложки тарифов:** постер + зацикленное видео. Десктоп — по наведению,
  мобильные — когда карточка занимает ≥55% экрана (IntersectionObserver).
  Видео не грузится при `saveData` и на 2G. Отдельные файлы для светлой и тёмной темы
  (`cover`/`video` и `coverDark`/`videoDark` в `tariffs.json`)
- **Скролл-анимации:** GSAP ScrollTrigger, поэлементно (заголовки, текст, карточки, иллюстрации).
  Секции целиком не анимируются. `ScrollTrigger.batch` для карточек, `once: true`,
  `clearProps` после анимации, отключение при `prefers-reduced-motion`
- **Кнопка AI-виджета:** появляется через 15 сек; на мобильных — только после ухода
  с первого экрана (класс `aiw-visible` на `body`)
- **Слои:** все оверлеи (меню, сайдбары, модалки) подняты выше AI-виджета,
  у которого `z-index: 2147483000`
- **Мобильные сайдбары:** новость выезжает слева, карта и замер скорости — справа

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
