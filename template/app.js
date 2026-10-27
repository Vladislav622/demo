// Выбор техники, форма заказа, цена и заявка.
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

  var Calc = { plural: plural, qty: qty, fmtNum: fmtNum, minUnits: minUnits };

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
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

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

  function humanDate(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return p[2] + '.' + p[1] + '.' + p[0] + ' (' + WEEKDAYS[d.getDay()] + ')';
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
    var min = minUnits(state.machine);
    if (n < min) {
      n = min;
      unitsHint.textContent = 'минимальный заказ — ' + qty(min, state.machine.unit);
      unitsHint.hidden = false;
    } else {
      unitsHint.hidden = true;
    }
    state.units = n;
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

  function priceParts() {
    var m = state.machine;
    if (m.rate_from == null) return { main: 'Цену назовёт менеджер', note: '' };
    // Ориентир rate_from × объём. Диапазон и доставка — шаг 4.
    return { main: 'от ' + fmtNum(m.rate_from * state.units) + ' ' + data.currency, note: 'предварительно' };
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
    var sumUnits = $('#sum-units');
    if (sumUnits) sumUnits.textContent = qty(state.units, m.unit);
    var sumDate = $('#sum-date');
    if (sumDate) sumDate.textContent = state.date ? humanDate(state.date) : '—';
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

  function firstProblem() {
    if (!state.date) return ['date', 'Выберите дату'];
    if (data.zones.length && state.zone === null) return ['zone', 'Выберите зону доставки'];
    if (!$('#address').value.trim()) return ['address', 'Укажите адрес'];
    if ($('#client_phone').value.replace(/\D/g, '').length < 10) return ['phone', 'Укажите телефон — минимум 10 цифр'];
    if (!$('#consent').checked) return ['consent', 'Нужно согласие на обработку данных'];
    return null;
  }

  $$('.js-submit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var problem = firstProblem();
      if (problem) {
        showError(problem[0], problem[1]);
        var f = fieldEl(problem[0]);
        f.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
        var input = $('input:not([hidden]), button.chip', f);
        if (input) input.focus({ preventScroll: true });
        return;
      }
      // Всё заполнено. Формирование текста и переход на wa.me — шаг 4.
    });
  });
})();
