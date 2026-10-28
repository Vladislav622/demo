// Страница компании: каталог, расчёт аренды и заявка. Данные и расчёт — из core.js (window.SiteData).

(function () {
  'use strict';

  var S = window.SiteData;
  if (!S || document.body.getAttribute('data-page') !== 'site') return;
  var C = S.Calc;

  var data = S.getCompanyData();
  if (!data) return;
  var hasOverrides = Boolean(S.Store.load(data.slug));

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scrollBehavior = reduceMotion ? 'auto' : 'smooth';

  var state = { machine: null, units: 0, date: '', dateKind: '', zone: null };
  var draftReady = false; // до восстановления черновика его не перезаписываем

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
  var dateHint = $('#date-hint');
  var comment = $('#comment');
  var commentCount = $('#comment-count');

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

  if (counter && dotsBox && cards.length > 1) {
    // Точка i ведёт на карточку dotTarget[i]; карточек больше 8 — точки распределяются равномерно.
    var dotCount = Math.min(cards.length, MAX_DOTS);
    var dotTarget = [];
    for (var d = 0; d < dotCount; d++) dotTarget.push(Math.round(d * (cards.length - 1) / (dotCount - 1)));

    var scrollToCard = function (i) {
      park.scrollTo({ left: cards[i].offsetLeft - park.offsetLeft - 16, behavior: scrollBehavior });
    };

    dotTarget.forEach(function (target) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Показать технику ' + (target + 1) + ' из ' + cards.length);
      dot.addEventListener('click', function () { scrollToCard(target); });
      dotsBox.appendChild(dot);
    });

    var setCurrent = function (i) {
      counter.textContent = (i + 1) + ' / ' + cards.length;
      var nearest = 0;
      dotTarget.forEach(function (t, k) { if (Math.abs(t - i) < Math.abs(dotTarget[nearest] - i)) nearest = k; });
      $$('button', dotsBox).forEach(function (b, k) { b.setAttribute('aria-current', String(k === nearest)); });
    };
    setCurrent(0);

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) setCurrent(cards.indexOf(e.target)); });
      }, { root: park, threshold: 0.6 });
      cards.forEach(function (c) { io.observe(c); });
    }
  }

  // ---------- Изменения из панели владельца: перерисовать карточки, список и канал ----------

  var CH = {
    whatsapp: { label: 'Написать в WhatsApp', send: 'Отправить заявку в WhatsApp', sheet: 'Заявка для WhatsApp', open: 'Открыть WhatsApp' },
    telegram: { label: 'Написать в Telegram', send: 'Отправить заявку в Telegram', sheet: 'Заявка для Telegram', open: 'Открыть Telegram' },
  };

  function channelHref(dd, text) {
    var q = text ? '?text=' + encodeURIComponent(text) : '';
    if (dd.channel === 'telegram') return 'https://t.me/' + dd.telegram + q;
    if (dd.channel === 'whatsapp') return 'https://wa.me/' + C.digitsOf(dd.whatsapp) + q;
    return 'tel:+' + C.digitsOf(dd.phone);
  }

  function renderPrice(el, m) {
    el.textContent = '';
    var b = document.createElement('b');
    var r = C.rateText(m, data.currency);
    var min = C.minText(m);
    if (r) {
      b.textContent = r;
      el.appendChild(b);
      el.appendChild(document.createTextNode(' /' + m.unit + (min ? ' · ' + min : '')));
    } else {
      b.className = 'mc__ask';
      b.textContent = 'Цена по запросу';
      el.appendChild(b);
      if (min) el.appendChild(document.createTextNode(' · ' + min));
    }
  }

  // Все позиции заняты — вместо расчёта сообщение и кнопка связи.
  function renderAllBusy(dd) {
    var none = !dd.machines.some(C.isSelectable);
    $('#calc-body').hidden = none;
    $('#allbusy').hidden = !none;
    if (none) {
      barEl.hidden = true;
      document.body.classList.remove('has-bar');
    }
  }

  function applyData(dd) {
    dd.machines.forEach(function (m) {
      var card = $('.mc[data-id="' + m.id + '"]');
      if (!card) return;
      card.className = 'mc mc--' + m.status;
      card.dataset.status = m.status;
      var chip = $('.status', card);
      chip.className = 'status status--' + m.status;
      chip.innerHTML = dd.ui.status[m.status];
      var btn = $('.mc__btn', card);
      btn.outerHTML = m.status === 'busy' ? dd.ui.btnBusy : dd.ui.btnSelect;
      var nb = $('.mc__btn', card);
      if (m.status !== 'busy') nb.setAttribute('aria-label', C.cardLabel(m, dd.currency));
      renderPrice($('.mc__price', card), m);
    });

    // Список техники в расчёте — только свободные и «требует подтверждения».
    machineSelect.textContent = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = 'Выберите технику';
    machineSelect.appendChild(first);
    dd.machines.filter(C.isSelectable).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      o.dataset.short = C.nbspUnits(m.title);
      o.dataset.full = C.optionLabel(m, dd.currency);
      machineSelect.appendChild(o);
    });

    // Канал заявок.
    if (CH[dd.channel]) {
      $$('[data-ch-href]').forEach(function (a) { a.href = channelHref(dd); a.setAttribute('aria-label', CH[dd.channel].label); });
      $$('[data-ch-label]').forEach(function (el) { el.textContent = CH[dd.channel].label; });
      $$('[data-ch-send]').forEach(function (el) { el.textContent = CH[dd.channel].send; });
      $$('[data-ch-icon]').forEach(function (el) { el.innerHTML = dd.ui.icons[dd.channel]; });
      $('#sheet').className = 'sheet sheet--' + dd.channel;
      $('#sheet-title').textContent = CH[dd.channel].sheet;
      $('[data-ch-open]').textContent = CH[dd.channel].open;
    }
    renderAllBusy(dd);
  }

  if (hasOverrides) applyData(data);
  var busyLink = $('#allbusy-link');
  if (busyLink) busyLink.href = channelHref(data, data.channel === 'phone' ? '' : 'Здравствуйте! Хочу заказать спецтехнику — подскажите ближайшую свободную дату.');

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
    if (m && !C.isSelectable(m)) return;
    state.machine = m;
    if (m) state.units = Math.max(state.units, C.minUnits(m));

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
    if (draftReady) saveDraft();
    if (fromCard && m) $('#calc').scrollIntoView({ behavior: scrollBehavior, block: 'start' });
  }

  $$('.mc').forEach(function (card) {
    card.addEventListener('click', function () {
      if (card.dataset.status !== 'busy') select(card.dataset.id, true);
    });
  });
  machineSelect.addEventListener('change', function () { select(machineSelect.value, false); });

  // ---------- Количество ----------

  function renderUnitChips() {
    var m = state.machine;
    unitsChips.textContent = '';
    if (!m) return;
    C.quickUnits(m).forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.units = String(n);
      b.textContent = C.qty(n, m.unit);
      b.addEventListener('click', function () { setUnits(n); });
      unitsChips.appendChild(b);
    });
  }

  function setUnits(n) {
    if (!state.machine) return;
    var p = C.calcPrice(state.machine, n, null);
    unitsHint.textContent = 'Минимальный заказ — ' + C.qty(C.minUnits(state.machine), state.machine.unit);
    unitsHint.hidden = !p.belowMin;
    state.units = p.units;
    clearError('units');
    renderUnits();
    if (draftReady) saveDraft();
  }

  function renderUnits() {
    var m = state.machine;
    $('#units-label').textContent = !m || m.unit === 'час' ? 'Количество часов' : 'Количество (' + C.plural(5, m.unit) + ')';
    unitsOut.textContent = m ? C.qty(state.units, m.unit) : '—';
    unitsMinus.disabled = !m || state.units <= C.minUnits(m);
    unitsPlus.disabled = !m;
    $$('.chip', unitsChips).forEach(function (c) {
      c.setAttribute('aria-pressed', String(Number(c.dataset.units) === state.units));
    });
    renderSummary();
  }

  unitsMinus.addEventListener('click', function () { setUnits(state.units - 1); });
  unitsPlus.addEventListener('click', function () { setUnits(state.units + 1); });

  // ---------- Дата (по местному времени устройства) ----------

  function today() {
    return C.isoDate(new Date());
  }

  // Страница может быть открыта с вечера: «сегодня» пересчитываем перед каждым действием.
  function refreshMin() {
    dateInput.min = today();
  }
  refreshMin();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshMin(); });
  dateInput.addEventListener('focus', refreshMin);

  // kind: today | tomorrow | other — какой чип нажат.
  function setDate(iso, kind) {
    refreshMin();
    state.date = iso && iso >= dateInput.min ? iso : '';
    state.dateKind = kind;
    dateInput.value = state.date;
    dateOther.hidden = kind !== 'other';
    $$('[data-date]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.date === kind)); });
    dateHint.hidden = !(kind === 'today' && C.isLate(new Date()));
    if (state.date) clearError('date');
    if (draftReady) saveDraft();
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
      setDate(C.dateFor(kind, new Date()), kind);
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

  // ---------- Комментарий: счётчик символов ----------

  function renderCount() {
    var n = Array.from(comment.value).length;
    commentCount.textContent = n + ' / ' + C.LIMITS.comment;
    commentCount.classList.toggle('is-near', n > C.LIMITS.comment * 0.9);
  }
  comment.addEventListener('input', function () {
    // maxlength считает UTF-16 — эмодзи «съедают» два символа; обрезаем по настоящим символам.
    if (Array.from(comment.value).length > C.LIMITS.comment) comment.value = C.clip(comment.value, C.LIMITS.comment);
    renderCount();
  });
  renderCount();

  // ---------- Итоговая стоимость и нижняя панель ----------

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderSummary() {
    var m = state.machine;
    var zone = currentZone();
    var p = m ? C.calcPrice(m, state.units, zone) : null;
    var hasPrice = Boolean(p && p.low != null);

    setText('sum-machine', m ? C.nbspUnits(m.title) : '—');
    setText('sum-units', m ? C.qty(state.units, m.unit) : '—');
    $$('.js-cost-row').forEach(function (row) { row.hidden = Boolean(m) && !hasPrice; });
    setText('sum-rent', hasPrice ? C.moneyRange(p.rentLow, p.rentHigh, data.currency) : '—');
    setText('sum-delivery-label', zone ? 'Доставка: ' + zone.title : 'Доставка');
    setText('sum-delivery', zone && p ? C.moneyRange(p.deliveryLow, p.deliveryHigh, data.currency) : '—');

    var total = !m ? 'Выберите технику' : hasPrice ? C.priceText(p, data.currency) : 'Цену назовёт менеджер';
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

  // Поля и кнопки поля, к которым относится ошибка: для aria-invalid и aria-describedby.
  function controlsOf(f) {
    return $$('input:not([type="hidden"]), select, textarea, .chip', f);
  }

  function showError(name, text) {
    var f = fieldEl(name);
    f.classList.add('is-invalid');
    var err = $('.err', f);
    err.textContent = text;
    err.hidden = false;
    controlsOf(f).forEach(function (c) {
      c.setAttribute('aria-invalid', 'true');
      var ids = (c.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      if (ids.indexOf(err.id) < 0) ids.push(err.id);
      c.setAttribute('aria-describedby', ids.join(' '));
    });
  }

  function clearError(name) {
    var f = fieldEl(name);
    if (!f) return;
    f.classList.remove('is-invalid');
    var err = $('.err', f);
    if (err) err.hidden = true;
    controlsOf(f).forEach(function (c) {
      c.removeAttribute('aria-invalid');
      if (!err) return;
      var ids = (c.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== err.id; });
      if (ids.length) c.setAttribute('aria-describedby', ids.join(' ')); else c.removeAttribute('aria-describedby');
    });
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
      today: today(),
      hasZones: data.zones.length > 0,
      zone: currentZone(),
      address: C.clip($('#address').value, C.LIMITS.address),
      name: C.clip($('#client_name').value, C.LIMITS.name),
      phone: C.clip($('#client_phone').value, C.LIMITS.phone),
      comment: C.clip(comment.value, C.LIMITS.comment),
      consent: $('#consent').checked,
      currency: data.currency,
    };
  }

  $$('.js-submit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Без мессенджеров — сразу звонок: с сайта ничего не отправляется, детали называют по телефону.
      if (data.channel === 'phone') {
        window.location.href = channelHref(data);
        return;
      }
      var o = order();
      var problem = C.validateOrder(o);
      if (problem) {
        showError(problem[0], problem[1]);
        var f = fieldEl(problem[0]);
        f.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
        var control = $('select, input:not([type="hidden"]), button', f);
        if (control && control.closest('[hidden]')) control = $('button', f);
        if (control) control.focus({ preventScroll: true });
        return;
      }
      openSheet(C.buildOrderLink(o, data), btn);
    });
  });

  // ---------- Окно «Заявка для WhatsApp / Telegram» ----------

  var sheet = $('#sheet');
  var sheetPanel = $('.sheet__panel', sheet);
  var sheetText = $('#sheet-text');
  var sheetArea = $('#sheet-area');
  var sheetHint = $('#sheet-hint');
  var sheetWarn = $('#sheet-warn');
  var copyBtn = $('#sheet-copy');
  var copyLabel = $('.js-copy-label', copyBtn);
  var openBtn = $('#sheet-open');
  var shareLink = $('#sheet-share');
  var sheetOpener = null;
  var current = { text: '', link: '', cut: false };
  var copiedTimer = 0;

  if (data.channel === 'telegram') $('#sheet-sub').textContent = '@' + data.telegram;
  if (data.channel === 'whatsapp') $('#sheet-sub').textContent = C.formatPhone(data.whatsapp);

  function focusables() {
    return $$('button, a[href], textarea:not([tabindex="-1"])', sheetPanel).filter(function (el) { return el.getClientRects().length; });
  }

  function openSheet(order, opener) {
    current = order;
    sheetOpener = opener;
    sheetText.textContent = order.text;
    sheetArea.value = order.text;
    sheetHint.hidden = true;
    sheetWarn.hidden = !order.cut;
    if (shareLink) shareLink.href = C.buildShareLink(location.href.split('#')[0], order.text);
    sheet.hidden = false;
    lockScroll();
    // Фокус — на само окно: обводка у кнопок появляется только при работе с клавиатуры.
    sheetPanel.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    unlockScroll();
    if (sheetOpener) sheetOpener.focus({ preventScroll: true });
  }

  // Страница под окном не прокручивается (iOS не слушается overflow:hidden у body) и не прыгает наверх.
  var lockY = 0;
  function lockScroll() {
    lockY = window.scrollY;
    document.body.style.top = -lockY + 'px';
    document.body.classList.add('sheet-open');
  }
  function unlockScroll() {
    document.body.classList.remove('sheet-open');
    document.body.style.top = '';
    window.scrollTo({ top: lockY, behavior: 'instant' });
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
      return navigator.clipboard.writeText(current.text).then(done, fallback);
    }
    return Promise.resolve(fallback());
  }

  copyBtn.addEventListener('click', copyText);

  // Защита от двойного нажатия: второй переход не уходит, кнопка оживает через 3 с или при возврате на страницу.
  var openLabel = $('[data-ch-open]', openBtn);
  var openText = openLabel.textContent;
  var openTimer = 0;
  function releaseOpen() {
    clearTimeout(openTimer);
    openBtn.disabled = false;
    openLabel.textContent = openText;
  }

  openBtn.addEventListener('click', function () {
    if (openBtn.disabled) return;
    openBtn.disabled = true;
    openText = openLabel.textContent;
    openLabel.textContent = 'Открываем…';
    openTimer = setTimeout(releaseOpen, 3000);
    // Черновик остаётся на случай «Назад»; через 10 минут после отправки он очищается.
    saveDraft(Date.now());
    newOrderBox.hidden = false;
    // Telegram или сокращённый комментарий: полная заявка сначала уходит в буфер — её можно вставить в чат.
    if (data.channel === 'telegram' || current.cut) {
      copyText();
      sheetHint.hidden = false;
      setTimeout(function () { window.location.href = current.link; }, 600);
      return;
    }
    // Переход в той же вкладке: window.open на телефоне блокируется.
    window.location.href = current.link;
  });
  window.addEventListener('pageshow', releaseOpen);

  $$('[data-close]', sheet).forEach(function (el) { el.addEventListener('click', closeSheet); });

  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    // Фокус не выходит из окна.
    var list = focusables();
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetPanel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Форма не отправляется браузером (заявка уходит только через мессенджер).
  $('#order-form').addEventListener('submit', function (e) { e.preventDefault(); });

  // ---------- Клавиатура на телефоне: нижняя панель не прыгает над ней, поле не закрыто ----------

  var TYPING = 'input:not([type="checkbox"]):not([type="hidden"]), textarea, select';
  document.addEventListener('focusin', function (e) {
    if (e.target.matches && e.target.matches(TYPING) && e.target.closest('#order-form')) document.body.classList.add('typing');
  });
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (!(a && a.matches && a.matches(TYPING))) document.body.classList.remove('typing');
    }, 50);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      var a = document.activeElement;
      if (a && a.matches && a.matches(TYPING) && window.visualViewport.height < window.innerHeight * 0.85) {
        a.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    });
  }

  // ---------- Черновик формы (sessionStorage): данные не теряются при возврате «Назад» из мессенджера ----------

  var DRAFT_KEY = 'specsite-draft:' + data.slug;
  var DRAFT_TTL = 10 * 60 * 1000;
  var newOrderBox = $('#new-order');
  var draftSentAt = 0;

  function saveDraft(sentAt) {
    if (sentAt) draftSentAt = sentAt;
    var dz = {
      machine: state.machine ? state.machine.id : '', units: state.units, date: state.date, dateKind: state.dateKind, zone: state.zone,
      time: $('#time').value, address: $('#address').value, name: $('#client_name').value, phone: $('#client_phone').value,
      comment: comment.value, consent: $('#consent').checked, sentAt: draftSentAt,
    };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(dz)); } catch (e) { /* приватный режим — без черновика */ }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* нет доступа */ }
  }

  function restoreDraft() {
    var dz = null;
    try { dz = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { dz = null; }
    if (!dz || typeof dz !== 'object') return;
    if (dz.sentAt && Date.now() - dz.sentAt > DRAFT_TTL) { clearDraft(); return; }
    var m = data.machines.find(function (x) { return x.id === dz.machine && C.isSelectable(x); });
    if (m) {
      select(m.id, false);
      setUnits(Number(dz.units) || C.minUnits(m));
    }
    if (dz.date && dz.date >= today()) setDate(dz.date, dz.dateKind || 'other');
    if (zoneSelect && dz.zone !== null && data.zones[dz.zone]) {
      zoneSelect.value = String(dz.zone);
      state.zone = Number(dz.zone);
    }
    $('#time').value = String(dz.time || '');
    $('#address').value = C.clip(dz.address, C.LIMITS.address);
    $('#client_name').value = C.clip(dz.name, C.LIMITS.name);
    $('#client_phone').value = C.clip(dz.phone, C.LIMITS.phone);
    comment.value = C.clip(dz.comment, C.LIMITS.comment);
    $('#consent').checked = Boolean(dz.consent);
    renderCount();
    renderSummary();
    draftSentAt = dz.sentAt || 0;
    newOrderBox.hidden = !draftSentAt;
  }

  $('#order-form').addEventListener('input', function () { saveDraft(); });
  $('#order-form').addEventListener('change', function () { saveDraft(); });
  $('#new-order-btn').addEventListener('click', function () {
    clearDraft();
    window.location.reload();
  });

  renderAllBusy(data);
  renderUnits();
  restoreDraft();
  draftReady = true;
})();
