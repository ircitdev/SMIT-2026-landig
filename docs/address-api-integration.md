![Инструкция оператору СОРМ](https://storage.googleapis.com/uspeshnyy-projects/smit/billing/screenshots/smitapi.png)

# Интеграция API проверки адресов — smit34.ru

**Дата внедрения:** 8 апреля 2026  
**Затронутые компоненты:** `index.html`, `/var/www/aida-gpt/server.py`

---

## Суть изменения

До внедрения поле "Введите ваш адрес" на главной странице использовало 13 захардкоженных адресов и не делало никакой реальной проверки покрытия. Кнопка "Проверить возможность" просто открывала AIDA-чат. Функция `check_address_gas` в AIDA была заглушкой — принимала любой адрес без проверки.

После внедрения — реальная проверка по базе 4 270 адресов из биллинговой системы.

---

## API покрытия

**Base URL:** `https://testbill.smit34.ru`  
**Авторизация:** не требуется  
**CORS:** `*` (любой домен)

### Автоподсказки

```
GET /api/address/suggest/?q={текст}
```

- Минимум 2 символа
- Возвращает до 15 результатов
- Поиск по названию улицы и полному адресу

**Ответ:**
```json
{
  "results": [
    { "id": 665, "address": "г Волгоград ул Удмуртская д 105а", "city": "Волгоград", "street": "Удмуртская", "house": "105а" }
  ]
}
```

### Проверка покрытия

```
GET /api/address/check/?id={id}     — по ID из suggest (точнее)
GET /api/address/check/?q={текст}   — по тексту (если ID нет)
```

**Статусы ответа:**

| `status` | Значение | Действие |
|---|---|---|
| `connected` | Адрес найден, есть абоненты | Открыть AIDA с адресом |
| `coverage` | Адрес в зоне покрытия, абонентов нет | Открыть AIDA с адресом |
| `unknown` | Адреса нет в базе | Показать сообщение, не открывать AIDA |

---

## Изменения в index.html

### Новые переменные состояния

```jsx
const [addressQuery, setAddressQuery] = useState('');
const [addressSuggestions, setAddressSuggestions] = useState([]);  // [{id, address}]
const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
const [selectedAddressId, setSelectedAddressId] = useState(null);  // ID из suggest
const [addressCheckResult, setAddressCheckResult] = useState(null); // результат проверки
const [isCheckingAddress, setIsCheckingAddress] = useState(false);  // спиннер
const debounceTimerRef = useRef(null);
```

Удалены: `mockAddresses` (массив 13 адресов), `checkResultModal` (неиспользуемый модал).

### Логика подсказок (handleAddressChange)

- Debounce 300ms
- Запрос к `/api/address/suggest/` при длине ≥ 2 символа
- Сброс `selectedAddressId` и `addressCheckResult` при каждом изменении

### Логика выбора из дропдауна (handleSelectAddress)

Сохраняет `item.id` в `selectedAddressId` для последующей точной проверки по ID.

### Логика проверки (handleCheckAddress)

```
1. Показать спиннер
2. Запрос: /check/?id=N (если выбрано из дропдауна) или /check/?q=текст
3. Показать инлайн-результат
4. Если connected или coverage → открыть AIDA с адресом
5. При ошибке сети → открыть AIDA без проверки (не блокировать пользователя)
```

### Инлайн-результат под кнопкой

| Статус | Цвет | Текст |
|---|---|---|
| `connected` | Зелёный | ✅ Подключение доступно! Уже подключено: N абон. |
| `coverage` | Голубой | 📍 Адрес в зоне покрытия — вы будете первым! |
| `unknown` | Жёлтый | ❓ Адрес не найден — оставьте заявку в чате |

---

## Изменения в server.py (AIDA backend)

**Файл:** `/var/www/aida-gpt/server.py` на сервере `31.44.7.144`

### Новая константа

```python
ADDRESS_API_BASE = "https://testbill.smit34.ru/api/address"  # строка ~60
```

### Функция check_address_gas (строка ~1600)

Заменена заглушка на реальный вызов:

```python
async def check_address_gas(address: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        resp = await client.get(f"{ADDRESS_API_BASE}/check/", params={"q": address})
        data = resp.json()
    # Маппинг: connected/coverage → available=True, unknown → available=False
```

**Поведение по статусам:**

- `connected` → `available: True`, возвращает количество абонентов в `message`
- `coverage` → `available: True`, сообщает что адрес в зоне покрытия
- `unknown` → `available: False` → AIDA предложит `add_to_waiting_list`
- Ошибка сети → `available: True` с предупреждением (не блокирует диалог)

---

## Поток данных

```
Пользователь вводит адрес
       ↓ (debounce 300ms)
testbill.smit34.ru/api/address/suggest/
       ↓ (список адресов с ID)
Пользователь выбирает → сохраняется ID
       ↓ (клик "Проверить")
testbill.smit34.ru/api/address/check/?id=N
       ↓
  connected/coverage → открыть AIDA с адресом
                              ↓
                    AIDA вызывает check_address_gas(address)
                              ↓
                    testbill.smit34.ru/api/address/check/?q=адрес
                              ↓
                    available=true  → продолжить оформление заявки
                    available=false → предложить лист ожидания
```

---

## Деплой

```bash
# index.html
scp "d:/DevTools/Database/2027smit/index.html" root@31.44.7.144:/var/www/smit34.ru/index.html
ssh root@31.44.7.144 "chmod 755 /var/www/smit34.ru/index.html && chown smit34ftp:www-data /var/www/smit34.ru/index.html"

# server.py (редактировать локально, деплоить через scp)
scp server.py root@31.44.7.144:/var/www/aida-gpt/server.py
ssh root@31.44.7.144 "systemctl restart aida-gpt"
```

---

## Проверка работоспособности

```bash
# API подсказок
curl "https://testbill.smit34.ru/api/address/suggest/?q=Удм"

# API проверки по ID
curl "https://testbill.smit34.ru/api/address/check/?id=665"

# API проверки по тексту
curl "https://testbill.smit34.ru/api/address/check/?q=Волгоград+Удмуртская+7"

# Health check AIDA
curl "https://aida.smit34.ru/health"
```

---

## Возможные проблемы

| Проблема | Причина | Решение |
|---|---|---|
| Подсказки не появляются | API недоступен или CORS | Проверить `testbill.smit34.ru` доступность |
| AIDA принимает все адреса | Откат к заглушке | Проверить логи `journalctl -u aida-gpt -n 50` |
| Синтаксическая ошибка server.py | Буквальные `\n` в строках | Заменить на `\\n` в Python-строках |
| 502 после рестарта AIDA | Сервис ещё стартует | Подождать 5-8 сек, проверить `/health` |
