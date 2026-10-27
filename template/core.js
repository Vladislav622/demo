// Общее ядро: расчёт, тексты, даты, проверки и данные компании.
// Единственный источник логики: его встраивают сайт и панель, его используют build.js и tests/.

(function () {
  'use strict';

  // ---------- Склонения и числа ----------

  var UNIT_FORMS = {
    'час': ['час', 'часа', 'часов'],
    'смена': ['смена', 'смены', 'смен'],
    'день': ['день', 'дня', 'дней'],
    'рейс': ['рейс', 'рейса', 'рейсов'],
  };

  // Быстрые значения количества: для часов — 4/8/16, для смен и дней — 1/2/3; для рейсов и прочего — нет.
  var QUICK_UNITS = { 'час': [4, 8, 16], 'смена': [1, 2, 3], 'день': [1, 2, 3] };

  // Форма слова для числа: [1, 2–4, 5+]; 11–14 — множественное.
  function pluralForms(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a >= 11 && a <= 14) return forms[2];
    if (b === 1) return forms[0];
    if (b >= 2 && b <= 4) return forms[1];
    return forms[2];
  }

  // 1 час, 2 часа, 5 часов, 21 час. Неизвестная единица — как есть.
  function plural(n, unit) {
    var forms = UNIT_FORMS[unit];
    return forms ? pluralForms(n, forms) : unit;
  }

  // «6 часов» — между числом и словом неразрывный пробел (не рвётся при переносе).
  function qty(n, unit) {
    return n + ' ' + plural(n, unit);
  }

  // 25000 → «25 000». По умолчанию неразрывный пробел, чтобы число не переносилось.
  function fmtNum(n, sep) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep === undefined ? ' ' : sep);
  }

  // «20 т», «22 м», «0,5 м³»: неразрывный пробел между числом и короткой единицей.
  function nbspUnits(text) {
    return String(text).replace(/(\d) (т|м³|м²|м|кг|ч|км)(?=$|[\s.,;:)!?])/g, '$1 $2');
  }

  function unitShort(unit) {
    return unit === 'час' ? 'ч' : unit;
  }

  function minUnits(m) {
    return m && m.min_units ? m.min_units : 1;
  }

  function quickUnits(m) {
    var list = QUICK_UNITS[m && m.unit] || [];
    return list.filter(function (n) { return n >= minUnits(m); });
  }

  // ---------- Статус и цена ----------

  // Статус позиции: free | busy | confirm. Старые конфиги: available true → free, false → busy.
  function statusOf(m) {
    if (!m) return 'busy';
    if (m.status === 'free' || m.status === 'busy' || m.status === 'confirm') return m.status;
    return m.available === false ? 'busy' : 'free';
  }

  function isSelectable(m) {
    return statusOf(m) !== 'busy';
  }

  // Точная сумма «30 600 ₸» или диапазон «48 000–60 000 ₸».
  function moneyRange(lo, hi, currency, sep) {
    if (lo === hi || hi == null) return fmtNum(lo, sep) + ' ' + currency;
    return fmtNum(lo, sep) + '–' + fmtNum(hi, sep) + ' ' + currency;
  }

  // Ставка позиции: «12 000 ₸» или «12 000–15 000 ₸»; без цены — null.
  function rateText(m, currency, sep) {
    if (m.rate_from == null) return null;
    return moneyRange(m.rate_from, m.rate_to != null ? m.rate_to : m.rate_from, currency, sep);
  }

  // «мин. смена — 4 часа» для часов, «мин. заказ — 2 смены» для остальных единиц.
  function minText(m) {
    if (!m.min_units) return '';
    return (m.unit === 'час' ? 'мин. смена' : 'мин. заказ') + ' — ' + qty(m.min_units, m.unit);
  }

  // Подпись кнопки карточки для экранного диктора: «Выбрать: Экскаватор, 12 000 ₸ за час, свободна».
  function cardLabel(m, currency) {
    var r = rateText(m, currency, ' ');
    var st = { free: 'свободна', busy: 'занята', confirm: 'требует подтверждения' }[statusOf(m)];
    return 'Выбрать: ' + m.title + ', ' + (r ? r + ' за ' + m.unit : 'цена по запросу') + ', ' + st;
  }

  // Подпись позиции в списке «Выбранная техника»: «Экскаватор · 12 000 ₸/ч».
  function optionLabel(m, currency) {
    var r = rateText(m, currency);
    return nbspUnits(m.title) + ' · ' + (r ? r + '/' + unitShort(m.unit) : 'цена по запросу');
  }

  // Цена по формуле PROMPT_01 с разбивкой на аренду и доставку:
  //   units = max(введено, min_units ?? 1)
  //   аренда:   units × rate_from … units × (rate_to ?? rate_from)
  //   доставка: zone.delivery_from ?? 0 … zone.delivery_to ?? zone.delivery_from ?? 0
  // Занятая позиция → null. Без цены → суммы null (стоимость назовёт менеджер).
  function calcPrice(m, entered, zone) {
    if (!isSelectable(m)) return null;
    var min = minUnits(m);
    var n = Math.floor(Number(entered));
    if (!isFinite(n) || n < 0) n = 0;
    var units = Math.max(n, min);
    var res = { units: units, belowMin: n < min, rentLow: null, rentHigh: null, deliveryLow: 0, deliveryHigh: 0, low: null, high: null };
    if (zone) {
      res.deliveryLow = zone.delivery_from != null ? zone.delivery_from : 0;
      res.deliveryHigh = zone.delivery_to != null ? zone.delivery_to : res.deliveryLow;
    }
    if (m.rate_from == null) return res;
    res.rentLow = units * m.rate_from;
    res.rentHigh = units * (m.rate_to != null ? m.rate_to : m.rate_from);
    res.low = res.rentLow + res.deliveryLow;
    res.high = res.rentHigh + res.deliveryHigh;
    return res;
  }

  // Итог для показа; без цены — null.
  function priceText(p, currency, sep) {
    if (!p || p.low == null) return null;
    return moneyRange(p.low, p.high, currency, sep);
  }

  // ---------- Даты (всегда по местному времени устройства) ----------

  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var LATE_HOUR = 20;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Дата → «2026-10-28» по местному времени (не UTC).
  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // «Сегодня» / «Завтра» относительно now. Через setDate — корректно через конец месяца, года и 29 февраля.
  function dateFor(kind, now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
    return isoDate(d);
  }

  // Вечером подать технику «сегодня» могут не успеть — показываем подсказку.
  function isLate(now) {
    return now.getHours() >= LATE_HOUR;
  }

  // '2026-10-09' → '9 октября 2026 г. (пятница)'
  function formatDate(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' г. (' + WEEKDAYS[d.getDay()] + ')';
  }

  // ---------- Ввод пользователя ----------

  var LIMITS = { address: 200, comment: 500, name: 60, phone: 25 };

  function digitsOf(s) {
    return String(s || '').replace(/\D/g, '');
  }

  // Обрезка по символам (эмодзи и прочие пары UTF-16 не разрываются).
  function clip(s, max) {
    var chars = Array.from(String(s || ''));
    return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
  }

  function isWhatsapp(v) {
    return /^\d{10,15}$/.test(String(v || ''));
  }

  function isTelegram(v) {
    return /^[A-Za-z0-9_]{5,32}$/.test(String(v || ''));
  }

  // Первое незаполненное обязательное поле в порядке формы: [поле, подсказка] или null.
  // Имя и телефон необязательны; телефон, если введён, — не меньше 10 цифр.
  function validateOrder(o) {
    if (!o.machine || !isSelectable(o.machine)) return ['machine', 'Выберите технику'];
    if (!String(o.address || '').trim()) return ['address', 'Укажите адрес объекта'];
    if (!o.date) return ['date', 'Выберите дату начала работ'];
    if (o.date < o.today) return ['date', 'Эта дата уже прошла — выберите другую'];
    if (!(o.units >= minUnits(o.machine))) return ['units', 'Укажите количество'];
    if (o.hasZones && !o.zone) return ['zone', 'Выберите зону доставки'];
    var phone = digitsOf(o.phone);
    if (phone && phone.length < 10) return ['phone', 'Проверьте телефон: нужно не меньше 10 цифр — или оставьте поле пустым'];
    if (!o.consent) return ['consent', 'Отметьте согласие на обработку данных'];
    return null;
  }

  // ---------- Текст заявки и ссылки ----------

  // Текст заявки (порядок как в референсе). Строки без значения не выводятся.
  // Пробелы обычные: текст уходит в мессенджер.
  function buildMessage(o) {
    var p = calcPrice(o.machine, o.units, o.zone);
    var total = priceText(p, o.currency, ' ');
    var opt = function (v) { return String(v == null ? '' : v).trim(); };
    var lines = ['Здравствуйте! Хочу заказать спецтехнику.', '', 'Техника: ' + o.machine.title];
    if (statusOf(o.machine) === 'confirm') lines.push('Наличие: требует подтверждения');
    lines.push('Адрес: ' + opt(o.address).replace(/\s*\n\s*/g, ', '));
    lines.push('Дата: ' + formatDate(o.date));
    if (opt(o.time)) lines.push('Время подачи: ' + opt(o.time));
    lines.push('Продолжительность: ' + p.units + ' ' + plural(p.units, o.machine.unit));
    if (o.zone) lines.push('Зона доставки: ' + o.zone.title);
    if (total) lines.push('Предварительная стоимость: ' + total);
    if (opt(o.name)) lines.push('Имя: ' + opt(o.name));
    if (opt(o.phone)) lines.push('Телефон: ' + opt(o.phone));
    if (opt(o.comment)) lines.push('Комментарий: ' + opt(o.comment).replace(/\n{2,}/g, '\n'));
    return lines.join('\n');
  }

  // Ссылка «Открыть …» по главному каналу.
  // WhatsApp: wa.me/<номер>?text=… — чат с готовым текстом.
  // Telegram: t.me/<username>?text=… — по core.telegram.org/api/links («Public username links»)
  //   text подставляется в поле ввода; на всякий случай заявка ещё и копируется в буфер.
  function buildLink(text, c) {
    if (c.channel === 'whatsapp' && c.whatsapp) return 'https://wa.me/' + digitsOf(c.whatsapp) + '?text=' + encodeURIComponent(text);
    if (c.channel === 'telegram' && c.telegram) return 'https://t.me/' + c.telegram + '?text=' + encodeURIComponent(text);
    if (c.phone) return 'tel:+' + digitsOf(c.phone);
    return '';
  }

  // Предел длины ссылки. Кириллица в адресе занимает 6 символов на букву (%D0%9F), поэтому обычная заявка —
  // уже 1500–1900 символов, и классические 2000 обрезали бы почти любой комментарий. Браузеры телефонов и
  // мессенджеры принимают ссылки в десятки тысяч символов; 4000 — с большим запасом ниже пределов старых
  // WebView и прокси (около 8 КБ).
  var MAX_LINK = 4000;

  // Ссылка с заявкой, которая гарантированно открывается: если не помещается — сокращаем комментарий в ссылке
  // (полный текст при этом копируется в буфер, см. сайт). Возвращает { text, link, cut }.
  function buildOrderLink(o, c) {
    var full = buildMessage(o);
    var link = buildLink(full, c);
    if (link.length <= MAX_LINK || !String(o.comment || '').trim()) return { text: full, link: link, cut: false };
    var chars = Array.from(String(o.comment).trim());
    var lo = 0;
    var hi = chars.length;
    var best = buildLink(buildMessage(Object.assign({}, o, { comment: '' })), c);
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var short = (mid ? chars.slice(0, mid).join('') : '') + '… (полный комментарий пришлю следующим сообщением)';
      var candidate = buildLink(buildMessage(Object.assign({}, o, { comment: short })), c);
      if (candidate.length <= MAX_LINK) { best = candidate; lo = mid + 1; } else { hi = mid - 1; }
    }
    return { text: full, link: best, cut: true };
  }

  // «Поделиться через Telegram»: выбрать любой чат и отправить ссылку на страницу с текстом заявки.
  function buildShareLink(pageUrl, text) {
    return 'https://t.me/share/url?url=' + encodeURIComponent(pageUrl) + '&text=' + encodeURIComponent(text);
  }

  // Номер для шапки окна: 77011234567 → «+7 701 123 45 67».
  function formatPhone(raw) {
    var d = digitsOf(raw);
    if (d.length === 11) return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9);
    return '+' + d;
  }

  // ---------- Изменения владельца из демо-панели ----------

  // Изменения поверх данных конфига. Берутся только известные поля с проверкой.
  // Новая цена «от» без «до» снимает диапазон; «до» принимается, только если оно не меньше «от».
  function mergeOverrides(base, ov) {
    var data = JSON.parse(JSON.stringify(base));
    if (!ov || typeof ov !== 'object') return data;
    var byId = ov.machines && typeof ov.machines === 'object' ? ov.machines : {};
    var price = function (v) { return v === null || (typeof v === 'number' && isFinite(v) && v > 0); };
    data.machines.forEach(function (m) {
      var o = byId[m.id];
      if (!o || typeof o !== 'object') return;
      if (o.status === 'free' || o.status === 'busy' || o.status === 'confirm') m.status = o.status;
      var fromChanged = false;
      if ('rate_from' in o && price(o.rate_from) && o.rate_from !== m.rate_from) {
        m.rate_from = o.rate_from;
        fromChanged = true;
      }
      if ('rate_to' in o && price(o.rate_to) && (o.rate_to === null || (m.rate_from != null && o.rate_to >= m.rate_from))) {
        m.rate_to = o.rate_to;
      } else if (fromChanged || m.rate_from == null || (m.rate_to != null && m.rate_to < m.rate_from)) {
        m.rate_to = null;
      }
      if ('min_units' in o && (o.min_units === null || (Number.isInteger(o.min_units) && o.min_units > 0))) m.min_units = o.min_units;
    });
    if (isWhatsapp(ov.whatsapp)) data.whatsapp = ov.whatsapp;
    if (isTelegram(ov.telegram)) data.telegram = ov.telegram;
    if (ov.channel === 'whatsapp' && data.whatsapp) data.channel = 'whatsapp';
    if (ov.channel === 'telegram' && data.telegram) data.channel = 'telegram';
    return data;
  }

  var Calc = {
    pluralForms: pluralForms, plural: plural, qty: qty, fmtNum: fmtNum, nbspUnits: nbspUnits, unitShort: unitShort,
    minUnits: minUnits, quickUnits: quickUnits, statusOf: statusOf, isSelectable: isSelectable,
    moneyRange: moneyRange, rateText: rateText, minText: minText, optionLabel: optionLabel, cardLabel: cardLabel,
    calcPrice: calcPrice, priceText: priceText,
    isoDate: isoDate, dateFor: dateFor, isLate: isLate, formatDate: formatDate,
    LIMITS: LIMITS, MAX_LINK: MAX_LINK, digitsOf: digitsOf, clip: clip, isWhatsapp: isWhatsapp, isTelegram: isTelegram,
    validateOrder: validateOrder, buildMessage: buildMessage, buildLink: buildLink, buildOrderLink: buildOrderLink,
    buildShareLink: buildShareLink, formatPhone: formatPhone, mergeOverrides: mergeOverrides,
  };

  if (typeof module === 'object' && module.exports) module.exports = Calc;
  if (typeof document === 'undefined') return;

  // ---------- Данные компании (data-слой) ----------
  // Демо-режим: изменения владельца лежат в localStorage этого браузера.
  // В рабочей версии (после первой оплаты) поменяется только этот блок: Store будет ходить на сервер.

  var STORE_PREFIX = 'specsite-demo:';
  var Store = {
    available: function () {
      try {
        localStorage.setItem(STORE_PREFIX + 'test', '1');
        localStorage.removeItem(STORE_PREFIX + 'test');
        return true;
      } catch (e) { return false; }
    },
    load: function (slug) {
      try { var raw = localStorage.getItem(STORE_PREFIX + slug); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    },
    save: function (slug, ov) {
      try { localStorage.setItem(STORE_PREFIX + slug, JSON.stringify(ov)); return true; } catch (e) { return false; }
    },
    clear: function (slug) {
      try { localStorage.removeItem(STORE_PREFIX + slug); return true; } catch (e) { return false; }
    },
  };

  function baseData() {
    var el = document.getElementById('site-data');
    return el ? JSON.parse(el.textContent) : null;
  }

  // Единственная точка входа к данным: конфиг (встроен при сборке) + изменения владельца.
  function getCompanyData() {
    var base = baseData();
    return base ? mergeOverrides(base, Store.load(base.slug)) : null;
  }

  window.SiteData = { Calc: Calc, Store: Store, baseData: baseData, getCompanyData: getCompanyData };
})();
