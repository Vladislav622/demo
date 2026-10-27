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
  'demo', 'slug', 'name', 'logo', 'hero_photo', 'city', 'city_in', 'address', 'schedule', 'phone', 'whatsapp',
  'colors', 'about', 'reviews_summary', 'source_2gis', 'currency', 'price_note', 'machines', 'zones',
];
const MACHINE_KEYS = ['id', 'title', 'kind', 'photo', 'purpose', 'rate_from', 'rate_to', 'unit', 'min_units', 'available'];
const ZONE_KEYS = ['title', 'delivery_from', 'delivery_to'];
const OPTIONAL_STRINGS = ['logo', 'hero_photo', 'city', 'city_in', 'address', 'schedule', 'phone', 'whatsapp', 'about', 'source_2gis', 'price_note'];

const KINDS = ['excavator', 'crane', 'dump_truck', 'loader', 'manipulator', 'aerial_platform', 'bulldozer', 'roller', 'tractor', 'other'];
const PHOTO_WARN_BYTES = 300 * 1024;

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

function rateText(m, currency) {
  if (m.rate_from == null) return 'цена по запросу';
  return `от ${fmtNum(m.rate_from)} ${currency}/${m.unit}`;
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
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  check: '<path d="M6 12.5l4 4 8-9"/>',
  quote: '<path d="M10 6C6.5 7.2 4 9.8 4 13.5V18h6v-6H6.5c.3-2 1.6-3.4 3.5-4.2z"/><path d="M20 6c-3.5 1.2-6 3.8-6 7.5V18h6v-6h-3.5c.3-2 1.6-3.4 3.5-4.2z"/>',
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

function machineCard(m, currency) {
  const busy = !m.available;
  const photo = str(m.photo);
  const media = photo
    ? `<img src="${esc(photo)}" alt="" width="1200" height="900" loading="lazy">`
    : kindIcon(m.kind, 'mc__icon');
  return [
    `        <button type="button" class="mc${busy ? ' mc--busy' : ''}" data-id="${esc(m.id)}" aria-pressed="false"${busy ? ' disabled' : ''}>`,
    `          <span class="mc__media${photo ? '' : ' mc__media--icon'}">${media}`,
    `            <span class="badge ${busy ? 'badge--busy' : 'badge--free'}">${busy ? 'Занята' : 'Свободна'}</span>`,
    `            <span class="mc__check">${uiIcon('check')}</span>`,
    '          </span>',
    '          <span class="mc__body">',
    `            <span class="mc__title">${esc(m.title)}</span>`,
    str(m.purpose) ? `            <span class="mc__purpose">${esc(str(m.purpose))}</span>` : null,
    `            <span class="mc__price${m.rate_from == null ? ' mc__price--ask' : ''}">${esc(rateText(m, currency))}</span>`,
    m.min_units ? `            <span class="mc__min">мин. ${esc(Calc.qty(m.min_units, m.unit))}</span>` : null,
    '          </span>',
    busy
      ? '          <span class="mc__cta mc__cta--busy">Занята</span>'
      : `          <span class="mc__cta">${uiIcon('check', 'ui mc__cta-ico')}<span class="mc__cta-text">Выбрать</span></span>`,
    '        </button>',
  ].filter((l) => l !== null).join('\n');
}

function pageVars(config) {
  const name = str(config.name);
  const city = str(config.city);
  const cityIn = str(config.city_in);
  const address = str(config.address);
  const phone = str(config.phone);
  const whatsapp = str(config.whatsapp);
  const currency = str(config.currency);
  const source2gis = str(config.source_2gis);
  const machines = config.machines.map((m) => ({ ...m, available: m.available !== false }));
  const zones = Array.isArray(config.zones) ? config.zones : [];
  const reviews = Array.isArray(config.reviews_summary) ? config.reviews_summary.map(str).filter(Boolean) : [];
  const colors = config.colors || {};

  const colorRules = [];
  for (const key of ['primary', 'accent']) {
    const c = str(colors[key]);
    if (c) colorRules.push(`--${key}:${c};--${key}-ink:${inkFor(c)}`);
  }

  const logo = str(config.logo);
  const brandHtml = logo
    ? `<img class="brand__logo" src="${esc(logo)}" alt="${esc(name)}">`
    : `<span class="brand__name">${esc(name)}</span>`;

  // Связь: телефон, а если его нет — WhatsApp.
  const phoneTel = phone ? `+${digits(phone)}` : '';
  const callHref = phone ? `tel:${phoneTel}` : `https://wa.me/${whatsapp}`;
  const callLabel = phone ? 'Позвонить' : 'WhatsApp';
  const callIcon = phone ? 'phone' : 'chat';

  // Первый экран: hero_photo → фото первой свободной позиции → иконка на фоне primary.
  const firstFree = machines.find((m) => m.available) || machines[0];
  const heroPhoto = str(config.hero_photo)
    || str((machines.find((m) => m.available && str(m.photo)) || {}).photo);
  const heroMedia = heroPhoto
    ? `<img class="hero__img" src="${esc(heroPhoto)}" alt="" width="1200" height="900">`
    : kindIcon(firstFree.kind, 'hero__icon');

  const zoneChips = zones.map((z, i) => `            <button type="button" class="chip" data-zone="${i}" aria-pressed="false">${esc(z.title)}</button>`).join('\n');
  const reviewItems = reviews.map((r) => `        <li class="review">${uiIcon('quote', 'review__q')}<p>${esc(r)}</p></li>`).join('\n');

  const contactButtons = [
    phone ? `        <a class="btn btn--accent" href="tel:${esc(phoneTel)}">${uiIcon('phone')}Позвонить</a>` : null,
    whatsapp ? `        <a class="btn btn--line" href="https://wa.me/${esc(whatsapp)}">${uiIcon('chat')}WhatsApp</a>` : null,
    source2gis ? `        <a class="btn btn--line" href="${esc(source2gis)}" target="_blank" rel="nofollow noopener">${uiIcon('pin')}Открыть в 2ГИС</a>` : null,
  ].filter(Boolean).join('\n');

  // Данные для калькулятора (app.js). «<» экранируем, чтобы строка не закрыла <script>.
  const data = {
    currency,
    whatsapp,
    phone: phone ? digits(phone) : '',
    machines: machines.map((m) => ({
      id: m.id, title: m.title, unit: m.unit,
      rate_from: m.rate_from ?? null, rate_to: m.rate_to ?? null,
      min_units: m.min_units ?? null, available: m.available,
    })),
    zones: zones.map((z) => ({ title: z.title, delivery_from: z.delivery_from ?? null, delivery_to: z.delivery_to ?? null })),
  };

  return {
    demo: config.demo === true,
    name,
    city,
    address: address ? [city, address].filter(Boolean).join(', ') : '',
    schedule: str(config.schedule),
    about: str(config.about),
    page_title: `${name} — аренда спецтехники${city ? `, ${city}` : ''}`,
    page_description: `${name}: аренда спецтехники${city ? ` в городе ${city}` : ''}. Выбор техники, расчёт и заявка онлайн.`,
    color_style: colorRules.length ? `<style>:root{${colorRules.join(';')}}</style>` : '',
    brand_html: brandHtml,
    call_href: callHref,
    call_label: callLabel,
    call_icon: uiIcon(callIcon),
    hero_class: heroPhoto ? 'hero--photo' : 'hero--icon',
    hero_media: heroMedia,
    hero_title: cityIn ? `Аренда спецтехники ${cityIn}` : 'Аренда спецтехники',
    hero_sub: !cityIn && city ? `${city} · ${name}` : name,
    step_icon_1: uiIcon('grid', 'how__ico'),
    step_icon_2: uiIcon('calendar', 'how__ico'),
    step_icon_3: uiIcon(whatsapp ? 'chat' : 'phone', 'how__ico'),
    step_3_label: whatsapp ? 'Заявка в WhatsApp' : 'Звонок менеджеру',
    machine_cards: machines.map((m) => machineCard(m, currency)).join('\n'),
    has_zones: zones.length > 0,
    zone_chips: zoneChips,
    has_reviews: reviews.length > 0,
    review_items: reviewItems,
    contact_buttons: contactButtons,
    submit_label: whatsapp ? 'Отправить в WhatsApp' : 'Позвонить',
    data_json: JSON.stringify(data).replace(/</g, '\\u003c'),
  };
}

function buildCompany(company, outRoot, tpl) {
  const dir = path.join(outRoot, company.folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render(tpl, pageVars(company.config)));
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'style.css'), path.join(dir, 'style.css'));
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'app.js'), path.join(dir, 'app.js'));
  const img = path.join(COMPANIES_DIR, company.folder, 'img');
  if (fs.existsSync(img)) {
    fs.cpSync(img, path.join(dir, 'img'), { recursive: true, filter: (src) => path.basename(src) !== '.gitkeep' });
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

module.exports = { validate, readConfig, loadCompanies, render, pageVars };
