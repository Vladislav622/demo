// Выбор техники, форма заказа, цена и заявка в WhatsApp.
// Чистые функции (Calc) доступны и в Node: их используют build.js и tests/price.test.js.

(function () {
  'use strict';

  // ---------- Чистые функции ----------

  var UNIT_FORMS = {
    'час': ['час', 'часа', 'часов'],
    'смена': ['смена', 'смены', 'смен'],
    'день': ['день', 'дня', 'дней'],
    'рейс': ['рейс', 'рейса', 'рейсов'],
  };

  // Форма единицы для числа: 1 час, 2 часа, 5 часов, 11 часов, 21 час. Неизвестная единица — как есть.
  function plural(n, unit) {
    var forms = UNIT_FORMS[unit];
    if (!forms) return unit;
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a >= 11 && a <= 14) return forms[2];
    if (b === 1) return forms[0];
    if (b >= 2 && b <= 4) return forms[1];
    return forms[2];
  }

  function qty(n, unit) {
    return n + ' ' + plural(n, unit);
  }

  // 25000 → «25 000». По умолчанию неразрывный пробел, чтобы число не переносилось.
  function fmtNum(n, sep) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep === undefined ? ' ' : sep);
  }

  function minUnits(m) {
    return m && m.min_units ? m.min_units : 1;
  }

  // Цена по формуле PROMPT_01:
  //   units = max(введено, min_units ?? 1)
  //   low   = units × rate_from + (zone.delivery_from ?? 0)
  //   high  = units × (rate_to ?? rate_from) + (zone.delivery_to ?? zone.delivery_from ?? 0)
  // Занятая позиция → null. Без цены → low/high = null (стоимость назовёт менеджер).
  function calcPrice(m, entered, zone) {
    if (!m || m.available === false) return null;
    var min = minUnits(m);
    var n = Math.floor(Number(entered));
    if (!isFinite(n) || n < 0) n = 0;
    var res = { units: Math.max(n, min), belowMin: n < min, low: null, high: null };
    if (m.rate_from == null) return res;
    var from = zone && zone.delivery_from != null ? zone.delivery_from : 0;
    var to = zone && zone.delivery_to != null ? zone.delivery_to : from;
    res.low = res.units * m.rate_from + from;
    res.high = res.units * (m.rate_to != null ? m.rate_to : m.rate_from) + to;
    return res;
  }

  // «72 000–98 000 ₸»; если low == high — «от 48 000 ₸». Без цены — null.
  function priceText(p, currency, sep) {
    if (!p || p.low == null) return null;
    if (p.low === p.high) return 'от ' + fmtNum(p.low, sep) + ' ' + currency;
    return fmtNum(p.low, sep) + '–' + fmtNum(p.high, sep) + ' ' + currency;
  }

  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  // '2026-10-28' → '28.10.2026 (среда)'
  function formatDate(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return p[2] + '.' + p[1] + '.' + p[0] + ' (' + WEEKDAYS[d.getDay()] + ')';
  }

  function digitsOf(s) {
    return String(s || '').replace(/\D/g, '');
  }

  // Первое незаполненное обязательное поле: [поле, подсказка] или null.
  function validateOrder(o) {
    if (!o.machine || o.machine.available === false) return ['machine', 'Выберите свободную технику'];
    if (!(o.units >= minUnits(o.machine))) return ['units', 'Укажите объём'];
    if (!o.date || o.date < o.today) return ['date', 'Выберите дату'];
    if (o.hasZones && !o.zone) return ['zone', 'Выберите зону доставки'];
    if (!String(o.address || '').trim()) return ['address', 'Укажите адрес'];
    if (digitsOf(o.phone).length < 10) return ['phone', 'Укажите телефон — минимум 10 цифр'];
    if (!o.consent) return ['consent', 'Нужно согласие на обработку данных'];
    return null;
  }

  // Текст заявки по шаблону PROMPT_01. Пустые необязательные строки не выводятся.
  function buildMessage(o) {
    var p = calcPrice(o.machine, o.units, o.zone);
    var range = priceText(p, o.currency, ' ');
    var name = String(o.name || '').trim();
    var comment = String(o.comment || '').trim();
    var lines = [
      'Здравствуйте! Заявка с сайта.',
      'Техника: ' + o.machine.title,
      'Объём: ' + qty(p.units, o.machine.unit),
      'Дата: ' + formatDate(o.date),
      'Адрес: ' + String(o.address).trim(),
    ];
    if (o.zone) lines.push('Зона: ' + o.zone.title);
    if (range) lines.push('Ориентир: ' + range + ' (предварительно)');
    if (name) lines.push('Имя: ' + name);
    lines.push('Телефон: ' + String(o.phone).trim());
    if (comment) lines.push('Комментарий: ' + comment);
    return lines.join('\n');
  }

  // Ссылка для кнопки: wa.me с готовым текстом, без WhatsApp — звонок.
  function buildLink(text, whatsapp, phone) {
    if (whatsapp) return 'https://wa.me/' + digitsOf(whatsapp) + '?text=' + encodeURIComponent(text);
    if (phone) return 'tel:+' + digitsOf(phone);
    return '';
  }

  var Calc = {
    plural: plural, qty: qty, fmtNum: fmtNum, minUnits: minUnits, calcPrice: calcPrice, priceText: priceText,
    formatDate: formatDate, validateOrder: validateOrder, buildMessage: buildMessage, buildLink: buildLink,
  };

  if (typeof module === 'object' && module.exports) module.exports = Calc;
  if (typeof document === 'undefined') return;

  // ---------- Страница ----------

  var dataEl = document.getElementById('site-data');
  if (!dataEl) return;
  var data = JSON.parse(dataEl.textContent);

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scrollBehavior = reduceMotion ? 'auto' : 'smooth';

  var QUICK_HOURS = [4, 8, 16];

  var state = { machine: null, units: 1, date: '', zone: null };

  var orderEl = $('#order');
  var barEl = $('#bar');
  var unitsOut = $('#units-out');
  var unitsMinus = $('#units-minus');
  var unitsChips = $('#units-chips');
  var unitsHint = $('#units-hint');
  var dateInput = $('#date');
  var commentToggle = $('#comment-toggle');
  var comment = $('#comment');

  function isoDate(d) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Высота закреплённой плашки и шапки — для scroll-margin и sticky-карточки заказа.
  function measureSticky() {
    var h = $('.sticky').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sticky-h', Math.round(h) + 'px');
  }
  measureSticky();
  window.addEventListener('resize', measureSticky);

  // ---------- Выбор техники ----------

  function select(id) {
    var m = data.machines.find(function (x) { return x.id === id; });
    if (!m || !m.available) return;
    state.machine = m;
    state.units = minUnits(m);

    $$('.mc').forEach(function (card) {
      var on = card.dataset.id === id;
      card.setAttribute('aria-pressed', String(on));
      if (!card.disabled) $('.mc__cta-text', card).textContent = on ? 'Выбрано' : 'Выбрать';
    });

    var visual = $('.mc[data-id="' + id + '"] .mc__media').querySelector('img, svg');
    $$('.js-picked-media').forEach(function (box) {
      box.innerHTML = '';
      if (visual) {
        var copy = visual.cloneNode(true);
        copy.removeAttribute('loading');
        box.appendChild(copy);
      }
    });
    $$('.js-picked-title').forEach(function (el) { el.textContent = m.title; });

    unitsHint.hidden = true;
    renderUnitChips();
    renderUnits();

    var firstTime = orderEl.hidden;
    orderEl.hidden = false;
    barEl.hidden = false;
    document.body.classList.add('has-bar');
    renderSummary();
    if (firstTime || orderEl.getBoundingClientRect().top > window.innerHeight * 0.6) {
      orderEl.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
    }
  }

  $$('.mc').forEach(function (card) {
    card.addEventListener('click', function () {
      if (!card.disabled) select(card.dataset.id);
    });
  });

  // ---------- Объём ----------

  function renderUnitChips() {
    var m = state.machine;
    unitsChips.innerHTML = '';
    if (!m || m.unit !== 'час') return;
    QUICK_HOURS.filter(function (h) { return h >= minUnits(m); }).forEach(function (h) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.units = String(h);
      b.textContent = qty(h, m.unit);
      b.addEventListener('click', function () { setUnits(h); });
      unitsChips.appendChild(b);
    });
  }

  function setUnits(n) {
    var p = calcPrice(state.machine, n, null);
    unitsHint.textContent = 'минимальный заказ — ' + qty(minUnits(state.machine), state.machine.unit);
    unitsHint.hidden = !p.belowMin;
    state.units = p.units;
    renderUnits();
  }

  function renderUnits() {
    var m = state.machine;
    if (!m) return;
    unitsOut.textContent = qty(state.units, m.unit);
    unitsMinus.disabled = state.units <= minUnits(m);
    $$('.chip', unitsChips).forEach(function (c) {
      c.setAttribute('aria-pressed', String(Number(c.dataset.units) === state.units));
    });
    renderSummary();
  }

  unitsMinus.addEventListener('click', function () { setUnits(state.units - 1); });
  $('#units-plus').addEventListener('click', function () { setUnits(state.units + 1); });

  // ---------- Дата ----------

  dateInput.min = isoDate(new Date());

  $$('[data-date]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('[data-date]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      var kind = chip.dataset.date;
      if (kind === 'other') {
        dateInput.hidden = false;
        state.date = dateInput.value >= dateInput.min ? dateInput.value : '';
        dateInput.focus();
        if (dateInput.showPicker) { try { dateInput.showPicker(); } catch (e) { /* не везде доступно */ } }
      } else {
        dateInput.hidden = true;
        var d = new Date();
        if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
        state.date = isoDate(d);
      }
      if (state.date) clearError('date');
      renderSummary();
    });
  });

  dateInput.addEventListener('change', function () {
    state.date = dateInput.value >= dateInput.min ? dateInput.value : '';
    if (state.date) clearError('date');
    renderSummary();
  });

  // ---------- Зона ----------

  $$('[data-zone]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('[data-zone]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      state.zone = Number(chip.dataset.zone);
      clearError('zone');
      renderSummary();
    });
  });

  // ---------- Комментарий ----------

  commentToggle.addEventListener('click', function () {
    comment.hidden = false;
    commentToggle.hidden = true;
    commentToggle.setAttribute('aria-expanded', 'true');
    comment.focus();
  });

  // ---------- Цена: нижняя панель и «Ваш заказ» ----------

  function currentZone() {
    return state.zone === null ? null : data.zones[state.zone];
  }

  function priceParts() {
    var text = priceText(calcPrice(state.machine, state.units, currentZone()), data.currency);
    return text ? { main: text, note: 'предварительно' } : { main: 'Цену назовёт менеджер', note: '' };
  }

  function renderSummary() {
    var m = state.machine;
    if (!m) return;
    var p = priceParts();
    $$('.js-price').forEach(function (el) {
      el.textContent = p.main;
      if (p.note) {
        var small = document.createElement('small');
        small.textContent = p.note;
        el.appendChild(small);
      }
    });
    // Панель может вырасти (длинный диапазон) — отступ снизу страницы подстраиваем под неё.
    if (!barEl.hidden && barEl.offsetHeight) {
      document.documentElement.style.setProperty('--bar-h', barEl.offsetHeight + 'px');
    }
    var sumUnits = $('#sum-units');
    if (sumUnits) sumUnits.textContent = qty(state.units, m.unit);
    var sumDate = $('#sum-date');
    if (sumDate) sumDate.textContent = state.date ? formatDate(state.date) : '—';
    var sumZone = $('#sum-zone');
    if (sumZone) sumZone.textContent = state.zone === null ? '—' : data.zones[state.zone].title;
  }

  // ---------- Проверка полей ----------

  function fieldEl(name) {
    return $('[data-field="' + name + '"]');
  }

  function showError(name, text) {
    var f = fieldEl(name);
    f.classList.add('is-invalid');
    var err = $('.err', f);
    err.textContent = text;
    err.hidden = false;
  }

  function clearError(name) {
    var f = fieldEl(name);
    if (!f) return;
    f.classList.remove('is-invalid');
    var err = $('.err', f);
    if (err) err.hidden = true;
  }

  [['address', '#address'], ['phone', '#client_phone']].forEach(function (pair) {
    $(pair[1]).addEventListener('input', function () { clearError(pair[0]); });
  });
  $('#consent').addEventListener('change', function () { clearError('consent'); });

  function order() {
    return {
      machine: state.machine,
      units: state.units,
      date: state.date,
      today: isoDate(new Date()),
      hasZones: data.zones.length > 0,
      zone: currentZone(),
      address: $('#address').value,
      name: $('#client_name').value,
      phone: $('#client_phone').value,
      comment: comment.hidden ? '' : comment.value,
      consent: $('#consent').checked,
      currency: data.currency,
    };
  }

  $$('.js-submit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var o = order();
      var problem = validateOrder(o);
      if (problem && (problem[0] === 'machine' || problem[0] === 'units')) {
        $('#choose').scrollIntoView({ behavior: scrollBehavior, block: 'start' });
        return;
      }
      if (problem) {
        showError(problem[0], problem[1]);
        var f = fieldEl(problem[0]);
        f.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
        var input = $('input:not([hidden]), button.chip', f);
        if (input) input.focus({ preventScroll: true });
        return;
      }
      // Переход в той же вкладке: window.open на телефоне блокируется.
      var link = buildLink(buildMessage(o), data.whatsapp, data.phone);
      if (link) window.location.href = link;
    });
  });
})();
