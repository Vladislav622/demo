// Сборка сайтов компаний: companies/<slug>/config.json → docs/<slug>/
// Только встроенные модули Node.
//
// node build.js         — все компании, кроме папок на «_» → docs/ (публикация)
// node build.js --test  — все компании, включая папки на «_» → preview/ (не публикуется)
//
// Шаг 2: загрузка и валидация конфигов. Генерация страниц — шаг 3.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const COMPANIES_DIR = path.join(ROOT, 'companies');

const KNOWN_KEYS = [
  'demo', 'slug', 'name', 'logo', 'city', 'address', 'schedule', 'phone', 'whatsapp',
  'colors', 'about', 'reviews_summary', 'source_2gis', 'currency', 'price_note', 'machines', 'zones',
];
const MACHINE_KEYS = ['id', 'title', 'photo', 'purpose', 'rate_from', 'rate_to', 'unit', 'min_units', 'available'];
const ZONE_KEYS = ['title', 'delivery_from', 'delivery_to'];
const OPTIONAL_STRINGS = ['logo', 'city', 'address', 'schedule', 'phone', 'whatsapp', 'about', 'source_2gis', 'price_note'];

const SLUG_RE = /^_?[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function show(v) {
  return JSON.stringify(v);
}

function digits(s) {
  return String(s).replace(/\D/g, '');
}

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function isNumOrNull(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

// Читает config.json. Ошибку разбора JSON переводит в строку/столбец.
function readConfig(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (!fs.existsSync(file)) {
    return { rel, errors: [`${rel}: файл не найден`] };
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return { rel, config: JSON.parse(text), errors: [] };
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) {
      const before = text.slice(0, Number(m[1]));
      const line = before.split('\n').length;
      const col = Number(m[1]) - before.lastIndexOf('\n');
      where = ` (строка ${line}, столбец ${col})`;
    }
    return { rel, errors: [`${rel}: неверный JSON${where} — ${e.message}`] };
  }
}

// Возвращает { errors, warnings }. Каждая строка: «файл: поле — что не так».
function validate(config, rel, folder) {
  const errors = [];
  const warnings = [];
  const err = (field, msg) => errors.push(`${rel}: ${field} — ${msg}`);
  const warn = (field, msg) => warnings.push(`${rel}: ${field} — ${msg}`);
  const dir = path.join(COMPANIES_DIR, folder);

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    err('(корень)', 'конфиг должен быть объектом { ... }');
    return { errors, warnings };
  }

  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.includes(key)) warn(key, 'неизвестное поле, будет проигнорировано (опечатка?)');
  }

  if (typeof config.demo !== 'boolean') err('demo', `должно быть true или false (сейчас: ${show(config.demo)})`);

  if (config.slug !== folder) {
    err('slug', `должен совпадать с именем папки ${show(folder)} (сейчас: ${show(config.slug)})`);
  } else if (!SLUG_RE.test(folder)) {
    err('slug', 'только латиница в нижнем регистре, цифры и «-» (плюс «_» в начале для тестовых)');
  }

  if (typeof config.name !== 'string' || isEmpty(config.name)) err('name', 'название компании обязательно');

  for (const key of OPTIONAL_STRINGS) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      err(key, `должно быть строкой (сейчас: ${show(config[key])})`);
    }
  }

  // Контакт: whatsapp или phone обязателен.
  const wa = typeof config.whatsapp === 'string' ? config.whatsapp.trim() : '';
  const phone = typeof config.phone === 'string' ? config.phone.trim() : '';
  if (wa && !/^\d{10,15}$/.test(wa)) {
    err('whatsapp', `только цифры в международном формате, 10–15 цифр, например 77011234567 (сейчас: ${show(config.whatsapp)})`);
  }
  if (phone && !/^[\d\s()+-]+$/.test(phone)) {
    err('phone', `допустимы цифры, пробелы, «+», «-», скобки (сейчас: ${show(config.phone)})`);
  } else if (phone && (digits(phone).length < 10 || digits(phone).length > 15)) {
    err('phone', `должно быть 10–15 цифр (сейчас: ${digits(phone).length})`);
  }
  if (!wa && !phone) {
    if (folder.startsWith('_')) {
      err('whatsapp / phone', 'нет контакта — для тестовой сборки задайте TEST_WA=<ваш номер>, например: '
        + 'TEST_WA=77011234567 node build.js --test (в PowerShell: $env:TEST_WA="77011234567"; node build.js --test)');
    } else {
      err('whatsapp / phone', 'нет ни WhatsApp, ни телефона — демо без контакта не собираем');
    }
  }

  if (typeof config.logo === 'string' && config.logo.trim() && !fs.existsSync(path.join(dir, config.logo))) {
    err('logo', `файл ${show(config.logo)} не найден в companies/${folder}/`);
  }

  if (config.colors !== undefined) {
    if (typeof config.colors !== 'object' || config.colors === null || Array.isArray(config.colors)) {
      err('colors', 'должно быть объектом { "primary": "#...", "accent": "#..." }');
    } else {
      for (const key of ['primary', 'accent']) {
        const c = config.colors[key];
        if (!isEmpty(c) && (typeof c !== 'string' || !COLOR_RE.test(c.trim()))) {
          err(`colors.${key}`, `цвет в формате #rgb или #rrggbb (сейчас: ${show(c)})`);
        }
      }
    }
  }

  if (config.reviews_summary !== undefined) {
    if (!Array.isArray(config.reviews_summary)) {
      err('reviews_summary', 'должно быть массивом строк-пересказов');
    } else {
      config.reviews_summary.forEach((r, i) => {
        if (typeof r !== 'string' || isEmpty(r)) err(`reviews_summary[${i}]`, 'пустой пересказ — удалите строку');
      });
    }
  }

  if (typeof config.currency !== 'string' || isEmpty(config.currency)) {
    err('currency', `валюта обязательна, например "₸" (сейчас: ${show(config.currency)})`);
  }

  // Техника
  if (!Array.isArray(config.machines) || config.machines.length === 0) {
    err('machines', 'нужна хотя бы одна позиция техники');
  } else {
    const ids = new Set();
    config.machines.forEach((m, i) => {
      const f = (k) => `machines[${i}].${k}`;
      if (typeof m !== 'object' || m === null || Array.isArray(m)) {
        err(`machines[${i}]`, 'должно быть объектом');
        return;
      }
      for (const key of Object.keys(m)) {
        if (!MACHINE_KEYS.includes(key)) warn(f(key), 'неизвестное поле, будет проигнорировано (опечатка?)');
      }
      if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
        err(f('id'), `латиница в нижнем регистре, цифры и «-» (сейчас: ${show(m.id)})`);
      } else if (ids.has(m.id)) {
        err(f('id'), `повторяется ${show(m.id)} — id должны быть разными`);
      } else {
        ids.add(m.id);
      }
      if (typeof m.title !== 'string' || isEmpty(m.title)) err(f('title'), 'название техники обязательно');
      for (const key of ['photo', 'purpose']) {
        if (m[key] !== undefined && typeof m[key] !== 'string') err(f(key), `должно быть строкой (сейчас: ${show(m[key])})`);
      }
      if (typeof m.photo === 'string' && m.photo.trim() && !fs.existsSync(path.join(dir, m.photo))) {
        err(f('photo'), `файл ${show(m.photo)} не найден в companies/${folder}/`);
      }
      if (!isNumOrNull(m.rate_from) || (typeof m.rate_from === 'number' && m.rate_from <= 0)) {
        err(f('rate_from'), `число больше 0 или null (сейчас: ${show(m.rate_from)})`);
      }
      if (!isNumOrNull(m.rate_to) || (typeof m.rate_to === 'number' && m.rate_to <= 0)) {
        err(f('rate_to'), `число больше 0 или null (сейчас: ${show(m.rate_to)})`);
      }
      if (m.rate_from == null && m.rate_to != null) {
        err(f('rate_to'), 'задано без rate_from — укажите rate_from или уберите обе цены');
      }
      if (typeof m.rate_from === 'number' && typeof m.rate_to === 'number' && m.rate_to < m.rate_from) {
        err(f('rate_to'), `меньше rate_from (${m.rate_to} < ${m.rate_from})`);
      }
      if (typeof m.unit !== 'string' || isEmpty(m.unit)) err(f('unit'), `единица обязательна, например "час" (сейчас: ${show(m.unit)})`);
      if (m.min_units != null && !(Number.isInteger(m.min_units) && m.min_units > 0)) {
        err(f('min_units'), `целое число больше 0 или null (сейчас: ${show(m.min_units)})`);
      }
      if (m.available !== undefined && typeof m.available !== 'boolean') {
        err(f('available'), `должно быть true или false (сейчас: ${show(m.available)})`);
      }
    });
    if (config.machines.every((m) => m && m.available === false)) {
      warn('machines', 'все позиции помечены занятыми — заказать будет нечего');
    }
  }

  // Зоны доставки
  if (config.zones !== undefined) {
    if (!Array.isArray(config.zones)) {
      err('zones', 'должно быть массивом (или [] — тогда поле зоны не показываем)');
    } else {
      config.zones.forEach((z, i) => {
        const f = (k) => `zones[${i}].${k}`;
        if (typeof z !== 'object' || z === null || Array.isArray(z)) {
          err(`zones[${i}]`, 'должно быть объектом');
          return;
        }
        for (const key of Object.keys(z)) {
          if (!ZONE_KEYS.includes(key)) warn(f(key), 'неизвестное поле, будет проигнорировано (опечатка?)');
        }
        if (typeof z.title !== 'string' || isEmpty(z.title)) err(f('title'), 'название зоны обязательно — заполните или удалите зону');
        for (const key of ['delivery_from', 'delivery_to']) {
          if (!isNumOrNull(z[key]) || (typeof z[key] === 'number' && z[key] < 0)) {
            err(f(key), `число от 0 или null (сейчас: ${show(z[key])})`);
          }
        }
        if (z.delivery_from == null && z.delivery_to != null) {
          err(f('delivery_to'), 'задано без delivery_from');
        }
        if (typeof z.delivery_from === 'number' && typeof z.delivery_to === 'number' && z.delivery_to < z.delivery_from) {
          err(f('delivery_to'), `меньше delivery_from (${z.delivery_to} < ${z.delivery_from})`);
        }
      });
    }
  }

  return { errors, warnings };
}

// Загружает и проверяет все компании. Тестовые («_») — только в режиме --test.
function loadCompanies(includeTest) {
  const folders = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (includeTest || !d.name.startsWith('_')))
    .map((d) => d.name)
    .sort();

  const companies = [];
  const errors = [];
  const warnings = [];

  for (const folder of folders) {
    const { rel, config, errors: readErrors } = readConfig(path.join(COMPANIES_DIR, folder, 'config.json'));
    if (readErrors.length) {
      errors.push(...readErrors);
      continue;
    }
    // Номер WhatsApp тестовой компании не храним в репозитории — берём из TEST_WA.
    if (folder.startsWith('_') && isEmpty(config.whatsapp) && process.env.TEST_WA) {
      config.whatsapp = process.env.TEST_WA.trim();
    }
    const result = validate(config, rel, folder);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (!includeTest && config.demo === false) {
      warnings.push(`${rel}: demo — demo=false в демо-репозитории: robots.txt закрывает сайт от поиска, публикуйте клиента отдельно`);
    }
    if (!result.errors.length) companies.push({ folder, config });
  }

  return { folders, companies, errors, warnings };
}

function main() {
  const includeTest = process.argv.includes('--test');
  const outDir = includeTest ? 'preview' : 'docs';

  if (!fs.existsSync(COMPANIES_DIR)) {
    console.error('Ошибка: нет папки companies/');
    process.exit(1);
  }

  const { folders, companies, errors, warnings } = loadCompanies(includeTest);

  for (const w of warnings) console.warn(`Предупреждение: ${w}`);

  if (errors.length) {
    console.error(`Валидация не пройдена, ошибок: ${errors.length}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('Сборка остановлена, файлы не записаны.');
    process.exit(1);
  }

  if (!folders.length) {
    console.log(`Компаний для сборки нет${includeTest ? '' : ' (тестовые папки на «_» собираются только с --test)'}.`);
    return;
  }

  console.log(`Валидация пройдена: ${companies.length} из ${folders.length} (${companies.map((c) => c.folder).join(', ')})`);
  console.log(`Режим: ${includeTest ? '--test' : 'публикация'} → ${outDir}/ (генерация страниц — шаг 3)`);
}

if (require.main === module) main();

module.exports = { validate, readConfig, loadCompanies };
