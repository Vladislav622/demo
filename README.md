# Сайты для аренды спецтехники

Один шаблон на всех: одностраничник + калькулятор-заявка в WhatsApp. У каждой компании свой `config.json`.

## Добавить компанию
1. Создать папку `companies/<slug>/` (латиница, без «_» в начале — папки на «_» не публикуются).
2. Положить `config.json` по образцу `companies/_test/config.json` и фото в `img/`.
3. Необязательные поля: `tagline`, `hero_photo`, `hero_title` (слова в `*звёздочках*` — акцентным цветом), `city_in` («в Караганде»),
   `delivery_time_text`, `park_note`, `features` (`[{icon, title, text}]`, icon: park, clock, operator, calendar, shield, truck),
   `telegram` (username без @), `channel` (`whatsapp` — по умолчанию, или `telegram`),
   `machines[].status` (`free` / `busy` / `confirm`), `machines[].kind` (excavator, crane, dump_truck, loader, manipulator,
   aerial_platform, bulldozer, roller, tractor, other). Нет своего фото → общее из `assets/stock/<kind>.jpg` с подписью «Фото для примера», нет и его → иконка.
4. Заполнять только то, что известно о компании. Пустое поле → блок на странице не выводится. Ничего не придумывать.
5. `"demo": true` — плашка «Демо-концепт…» + noindex. Для оплатившего клиента — `"demo": false`.

Тестовые папки (на «_», в `docs/` не публикуются):
- `_sample` — витрина шаблона, данные вымышленные;
- `_test` — проверки граничных случаев (без цены, занятая позиция, без фото и т. п.).

## Собрать
```
node build.js           # публикация: компании без «_» → docs/<slug>/
node build.js --test    # предпросмотр: все, включая «_» → preview/<slug>/
```
Контакты тестовых папок берутся из переменных окружения: `TEST_WA` (WhatsApp), `TEST_TG` (Telegram username), `TEST_CHANNEL` (`whatsapp` / `telegram` — главный канал)
(PowerShell: `$env:TEST_WA="77011234567"; node build.js --test`).

## Панель владельца (демо)
Сборка кладёт рядом со страницей компании `admin/index.html` (ссылки на неё с сайта нет).
Цены, минимальная смена, статус позиций и канал заявок сохраняются в localStorage браузера —
видны на сайте только на этом же устройстве. Для показа на созвоне; общая база и пароль — после первой оплаты.

## Публикация
GitHub Pages из папки `/docs` ветки `main`. `docs/` коммитится в репозиторий. `preview/` не коммитится.

## Проверить
```
node tests/price.test.js           # формула цены, склонения, текст заявки
node tests/screens.js <slug>       # скриншоты 360/1280 в checks/ + проверки «да/нет»
python -m http.server -d preview   # открыть http://localhost:8000/<slug>/
```
`tests/screens.js` берёт `preview/<slug>/` (или `docs/<slug>/`), запускает установленный Edge или Chrome без окна
и пишет `checks/<slug>-360-full.png`, `-360-selected.png`, `-1280.png`, `-1280-selected.png`.
Путь к браузеру можно задать переменной `BROWSER`.

Нужен Node.js ≥ 22 (только встроенные модули, `npm install` не нужен).
