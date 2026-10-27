# Сайты для аренды спецтехники

Один шаблон на всех: одностраничник + калькулятор-заявка в WhatsApp. У каждой компании свой `config.json`.

## Добавить компанию
1. Создать папку `companies/<slug>/` (латиница, без «_» в начале — папки на «_» не публикуются).
2. Положить `config.json` по образцу `companies/_test/config.json` и фото в `img/`.
3. Необязательные поля: `hero_photo` (фон первого экрана), `city_in` («в Караганде»), `machines[].kind` (excavator, crane, dump_truck, loader, manipulator, aerial_platform, bulldozer, roller, tractor, other — иконка, если нет фото).
4. Заполнять только то, что известно о компании. Пустое поле → блок на странице не выводится. Ничего не придумывать.
5. `"demo": true` — плашка «Демо-концепт…» + noindex. Для оплатившего клиента — `"demo": false`.

## Собрать
```
node build.js           # публикация: компании без «_» → docs/<slug>/
node build.js --test    # предпросмотр: все, включая «_» → preview/<slug>/
```
Номер WhatsApp для `_test` берётся из переменной `TEST_WA` (PowerShell: `$env:TEST_WA="77011234567"; node build.js --test`).

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
