// Галерея свежих скриншотов: checks/index.html (не публикуется — checks/ в .gitignore).
// node tests/gallery.js — после node tests/run-all.js

'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'checks');

const SECTIONS = [
  ['_sample — витрина', [
    ['_sample-360-full.png', 'Телефон 360'],
    ['_sample-390-full.png', 'Телефон 390'],
    ['_sample-1280.png', 'Ноутбук 1280'],
    ['_sample-1920-full.png', 'Монитор 1920'],
  ]],
  ['Окно заявки', [
    ['_sample-360-sheet.png', 'Телефон 360'],
    ['_sample-1280-sheet.png', 'Ноутбук 1280'],
    ['_sample-740x360-sheet.png', 'Телефон боком'],
    ['_sample-360-privacy.png', '«Как используются данные»'],
  ]],
  ['Панель владельца', [
    ['_sample-admin-360.png', 'Телефон: «Статусы»'],
    ['_sample-admin-360-full.png', 'Телефон: «Цены и статусы»'],
    ['_sample-admin-1280.png', 'Ноутбук 1280'],
  ]],
  ['Крайние случаи, 360', [
    ['_min-360-full.png', '_min — минимум данных'],
    ['_allbusy-360-full.png', '_allbusy — всё занято'],
    ['_long-360-full.png', '_long — длинные тексты'],
    ['_phoneonly-360-full.png', '_phoneonly — только телефон'],
  ]],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const results = fs.readdirSync(OUT).filter((f) => f.endsWith('-result.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')))
  .map((r) => `<tr><td>${esc(r.slug)}${r.prefix && r.prefix !== '/' ? ` (${esc(r.prefix)})` : ''}</td><td>${r.yes}</td><td class="${r.no ? 'bad' : ''}">${r.no}</td></tr>`);

const missing = [];
const sections = SECTIONS.map(([title, items]) => {
  const cards = items.map(([file, label]) => {
    if (!fs.existsSync(path.join(OUT, file))) { missing.push(file); return ''; }
    const when = fs.statSync(path.join(OUT, file)).mtime.toLocaleString('ru-RU');
    return `<figure><a href="${esc(file)}"><img src="${esc(file)}" alt="${esc(label)}" loading="lazy"></a><figcaption>${esc(label)}<small>${esc(when)}</small></figcaption></figure>`;
  }).join('\n');
  return `<section><h2>${esc(title)}</h2><div class="grid">${cards}</div></section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Проверки — скриншоты</title>
<style>
body { margin: 0; padding: 24px 16px 48px; font: 15px/1.45 system-ui, sans-serif; background: #f3f3ef; color: #1d1f1c; }
h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin: 32px 0 12px; font-size: 18px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; align-items: start; }
figure { margin: 0; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
figure img { display: block; width: 100%; max-height: 520px; object-fit: cover; object-position: top; }
figcaption { padding: 8px 12px; font-weight: 700; } figcaption small { display: block; font-weight: 400; color: #5b5f58; }
table { border-collapse: collapse; background: #fff; } td, th { padding: 4px 12px; border-bottom: 1px solid #e3e3dd; text-align: left; } .bad { color: #b3261e; font-weight: 700; }
</style>
</head>
<body>
<h1>Проверки шаблона</h1>
<p>Собрано ${esc(new Date().toLocaleString('ru-RU'))}. Нажмите на скриншот — откроется целиком.${missing.length ? ` Нет файлов: ${esc(missing.join(', '))}` : ''}</p>
${sections}
<section><h2>Итоги screens.js</h2><table><tr><th>slug</th><th>да</th><th>НЕТ</th></tr>${results.join('')}</table></section>
</body>
</html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`checks/index.html${missing.length ? ` — нет ${missing.length}: ${missing.join(', ')}` : ' — все скриншоты на месте'}`);
