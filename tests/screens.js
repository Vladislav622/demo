// Скриншоты и проверки страницы компании в headless Edge/Chrome (протокол DevTools).
// Только встроенные модули Node (нужен Node ≥ 22: глобальные fetch и WebSocket) + установленный Edge или Chrome.
//
// node tests/screens.js <slug>
//   Берёт preview/<slug>/ (после node build.js --test) или docs/<slug>/.
//   Пишет checks/<slug>-360-full.png, -360-selected.png, -1280.png, -1280-selected.png
//   и печатает проверки «да/нет», плюс замер загрузки на «Slow 3G» без фото.
//   Код выхода 1, если какая-то проверка «нет».

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'checks');
const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`Ошибка: ${msg}`);
  process.exit(1);
}

// Простой статический сервер для папки сборки.
function serve(dir) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    const ext = path.extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream' };
    // Как GitHub Pages: текстовые файлы отдаются сжатыми (SCREENS_NO_GZIP=1 — без сжатия).
    if (!process.env.SCREENS_NO_GZIP && /gzip/.test(req.headers['accept-encoding'] || '') && ['.html', '.css', '.js', '.svg', '.txt'].includes(ext)) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync(fs.readFileSync(file)));
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function launch() {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) fail('не найден Edge или Chrome; укажите путь в переменной BROWSER');
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 75 && !page; i++) {
    await sleep(200);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) { /* ещё запускается */ }
  }
  if (!page) fail('браузер не ответил по протоколу DevTools');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    listeners.forEach((fn) => fn(msg));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const close = () => { ws.close(); proc.kill(); };
  return { send, on: (fn) => listeners.push(fn), close };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) fail('укажите slug: node tests/screens.js _test');
  const base = ['preview', 'docs'].map((d) => path.join(ROOT, d)).find((d) => fs.existsSync(path.join(d, slug, 'index.html')));
  if (!base) fail(`нет preview/${slug}/index.html и docs/${slug}/index.html — сначала соберите: node build.js --test`);

  // city_in из конфига: с ним заголовку первого экрана допустимо 3 строки.
  const cfgFile = path.join(ROOT, 'companies', slug, 'config.json');
  const cityIn = fs.existsSync(cfgFile) ? String(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).city_in || '').trim() : '';
  const heroMaxLines = cityIn ? 3 : 2;

  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(base);
  const url = `http://127.0.0.1:${server.address().port}/${slug}/`;
  const b = await launch();

  const errors = [];
  const waLinks = [];
  b.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || 'ошибка JS');
    if (msg.method === 'Fetch.requestPaused') {
      waLinks.push(msg.params.request.url);
      b.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Aborted' }).catch(() => {});
    }
  });

  const js = async (expr) => {
    const r = await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'ошибка в проверке');
    return r.result.value;
  };
  const open = async (w, h, mobile) => {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await b.send('Page.navigate', { url });
    for (let i = 0; i < 50; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; }
    await sleep(300);
  };
  const shot = async (name, full) => {
    let params = { format: 'png' };
    if (full) {
      // При съёмке всей страницы vh растягивается — фиксируем высоту первого экрана в px.
      await js(`(() => { const h = document.querySelector('.hero').getBoundingClientRect().height;
        const s = document.createElement('style'); s.id = 'fix-hero';
        s.textContent = '.hero{min-height:' + h + 'px!important;max-height:' + h + 'px!important}';
        document.head.appendChild(s); })()`);
      const size = await js('({ w: document.documentElement.clientWidth, h: document.documentElement.scrollHeight })');
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 } };
    }
    const r = await b.send('Page.captureScreenshot', params);
    if (full) await js("document.getElementById('fix-hero')?.remove()");
    const file = path.join(OUT, `${slug}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return path.relative(ROOT, file).split(path.sep).join('/');
  };
  // Настоящий тап мышью в центр элемента (а не element.click()).
  const tap = async (sel) => {
    const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!p) throw new Error(`нет элемента ${sel}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    }
    await sleep(250);
  };
  const type = async (sel, text) => { await tap(sel); await b.send('Input.insertText', { text }); };

  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://wa.me/*' }, { urlPattern: 'https://api.whatsapp.com/*' }] });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const shots = [];
  const NOSCROLL = '({ sw: document.documentElement.scrollWidth, iw: innerWidth })';
  const SMALL = `[...document.querySelectorAll('a.btn, .pill-btn, button:not(.mc), .chip, .check, .picked__change, .link-btn, .mc__cta')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => ({ t: (e.textContent.trim() || e.className).slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((e) => e.h < 44)`;
  const PRESSED = "[...document.querySelectorAll('.mc[aria-pressed=\"true\"]')].map((e) => e.dataset.id)";
  const FIRST_FREE = '.mc:not(.mc--busy)';

  // ---------- 360 ----------
  await open(360, 740, true);
  const cols = await js("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length");
  check('сетка 2 колонки на 360px', cols === 2, `${cols}`);
  const demo = await js("({ bar: document.querySelector('.demo-bar')?.getBoundingClientRect().height ?? null, robots: document.querySelector('meta[name=robots]')?.content ?? null })");
  if (demo.bar !== null) {
    check('плашка демо видна и ≤ 36px', demo.bar > 0 && demo.bar <= 36, `${demo.bar}px`);
    check('meta robots noindex', demo.robots === 'noindex, nofollow', demo.robots);
  }
  const hero = await js(`(() => { const t = document.querySelector('.hero__title'); const lh = parseFloat(getComputedStyle(t).lineHeight);
    const btns = [...document.querySelectorAll('.hero__actions .btn')].map((e) => e.getBoundingClientRect());
    return { lines: Math.round(t.getBoundingClientRect().height / lh), h: Math.round(document.querySelector('.hero').getBoundingClientRect().height),
      stacked: btns.length < 2 || btns[1].top >= btns[0].bottom, oneLine: [...document.querySelectorAll('.hero__actions .btn')].every((e) => e.getBoundingClientRect().height < 60) }; })()`);
  check(`заголовок первого экрана ≤ ${heroMaxLines} строк на 360px${cityIn ? ` (city_in «${cityIn}»)` : ''}`, hero.lines <= heroMaxLines,
    `${hero.lines} строки, ${await js("getComputedStyle(document.querySelector('.hero__title')).fontSize")}, высота экрана ${hero.h}px`);
  const head = await js(`(() => { const n = document.querySelector('.brand__name'), b = document.querySelector('.pill-btn'), r = b.getBoundingClientRect();
    const t = document.querySelector('.pill-btn__text');
    return { name: n ? { sw: n.scrollWidth, cw: n.clientWidth, overflow: getComputedStyle(n).textOverflow, ws: getComputedStyle(n).whiteSpace,
      lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) } : null,
      btn: { w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label'), textShown: Boolean(t && t.getClientRects().length) } }; })()`);
  if (head.name) {
    check('шапка 360: название не обрезано (scrollWidth == clientWidth, без text-overflow, ≤ 2 строк)',
      head.name.sw === head.name.cw && head.name.overflow !== 'ellipsis' && head.name.lines <= 2,
      `${head.name.sw} = ${head.name.cw}, text-overflow: ${head.name.overflow}, строк: ${head.name.lines}`);
  }
  check('шапка 360: круглая кнопка 44×44 без подписи, с aria-label', head.btn.w === 44 && head.btn.h === 44 && !head.btn.textShown && Boolean(head.btn.label),
    `${head.btn.w}×${head.btn.h}, aria-label «${head.btn.label}»`);
  check('кнопки первого экрана друг под другом, текст в одну строку', hero.stacked && hero.oneLine, '');
  const titles = await js(`[...document.querySelectorAll('.mc__title')].map((e) => ({ t: e.textContent, cut: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1,
    lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) }))`);
  check('название карточки на 360px не обрезано (≤ 3 строк)', titles.every((t) => !t.cut && t.lines <= 3), titles.map((t) => `${t.t}: ${t.lines}`).join('; '));
  const s1 = await js(NOSCROLL);
  check('нет горизонтального скролла (360, до выбора)', s1.sw === s1.iw, `${s1.sw} = ${s1.iw}`);
  shots.push(await shot('360-full', true));

  const hasBusy = await js("Boolean(document.querySelector('.mc--busy'))");
  if (hasBusy) {
    await tap('.mc--busy');
    const r = await js(`({ pressed: ${PRESSED}, orderHidden: document.getElementById('order').hidden })`);
    check('занятая карточка не выбирается', r.pressed.length === 0 && r.orderHidden, JSON.stringify(r));
  }

  await tap(FIRST_FREE);
  const picked = await js(PRESSED);
  await js("document.getElementById('order').scrollIntoView({ block: 'start' })");
  await sleep(150);
  const orderTop = await js("({ order: Math.round(document.getElementById('order').getBoundingClientRect().top), sticky: Math.round(document.querySelector('.sticky').getBoundingClientRect().bottom) })");
  check('блок заказа не уходит под шапку', orderTop.order >= orderTop.sticky, `верх блока ${orderTop.order} ≥ низ шапки ${orderTop.sticky}`);
  shots.push(await shot('360-selected', false));
  const s2 = await js(NOSCROLL);
  check('нет горизонтального скролла (360, после выбора)', s2.sw === s2.iw, `${s2.sw} = ${s2.iw}`);
  const cta = await js("[...document.querySelectorAll('.mc')].map((e) => e.querySelector('.mc__cta').textContent.trim())");
  check('полоса карточки: Выбрано / Выбрать / Занята', cta.includes('Выбрано') && cta.includes('Выбрать') && (!hasBusy || cta.includes('Занята')), cta.join(', '));
  if (hasBusy) {
    await tap('.mc--busy');
    const after = await js(PRESSED);
    check('тап по занятой после выбора не меняет выбор', JSON.stringify(after) === JSON.stringify(picked), after.join(','));
  }

  await tap('#submit');
  // Цена в панели: одна строка + «предварительно».
  const BAR_LINES = `(() => { const el = document.getElementById('bar-price'), node = el.firstChild;
    const range = document.createRange(); range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    return { text: node.textContent, lines: tops.size, small: el.querySelector('small')?.textContent || '', nowrap: getComputedStyle(el).whiteSpace,
      fits: el.scrollWidth <= el.clientWidth, btn: document.getElementById('submit').innerText.trim() }; })()`;
  const bar1 = await js(BAR_LINES);
  check('панель 360: цена в одну строку + «предварительно», кнопка «Отправить»',
    bar1.lines === 1 && bar1.fits && (!bar1.small || bar1.small === 'предварительно') && bar1.btn === 'Отправить',
    `«${bar1.text}» — строк: ${bar1.lines}, ${bar1.small}, кнопка «${bar1.btn}»`);

  const firstErr = await js("({ f: document.querySelector('.field.is-invalid')?.dataset.field, msg: document.querySelector('.field.is-invalid .err')?.textContent })");
  check('пустая отправка: подсвечено первое незаполненное поле', Boolean(firstErr.f), `${firstErr.f}: ${firstErr.msg}`);

  await tap('#comment-toggle');
  await tap('[data-date="other"]');
  const small360 = await js(SMALL);
  check('кнопки и чипы ≥ 44px (360)', small360.length === 0, JSON.stringify(small360));

  const overlap = await js(`(() => { const f = document.querySelector('[data-field="consent"]'); f.scrollIntoView({ block: 'end' });
    const fr = f.getBoundingClientRect(), br = document.getElementById('bar').getBoundingClientRect();
    return { field: Math.round(fr.bottom), bar: Math.round(br.top), pad: parseFloat(getComputedStyle(document.body).paddingBottom), barH: Math.round(br.height) }; })()`);
  check('нижняя панель не перекрывает последнее поле', overlap.field <= overlap.bar && overlap.pad >= overlap.barH,
    `низ поля ${overlap.field} ≤ верх панели ${overlap.bar}; padding-bottom ${overlap.pad}px ≥ панель ${overlap.barH}px`);

  // Заполняем заявку: +2 к объёму, завтра, последняя зона, адрес, телефон, согласие → «Отправить».
  await tap('#units-plus'); await tap('#units-plus');
  await tap('[data-date="tomorrow"]');
  if (await js("Boolean(document.querySelector('[data-zone]'))")) await tap('[data-zone]:last-of-type');
  await type('#address', 'Тестовый адрес, 5');
  await type('#client_name', 'Тест');
  await type('#client_phone', '+7 700 000 00 00');
  await tap('#consent');
  const price360 = await js("document.getElementById('bar-price').textContent");
  const bar2 = await js(BAR_LINES);
  check('панель 360 с доставкой: цена в одну строку', bar2.lines === 1 && bar2.fits, `«${bar2.text}» — строк: ${bar2.lines}`);
  await tap('#submit');
  await sleep(500);

  // ---------- 1280 ----------
  await open(1280, 800, false);
  const dcols = await js("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length");
  check('сетка 4 колонки на 1280px', dcols === 4, `${dcols}`);
  const d1 = await js(NOSCROLL);
  check('нет горизонтального скролла (1280)', d1.sw === d1.iw, `${d1.sw} = ${d1.iw}`);
  shots.push(await shot('1280', true));
  await tap(FIRST_FREE);
  await js("document.getElementById('order').scrollIntoView({ block: 'start' })");
  await sleep(150);
  const desk = await js(`(() => { const f = document.getElementById('order-form').getBoundingClientRect(), s = document.querySelector('.summary').getBoundingClientRect();
    return { formW: Math.round(f.width), sumLeft: Math.round(s.left), formRight: Math.round(f.right), sumVisible: s.width > 0,
      barShown: getComputedStyle(document.getElementById('bar')).display !== 'none', ratio: Math.round(f.width / (f.width + s.width) * 100) }; })()`);
  check('1280: «Ваш заказ» справа от формы, нижней панели нет', desk.sumVisible && !desk.barShown && desk.formRight <= desk.sumLeft,
    `форма ${desk.ratio}% ширины, правый край ${desk.formRight} ≤ ${desk.sumLeft}`);
  const sticky = await js(`(() => { window.scrollBy(0, 300); const s = document.querySelector('.summary').getBoundingClientRect();
    const top = document.querySelector('.sticky').getBoundingClientRect().bottom; return { sum: Math.round(s.top), sticky: Math.round(top) }; })()`);
  check('1280: «Ваш заказ» закреплена ниже шапки', sticky.sum >= sticky.sticky, `верх карточки ${sticky.sum} ≥ низ шапки ${sticky.sticky}`);
  await js("document.getElementById('order').scrollIntoView({ block: 'start' })");
  await sleep(150);
  shots.push(await shot('1280-selected', false));
  const small1280 = await js(SMALL);
  check('кнопки и чипы ≥ 44px (1280)', small1280.length === 0, JSON.stringify(small1280));

  check('нет ошибок JS', errors.length === 0, errors.join('; '));

  // ---------- Slow 3G, без фото, без кэша ----------
  // Пресет DevTools «Slow 3G»: задержка 2000 мс, ~400 Кбит/с в обе стороны.
  await b.send('Network.enable');
  await b.send('Network.setCacheDisabled', { cacheDisabled: true });
  await b.send('Network.setBlockedURLs', { urls: ['*/img/*', '*.jpg', '*.jpeg', '*.png', '*.webp'] });
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
  await b.send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; }
  const slow = await js(`(() => { const n = performance.getEntriesByType('navigation')[0];
    const bytes = performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || 0), n.transferSize || 0);
    return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), cards: document.querySelectorAll('.mc').length, kb: Math.round(bytes / 1024) }; })()`);
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  check('Slow 3G без фото: сетка карточек до 3 с (DOMContentLoaded)', slow.dcl <= 3000 && slow.cards > 0,
    `DOMContentLoaded ${(slow.dcl / 1000).toFixed(2)} с, load ${(slow.load / 1000).toFixed(2)} с, карточек ${slow.cards}, передано ${slow.kb} КБ${process.env.SCREENS_NO_GZIP ? ' (без gzip)' : ' (gzip)'}`);

  b.close();
  server.close();

  console.log(`Страница: ${slug} (${path.relative(ROOT, base)}/${slug}/)`);
  console.log('Скриншоты:');
  shots.forEach((s) => console.log(`  ${s}`));
  console.log('Проверки:');
  checks.forEach((c) => console.log(`  ${c.ok ? 'да ' : 'НЕТ'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`));
  console.log(`Цена в панели после заполнения (360): ${price360}`);
  if (waLinks.length) {
    console.log(`Переход по «Отправить» (перехвачен, не отправлен): ${waLinks[0]}`);
    const text = new URL(waLinks[0]).searchParams.get('text');
    if (text) console.log(`Текст заявки:\n${text.split('\n').map((l) => `  | ${l}`).join('\n')}`);
  } else {
    console.log('Переход по «Отправить»: не было');
  }
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
