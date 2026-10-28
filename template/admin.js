// Панель владельца — демо-режим: изменения сохраняются в localStorage этого браузера
// через тот же data-слой, что и сайт (window.SiteData из app.js).

(function () {
  'use strict';

  var S = window.SiteData;
  if (!S || document.body.getAttribute('data-page') !== 'admin') return;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var base = S.baseData();
  var slug = base.slug;
  var canSave = S.Store.available();
  var form = $('#adm-form');
  var toast = $('#adm-toast');
  var toastText = $('span', toast);
  var toastTimer = 0;
  var savedState = '';
  var leaving = false;
  var TEST_TEXT = 'Тестовая заявка с сайта — всё работает ✓';

  if (!canSave) {
    $('#adm-nostore').hidden = false;
    $('#adm-save').disabled = true;
  }

  function digits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  // «15 000» → 15000; пусто → null.
  function toNumber(v) {
    var d = digits(v);
    return d ? Number(d) : null;
  }

  function setPressed(group, attr, value) {
    $$('[' + attr + ']', group).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)); });
  }

  function pressed(group, attr) {
    var b = $('[' + attr + '][aria-pressed="true"]', group);
    return b ? b.getAttribute(attr) : '';
  }

  // ---------- Режим на телефоне: «Статусы» / «Цены и статусы» ----------

  function setMode(mode) {
    setPressed($('.adm-mode'), 'data-mode', mode);
    form.classList.toggle('is-status', mode === 'status');
  }

  // ---------- Заполнение и сбор ----------

  // Заполнить форму данными (конфиг + сохранённые изменения или чистый конфиг).
  function fill(d) {
    d.machines.forEach(function (m) {
      var card = $('.ac[data-id="' + m.id + '"]');
      if (!card) return;
      $('[name="rate"]', card).value = m.rate_from != null ? S.Calc.fmtNum(m.rate_from, ' ') : '';
      var to = $('[name="rate_to"]', card);
      if (to) to.value = m.rate_to != null ? S.Calc.fmtNum(m.rate_to, ' ') : '';
      $('[name="min"]', card).value = m.min_units != null ? String(m.min_units) : '';
      setPressed(card, 'data-status', m.status);
    });
    $('#adm-wa').value = d.whatsapp || '';
    $('#adm-tg').value = d.telegram || '';
    setPressed($('[data-field="channel"]'), 'data-channel', d.channel === 'phone' ? '' : d.channel);
    clearErrors();
    savedState = snapshot();
    update();
  }

  function collect() {
    var machines = {};
    $$('.ac').forEach(function (card) {
      var to = $('[name="rate_to"]', card);
      machines[card.dataset.id] = {
        rate_from: toNumber($('[name="rate"]', card).value),
        rate_to: to ? toNumber(to.value) : null,
        min_units: toNumber($('[name="min"]', card).value),
        status: pressed(card, 'data-status'),
      };
    });
    return {
      machines: machines,
      whatsapp: digits($('#adm-wa').value),
      telegram: $('#adm-tg').value.trim().replace(/^@/, ''),
      channel: pressed($('[data-field="channel"]'), 'data-channel'),
      saved_at: new Date().toISOString(),
    };
  }

  // Сырые значения полей — чтобы «15 000» и «15000» не считались разными, а «15,5» считался.
  function snapshot() {
    return JSON.stringify($$('#adm-form input').map(function (i) { return i.value.replace(/[\s ]/g, ''); })
      .concat($$('#adm-form [aria-pressed="true"]').map(function (b) { return b.getAttribute('data-status') || b.getAttribute('data-channel'); })));
  }

  function isDirty() {
    return snapshot() !== savedState;
  }

  // Подсветить карточки, где что-то отличается от конфига, и показать плашку несохранённых изменений.
  function update() {
    base.machines.forEach(function (m) {
      var card = $('.ac[data-id="' + m.id + '"]');
      if (!card) return;
      var to = $('[name="rate_to"]', card);
      var changed = toNumber($('[name="rate"]', card).value) !== m.rate_from
        || (to && toNumber(to.value) !== m.rate_to)
        || toNumber($('[name="min"]', card).value) !== m.min_units
        || pressed(card, 'data-status') !== m.status;
      card.classList.toggle('is-changed', changed);
    });
    $('#adm-dirty').hidden = !isDirty();
    updateTest();
    waWarning();
  }

  // ---------- Проверка ----------

  function clearErrors() {
    $$('.is-invalid').forEach(function (f) {
      f.classList.remove('is-invalid');
      var err = $('.err', f);
      err.hidden = true;
      err.removeAttribute('id');
      $$('input', f).forEach(function (i) { i.removeAttribute('aria-invalid'); i.removeAttribute('aria-describedby'); });
    });
  }

  var errSeq = 0;
  function showError(field, text) {
    field.classList.add('is-invalid');
    var err = $('.err', field);
    err.id = 'adm-err-' + (++errSeq);
    err.textContent = text;
    err.hidden = false;
    var input = $('input', field);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', err.id);
    }
  }

  // Целое > 0 (пробелы между разрядами допустимы); пусто — null; иначе текст ошибки.
  function checkInt(raw, zeroText) {
    var v = raw.replace(/[\s ]/g, '');
    if (!v) return null;
    if (!/^\d+$/.test(v)) return 'Только целое число, без копеек и букв';
    if (Number(v) < 1) return zeroText;
    return null;
  }

  function validate(ov) {
    clearErrors();
    $$('.ac').forEach(function (card) {
      var rate = $('[name="rate"]', card);
      var to = $('[name="rate_to"]', card);
      var min = $('[name="min"]', card);
      var e = checkInt(rate.value, 'Цена больше 0 — или оставьте пусто: «цена по запросу»');
      if (e) showError(rate.closest('.ac__field'), e);
      if (to) {
        var et = checkInt(to.value, 'Больше 0 — или оставьте пусто');
        var from = toNumber(rate.value);
        var upto = toNumber(to.value);
        if (!et && upto != null && (from == null || upto <= from)) et = from == null ? 'Сначала укажите цену «от»' : '«До» должно быть больше «от»';
        if (et) showError(to.closest('.ac__field'), et);
      }
      var em = checkInt(min.value, 'Не меньше 1 — или оставьте пусто');
      if (em) showError(min.closest('.ac__field'), em);
    });
    if (ov.whatsapp && !S.Calc.isWhatsapp(ov.whatsapp)) showError($('[data-field="whatsapp"]'), 'Номер — 10–15 цифр, например 77011234567');
    if (ov.telegram && !S.Calc.isTelegram(ov.telegram)) showError($('[data-field="telegram"]'), 'Латиница, цифры и «_», 5–32 символа, без @');
    if (ov.channel === 'whatsapp' && !ov.whatsapp) showError($('[data-field="channel"]'), 'Укажите номер WhatsApp или выберите Telegram');
    if (ov.channel === 'telegram' && !ov.telegram) showError($('[data-field="channel"]'), 'Укажите Telegram username или выберите WhatsApp');
    var first = $('.is-invalid');
    if (!first) return true;
    // Ошибка в цене спрятана в режиме «Статусы» — показать поля.
    if (first.closest('.ac__fields')) setMode('full');
    first.scrollIntoView({ block: 'center' });
    var input = $('input', first) || $('button', first);
    if (input) input.focus({ preventScroll: true });
    return false;
  }

  // Номер Казахстана: 11 цифр, начинается с 7. Другое — предупреждение, сохранять не мешает.
  function waWarning() {
    var wa = digits($('#adm-wa').value);
    var warn = $('#adm-wa-warn');
    var show = wa.length > 0 && !(wa.length >= 11 && wa.length <= 12 && wa.charAt(0) === '7');
    if (!warn) {
      warn = document.createElement('span');
      warn.id = 'adm-wa-warn';
      warn.className = 'warn-text';
      $('[data-field="whatsapp"] .hint').insertAdjacentElement('afterend', warn);
    }
    warn.textContent = 'Проверьте номер: для Казахстана это 11 цифр и первая — 7, например 77011234567';
    warn.hidden = !show;
  }

  // ---------- Тестовая заявка себе ----------

  function updateTest() {
    var link = $('#adm-test');
    var wa = digits($('#adm-wa').value);
    var ok = S.Calc.isWhatsapp(wa);
    link.href = ok ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent(TEST_TEXT) : '#';
    link.setAttribute('aria-disabled', String(!ok));
    $('#adm-test-hint').textContent = ok
      ? 'Откроется WhatsApp на номер выше — так вы увидите, как приходят заявки'
      : 'Сначала укажите номер WhatsApp выше';
  }

  // ---------- Тост ----------

  function showToast(text, withLink) {
    toastText.textContent = text;
    $('#adm-toast-link').hidden = !withLink;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }

  // ---------- События ----------

  // Любая правка прячет тост прошлого сохранения — он больше не про текущее состояние.
  function edited() {
    toast.hidden = true;
    update();
  }

  $('.adm-mode').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (b) setMode(b.getAttribute('data-mode'));
  });

  $$('#adm-form .seg').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn');
      if (!b) return;
      var attr = b.hasAttribute('data-status') ? 'data-status' : 'data-channel';
      setPressed(group, attr, b.getAttribute(attr));
      edited();
    });
  });

  $$('#adm-form input').forEach(function (input) {
    input.addEventListener('input', edited);
  });

  $('#adm-test').addEventListener('click', function (e) {
    if (this.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      $('#adm-wa').focus();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canSave) return;
    var ov = collect();
    if (!validate(ov)) return;
    if (S.Store.save(slug, ov)) {
      savedState = snapshot();
      update();
      showToast('Сохранено. Откройте сайт, чтобы проверить', true);
    } else {
      showToast('Не удалось сохранить в этом браузере', false);
    }
  });

  $('#adm-reset').addEventListener('click', function () {
    S.Store.clear(slug);
    fill(base);
    showToast('Вернули исходные цены и статусы', true);
  });

  // Уход со страницы с несохранёнными изменениями.
  $$('a[href="../"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (!isDirty()) return;
      if (window.confirm('Есть несохранённые изменения. Открыть сайт без сохранения?')) leaving = true;
      else e.preventDefault();
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (leaving || !isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  fill(S.getCompanyData());
})();
