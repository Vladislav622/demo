// Каталог, расчёт аренды и заявка.
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

  // Статус позиции: free | busy | confirm. Старые конфиги: available true → free, false → busy.
  function statusOf(m) {
    if (!m) return 'busy';
    if (m.status === 'free' || m.status === 'busy' || m.status === 'confirm') return m.status;
    return m.available === false ? 'busy' : 'free';
  }

  function isSelectable(m) {
    return statusOf(m) !== 'busy';
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

  // Точная сумма «30 600 ₸» или диапазон «48 000–60 000 ₸».
  function moneyRange(lo, hi, currency, sep) {
    if (lo === hi) return fmtNum(lo, sep) + ' ' + currency;
    return fmtNum(lo, sep) + '–' + fmtNum(hi, sep) + ' ' + currency;
  }

  // Итог для показа; без цены — null.
  function priceText(p, currency, sep) {
    if (!p || p.low == null) return null;
    return moneyRange(p.low, p.high, currency, sep);
  }

  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // '2026-10-09' → '9 октября 2026 г. (пятница)'
  function formatDate(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' г. (' + WEEKDAYS[d.getDay()] + ')';
  }

  function digitsOf(s) {
    return String(s || '').replace(/\D/g, '');
  }

  // Первое незаполненное обязательное поле в порядке формы: [поле, подсказка] или null.
  // Имя и телефон необязательны; телефон, если введён, — не меньше 10 цифр.
  function validateOrder(o) {
    if (!o.machine || !isSelectable(o.machine)) return ['machine', 'Выберите технику'];
    if (!String(o.address || '').trim()) return ['address', 'Укажите адрес объекта'];
    if (!o.date || o.date < o.today) return ['date', 'Выберите дату начала работ'];
    if (!(o.units >= minUnits(o.machine))) return ['units', 'Укажите количество'];
    if (o.hasZones && !o.zone) return ['zone', 'Выберите зону доставки'];
    var phone = digitsOf(o.phone);
    if (phone && phone.length < 10) return ['phone', 'Проверьте телефон — минимум 10 цифр, или оставьте поле пустым'];
    if (!o.consent) return ['consent', 'Нужно согласие на обработку данных'];
    return null;
  }

  // Текст заявки (порядок как в референсе). Строки без значения не выводятся.
  function buildMessage(o) {
    var p = calcPrice(o.machine, o.units, o.zone);
    var total = priceText(p, o.currency, ' ');
    var opt = function (v) { return String(v || '').trim(); };
    var lines = ['Здравствуйте! Хочу заказать спецтехнику.', '', 'Техника: ' + o.machine.title];
    if (statusOf(o.machine) === 'confirm') lines.push('Наличие: требует подтверждения');
    lines.push('Адрес: ' + opt(o.address));
    lines.push('Дата: ' + formatDate(o.date));
    if (opt(o.time)) lines.push('Время подачи: ' + opt(o.time));
    lines.push('Продолжительность: ' + qty(p.units, o.machine.unit));
    if (o.zone) lines.push('Зона доставки: ' + o.zone.title);
    if (total) lines.push('Предварительная стоимость: ' + total);
    if (opt(o.name)) lines.push('Имя: ' + opt(o.name));
    if (opt(o.phone)) lines.push('Телефон: ' + opt(o.phone));
    if (opt(o.comment)) lines.push('Комментарий: ' + opt(o.comment));
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

  // «Поделиться через Telegram»: выбрать любой чат и отправить ссылку на страницу с текстом заявки.
  function buildShareLink(pageUrl, text) {
    return 'https://t.me/share/url?url=' + encodeURIComponent(pageUrl) + '&text=' + encodeURIComponent(text);
  }

  // Номер для шапки окна: 77000000000 → «+7 700 000 00 00».
  function formatPhone(raw) {
    var d = digitsOf(raw);
    if (d.length === 11) return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9);
    return '+' + d;
  }

  var Calc = {
    pluralForms: pluralForms, plural: plural, qty: qty, fmtNum: fmtNum, minUnits: minUnits,
    statusOf: statusOf, isSelectable: isSelectable, calcPrice: calcPrice, moneyRange: moneyRange, priceText: priceText,
    formatDate: formatDate, validateOrder: validateOrder, buildMessage: buildMessage, buildLink: buildLink,
    buildShareLink: buildShareLink, formatPhone: formatPhone,
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

  var state = { machine: null, units: 0, date: '', zone: null };

  var barEl = $('#bar');
  var machineSelect = $('#machine');
  var zoneSelect = $('#zone');
  var unitsOut = $('#units-out');
  var unitsMinus = $('#units-minus');
  var unitsPlus = $('#units-plus');
  var unitsChips = $('#units-chips');
  var unitsHint = $('#units-hint');
  var dateInput = $('#date');
  var dateOther = $('#date-other');

  function isoDate(d) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Высота закреплённой плашки и шапки — для scroll-margin и sticky-карточки расчёта.
  function measureSticky() {
    var h = $('.sticky').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--sticky-h', Math.round(h) + 'px');
  }
  measureSticky();
  window.addEventListener('resize', measureSticky);

  // ---------- Лента каталога на телефоне: счётчик «1 / 8» и точки ----------

  var park = $('#park');
  var cards = $$('.mc', park);
  var counter = $('#park-counter');
  var dotsBox = $('#park-dots');
  var MAX_DOTS = 8;
  // Точка i ведёт на карточку dotTarget[i]; карточек больше 8 — точки распределяются равномерно.
  var dotCount = Math.min(cards.length, MAX_DOTS);
  var dotTarget = [];
  for (var d = 0; d < dotCount; d++) {
    dotTarget.push(dotCount === 1 ? 0 : Math.round(d * (cards.length - 1) / (dotCount - 1)));
  }

  function scrollToCard(i) {
    var card = cards[i];
    park.scrollTo({ left: card.offsetLeft - park.offsetLeft - 16, behavior: scrollBehavior });
  }

  dotTarget.forEach(function (target, i) {
    var dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', 'Техника ' + (target + 1) + ' из ' + cards.length);
    dot.addEventListener('click', function () { scrollToCard(target); });
    dotsBox.appendChild(dot);
  });

  function setCurrent(i) {
    counter.textContent = (i + 1) + ' / ' + cards.length;
    var nearest = 0;
    dotTarget.forEach(function (t, k) { if (Math.abs(t - i) < Math.abs(dotTarget[nearest] - i)) nearest = k; });
    $$('button', dotsBox).forEach(function (b, k) { b.setAttribute('aria-current', String(k === nearest)); });
  }
  setCurrent(0);

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setCurrent(cards.indexOf(e.target));
      });
    }, { root: park, threshold: 0.6 });
    cards.forEach(function (c) { io.observe(c); });
  }

  // ---------- Выбор техники: карточки ⇄ select ----------

  // На узком экране в списке только название — цена видна в итоговой карточке.
  var narrow = window.matchMedia('(max-width: 559px)');
  function optionLabels() {
    $$('option[data-full]', machineSelect).forEach(function (o) {
      o.textContent = narrow.matches ? o.dataset.short : o.dataset.full;
    });
  }
  optionLabels();
  if (narrow.addEventListener) narrow.addEventListener('change', optionLabels);

  function select(id, fromCard) {
    var m = data.machines.find(function (x) { return x.id === id; }) || null;
    if (m && !isSelectable(m)) return;
    state.machine = m;
    if (m) state.units = Math.max(state.units, minUnits(m));

    $$('.mc').forEach(function (card) {
      var on = Boolean(m) && card.dataset.id === m.id;
      card.classList.toggle('is-selected', on);
      var btn = $('.mc__btn', card);
      if (btn.disabled) return;
      btn.setAttribute('aria-pressed', String(on));
      $('.mc__btn-text', btn).textContent = on ? 'Техника выбрана' : 'Выбрать';
    });
    machineSelect.value = m ? m.id : '';
    if (m) clearError('machine');

    unitsHint.hidden = true;
    renderUnitChips();
    renderUnits();

    if (m) {
      barEl.hidden = false;
      document.body.classList.add('has-bar');
    }
    renderSummary();
    if (fromCard && m) $('#calc').scrollIntoView({ behavior: scrollBehavior, block: 'start' });
  }

  $$('.mc').forEach(function (card) {
    if (card.dataset.status === 'busy') return;
    card.addEventListener('click', function () { select(card.dataset.id, true); });
  });
  machineSelect.addEventListener('change', function () { select(machineSelect.value, false); });

  // ---------- Количество ----------

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
    if (!state.machine) return;
    var p = calcPrice(state.machine, n, null);
    unitsHint.textContent = 'минимальный заказ — ' + qty(minUnits(state.machine), state.machine.unit);
    unitsHint.hidden = !p.belowMin;
    state.units = p.units;
    clearError('units');
    renderUnits();
  }

  function renderUnits() {
    var m = state.machine;
    $('#units-label').textContent = !m || m.unit === 'час' ? 'Количество часов' : 'Количество (' + plural(5, m.unit) + ')';
    unitsOut.textContent = m ? qty(state.units, m.unit) : '—';
    unitsMinus.disabled = !m || state.units <= minUnits(m);
    unitsPlus.disabled = !m;
    $$('.chip', unitsChips).forEach(function (c) {
      c.setAttribute('aria-pressed', String(Number(c.dataset.units) === state.units));
    });
    renderSummary();
  }

  unitsMinus.addEventListener('click', function () { setUnits(state.units - 1); });
  unitsPlus.addEventListener('click', function () { setUnits(state.units + 1); });

  // ---------- Дата ----------

  dateInput.min = isoDate(new Date());

  // kind: today | tomorrow | other — какой чип нажат.
  function setDate(iso, kind) {
    state.date = iso && iso >= dateInput.min ? iso : '';
    dateInput.value = state.date;
    dateOther.hidden = kind !== 'other';
    $$('[data-date]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.date === kind)); });
    if (state.date) clearError('date');
  }

  $$('[data-date]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var kind = chip.dataset.date;
      if (kind === 'other') {
        setDate(dateInput.value, 'other');
        dateInput.focus();
        if (dateInput.showPicker) { try { dateInput.showPicker(); } catch (e) { /* не везде доступно */ } }
        return;
      }
      var d = new Date();
      if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
      setDate(isoDate(d), kind);
    });
  });
  dateInput.addEventListener('change', function () { setDate(dateInput.value, 'other'); });

  // ---------- Зона ----------

  if (zoneSelect) {
    zoneSelect.addEventListener('change', function () {
      state.zone = zoneSelect.value === '' ? null : Number(zoneSelect.value);
      if (state.zone !== null) clearError('zone');
      renderSummary();
    });
  }

  function currentZone() {
    return state.zone === null ? null : data.zones[state.zone];
  }

  // ---------- Итоговая стоимость и нижняя панель ----------

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderSummary() {
    var m = state.machine;
    var zone = currentZone();
    var p = m ? calcPrice(m, state.units, zone) : null;
    var hasPrice = Boolean(p && p.low != null);

    setText('sum-machine', m ? m.title : '—');
    setText('sum-units', m ? qty(state.units, m.unit) : '—');
    $$('.js-cost-row').forEach(function (row) { row.hidden = Boolean(m) && !hasPrice; });
    setText('sum-rent', hasPrice ? moneyRange(p.rentLow, p.rentHigh, data.currency) : '—');
    setText('sum-delivery-label', zone ? 'Доставка: ' + zone.title : 'Доставка');
    setText('sum-delivery', zone && p ? moneyRange(p.deliveryLow, p.deliveryHigh, data.currency) : '—');

    var total = !m ? 'Выберите технику' : hasPrice ? priceText(p, data.currency) : 'назовёт менеджер';
    $$('.js-total').forEach(function (el) {
      el.textContent = total;
      el.classList.toggle('is-text', !hasPrice);
      el.classList.toggle('is-range', hasPrice && p.low !== p.high);
    });
    $('#sum-pre').hidden = !hasPrice;
    $('#bar-pre').hidden = !hasPrice;

    // Панель может вырасти — отступ снизу страницы подстраиваем под неё.
    if (!barEl.hidden && barEl.offsetHeight) {
      document.documentElement.style.setProperty('--bar-h', barEl.offsetHeight + 'px');
    }
  }

  // ---------- Проверка полей и отправка ----------

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

  $('#address').addEventListener('input', function () { clearError('address'); });
  $('#client_phone').addEventListener('input', function () { clearError('phone'); });
  $('#consent').addEventListener('change', function () { clearError('consent'); });

  function order() {
    return {
      machine: state.machine,
      units: state.units,
      date: state.date,
      time: $('#time').value,
      today: isoDate(new Date()),
      hasZones: data.zones.length > 0,
      zone: currentZone(),
      address: $('#address').value,
      name: $('#client_name').value,
      phone: $('#client_phone').value,
      comment: $('#comment').value,
      consent: $('#consent').checked,
      currency: data.currency,
    };
  }

  $$('.js-submit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var o = order();
      var problem = validateOrder(o);
      if (problem) {
        showError(problem[0], problem[1]);
        var f = fieldEl(problem[0]);
        f.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
        var control = $('select, input:not([type="hidden"]), button', f);
        if (control && control.closest('[hidden]')) control = $('button', f);
        if (control) control.focus({ preventScroll: true });
        return;
      }
      // Без мессенджеров — сразу звонок; иначе окно с готовой заявкой.
      if (data.channel === 'phone') {
        var tel = buildLink('', data);
        if (tel) window.location.href = tel;
        return;
      }
      openSheet(buildMessage(o), btn);
    });
  });

  // ---------- Окно «Заявка для WhatsApp / Telegram» ----------

  var sheet = $('#sheet');
  var sheetPanel = $('.sheet__panel', sheet);
  var sheetText = $('#sheet-text');
  var sheetArea = $('#sheet-area');
  var sheetHint = $('#sheet-hint');
  var copyBtn = $('#sheet-copy');
  var copyLabel = $('.js-copy-label', copyBtn);
  var openBtn = $('#sheet-open');
  var shareLink = $('#sheet-share');
  var sheetOpener = null;
  var currentText = '';
  var copiedTimer = 0;

  if (data.channel === 'telegram') $('#sheet-sub').textContent = '@' + data.telegram;
  if (data.channel === 'whatsapp') $('#sheet-sub').textContent = formatPhone(data.whatsapp);

  function focusables() {
    return $$('button, a[href], textarea:not([tabindex="-1"])', sheetPanel).filter(function (el) { return el.getClientRects().length; });
  }

  function openSheet(text, opener) {
    currentText = text;
    sheetOpener = opener;
    sheetText.textContent = text;
    sheetArea.value = text;
    sheetHint.hidden = true;
    if (shareLink) shareLink.href = buildShareLink(location.href.split('#')[0], text);
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    copyBtn.focus();
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    if (sheetOpener) sheetOpener.focus({ preventScroll: true });
  }

  // Копирование: Clipboard API, запасной вариант — выделить текст в скрытом поле и execCommand.
  function copyText() {
    var done = function () {
      copyLabel.textContent = 'Скопировано ✓';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(function () { copyLabel.textContent = 'Скопировать заявку'; }, 2000);
      return true;
    };
    var fallback = function () {
      sheetArea.hidden = false;
      sheetArea.focus();
      sheetArea.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      sheetArea.hidden = true;
      copyBtn.focus();
      return ok ? done() : false;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(currentText).then(done, fallback);
    }
    return Promise.resolve(fallback());
  }

  copyBtn.addEventListener('click', copyText);

  openBtn.addEventListener('click', function () {
    var link = buildLink(currentText, data);
    if (data.channel === 'telegram') {
      // Перед открытием Telegram заявка уже в буфере — её можно просто вставить в чат.
      copyText();
      sheetHint.hidden = false;
      setTimeout(function () { window.location.href = link; }, 600);
      return;
    }
    // Переход в той же вкладке: window.open на телефоне блокируется.
    window.location.href = link;
  });

  $$('[data-close]', sheet).forEach(function (el) { el.addEventListener('click', closeSheet); });

  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    // Фокус не выходит из окна.
    var list = focusables();
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  renderUnits();
})();
