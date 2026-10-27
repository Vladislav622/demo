// Сборка сайтов компаний: companies/<slug>/config.json → docs/<slug>/
// Только встроенные модули Node.
//
// node build.js         — все компании, кроме папок на «_» → docs/ (публикация)
// node build.js --test  — все компании, включая папки на «_», и фикстуры tests/fixtures → preview/ (не публикуется)

'use strict';

const fs = require('fs');
const path = require('path');
const Calc = require('./template/core.js');

const ROOT = __dirname;
const COMPANIES_DIR = path.join(ROOT, 'companies');
const FIXTURES_DIR = path.join(ROOT, 'tests', 'fixtures');
const TEMPLATE_DIR = path.join(ROOT, 'template');
const STOCK_DIR = path.join(ROOT, 'assets', 'stock');

const KNOWN_KEYS = [
  'demo', 'slug', 'name', 'tagline', 'logo', 'hero_photo', 'hero_title', 'city', 'city_in', 'address', 'schedule',
  'phone', 'whatsapp', 'telegram', 'channel', 'delivery_time_text', 'park_note', 'features', 'colors', 'about', 'reviews_summary', 'source_2gis', 'currency', 'price_note', 'machines', 'zones',
];
const MACHINE_KEYS = ['id', 'title', 'kind', 'photo', 'purpose', 'rate_from', 'rate_to', 'unit', 'min_units', 'status', 'available'];
const ZONE_KEYS = ['title', 'delivery_from', 'delivery_to'];
const OPTIONAL_STRINGS = ['tagline', 'logo', 'hero_photo', 'hero_title', 'city', 'city_in', 'address', 'schedule', 'phone', 'whatsapp',
  'telegram', 'channel', 'delivery_time_text', 'park_note', 'about', 'source_2gis', 'price_note'];

const KINDS = ['excavator', 'crane', 'dump_truck', 'loader', 'mini_loader', 'manipulator', 'aerial_platform', 'bulldozer', 'roller', 'tractor', 'other'];
const PHOTO_WARN_BYTES = 300 * 1024;
const STATUSES = ['free', 'busy', 'confirm'];
const CHANNELS = ['whatsapp', 'telegram'];
const FEATURE_ICONS = ['park', 'clock', 'operator', 'calendar', 'shield', 'truck'];
const FEATURE_KEYS = ['icon', 'title', 'text'];
// Контакты тестовых папок («_») не храним в репозитории: в конфиге пишется "$TEST_WA" и т. п.
const PLACEHOLDER_KEYS = ['whatsapp', 'telegram', 'phone'];

const SLUG_RE = /^_?[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DEFAULT_COLORS = { primary: '#1e211f', accent: '#b5361c' };
const PAGE_BG = '#f1efea';

function show(v) {
  return JSON.stringify(v);
}

const digits = Calc.digitsOf;

function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function isNumOrNull(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function relPath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// Читает config.json. Ошибку разбора JSON переводит в строку/столбец.
function readConfig(file) {
  const rel = relPath(file);
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

// "$TEST_WA" → значение переменной окружения (только для тестовых папок «_»). Возвращает имена незаданных переменных.
function resolvePlaceholders(config, folder) {
  const missing = [];
  for (const key of PLACEHOLDER_KEYS) {
    const m = typeof config[key] === 'string' && /^\$(TEST_[A-Z]+)$/.exec(config[key].trim());
    if (!m) continue;
    if (!folder.startsWith('_')) continue;
    const value = (process.env[m[1]] || '').trim().replace(/^@/, '');
    if (!value) missing.push(m[1]);
    config[key] = value;
  }
  return missing;
}

// Главный канал заявок: channel из конфига, иначе WhatsApp, если он есть, иначе Telegram, иначе звонок.
function resolveChannel(config) {
  const wa = str(config.whatsapp);
  const tg = str(config.telegram);
  if (config.channel === 'telegram' && tg) return 'telegram';
  if (config.channel === 'whatsapp' && wa) return 'whatsapp';
  if (wa) return 'whatsapp';
  if (tg) return 'telegram';
  return 'phone';
}

// Размер картинки без зависимостей: PNG (IHDR), JPEG (SOF), WebP (VP8/VP8L/VP8X). SVG и прочее — null.
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

// Возвращает { errors, warnings }. Каждая строка: «файл: поле — что не так».
function validate(config, rel, folder, dir = path.join(COMPANIES_DIR, folder), missingEnv = []) {
  const errors = [];
  const warnings = [];
  const err = (field, msg) => errors.push(`${rel}: ${field} — ${msg}`);
  const warn = (field, msg) => warnings.push(`${rel}: ${field} — ${msg}`);
  const dirRel = relPath(dir);

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
  const wa = str(config.whatsapp);
  const tg = str(config.telegram);
  const phone = str(config.phone);
  if (tg && !Calc.isTelegram(tg)) {
    err('telegram', `username без @: латиница, цифры, «_», 5–32 символа (сейчас: ${show(config.telegram)})`);
  }
  const channel = str(config.channel);
  if (channel && !CHANNELS.includes(channel)) {
    err('channel', `"whatsapp" или "telegram" (сейчас: ${show(config.channel)})`);
  } else if (channel === 'whatsapp' && !wa) {
    err('channel', 'указан "whatsapp", но поле whatsapp пустое');
  } else if (channel === 'telegram' && !tg) {
    err('channel', 'указан "telegram", но поле telegram пустое');
  }
  if (wa && !Calc.isWhatsapp(wa)) {
    err('whatsapp', `только цифры в международном формате, 10–15 цифр, например 77011234567 (сейчас: ${show(config.whatsapp)})`);
  }
  if (phone && !/^[\d\s()+-]+$/.test(phone)) {
    err('phone', `допустимы цифры, пробелы, «+», «-», скобки (сейчас: ${show(config.phone)})`);
  } else if (phone && (digits(phone).length < 10 || digits(phone).length > 15)) {
    err('phone', `должно быть 10–15 цифр (сейчас: ${digits(phone).length})`);
  }
  for (const name of missingEnv) {
    err(name, `не задана переменная окружения — например: ${name}=77011234567 node build.js --test (PowerShell: $env:${name}="77011234567"; node build.js --test)`);
  }
  if (!wa && !tg && !phone && !missingEnv.length) {
    err('whatsapp / telegram / phone', 'нет ни WhatsApp, ни Telegram, ни телефона — демо без контакта не собираем');
  }

  // Файл картинки должен существовать; тяжёлые и слишком широкие фото — предупреждение с советом.
  const checkImage = (field, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const file = path.join(dir, value.trim());
    if (!fs.existsSync(file)) {
      err(field, `файл ${show(value)} не найден в ${dirRel}/`);
      return;
    }
    const kb = Math.round(fs.statSync(file).size / 1024);
    const size = imageSize(file);
    if (kb > 300 || (size && size.w > 1600)) {
      warn(field, `${show(value)} — ${kb} КБ${size ? `, ${size.w}×${size.h}` : ''}: сожмите до ширины 1600 px и ~200 КБ `
        + '(например, squoosh.app → MozJPEG, качество 75, Resize 1600) и замените файл');
    }
  };
  checkImage('logo', config.logo);
  checkImage('hero_photo', config.hero_photo);

  if (typeof config.hero_title === 'string' && (config.hero_title.match(/\*/g) || []).length % 2) {
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
    if (config.machines.every((m) => m && Calc.statusOf(m) === 'busy')) {
      warn('machines', 'все позиции заняты — вместо расчёта будет сообщение «Сейчас вся техника занята»');
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

// Папки компаний: companies/<slug>, а в режиме --test ещё тестовые «_» и фикстуры tests/fixtures/_*.
function companyFolders(includeTest) {
  const list = [];
  const scan = (base, onlyTest) => {
    if (!fs.existsSync(base)) return;
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith('_') ? !includeTest : onlyTest) continue;
      list.push({ folder: d.name, dir: path.join(base, d.name) });
    }
  };
  scan(COMPANIES_DIR, false);
  scan(FIXTURES_DIR, true);
  return list.sort((a, b) => a.folder.localeCompare(b.folder));
}

// Загружает и проверяет компании. only — сборка одной компании.
function loadCompanies(includeTest, only = null) {
  const all = companyFolders(includeTest);
  const entries = only ? all.filter((e) => e.folder === only) : all;
  const companies = [];
  const errors = [];
  const warnings = [];
  const seen = new Set();

  for (const { folder, dir } of entries) {
    if (seen.has(folder)) {
      errors.push(`${relPath(dir)}: папка с таким именем уже есть в companies/ — переименуйте`);
      continue;
    }
    seen.add(folder);
    const { rel, config, errors: readErrors } = readConfig(path.join(dir, 'config.json'));
    if (readErrors.length) {
      errors.push(...readErrors);
      continue;
    }
    const missing = resolvePlaceholders(config, folder);
    const result = validate(config, rel, folder, dir, missing);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (!includeTest && config.demo === false) {
      warnings.push(`${rel}: demo — demo=false в демо-репозитории: robots.txt закрывает сайт от поиска, публикуйте клиента отдельно`);
    }
    if (!result.errors.length) companies.push({ folder, dir, config, warnings: result.warnings.length });
  }

  return { folders: entries.map((e) => e.folder), companies, errors, warnings };
}

// ---------- Цвета: контраст текста ≥ 4,5:1 автоматически ----------

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Смесь двух цветов: t — доля второго.
function mix(a, b, t) {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(p.map((v, i) => v + (q[i] - v) * t));
}

// Сдвигаем цвет к toward, пока контраст с фоном не станет ≥ min.
function ensureContrast(fg, bg, toward, min = 4.5) {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(fg, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}

function inkFor(bg) {
  return contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111';
}

// Фон под текстом: если ни белый, ни тёмный текст не дают 4,5:1 (цвет средней яркости),
// чуть затемняем или осветляем сам фон — фирменный оттенок сохраняется.
function readableBg(color) {
  const ink = inkFor(color);
  return { bg: ensureContrast(color, ink, ink === '#ffffff' ? '#000000' : '#ffffff'), ink };
}

function palette(colors = {}) {
  const { bg: primary, ink: primaryInk } = readableBg((str(colors.primary) || DEFAULT_COLORS.primary).toLowerCase());
  const { bg: accent, ink: accentInk } = readableBg((str(colors.accent) || DEFAULT_COLORS.accent).toLowerCase());
  const darkText = '#1e211f';
  return {
    primary,
    'primary-ink': primaryInk,
    'on-primary-muted': ensureContrast(mix(primaryInk, primary, 0.28), primary, primaryInk),
    accent,
    'accent-ink': accentInk,
    // текст и иконки цвета акцента на светлом фоне страницы
    'accent-text': ensureContrast(accent, PAGE_BG, darkText),
    // акцент на тёмном (primary) фоне — первый экран, итоговая карточка
    'accent-on-dark': ensureContrast(accent, primary, primaryInk),
    'accent-soft': mix(accent, '#ffffff', 0.9),
  };
}

// ---------- Генерация страниц ----------

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

// Текст с неразрывными пробелами «20 т» → безопасный HTML.
const escUnits = (s) => esc(Calc.nbspUnits(s));

// Иконки видов техники: иллюстрация, не фото. Единый стиль — контур 2px, скругления.
const KIND_PATHS = {
  excavator: '<rect x="14" y="60" width="62" height="14" rx="7"/><circle cx="23" cy="67" r="3"/><circle cx="67" cy="67" r="3"/><path d="M24 60V36h16l6 10h14v14"/><path d="M28 40h9v8h-9z"/><path d="M58 48L84 22l18 22"/><path d="M96 44c0 8 4 13 12 13V44z"/>',
  crane: '<rect x="10" y="52" width="78" height="10" rx="2"/><path d="M88 62V44h12l8 8v10z"/><circle cx="24" cy="68" r="6"/><circle cx="42" cy="68" r="6"/><circle cx="96" cy="68" r="6"/><rect x="22" y="44" width="16" height="8" rx="2"/><path d="M30 44L96 12"/><path d="M96 12v24"/><path d="M96 36c0 4-5 4-5 0"/>',
  dump_truck: '<path d="M10 24h60l-6 28H14z"/><path d="M74 52V32h16l10 12v8z"/><path d="M78 36h10l6 8H78z"/><path d="M8 56h96"/><circle cx="24" cy="64" r="7"/><circle cx="44" cy="64" r="7"/><circle cx="88" cy="64" r="7"/>',
  loader: '<path d="M44 58V40h44v18"/><path d="M56 40V18h24v22"/><rect x="60" y="22" width="16" height="11" rx="1"/><circle cx="52" cy="64" r="10"/><circle cx="84" cy="64" r="10"/><path d="M44 46L26 56"/><path d="M26 44H12v18h16z"/>',
  mini_loader: '<path d="M40 64V36h22l10 10v18z"/><path d="M46 40h12l6 6v8H46z"/><circle cx="49" cy="68" r="7"/><circle cx="69" cy="68" r="7"/><path d="M72 44l18 8"/><path d="M88 46h16l-3 20H86z"/>',
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
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  checks: '<path d="M2 12.5l4 4 8-9"/><path d="M10 15.5l1 1 8-9"/>',
};

function uiIcon(name, cls = 'ui') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name]}</svg>`;
}

// Метки шаблона: {{key}} — текст с экранированием, {{{key}}} — готовый HTML,
// <!--if:key-->…<!--/if:key--> — блок целиком вырезается из HTML, если значение пустое.
// Метки подставляются за один проход: в подставленных значениях «{{…}}» и «<!--if…-->» уже не обрабатываются.
function render(tpl, vars, name = 'template') {
  const need = (k) => {
    if (!(k in vars)) throw new Error(`${name}: метка «${k}» не задана в build.js`);
    return vars[k];
  };
  const IF_RE = /<!--if:(\w+)-->([\s\S]*?)<!--\/if:\1-->/g;
  let out = tpl;
  while (new RegExp(IF_RE.source).test(out)) {
    out = out.replace(IF_RE, (_, k, body) => (need(k) ? body : ''));
  }
  return out.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, text) => (raw ? String(need(raw) ?? '') : esc(need(text) ?? '')));
}

// Общие фото по виду техники: assets/stock/<kind>.jpg, <kind>-2.jpg, <kind>-3.jpg (какие есть).
function stockFiles(kind) {
  const k = KINDS.includes(kind) ? kind : 'other';
  return [`${k}.jpg`, `${k}-2.jpg`, `${k}-3.jpg`].filter((f) => fs.existsSync(path.join(STOCK_DIR, f)));
}

// Общее фото «для примера»: путь на странице, уменьшенная копия 640 px (если есть) и размеры.
function stockMedia(file) {
  const small = file.replace(/\.jpg$/, '-640.jpg');
  const size = imageSize(path.join(STOCK_DIR, file)) || { w: 1200, h: 750 };
  return { type: 'stock', src: `img/stock/${file}`, small: fs.existsSync(path.join(STOCK_DIR, small)) ? `img/stock/${small}` : '', w: size.w, h: size.h };
}

// Своё фото компании: размеры из файла (для width/height без «прыжков» вёрстки).
function photoMedia(src, dir) {
  const size = dir && fs.existsSync(path.join(dir, src)) ? imageSize(path.join(dir, src)) : null;
  return { type: 'photo', src, small: '', w: size ? size.w : 1200, h: size ? size.h : 750 };
}

// Картинки всех позиций: своё фото → общее «для примера» → SVG-иконка.
// Общие фото одного вида раздаются по очереди, чтобы соседние карточки не повторялись.
function machinesMedia(machines, dir) {
  const used = {};
  return machines.map((m) => {
    const photo = str(m.photo);
    if (photo) return photoMedia(photo, dir);
    const files = stockFiles(m.kind);
    if (!files.length) return { type: 'icon' };
    const n = used[m.kind] || 0;
    used[m.kind] = n + 1;
    return stockMedia(files[n % files.length]);
  });
}

// <img>: ленивые карточки с srcset (640 px на телефоне), размеры заданы — вёрстка не прыгает.
const CARD_SIZES = '(min-width: 1100px) 290px, (min-width: 560px) 50vw, 85vw';
function imgTag(md, { prefix = '', sizes = CARD_SIZES, eager = false } = {}) {
  const src = `${prefix}${md.small || md.src}`;
  const srcset = md.small ? ` srcset="${esc(prefix + md.small)} 640w, ${esc(prefix + md.src)} ${md.w}w" sizes="${sizes}"` : '';
  const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<img src="${esc(src)}"${srcset} alt="" width="${md.w}" height="${md.h}"${load} decoding="async">`;
}

const STATUS_CHIP = {
  free: ['status--free', 'checkCircle', 'Свободна'],
  busy: ['status--busy', 'clock', 'Занята'],
  confirm: ['status--confirm', 'alert', 'Требует подтверждения'],
};

function machineCard(m, currency, media) {
  const [chipCls, chipIcon, chipText] = STATUS_CHIP[m.status];
  const busy = m.status === 'busy';
  const rate = Calc.rateText(m, currency);
  const min = Calc.minText(m);
  const mediaHtml = media.type === 'icon' ? kindIcon(m.kind, 'mc__icon') : imgTag(media);
  return [
    `        <article class="mc mc--${m.status}" data-id="${esc(m.id)}" data-status="${m.status}">`,
    `          <div class="mc__media${media.type === 'icon' ? ' mc__media--icon' : ''}">${mediaHtml}`,
    media.type === 'stock' ? '            <span class="mc__stock">Фото для примера</span>' : null,
    `            <span class="mc__picked">${uiIcon('check')}Выбрано</span>`,
    '          </div>',
    '          <div class="mc__body">',
    '            <div class="mc__head">',
    `              <h3 class="mc__title">${escUnits(m.title)}</h3>`,
    `              <span class="status ${chipCls}">${uiIcon(chipIcon)}${chipText}</span>`,
    '            </div>',
    str(m.purpose) ? `            <p class="mc__purpose">${escUnits(str(m.purpose))}</p>` : null,
    rate
      ? `            <p class="mc__price"><b>${esc(rate)}</b> /${esc(m.unit)}${min ? ` · ${esc(min)}` : ''}</p>`
      : `            <p class="mc__price"><b class="mc__ask">Цена по запросу</b>${min ? ` · ${esc(min)}` : ''}</p>`,
    busy
      ? '            <button type="button" class="mc__btn" disabled>Сейчас занята</button>'
      : `            <button type="button" class="mc__btn" aria-pressed="false" aria-label="${esc(Calc.cardLabel(m, currency))}"><span class="mc__btn-text">Выбрать</span>${uiIcon('check')}</button>`,
    '          </div>',
    '        </article>',
  ].filter((l) => l !== null).join('\n');
}

// «Спецтехника на объекте *точно в срок*» → акцентный цвет на словах в звёздочках.
function accentTitle(text) {
  return escUnits(text).replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');
}

const FEATURE_ICON = { park: 'park', clock: 'clock', operator: 'operator', calendar: 'calendar', shield: 'shield', truck: 'truck' };

function normalizedMachines(config) {
  return config.machines.map((m) => ({ ...m, status: Calc.statusOf(m) }));
}

// Фото первого экрана: hero_photo → своё фото первой свободной позиции →
// общий широкий кадр assets/stock/hero.jpg (не тот же, что в карточках) → общее фото по виду → иконка.
function heroMedia(config, dir) {
  const machines = normalizedMachines(config);
  if (str(config.hero_photo)) return photoMedia(str(config.hero_photo), dir);
  const withPhoto = machines.find((m) => m.status !== 'busy' && str(m.photo));
  if (withPhoto) return photoMedia(str(withPhoto.photo), dir);
  if (fs.existsSync(path.join(STOCK_DIR, 'hero.jpg'))) return stockMedia('hero.jpg');
  const firstFree = machines.find((m) => m.status !== 'busy') || machines[0];
  const files = stockFiles(firstFree.kind);
  return files.length ? stockMedia(files[0]) : { type: 'icon', src: '' };
}

// Какие общие фото нужны компании (копируются в img/stock/).
function neededStock(config) {
  const all = [...machinesMedia(normalizedMachines(config)), heroMedia(config)];
  return [...new Set(all.filter((x) => x.type === 'stock').flatMap((x) => [x.src, x.small].filter(Boolean)))];
}

const CHANNEL_UI = {
  whatsapp: { label: 'Написать в WhatsApp', icon: 'chat', send: 'Отправить заявку в WhatsApp', short: 'Отправить' },
  telegram: { label: 'Написать в Telegram', icon: 'plane', send: 'Отправить заявку в Telegram', short: 'Отправить' },
  phone: { label: 'Позвонить', icon: 'phone', send: 'Позвонить', short: 'Позвонить' },
};

function pageVars(config, dir = path.join(COMPANIES_DIR, String(config.slug))) {
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
  const channel = resolveChannel(config);
  const hasFree = machines.some((m) => m.status !== 'busy');

  const pal = palette(config.colors || {});
  const colorStyle = `<style>:root{${Object.entries(pal).map(([k, v]) => `--${k}:${v}`).join(';')}}</style>`;

  const logo = str(config.logo);
  const logoHtml = logo ? `<img src="${esc(logo)}" alt="">` : uiIcon('truck');

  // Канал связи: WhatsApp (основной), Telegram (запасной), иначе звонок.
  const phoneTel = phone ? `+${digits(phone)}` : '';
  const CH = CHANNEL_UI[channel];
  const channelHref = { whatsapp: `https://wa.me/${whatsapp}`, telegram: `https://t.me/${telegram}`, phone: `tel:${phoneTel}` }[channel];

  // Первый экран: hero_photo → фото первой свободной позиции → общее фото «для примера» → иконка.
  const firstFree = machines.find((m) => m.status !== 'busy') || machines[0];
  const hero = heroMedia(config, dir);
  const heroPhoto = hero.src;
  const HERO_SIZES = '(min-width: 900px) 50vw, 100vw';
  const heroTitle = str(config.hero_title)
    ? accentTitle(str(config.hero_title))
    : `Аренда спецтехники${cityIn ? ` <span class="accent">${esc(cityIn)}</span>` : ''}`;
  const count = machines.length;

  const featureItems = features.map((f) => [
    '        <li class="feature">',
    `          <span class="feature__ico">${uiIcon(FEATURE_ICON[f.icon] || 'truck')}</span>`,
    `          <span class="feature__title">${escUnits(str(f.title))}</span>`,
    str(f.text) ? `          <span class="feature__text">${escUnits(str(f.text))}</span>` : null,
    '        </li>',
  ].filter((l) => l !== null).join('\n')).join('\n');

  const machineOptions = machines.filter((m) => m.status !== 'busy').map((m) => {
    const label = Calc.optionLabel(m, currency);
    return `              <option value="${esc(m.id)}" data-full="${esc(label)}" data-short="${escUnits(m.title)}">${esc(label)}</option>`;
  }).join('\n');

  const zoneOptions = zones.map((z, i) => {
    const from = z.delivery_from;
    const to = z.delivery_to ?? from;
    let price = '';
    if (from === 0 && (to === 0 || to == null)) price = ' — бесплатно';
    else if (from != null) price = ` — ${Calc.moneyRange(from, to, currency)}`;
    return `              <option value="${i}">${esc(z.title + price)}</option>`;
  }).join('\n');

  const reviewItems = reviews.map((r) => `        <li class="review">${uiIcon('quote', 'review__q')}<p>${escUnits(r)}</p></li>`).join('\n');

  const contactButtons = [
    whatsapp ? `        <a class="btn ${channel === 'whatsapp' ? 'btn--accent' : 'btn--line'}" href="https://wa.me/${esc(whatsapp)}">${uiIcon('chat')}WhatsApp</a>` : null,
    telegram ? `        <a class="btn ${channel === 'telegram' ? 'btn--accent' : 'btn--line'}" href="https://t.me/${esc(telegram)}">${uiIcon('plane')}Telegram</a>` : null,
    phone ? `        <a class="btn ${channel === 'phone' ? 'btn--accent' : 'btn--line'}" href="tel:${esc(phoneTel)}">${uiIcon('phone')}Позвонить</a>` : null,
    source2gis ? `        <a class="btn btn--line" href="${esc(source2gis)}" target="_blank" rel="nofollow noopener noreferrer">${uiIcon('pin')}Открыть в 2ГИС</a>` : null,
  ].filter(Boolean).join('\n');

  // Данные для расчёта (core.js). «<» экранируем, чтобы строка не закрыла <script>.
  const data = {
    slug: config.slug,
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
    // Готовая разметка для перерисовки, если владелец поменял данные в демо-панели.
    ui: {
      status: Object.fromEntries(Object.entries(STATUS_CHIP).map(([k, [, icon, text]]) => [k, `${uiIcon(icon)}${text}`])),
      btnSelect: `<button type="button" class="mc__btn" aria-pressed="false"><span class="mc__btn-text">Выбрать</span>${uiIcon('check')}</button>`,
      btnBusy: '<button type="button" class="mc__btn" disabled>Сейчас занята</button>',
      icons: { whatsapp: uiIcon('chat'), telegram: uiIcon('plane') },
    },
  };

  return {
    demo: config.demo === true,
    name,
    brand_class: Array.from(name).length > 28 ? ' brand--long' : '',
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
    color_style: colorStyle,
    logo_html: logoHtml,
    channel_href: channelHref,
    channel_label: CH.label,
    channel_icon: uiIcon(CH.icon),
    send_label: CH.send,
    send_short: CH.short,
    send_icon: uiIcon(CH.icon),
    is_phone: channel === 'phone',
    consent_attr: channel === 'phone' ? ' hidden' : '',
    sheet_class: `sheet--${channel === 'telegram' ? 'telegram' : 'whatsapp'}`,
    sheet_title: channel === 'telegram' ? 'Заявка для Telegram' : 'Заявка для WhatsApp',
    open_label: channel === 'telegram' ? 'Открыть Telegram' : 'Открыть WhatsApp',
    is_telegram: channel === 'telegram',
    icon_close: uiIcon('close'),
    icon_copy: uiIcon('copy'),
    icon_external: uiIcon('external', 'ui ui--sm'),
    icon_share: uiIcon('share'),
    icon_checks: uiIcon('checks', 'ui ui--sm'),
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
    hero_img: hero.type === 'icon' ? '' : imgTag(hero, { sizes: HERO_SIZES, eager: true }),
    hero_preload: hero.type === 'icon' ? ''
      : `<link rel="preload" as="image" href="${esc(hero.small || hero.src)}"${hero.small ? ` imagesrcset="${esc(hero.small)} 640w, ${esc(hero.src)} ${hero.w}w" imagesizes="${HERO_SIZES}"` : ''} fetchpriority="high">`,
    hero_icon: heroPhoto ? '' : kindIcon(firstFree.kind, 'hero__icon'),
    stat_count: String(count),
    stat_count_label: `${Calc.pluralForms(count, ['единица', 'единицы', 'единиц'])} техники`,
    has_features: features.length > 0,
    feature_items: featureItems,
    machine_cards: (() => { const media = machinesMedia(machines, dir); return machines.map((m, i) => machineCard(m, currency, media[i])).join('\n'); })(),
    machine_count: String(count),
    many_cards: count > 1,
    grid_class: count === 1 ? ' grid--single' : '',
    machine_options: machineOptions,
    calc_attr: hasFree ? '' : ' hidden',
    allbusy_attr: hasFree ? ' hidden' : '',
    has_zones: zones.length > 0,
    zone_options: zoneOptions,
    has_reviews: reviews.length > 0,
    review_items: reviewItems,
    contact_buttons: contactButtons,
    data_json: JSON.stringify(data).replace(/</g, '\\u003c'),
  };
}

// CSS и JS встраиваются в страницу: она грузится одним запросом
// (на медленном мобильном интернете каждый лишний запрос — это ещё одна задержка сети).
// Сайт: base.css + site.css, core.js + site.js. Панель: base.css + admin.css, core.js + admin.js.
// Простая минификация: CSS — без комментариев и лишних пробелов; JS — без строк-комментариев и отступов
// (переводы строк сохраняются — без риска для кода).
function minCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}
function minJs(js) {
  return js.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
}
function minHtml(html) {
  return html.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

function inlineAssets(kind) {
  const read = (f) => fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8').trim();
  const css = minCss(`${read('base.css')}\n${read(`${kind}.css`)}`);
  const js = minJs(`${read('core.js')}\n${read(`${kind}.js`)}`);
  if (/<\/style/i.test(css) || /<\/script/i.test(js)) throw new Error('template: в CSS или JS встречается закрывающий тег');
  return { inline_css: `\n${css}\n`, inline_js: `\n${js}\n` };
}

// Панель владельца (демо-режим): карточки позиций с ценой, минимальной сменой и статусом.
function adminVars(config, site) {
  const machines = normalizedMachines(config);
  const media = machinesMedia(machines, site.dir);
  const currency = str(config.currency);
  const cards = machines.map((m, i) => {
    const md = media[i];
    const thumb = md.type === 'icon' ? kindIcon(m.kind, 'ac__icon') : `<img src="../${esc(md.small || md.src)}" alt="" width="${md.w}" height="${md.h}" loading="lazy" decoding="async">`;
    const hour = m.unit === 'час';
    const per = hour ? 'час' : esc(m.unit);
    const range = m.rate_to != null;
    return [
      `      <article class="ac" data-id="${esc(m.id)}">`,
      '        <div class="ac__top">',
      `          <span class="ac__thumb${md.type === 'icon' ? ' ac__thumb--icon' : ''}">${thumb}</span>`,
      '          <div class="ac__text">',
      '            <p class="ac__eyebrow">Техника</p>',
      `            <h2 class="ac__title">${escUnits(m.title)}</h2>`,
      str(m.purpose) ? `            <p class="ac__purpose">${escUnits(str(m.purpose))}</p>` : null,
      '          </div>',
      '        </div>',
      '        <div class="ac__fields">',
      '          <label class="ac__field">',
      `            <span class="field__label">Цена за ${per}${range ? ', от' : ''}</span>`,
      `            <span class="ctl"><span class="ctl__prefix">${esc(currency)}</span><input class="input" type="text" inputmode="numeric" name="rate" placeholder="по запросу" autocomplete="off"></span>`,
      '          </label>',
      range ? [
        '          <label class="ac__field">',
        `            <span class="field__label">Цена за ${per}, до</span>`,
        `            <span class="ctl"><span class="ctl__prefix">${esc(currency)}</span><input class="input" type="text" inputmode="numeric" name="rate_to" placeholder="без «до»" autocomplete="off"></span>`,
        '          </label>',
      ].join('\n') : null,
      '          <label class="ac__field">',
      `            <span class="field__label"><span class="lbl-full">${hour ? 'Минимальная смена' : 'Минимальный заказ'}</span><span class="lbl-short">${hour ? 'Мин. смена' : 'Мин. заказ'}</span></span>`,
      `            <span class="ctl">${uiIcon('clock', 'ui ctl__ico')}<input class="input" type="text" inputmode="numeric" name="min" placeholder="нет" autocomplete="off"></span>`,
      `            <span class="hint">${hour ? 'часов' : esc(Calc.plural(5, m.unit))}</span>`,
      '          </label>',
      '        </div>',
      '        <div class="ac__status">',
      `          <span class="field__label" id="st-${esc(m.id)}">Статус техники</span>`,
      `          <div class="seg" role="group" aria-labelledby="st-${esc(m.id)}">`,
      '            <button type="button" class="seg__btn seg__btn--free" data-status="free" aria-pressed="false">Свободна</button>',
      '            <button type="button" class="seg__btn seg__btn--busy" data-status="busy" aria-pressed="false">Занята</button>',
      '            <button type="button" class="seg__btn seg__btn--confirm" data-status="confirm" aria-pressed="false">Требует подтверждения</button>',
      '          </div>',
      '        </div>',
      '      </article>',
    ].filter((l) => l !== null).join('\n');
  }).join('\n');
  return {
    ...site,
    admin_cards: cards,
    currency,
    icon_warn: uiIcon('alert'),
    icon_wa: uiIcon('chat', 'ui ctl__ico'),
    icon_tg: uiIcon('plane', 'ui ctl__ico'),
    icon_ext: uiIcon('external', 'ui ui--sm'),
  };
}

function buildCompany(company, outRoot, tpl, adminTpl) {
  const dir = path.join(outRoot, company.folder);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const site = { ...pageVars(company.config, company.dir), dir: company.dir };
  fs.writeFileSync(path.join(dir, 'index.html'), minHtml(render(tpl, { ...site, ...inlineAssets('site') }, 'template/index.html')));
  fs.mkdirSync(path.join(dir, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'admin', 'index.html'), minHtml(render(adminTpl, { ...adminVars(company.config, site), ...inlineAssets('admin') }, 'template/admin.html')));
  const img = path.join(company.dir, 'img');
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
  const adminTpl = fs.readFileSync(path.join(TEMPLATE_DIR, 'admin.html'), 'utf8');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'index.html'), ROOT_INDEX);
  fs.writeFileSync(path.join(outRoot, 'robots.txt'), ROBOTS_TXT);
  fs.writeFileSync(path.join(outRoot, '.nojekyll'), '');

  for (const company of companies) {
    buildCompany(company, outRoot, tpl, adminTpl);
    console.log(`  ✓ ${outDir}/${company.folder}/index.html + admin/index.html`);
  }
  console.log(`Готово: ${outDir}/ (${companies.length} компаний)`);
}

if (require.main === module) main();

module.exports = { validate, readConfig, loadCompanies, render, pageVars, neededStock, resolveChannel, palette, contrast, esc };
