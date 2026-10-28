// XSS-автотест: вредные строки в конфиге, в сохранённых изменениях панели (localStorage) и в полях формы.
// Ничего не должно исполниться, разметка не должна сломаться, в консоли нет нарушений CSP.
// node tests/xss.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve, launch, sleep, fail } = require('./browser.js');
const build = require('../build.js');

const ROOT = path.join(__dirname, '..');
const P = ['<img src=x onerror=alert(1)>', '"><script>alert(2)</script>', '</textarea><i class=xss>x</i>', '{{name}}', '<!--if:x-->', "'><svg onload=alert(3)>"];
const bad = (i) => P[i % P.length];

const config = {
  demo: true,
  slug: '_xss',
  name: `XSS ${P[0]} ${P[1]}`,
  tagline: P[2],
  city: P[3],
  city_in: P[4],
  schedule: P[5],
  address: P[1],
  whatsapp: '77000000000',
  channel: 'whatsapp',
  hero_title: `${P[0]} *${P[1]}*`,
  delivery_time_text: P[2],
  park_note: P[3],
  features: [0, 1, 2, 3].map((i) => ({ icon: 'park', title: bad(i), text: bad(i + 1) })),
  about: `${P[4]} ${P[0]}`,
  reviews_summary: [P[1], P[2]],
  currency: '₸',
  price_note: P[5],
  machines: [0, 1, 2].map((i) => ({ id: `m${i}`, kind: 'excavator', title: bad(i), photo: '', purpose: bad(i + 3), rate_from: 10000, rate_to: null, unit: 'час', min_units: 4, status: 'free' })),
  zones: [0, 1].map((i) => ({ title: bad(i + 2), delivery_from: 5000, delivery_to: null })),
};

// Признаки вставленной разметки: элементы из вредных строк.
const INJ_SEL = 'img[src="x"], [onerror], [onload], .xss, body script:not([type]) ~ script:not([type])';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'да ' : 'НЕТ'}  ${name}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xss-'));
  const src = path.join(tmp, 'src', '_xss');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'config.json'), JSON.stringify(config, null, 2));
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const tpl = (f) => fs.readFileSync(path.join(ROOT, 'template', f), 'utf8');
  build.buildCompany({ folder: '_xss', dir: src, config: build.readConfig(path.join(src, 'config.json')).config }, out, tpl('index.html'), tpl('admin.html'), build.readSite());

  const server = await serve(out);
  const url = `http://127.0.0.1:${server.address().port}/_xss/`;
  const b = await launch();
  const alerts = [];
  const csp = [];
  const errors = [];
  b.on((msg) => {
    if (msg.method === 'Page.javascriptDialogOpening') { alerts.push(msg.params.message); b.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
    if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__csp') csp.push(msg.params.payload);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || 'ошибка JS');
  });
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.send('Runtime.addBinding', { name: '__csp' });
  // Всё, что могло бы исполниться, отмечается здесь; нарушения CSP — через событие securitypolicyviolation.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.alert = (m) => { window.__csp && window.__csp('alert ' + m); };
    document.addEventListener('securitypolicyviolation', (e) => window.__csp('CSP ' + e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '')));` });
  // Фото и навигация наружу (wa.me) не нужны: перехватываем.
  await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
  const nav = [];
  b.on((msg) => { if (msg.method === 'Fetch.requestPaused') nav.push(msg.params.request.url); if (msg.method === 'Fetch.requestPaused') b.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Aborted' }).catch(() => {}); });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  const js = async (expr) => {
    const r = await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description}\n  в: ${expr.slice(0, 120)}`);
    return r.result.value;
  };
  const go = async (u) => { await b.send('Page.navigate', { url: u }); await sleep(900); };

  // 1. Конфиг.
  await go(url);
  const STRUCT = `(() => ({ h1: document.querySelectorAll('h1').length, cards: document.querySelectorAll('.mc').length, form: Boolean(document.getElementById('calc-body')),
    sheet: Boolean(document.getElementById('sheet')), injected: [...document.querySelectorAll(${JSON.stringify(INJ_SEL)})].map((e) => e.outerHTML.slice(0, 60)),
    scripts: [...document.scripts].filter((s) => s.type !== 'application/json').length, title: document.title,
    nameText: document.querySelector('.brand__name').textContent, zones: [...document.querySelectorAll('#zone option')].map((o) => o.textContent) }))()`;
  const s1 = await js(STRUCT);
  check('сайт: разметка цела (1 h1, 3 карточки, форма, окно заявки, 1 скрипт)', s1.h1 === 1 && s1.cards === 3 && s1.form && s1.sheet && s1.scripts === 1, JSON.stringify({ h1: s1.h1, cards: s1.cards, scripts: s1.scripts }));
  check('сайт: вредные строки показаны текстом, новых элементов нет', !s1.injected.length && s1.nameText === config.name && s1.zones.some((z) => z.includes(P[2])), s1.injected.join(' '));
  check('сайт: {{name}} и <!--if:x--> из данных не подставляются повторно', s1.title.includes('XSS') && (await js("document.body.textContent.includes('{{name}}') && document.body.textContent.includes('<!--if:x-->')")), '');

  // 2. Поля формы.
  await js(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelector('.mc__btn').click(); set('address', ${JSON.stringify(P.join(' '))}); set('comment', ${JSON.stringify(P.join(' '))}); set('client_name', ${JSON.stringify(P[0])}); document.querySelector('[data-date="tomorrow"]').click();
    const z = document.getElementById('zone'); if (z && z.options.length > 1) { z.selectedIndex = 1; z.dispatchEvent(new Event('change', { bubbles: true })); }
    const c = document.getElementById('consent'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('submit').click(); })()`);
  await sleep(500);
  const s2 = await js(`({ open: !document.getElementById('sheet').hidden, area: document.getElementById('sheet-area').value,
    injected: document.querySelectorAll(${JSON.stringify(INJ_SEL)}).length })`);
  check('форма: вредные строки в адресе, комментарии, имени — текст заявки, а не разметка', s2.open && s2.injected === 0 && s2.area.includes(P[0]) && s2.area.includes(P[2]),
    `окно ${s2.open ? 'открыто' : 'не открыто'}, вставлено элементов: ${s2.injected}`);
  await js("document.getElementById('sheet-open').click()");
  await sleep(1200);
  const wa = nav.find((u) => u.startsWith('https://wa.me/')) || '';
  check('форма: переход на wa.me с закодированным текстом (нет < > " в адресе)', /^https:\/\/wa\.me\/77000000000\?text=/.test(wa) && !/[<>"]/.test(wa)
    && decodeURIComponent(wa.split('text=')[1]).includes(P[0]), wa.slice(0, 70));

  // 3. Панель: вредные строки в сохранённых изменениях (localStorage).
  await go(`${url}admin/`);
  await js(`localStorage.setItem('specsite-demo:_xss', JSON.stringify({ machines: { m0: { rate_from: ${JSON.stringify(P[0])}, rate_to: ${JSON.stringify(P[1])}, min_units: ${JSON.stringify(P[2])}, status: ${JSON.stringify(P[1])} },
    ${JSON.stringify(P[0])}: { status: 'busy' } }, whatsapp: ${JSON.stringify(P[0])}, telegram: ${JSON.stringify(P[5])}, channel: ${JSON.stringify(P[1])} }))`);
  await go(`${url}admin/`);
  const s3 = await js(`({ cards: document.querySelectorAll('.ac').length, wa: document.getElementById('adm-wa').value, rate: document.querySelector('.ac [name="rate"]').value,
    injected: document.querySelectorAll(${JSON.stringify(INJ_SEL)}).length, h1: document.querySelectorAll('h1').length })`);
  check('панель: вредные значения из localStorage отброшены, разметка цела', s3.cards === 3 && s3.h1 === 1 && s3.injected === 0 && s3.wa === '77000000000' && s3.rate === '10 000', JSON.stringify(s3));
  await js(`(() => { const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('.ac [name="rate"]', ${JSON.stringify(P[0])}); set('#adm-tg', ${JSON.stringify(P[1])}); document.getElementById('adm-save').click(); })()`);
  await sleep(300);
  const s4 = await js(`({ injected: document.querySelectorAll(${JSON.stringify(INJ_SEL)}).length, errs: document.querySelectorAll('.is-invalid').length })`);
  check('панель: вредные строки в полях — ошибка проверки, не разметка', s4.injected === 0 && s4.errs >= 2, JSON.stringify(s4));
  await js("document.getElementById('adm-reset').click()");
  await go(url);
  const s5 = await js(STRUCT);
  check('сайт после панели: разметка цела', s5.h1 === 1 && s5.cards === 3 && !s5.injected.length, '');

  check('ничего не исполнилось (alert не вызывался)', alerts.length === 0 && !csp.some((c) => c.startsWith('alert')), alerts.concat(csp.filter((c) => c.startsWith('alert'))).join('; '));
  check('нарушений CSP нет', !csp.some((c) => c.startsWith('CSP')), csp.join('; '));
  check('нет ошибок JS', errors.length === 0, errors.join('; '));

  b.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const no = results.filter((r) => !r.ok).length;
  console.log(`Итог XSS: да ${results.length - no}, НЕТ ${no}`);
  process.exit(no ? 1 : 0);
}

main().catch((e) => fail(e.stack || e.message));
