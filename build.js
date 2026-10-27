// Сборка сайтов компаний: companies/<slug>/config.json → docs/<slug>/
// Только встроенные модули Node.
//
// node build.js         — все компании, кроме папок на «_» → docs/ (публикация)
// node build.js --test  — все компании, включая папки на «_» → preview/ (не публикуется)

'use strict';

const fs = require('fs');
const path = require('path');
const Calc = require('./template/app.js');

const ROOT = __dirname;
const COMPANIES_DIR = path.join(ROOT, 'companies');

const KNOWN_KEYS = [
  'demo', 'slug', 'name', 'tagline', 'logo', 'hero_photo', 'hero_title', 'city', 'city_in', 'address', 'schedule',
  'phone', 'whatsapp', 'telegram', 'channel', 'delivery_time_text', 'park_note', 'features', 'colors', 'about', 'reviews_summary', 'source_2gis', 'currency', 'price_note', 'machines', 'zones',
];
const MACHINE_KEYS = ['id', 'title', 'kind', 'photo', 'purpose', 'rate_from', 'rate_to', 'unit', 'min_units', 'status', 'available'];
const ZONE_KEYS = ['title', 'delivery_from', 'delivery_to'];
const OPTIONAL_STRINGS = ['tagline', 'logo', 'hero_photo', 'hero_title', 'city', 'city_in', 'address', 'schedule', 'phone', 'whatsapp',
  'telegram', 'channel', 'delivery_time_text', 'park_note', 'about', 'source_2gis', 'price_note'];

const KINDS = ['excavator', 'crane', 'dump_truck', 'loader', 'manipulator', 'aerial_platform', 'bulldozer', 'roller', 'tractor', 'other'];
const PHOTO_WARN_BYTES = 300 * 1024;
const STATUSES = ['free', 'busy', 'confirm'];
const CHANNELS = ['whatsapp', 'telegram'];
const FEATURE_ICONS = ['park', 'clock', 'operator', 'calendar', 'shield', 'truck'];
const FEATURE_KEYS = ['icon', 'title', 'text'];
const STOCK_DIR = path.join(ROOT, 'assets', 'stock');

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

// Статус позиции: status, а для старых конфигов — available (true → free, false → busy).
function machineStatus(m) {
  if (STATUSES.includes(m.status)) return m.status;
  return m.available === false ? 'busy' : 'free';
}

// Главный канал заявок: channel из конфига, иначе WhatsApp, если он есть, иначе Telegram, иначе звонок.
function resolveChannel(config) {
  const wa = typeof config.whatsapp === 'string' ? config.whatsapp.trim() : '';
  const tg = typeof config.telegram === 'string' ? config.telegram.trim() : '';
  if (config.channel === 'telegram' && tg) return 'telegram';
  if (config.channel === 'whatsapp' && wa) return 'whatsapp';
  if (wa) return 'whatsapp';
  if (tg) return 'telegram';
  return 'phone';
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

  // Контакт: WhatsApp (основной), Telegram (запасной) или телефон — хотя бы один.
  const wa = typeof config.whatsapp === 'string' ? config.whatsapp.trim() : '';
  const tg = typeof config.telegram === 'string' ? config.telegram.trim() : '';
  const phone = typeof config.phone === 'string' ? config.phone.trim() : '';
  if (tg && !/^[A-Za-z0-9_]{5,32}$/.test(tg)) {
    err('telegram', `username без @: латиница, цифры, «_», 5–32 символа (сейчас: ${show(config.telegram)})`);
  }
  const channel = typeof config.channel === 'string' ? config.channel.trim() : '';
  if (channel && !CHANNELS.includes(channel)) {
    err('channel', `"whatsapp" или "telegram" (сейчас: ${show(config.channel)})`);
  } else if (channel === 'whatsapp' && !wa) {
    err('channel', 'указан "whatsapp", но поле whatsapp пустое');
  } else if (channel === 'telegram' && !tg) {
    err('channel', 'указан "telegram", но поле telegram пустое');
  }
  if (wa && !/^\d{10,15}$/.test(wa)) {
    err('whatsapp', `только цифры в международном формате, 10–15 цифр, например 77011234567 (сейчас: ${show(config.whatsapp)})`);
  }
  if (phone && !/^[\d\s()+-]+$/.test(phone)) {
    err('phone', `допустимы цифры, пробелы, «+», «-», скобки (сейчас: ${show(config.phone)})`);
  } else if (phone && (digits(phone).length < 10 || digits(phone).length > 15)) {
    err('phone', `должно быть 10–15 цифр (сейчас: ${digits(phone).length})`);
  }
  if (!wa && !tg && !phone) {
    if (folder.startsWith('_')) {
      err('whatsapp / phone', 'нет контакта — для тестовой сборки задайте TEST_WA=<ваш номер>, например: '
        + 'TEST_WA=77011234567 node build.js --test (в PowerShell: $env:TEST_WA="77011234567"; node build.js --test)');
    } else {
      err('whatsapp / telegram / phone', 'нет ни WhatsApp, ни Telegram, ни телефона — демо без контакта не собираем');
    }
  }

  // Файл картинки должен существовать; тяжёлые фото — предупреждение.
  const checkImage = (field, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const file = path.join(dir, value.trim());
    if (!fs.existsSync(file)) {
      err(field, `файл ${show(value)} не найден в companies/${folder}/`);
    } else if (fs.statSync(file).size > PHOTO_WARN_BYTES) {
      warn(field, `${show(value)} — ${Math.round(fs.statSync(file).size / 1024)} КБ, сожмите до ~200 КБ, ширина 1200px`);
    }
  };
  checkImage('logo', config.logo);
  checkImage('hero_photo', config.hero_photo);

  if (config.hero_title !== undefined && typeof config.hero_title === 'string' && (config.hero_title.match(/\*/g) || []).length % 2) {
    err('hero_title', 'непарная «*»: выделяемые слова оборачиваются с двух сторон, например "Техника *точно в срок*"');
  }

  if (config.features !== undefined) {
    if (!Array.isArray(config.features)) {
      err('features', 'должно быть массивом [{ "icon": "...", "title": "...", "text": "..." }] (или [] — блока не будет)');
    } else {
      config.features.forEach((ft, i) => {
        const f = (k) => `features[${i}].${k}`;
        if (typeof ft !== 'object' || ft === null || Array.isArray(ft)) {
          err(`features[${i}]`, 'должно быть объектом { icon, title, text }');
          return;
        }
        for (const key of Object.keys(ft)) {
          if (!FEATURE_KEYS.includes(key)) warn(f(key), 'неизвестное поле, будет проигнорировано (опечатка?)');
        }
        if (!FEATURE_ICONS.includes(ft.icon)) err(f('icon'), `неизвестная иконка ${show(ft.icon)}; допустимо: ${FEATURE_ICONS.join(', ')}`);
        if (typeof ft.title !== 'string' || isEmpty(ft.title)) err(f('title'), 'заголовок обязателен — заполните или удалите пункт');
        if (ft.text !== undefined && typeof ft.text !== 'string') err(f('text'), `должно быть строкой (сейчас: ${show(ft.text)})`);
      });
    }
  }

  if (typeof config.city_in === 'string' && config.city_in.trim() && !/^во? \S/.test(config.city_in.trim())) {
    err('city_in', `город с предлогом, начинается с «в » или «во », например "в Караганде" (сейчас: ${show(config.city_in)})`);
  }

  if (typeof config.source_2gis === 'string' && config.source_2gis.trim() && !/^https:\/\/\S+$/.test(config.source_2gis.trim())) {
    err('source_2gis', `ссылка должна начинаться с https:// (сейчас: ${show(config.source_2gis)})`);
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
      checkImage(f('photo'), m.photo);
      if (!isEmpty(m.kind) && !KINDS.includes(m.kind)) {
        err(f('kind'), `неизвестный вид техники ${show(m.kind)}; допустимо: ${KINDS.join(', ')}`);
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
      if (m.status !== undefined && !STATUSES.includes(m.status)) {
        err(f('status'), `"free", "busy" или "confirm" (сейчас: ${show(m.status)})`);
      }
      if (m.available !== undefined && typeof m.available !== 'boolean') {
        err(f('available'), `должно быть true или false (сейчас: ${show(m.available)})`);
      } else if (m.available !== undefined && m.status !== undefined) {
        warn(f('available'), 'задан вместе со status — используется status, available удалите');
      } else if (m.available !== undefined) {
        warn(f('available'), `устаревшее поле: замените на "status": "${m.available ? 'free' : 'busy'}"`);
      }
    });
    if (config.machines.every((m) => m && machineStatus(m) === 'busy')) {
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

// ---------- Генерация страниц ----------

const TEMPLATE_DIR = path.join(ROOT, 'template');

const ROOT_INDEX = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title></title>
</head>
<body></body>
</html>
`;
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const fmtNum = Calc.fmtNum;

// «2 500 ₸» — ставка без единицы; null, если цены нет.
function rateMoney(m, currency) {
  return m.rate_from == null ? null : `${fmtNum(m.rate_from)} ${currency}`;
}

// «мин. смена — 4 часа» для часов, «мин. заказ — 2 смены» для остальных единиц.
function minText(m) {
  if (!m.min_units) return '';
  return `${m.unit === 'час' ? 'мин. смена' : 'мин. заказ'} — ${Calc.qty(m.min_units, m.unit)}`;
}

// Иконки видов техники: иллюстрация, не фото. Единый стиль — контур 2px, скругления.
const KIND_PATHS = {
  excavator: '<rect x="14" y="60" width="62" height="14" rx="7"/><circle cx="23" cy="67" r="3"/><circle cx="67" cy="67" r="3"/><path d="M24 60V36h16l6 10h14v14"/><path d="M28 40h9v8h-9z"/><path d="M58 48L84 22l18 22"/><path d="M96 44c0 8 4 13 12 13V44z"/>',
  crane: '<rect x="10" y="52" width="78" height="10" rx="2"/><path d="M88 62V44h12l8 8v10z"/><circle cx="24" cy="68" r="6"/><circle cx="42" cy="68" r="6"/><circle cx="96" cy="68" r="6"/><rect x="22" y="44" width="16" height="8" rx="2"/><path d="M30 44L96 12"/><path d="M96 12v24"/><path d="M96 36c0 4-5 4-5 0"/>',
  dump_truck: '<path d="M10 24h60l-6 28H14z"/><path d="M74 52V32h16l10 12v8z"/><path d="M78 36h10l6 8H78z"/><path d="M8 56h96"/><circle cx="24" cy="64" r="7"/><circle cx="44" cy="64" r="7"/><circle cx="88" cy="64" r="7"/>',
  loader: '<path d="M44 58V40h44v18"/><path d="M56 40V18h24v22"/><rect x="60" y="22" width="16" height="11" rx="1"/><circle cx="52" cy="64" r="10"/><circle cx="84" cy="64" r="10"/><path d="M44 46L26 56"/><path d="M26 44H12v18h16z"/>',
  manipulator: '<path d="M8 58h96"/><path d="M84 58V38h12l8 10v10z"/><rect x="12" y="46" width="52" height="12" rx="1"/><path d="M70 58V30"/><path d="M70 30L48 20L30 30"/><path d="M30 30v10"/><circle cx="24" cy="66" r="6"/><circle cx="44" cy="66" r="6"/><circle cx="92" cy="66" r="6"/>',
  aerial_platform: '<path d="M8 58h96"/><path d="M84 58V38h12l8 10v10z"/><rect x="26" y="48" width="18" height="10" rx="1"/><path d="M35 48L66 18"/><rect x="60" y="6" width="20" height="12" rx="1"/><circle cx="24" cy="66" r="6"/><circle cx="44" cy="66" r="6"/><circle cx="92" cy="66" r="6"/>',
  bulldozer: '<rect x="30" y="58" width="64" height="14" rx="7"/><circle cx="38" cy="65" r="3"/><circle cx="86" cy="65" r="3"/><path d="M36 58V40h44v18"/><path d="M54 40V20h22v20"/><path d="M12 34h8v38h-8c4-13 4-25 0-38z"/><path d="M20 52h16"/>',
  roller: '<circle cx="28" cy="58" r="15"/><path d="M28 43h14"/><path d="M42 58V38h40v20"/><path d="M60 38V18h22v20"/><path d="M43 58h36"/><circle cx="90" cy="64" r="9"/>',
  tractor: '<circle cx="80" cy="56" r="17"/><circle cx="80" cy="56" r="5"/><circle cx="30" cy="64" r="10"/><path d="M20 54V42l6-10h38"/><path d="M64 39V14h26v25"/><rect x="69" y="18" width="16" height="12" rx="1"/>',
  other: '<rect x="10" y="26" width="62" height="30" rx="2"/><path d="M72 56V36h16l10 10v10z"/><path d="M8 56h96"/><circle cx="26" cy="64" r="7"/><circle cx="86" cy="64" r="7"/>',
};

function kindIcon(kind, cls) {
  const body = KIND_PATHS[kind] || KIND_PATHS.other;
  return `<svg class="${cls}" viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Иконки интерфейса (24×24, тот же стиль).
const UI = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  plane: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3L10 13"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="M6 12.5l4 4 8-9"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
  quote: '<path d="M10 6C6.5 7.2 4 9.8 4 13.5V18h6v-6H6.5c.3-2 1.6-3.4 3.5-4.2z"/><path d="M20 6c-3.5 1.2-6 3.8-6 7.5V18h6v-6h-3.5c.3-2 1.6-3.4 3.5-4.2z"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h0M16 11h0M8 15h1M12 15h0M16 15h0M8 18.5h8"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  park: '<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7M7 16h10"/>',
  operator: '<path d="M5 15a7 7 0 0 1 14 0"/><path d="M3 15h18v2.5H3z"/><path d="M12 8v3"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4.5"/>',
};

function uiIcon(name, cls = 'ui') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name]}</svg>`;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Цвет текста поверх фона: тёмный или белый по яркости фона.
function inkFor(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111111' : '#ffffff';
}

// Метки шаблона: {{key}} — текст с экранированием, {{{key}}} — готовый HTML,
// <!--if:key-->…<!--/if:key--> — блок целиком вырезается из HTML, если значение пустое.
function render(tpl, vars) {
  const need = (k) => {
    if (!(k in vars)) throw new Error(`template/index.html: метка «${k}» не задана в build.js`);
    return vars[k];
  };
  const IF_RE = /<!--if:(\w+)-->([\s\S]*?)<!--\/if:\1-->/g;
  let out = tpl;
  while (new RegExp(IF_RE.source).test(out)) {
    out = out.replace(IF_RE, (_, k, body) => (need(k) ? body : ''));
  }
  out = out.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => need(k) ?? '');
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(need(k) ?? ''));
  return out;
}

// Общее фото по виду техники (assets/stock/<kind>.jpg), если у позиции нет своего.
function stockFor(kind) {
  const k = KINDS.includes(kind) ? kind : 'other';
  return fs.existsSync(path.join(STOCK_DIR, `${k}.jpg`)) ? k : null;
}

// Картинка позиции: своё фото → общее «для примера» → SVG-иконка.
function machineMedia(m) {
  const photo = str(m.photo);
  if (photo) return { type: 'photo', src: photo };
  const stock = stockFor(m.kind);
  if (stock) return { type: 'stock', src: `img/stock/${stock}.jpg` };
  return { type: 'icon' };
}

const STATUS_CHIP = {
  free: ['status--free', 'checkCircle', 'Свободна'],
  busy: ['status--busy', 'clock', 'Занята'],
  confirm: ['status--confirm', 'alert', 'Требует подтверждения'],
};

function machineCard(m, currency) {
  const media = machineMedia(m);
  const [chipCls, chipIcon, chipText] = STATUS_CHIP[m.status];
  const busy = m.status === 'busy';
  const money = rateMoney(m, currency);
  const min = minText(m);
  const mediaHtml = media.type === 'icon'
    ? kindIcon(m.kind, 'mc__icon')
    : `<img src="${esc(media.src)}" alt="" width="1200" height="750" loading="lazy">`;
  return [
    `        <article class="mc mc--${m.status}" data-id="${esc(m.id)}" data-status="${m.status}">`,
    `          <div class="mc__media${media.type === 'icon' ? ' mc__media--icon' : ''}">${mediaHtml}`,
    media.type === 'stock' ? '            <span class="mc__stock">Фото для примера</span>' : null,
    `            <span class="mc__picked">${uiIcon('check')}Выбрано</span>`,
    '          </div>',
    '          <div class="mc__body">',
    '            <div class="mc__head">',
    `              <h3 class="mc__title">${esc(m.title)}</h3>`,
    `              <span class="status ${chipCls}">${uiIcon(chipIcon)}${chipText}</span>`,
    '            </div>',
    str(m.purpose) ? `            <p class="mc__purpose">${esc(str(m.purpose))}</p>` : null,
    money
      ? `            <p class="mc__price"><b>${esc(money)}</b> /${esc(m.unit)}${min ? ` · ${esc(min)}` : ''}</p>`
      : `            <p class="mc__price"><b class="mc__ask">Цена по запросу</b>${min ? ` · ${esc(min)}` : ''}</p>`,
    busy
      ? '            <button type="button" class="mc__btn" disabled>Сейчас занята</button>'
      : `            <button type="button" class="mc__btn" aria-pressed="false"><span class="mc__btn-text">Выбрать</span>${uiIcon('check')}</button>`,
    '          </div>',
    '        </article>',
  ].filter((l) => l !== null).join('\n');
}

// «Спецтехника на объекте *точно в срок*» → акцентный цвет на словах в звёздочках.
function accentTitle(text) {
  return esc(text).replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');
}

const FEATURE_ICON = { park: 'park', clock: 'clock', operator: 'operator', calendar: 'calendar', shield: 'shield', truck: 'truck' };

function normalizedMachines(config) {
  return config.machines.map((m) => ({ ...m, status: machineStatus(m) }));
}

// Какие общие фото нужны компании (копируются в img/stock/).
function neededStock(config) {
  const all = [...normalizedMachines(config).map(machineMedia), heroMedia(config)];
  return [...new Set(all.filter((x) => x.type === 'stock').map((x) => x.src))];
}

// Фото первого экрана: hero_photo → своё фото первой свободной позиции → общее фото по её виду.
function heroMedia(config) {
  const machines = normalizedMachines(config);
  if (str(config.hero_photo)) return { type: 'photo', src: str(config.hero_photo) };
  const withPhoto = machines.find((m) => m.status !== 'busy' && str(m.photo));
  if (withPhoto) return { type: 'photo', src: str(withPhoto.photo) };
  const firstFree = machines.find((m) => m.status !== 'busy') || machines[0];
  const stock = stockFor(firstFree.kind);
  return stock ? { type: 'stock', src: `img/stock/${stock}.jpg` } : { type: 'icon', src: '' };
}

function pageVars(config) {
  const name = str(config.name);
  const city = str(config.city);
  const cityIn = str(config.city_in);
  const address = str(config.address);
  const phone = str(config.phone);
  const whatsapp = str(config.whatsapp);
  const telegram = str(config.telegram);
  const currency = str(config.currency);
  const source2gis = str(config.source_2gis);
  const machines = normalizedMachines(config);
  const zones = Array.isArray(config.zones) ? config.zones : [];
  const reviews = Array.isArray(config.reviews_summary) ? config.reviews_summary.map(str).filter(Boolean) : [];
  const features = Array.isArray(config.features) ? config.features.filter((f) => f && str(f.title)) : [];
  const colors = config.colors || {};
  const channel = resolveChannel(config);

  const colorRules = [];
  for (const key of ['primary', 'accent']) {
    const c = str(colors[key]);
    if (c) colorRules.push(`--${key}:${c};--${key}-ink:${inkFor(c)}`);
  }

  const logo = str(config.logo);
  const logoHtml = logo ? `<img src="${esc(logo)}" alt="">` : uiIcon('truck');

  // Канал связи: WhatsApp (основной), Telegram (запасной), иначе звонок.
  const phoneTel = phone ? `+${digits(phone)}` : '';
  const CH = {
    whatsapp: { href: `https://wa.me/${whatsapp}`, label: 'Написать в WhatsApp', short: 'WhatsApp', icon: 'chat', send: 'Отправить заявку в WhatsApp' },
    telegram: { href: `https://t.me/${telegram}`, label: 'Написать в Telegram', short: 'Telegram', icon: 'plane', send: 'Отправить заявку в Telegram' },
    phone: { href: `tel:${phoneTel}`, label: 'Позвонить', short: 'Позвонить', icon: 'phone', send: 'Позвонить и заказать' },
  }[channel];

  // Первый экран: hero_photo → фото первой свободной позиции → общее фото «для примера» → иконка.
  const firstFree = machines.find((m) => m.status !== 'busy') || machines[0];
  const hero = heroMedia(config);
  const heroPhoto = hero.src;
  const heroTitle = str(config.hero_title)
    ? accentTitle(str(config.hero_title))
    : `Аренда спецтехники${cityIn ? ` <span class="accent">${esc(cityIn)}</span>` : ''}`;
  const count = machines.length;

  const featureItems = features.map((f) => [
    '        <li class="feature">',
    `          <span class="feature__ico">${uiIcon(FEATURE_ICON[f.icon] || 'truck')}</span>`,
    `          <span class="feature__title">${esc(str(f.title))}</span>`,
    str(f.text) ? `          <span class="feature__text">${esc(str(f.text))}</span>` : null,
    '        </li>',
  ].filter((l) => l !== null).join('\n')).join('\n');

  const machineOptions = machines.filter((m) => m.status !== 'busy').map((m) => {
    const money = rateMoney(m, currency);
    const label = `${m.title} · ${money ? `${money}/${m.unit === 'час' ? 'ч' : m.unit}` : 'цена по запросу'}`;
    return `              <option value="${esc(m.id)}" data-full="${esc(label)}" data-short="${esc(m.title)}">${esc(label)}</option>`;
  }).join('\n');

  const zoneOptions = zones.map((z, i) => {
    const from = z.delivery_from;
    const to = z.delivery_to ?? from;
    let price = '';
    if (from === 0 && (to === 0 || to == null)) price = ' — бесплатно';
    else if (from != null) price = ` — ${from === to ? `${fmtNum(from)} ${currency}` : `${fmtNum(from)}–${fmtNum(to)} ${currency}`}`;
    return `              <option value="${i}">${esc(z.title + price)}</option>`;
  }).join('\n');

  const reviewItems = reviews.map((r) => `        <li class="review">${uiIcon('quote', 'review__q')}<p>${esc(r)}</p></li>`).join('\n');

  const contactButtons = [
    whatsapp ? `        <a class="btn ${channel === 'whatsapp' ? 'btn--accent' : 'btn--line'}" href="https://wa.me/${esc(whatsapp)}">${uiIcon('chat')}WhatsApp</a>` : null,
    telegram ? `        <a class="btn ${channel === 'telegram' ? 'btn--accent' : 'btn--line'}" href="https://t.me/${esc(telegram)}">${uiIcon('plane')}Telegram</a>` : null,
    phone ? `        <a class="btn btn--line" href="tel:${esc(phoneTel)}">${uiIcon('phone')}Позвонить</a>` : null,
    source2gis ? `        <a class="btn btn--line" href="${esc(source2gis)}" target="_blank" rel="nofollow noopener">${uiIcon('pin')}Открыть в 2ГИС</a>` : null,
  ].filter(Boolean).join('\n');

  // Данные для расчёта (app.js). «<» экранируем, чтобы строка не закрыла <script>.
  const data = {
    currency,
    channel,
    whatsapp,
    telegram,
    phone: phone ? digits(phone) : '',
    machines: machines.map((m) => ({
      id: m.id, title: m.title, unit: m.unit, status: m.status,
      rate_from: m.rate_from ?? null, rate_to: m.rate_to ?? null, min_units: m.min_units ?? null,
    })),
    zones: zones.map((z) => ({ title: z.title, delivery_from: z.delivery_from ?? null, delivery_to: z.delivery_to ?? null })),
  };

  return {
    demo: config.demo === true,
    name,
    tagline: str(config.tagline),
    city,
    schedule: str(config.schedule),
    address: address ? [city, address].filter(Boolean).join(', ') : '',
    about: str(config.about),
    price_note: str(config.price_note),
    park_note: str(config.park_note),
    delivery_time_text: str(config.delivery_time_text),
    page_title: `${name} — аренда спецтехники${city ? `, ${city}` : ''}`,
    page_description: `${name}: аренда спецтехники${city ? ` в городе ${city}` : ''}. Выбор техники, расчёт и заявка онлайн.`,
    color_style: colorRules.length ? `<style>:root{${colorRules.join(';')}}</style>` : '',
    logo_html: logoHtml,
    channel_href: CH.href,
    channel_label: CH.label,
    channel_short: CH.short,
    channel_icon: uiIcon(CH.icon),
    send_label: CH.send,
    send_icon: uiIcon(CH.icon),
    icon_pin: uiIcon('pin'),
    icon_calc: uiIcon('calc'),
    icon_down: uiIcon('arrowDown'),
    icon_right: uiIcon('arrowRight'),
    icon_truck: uiIcon('truck', 'ui ctl__ico'),
    icon_pin_ctl: uiIcon('pin', 'ui ctl__ico'),
    icon_calendar_ctl: uiIcon('calendar', 'ui ctl__ico'),
    icon_clock_ctl: uiIcon('clock', 'ui ctl__ico'),
    icon_comment_ctl: uiIcon('comment', 'ui ctl__ico'),
    icon_user_ctl: uiIcon('user', 'ui ctl__ico'),
    icon_phone_ctl: uiIcon('phone', 'ui ctl__ico'),
    icon_map_ctl: uiIcon('truck', 'ui ctl__ico'),
    hero_chip: city ? (cityIn ? `Спецтехника ${cityIn}` : `Спецтехника в городе ${city}`) : '',
    hero_title: heroTitle,
    has_hero_photo: Boolean(heroPhoto),
    hero_stock: hero.type === 'stock',
    hero_class: heroPhoto ? 'hero--photo' : 'hero--icon',
    hero_photo: heroPhoto,
    hero_icon: heroPhoto ? '' : kindIcon(firstFree.kind, 'hero__icon'),
    stat_count: String(count),
    stat_count_label: `${Calc.pluralForms(count, ['единица', 'единицы', 'единиц'])} техники`,
    has_features: features.length > 0,
    feature_items: featureItems,
    machine_cards: machines.map((m) => machineCard(m, currency)).join('\n'),
    machine_count: String(machines.length),
    machine_options: machineOptions,
    has_zones: zones.length > 0,
    zone_options: zoneOptions,
    has_reviews: reviews.length > 0,
    review_items: reviewItems,
    contact_buttons: contactButtons,
    data_json: JSON.stringify(data).replace(/</g, '\\u003c'),
  };
}

// style.css и app.js встраиваются в index.html: страница грузится одним запросом
// (на медленном мобильном интернете каждый лишний запрос — это ещё одна задержка сети).
function inlineAssets() {
  const read = (f) => fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8').trim();
  const css = read('style.css');
  const js = read('app.js');
  if (/<\/style/i.test(css) || /<\/script/i.test(js)) throw new Error('template: в style.css или app.js встречается закрывающий тег');
  return { inline_css: `\n${css}\n`, inline_js: `\n${js}\n` };
}

function buildCompany(company, outRoot, tpl) {
  const dir = path.join(outRoot, company.folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render(tpl, { ...pageVars(company.config), ...inlineAssets() }));
  const img = path.join(COMPANIES_DIR, company.folder, 'img');
  if (fs.existsSync(img)) {
    fs.cpSync(img, path.join(dir, 'img'), { recursive: true, filter: (src) => path.basename(src) !== '.gitkeep' });
  }
  // Общие фото «для примера» — только те, что нужны этой компании.
  for (const rel of neededStock(company.config)) {
    fs.mkdirSync(path.join(dir, 'img', 'stock'), { recursive: true });
    fs.copyFileSync(path.join(STOCK_DIR, path.basename(rel)), path.join(dir, rel));
  }
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

  if (folders.length) {
    console.log(`Валидация пройдена: ${companies.length} из ${folders.length} (${companies.map((c) => c.folder).join(', ')})`);
  } else {
    console.log(`Компаний для сборки нет${includeTest ? '' : ' (тестовые папки на «_» собираются только с --test)'}.`);
  }

  // Папку результата собираем заново целиком: так в ней не остаются удалённые компании.
  const outRoot = path.join(ROOT, outDir);
  const tpl = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'index.html'), ROOT_INDEX);
  fs.writeFileSync(path.join(outRoot, 'robots.txt'), ROBOTS_TXT);
  fs.writeFileSync(path.join(outRoot, '.nojekyll'), '');

  for (const company of companies) {
    buildCompany(company, outRoot, tpl);
    console.log(`  ✓ ${outDir}/${company.folder}/index.html`);
  }
  console.log(`Готово: ${outDir}/ (${companies.length} компаний)`);
}

if (require.main === module) main();

module.exports = { validate, readConfig, loadCompanies, render, pageVars, neededStock, resolveChannel };
