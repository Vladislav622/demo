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
  var toast = $('#adm-toast');
  var toastText = $('span', toast);
  var toastTimer = 0;

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

  // Заполнить форму данными (конфиг + сохранённые изменения или чистый конфиг).
  function fill(d) {
    d.machines.forEach(function (m) {
      var card = $('.ac[data-id="' + m.id + '"]');
      if (!card) return;
      $('[name="rate"]', card).value = m.rate_from != null ? S.Calc.fmtNum(m.rate_from, ' ') : '';
      $('[name="min"]', card).value = m.min_units != null ? String(m.min_units) : '';
      setPressed(card, 'data-status', m.status);
    });
    $('#adm-wa').value = d.whatsapp || '';
    $('#adm-tg').value = d.telegram || '';
    setPressed($('[data-field="channel"]'), 'data-channel', d.channel === 'phone' ? '' : d.channel);
    markChanged();
    $$('.field.is-invalid').forEach(function (f) { f.classList.remove('is-invalid'); $('.err', f).hidden = true; });
  }

  // Подсветить карточки, где что-то отличается от конфига.
  function markChanged() {
    base.machines.forEach(function (m) {
      var card = $('.ac[data-id="' + m.id + '"]');
      if (!card) return;
      var changed = toNumber($('[name="rate"]', card).value) !== m.rate_from
        || toNumber($('[name="min"]', card).value) !== m.min_units
        || pressed(card, 'data-status') !== m.status;
      card.classList.toggle('is-changed', changed);
    });
  }

  function collect() {
    var machines = {};
    $$('.ac').forEach(function (card) {
      machines[card.dataset.id] = {
        rate_from: toNumber($('[name="rate"]', card).value),
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

  function showError(name, text) {
    var f = $('[data-field="' + name + '"]');
    f.classList.add('is-invalid');
    var err = $('.err', f);
    err.textContent = text;
    err.hidden = false;
  }

  function validate(ov) {
    $$('.field.is-invalid').forEach(function (f) { f.classList.remove('is-invalid'); $('.err', f).hidden = true; });
    var ok = true;
    if (ov.whatsapp && !/^\d{10,15}$/.test(ov.whatsapp)) { showError('whatsapp', 'Номер — 10–15 цифр, например 77011234567'); ok = false; }
    if (ov.telegram && !/^[A-Za-z0-9_]{5,32}$/.test(ov.telegram)) { showError('telegram', 'Латиница, цифры и «_», 5–32 символа'); ok = false; }
    if (ov.channel === 'whatsapp' && !ov.whatsapp) { showError('channel', 'Укажите номер WhatsApp или выберите Telegram'); ok = false; }
    if (ov.channel === 'telegram' && !ov.telegram) { showError('channel', 'Укажите Telegram username или выберите WhatsApp'); ok = false; }
    if (!ok) $('.field.is-invalid').scrollIntoView({ block: 'center' });
    return ok;
  }

  function showToast(text, withLink) {
    toastText.textContent = text;
    $('#adm-toast-link').hidden = !withLink;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }

  // ---------- События ----------

  $$('.seg').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn');
      if (!b) return;
      var attr = b.hasAttribute('data-status') ? 'data-status' : 'data-channel';
      setPressed(group, attr, b.getAttribute(attr));
      markChanged();
    });
  });

  $$('.ac input').forEach(function (input) {
    input.addEventListener('input', markChanged);
  });

  $('#adm-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!canSave) return;
    var ov = collect();
    if (!validate(ov)) return;
    if (S.Store.save(slug, ov)) showToast('Сохранено. Откройте сайт, чтобы проверить', true);
    else showToast('Не удалось сохранить в этом браузере', false);
  });

  $('#adm-reset').addEventListener('click', function () {
    S.Store.clear(slug);
    fill(base);
    showToast('Вернули исходные цены и статусы', true);
  });

  fill(S.getCompanyData());
})();
