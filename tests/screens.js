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

  // city_in или hero_title в конфиге: заголовку первого экрана допустимо 3 строки.
  const cfgFile = path.join(ROOT, 'companies', slug, 'config.json');
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  const heroMaxLines = String(cfg.city_in || '').trim() || String(cfg.hero_title || '').trim() ? 3 : 2;

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
      // Снимок всей страницы — от самого верха, иначе закреплённая шапка окажется посередине.
      await js('window.scrollTo(0, 0)');
      // Ленивые картинки ниже экрана сами не загрузятся — догружаем перед съёмкой всей страницы.
      await js(`Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); }))`);
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
  await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://wa.me/*' }, { urlPattern: 'https://api.whatsapp.com/*' }, { urlPattern: 'https://t.me/*' }] });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  const key = async (k, code) => {
    for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : 9 });
    await sleep(150);
  };
  const SHEET = `(() => { const sh = document.getElementById('sheet'), p = sh.querySelector('.sheet__panel'), r = p.getBoundingClientRect();
    return { open: !sh.hidden, title: document.getElementById('sheet-title').textContent, sub: document.getElementById('sheet-sub').textContent,
      text: document.getElementById('sheet-text').textContent, w: Math.round(r.width), left: Math.round(r.left), bottom: Math.round(r.bottom), top: Math.round(r.top),
      vw: innerWidth, vh: innerHeight, focusInside: p.contains(document.activeElement), active: document.activeElement.id || document.activeElement.className,
      share: document.getElementById('sheet-share')?.getAttribute('href') || '', hint: !document.getElementById('sheet-hint').hidden,
      copy: document.querySelector('.js-copy-label').textContent }; })()`;
  // Заполнить заявку: первая свободная позиция, адрес, завтра, 09:00, +2 к минимуму, зона «Пригород…», комментарий, согласие.
  const fillOrder = async () => {
    await tap(FIRST_FREE);
    await type('#address', 'Тестовый адрес, 5');
    await tap('[data-date="tomorrow"]');
    await setValue('#time', '09:00');
    await tap('#units-plus'); await tap('#units-plus');
    if (await js("Boolean(document.getElementById('zone'))")) {
      await setValue('#zone', await js("([...document.querySelectorAll('#zone option')].find((o) => /Пригород/.test(o.textContent)) || [...document.querySelectorAll('#zone option')].pop()).value"));
    }
    await type('#comment', 'нужен ковш 0,5');
    await tap('#consent');
  };

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const shots = [];
  const NOSCROLL = '({ sw: document.documentElement.scrollWidth, iw: innerWidth })';
  const SMALL = `[...document.querySelectorAll('a.btn, button, .chip, .check, .input')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
    .map((e) => ({ t: (e.textContent.trim() || e.id || e.className).slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((e) => e.h < 44)`;
  const SELECTED = "({ cards: [...document.querySelectorAll('.mc.is-selected')].map((e) => e.dataset.id), select: document.getElementById('machine').value })";
  const FIRST_FREE = '.mc--free .mc__btn';
  const setValue = (sel, value) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  // ---------- 360 ----------
  await open(360, 740, true);
  // Лента каталога: прокручивается сама, страница — нет; счётчик и точки.
  const strip = await js(`(() => { const g = document.querySelector('.grid'); const st = getComputedStyle(g);
    return { overflow: st.overflowX, snap: st.scrollSnapType, sw: g.scrollWidth, cw: g.clientWidth, cards: g.children.length,
      cardW: Math.round(g.children[0].getBoundingClientRect().width), counter: document.getElementById('park-counter').textContent,
      dots: document.querySelectorAll('#park-dots button').length }; })()`);
  check('360: каталог — горизонтальная лента (overflow-x auto, scroll-snap, карточка ≈ 85%)',
    strip.overflow === 'auto' && /x/.test(strip.snap) && strip.sw > strip.cw && strip.cardW < strip.cw,
    `${strip.cards} карточек, карточка ${strip.cardW}px из ${strip.cw}px, ${strip.snap}`);
  check('360: точки-индикаторы ≤ 8', strip.dots > 0 && strip.dots <= 8, `${strip.dots}`);
  await js("document.querySelector('.grid').scrollBy({ left: document.querySelector('.mc').offsetWidth + 12 })");
  await sleep(500);
  const c2 = await js("document.getElementById('park-counter').textContent");
  await tap('#park-dots button:last-child');
  await sleep(600);
  const c3 = await js("document.getElementById('park-counter').textContent");
  await js("document.querySelector('.grid').scrollTo({ left: 0 })");
  await sleep(400);
  check('360: лента прокручивается, счётчик меняется (прокрутка, тап по точке)', strip.counter !== c2 && c2 !== c3,
    `${strip.counter} → ${c2} → ${c3}`);
  const demo = await js("({ bar: document.querySelector('.demo-bar')?.getBoundingClientRect().height ?? null, robots: document.querySelector('meta[name=robots]')?.content ?? null })");
  if (demo.bar !== null) {
    check('плашка демо видна и ≤ 36px', demo.bar > 0 && demo.bar <= 36, `${demo.bar}px`);
    check('meta robots noindex', demo.robots === 'noindex, nofollow', demo.robots);
  }
  const hero = await js(`(() => { const t = document.querySelector('.hero__title'); const lh = parseFloat(getComputedStyle(t).lineHeight);
    const btns = [...document.querySelectorAll('.hero__actions .btn')].map((e) => e.getBoundingClientRect());
    return { lines: Math.round(t.getBoundingClientRect().height / lh), size: getComputedStyle(t).fontSize,
      stacked: btns.length < 2 || btns[1].top >= btns[0].bottom, oneLine: [...document.querySelectorAll('.hero__actions .btn')].every((e) => e.getBoundingClientRect().height < 60) }; })()`);
  check(`заголовок первого экрана ≤ ${heroMaxLines} строк на 360px`, hero.lines <= heroMaxLines, `${hero.lines} строки, ${hero.size}`);
  check('кнопки первого экрана друг под другом, текст в одну строку', hero.stacked && hero.oneLine, '');
  const head = await js(`(() => { const n = document.querySelector('.brand__name'), b = document.querySelector('.top__channel'), r = b.getBoundingClientRect();
    const t = document.querySelector('.top__channel-text');
    return { name: { sw: n.scrollWidth, cw: n.clientWidth, overflow: getComputedStyle(n).textOverflow,
      lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) },
      btn: { w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label'), textShown: Boolean(t && t.getClientRects().length) } }; })()`);
  check('нет многоточия у названия в шапке (scrollWidth == clientWidth, без text-overflow, ≤ 2 строк)',
    head.name.sw === head.name.cw && head.name.overflow !== 'ellipsis' && head.name.lines <= 2,
    `${head.name.sw} = ${head.name.cw}, text-overflow: ${head.name.overflow}, строк: ${head.name.lines}`);
  check('шапка 360: круглая кнопка канала 44×44 без подписи, с aria-label', head.btn.w === 44 && head.btn.h === 44 && !head.btn.textShown && Boolean(head.btn.label),
    `${head.btn.w}×${head.btn.h}, aria-label «${head.btn.label}»`);
  const titles = await js(`[...document.querySelectorAll('.mc__title')].map((e) => ({ t: e.textContent, cut: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1 }))`);
  check('название карточки на 360px не обрезано', titles.every((t) => !t.cut), `${titles.length} карточек`);
  const s1 = await js(NOSCROLL);
  check('нет горизонтального скролла (360, до выбора)', s1.sw === s1.iw, `${s1.sw} = ${s1.iw}`);
  const small360a = await js(SMALL);
  shots.push(await shot('360-full', true));

  const hasBusy = await js("Boolean(document.querySelector('.mc--busy'))");
  if (hasBusy) {
    await tap('.mc--busy .mc__media');
    await tap('.mc--busy .mc__btn');
    const r = await js(SELECTED);
    const inSelect = await js("[...document.querySelectorAll('#machine option')].some((o) => o.value === document.querySelector('.mc--busy').dataset.id)");
    check('busy: карточка не выбирается и её нет в списке расчёта', r.cards.length === 0 && r.select === '' && !inSelect, JSON.stringify(r));
  }
  if (await js("Boolean(document.querySelector('.mc--confirm'))")) {
    await tap('.mc--confirm .mc__btn');
    const r = await js(SELECTED);
    const id = await js("document.querySelector('.mc--confirm').dataset.id");
    check('confirm: карточка выбирается, select синхронизирован', r.cards[0] === id && r.select === id, JSON.stringify(r));
  }

  await tap(FIRST_FREE);
  const picked = await js(SELECTED);
  check('выбор карточкой → select в расчёте', picked.cards.length === 1 && picked.select === picked.cards[0], JSON.stringify(picked));
  const btnTexts = await js("[...document.querySelectorAll('.mc__btn')].map((b) => b.textContent.trim())");
  check('кнопки карточек: «Техника выбрана» / «Выбрать» / «Сейчас занята»',
    btnTexts.includes('Техника выбрана') && btnTexts.includes('Выбрать') && (!hasBusy || btnTexts.includes('Сейчас занята')), btnTexts.join(', '));
  const calcTop = await js("({ calc: Math.round(document.getElementById('calc').getBoundingClientRect().top), sticky: Math.round(document.querySelector('.sticky').getBoundingClientRect().bottom) })");
  check('после выбора экран прокручен к расчёту, не под шапку', calcTop.calc >= calcTop.sticky && calcTop.calc < 200, `верх расчёта ${calcTop.calc} ≥ низ шапки ${calcTop.sticky}`);
  shots.push(await shot('360-selected', false));
  const s2 = await js(NOSCROLL);
  check('нет горизонтального скролла (360, после выбора)', s2.sw === s2.iw, `${s2.sw} = ${s2.iw}`);

  // Выбор через select → карточка в каталоге.
  const otherId = await js("[...document.querySelectorAll('#machine option')].map((o) => o.value).filter(Boolean).pop()");
  await setValue('#machine', otherId);
  const viaSelect = await js(SELECTED);
  check('выбор в select → карточка в каталоге', viaSelect.cards[0] === otherId, JSON.stringify(viaSelect));
  await tap(FIRST_FREE);

  if (hasBusy) {
    await tap('.mc--busy .mc__btn');
    const after = await js(SELECTED);
    check('тап по занятой после выбора не меняет выбор', JSON.stringify(after) === JSON.stringify(picked), JSON.stringify(after));
  }

  // Цена в панели: одна строка + «предварительно».
  const BAR_LINES = `(() => { const el = document.getElementById('bar-total');
    const range = document.createRange(); range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    const pre = document.getElementById('bar-pre');
    return { text: el.textContent, lines: tops.size, pre: pre.hidden ? '' : pre.textContent,
      fits: el.parentElement.scrollWidth <= el.parentElement.clientWidth, btn: document.getElementById('submit').innerText.trim() }; })()`;
  const bar1 = await js(BAR_LINES);
  check('панель 360: сумма в одну строку + «предварительно», кнопка «Отправить»',
    bar1.lines === 1 && bar1.fits && bar1.pre === 'предварительно' && bar1.btn === 'Отправить',
    `«${bar1.text}» — строк: ${bar1.lines}, ${bar1.pre}, кнопка «${bar1.btn}»`);

  await tap('#submit');
  const firstErr = await js("({ f: document.querySelector('.field.is-invalid')?.dataset.field, msg: document.querySelector('.field.is-invalid .err')?.textContent })");
  check('пустая отправка: подсвечено первое незаполненное поле', firstErr.f === 'address', `${firstErr.f}: ${firstErr.msg}`);

  const small360 = [...small360a, ...(await js(SMALL))];
  check('кнопки, чипы и поля ≥ 44px (360)', small360.length === 0, JSON.stringify(small360));

  const overlap = await js(`(() => { const f = document.querySelector('[data-field="consent"]'); f.scrollIntoView({ block: 'end' });
    const fr = f.getBoundingClientRect(), br = document.getElementById('bar').getBoundingClientRect();
    return { field: Math.round(fr.bottom), bar: Math.round(br.top), pad: parseFloat(getComputedStyle(document.body).paddingBottom), barH: Math.round(br.height) }; })()`);
  check('нижняя панель не перекрывает последнее поле', overlap.field <= overlap.bar && overlap.pad >= overlap.barH,
    `низ поля ${overlap.field} ≤ верх панели ${overlap.bar}; padding-bottom ${overlap.pad}px ≥ панель ${overlap.barH}px`);

  // Дата: три чипа в одну строку; «Другая дата» — поле на всю ширину колонки.
  const DATE_CHECK = `(() => { const chips = [...document.querySelectorAll('[data-date]')].map((c) => c.getBoundingClientRect());
    return { oneLine: chips.every((r) => Math.round(r.top) === Math.round(chips[0].top)), chipsFit: [...document.querySelectorAll('[data-date]')].every((c) => c.scrollWidth <= c.clientWidth) }; })()`;
  const dates360 = await js(DATE_CHECK);
  await tap('[data-date="other"]');
  const other360 = await js(`(() => { const box = document.getElementById('date-other'), f = document.querySelector('[data-field="date"]'), i = document.getElementById('date');
    return { shown: !box.hidden, full: Math.round(box.getBoundingClientRect().width) === Math.round(f.getBoundingClientRect().width), fits: i.scrollWidth <= i.clientWidth }; })()`);
  check('360: дата — «Сегодня / Завтра / Другая дата» в одну строку, «Другая дата» открывает поле на всю ширину',
    dates360.oneLine && dates360.chipsFit && other360.shown && other360.full && other360.fits, JSON.stringify({ ...dates360, ...other360 }));
  const opts = await js("[...document.querySelectorAll('#machine option')].filter((o) => o.value).map((o) => o.textContent)");
  check('360: в списке техники только названия (без цены)', opts.every((t) => !t.includes('·')), opts.slice(0, 3).join('; '));

  // Заполняем: адрес, завтра, время, +2 к часам, зона «Пригород…» (или последняя), комментарий, согласие → «Отправить».
  await type('#address', 'Тестовый адрес, 5');
  await tap('[data-date="tomorrow"]');
  await setValue('#time', '09:00');
  await tap('#units-plus'); await tap('#units-plus');
  if (await js("Boolean(document.getElementById('zone'))")) {
    await setValue('#zone', await js("([...document.querySelectorAll('#zone option')].find((o) => /Пригород/.test(o.textContent)) || [...document.querySelectorAll('#zone option')].pop()).value"));
  }
  await type('#comment', 'нужен ковш 0,5');
  await tap('#consent');
  const summary360 = await js(`[...document.querySelectorAll('.summary__rows div')].filter((d) => !d.hidden).map((d) => d.querySelector('dt').textContent + ': ' + d.querySelector('dd').textContent)
    .concat('Итого: ' + document.getElementById('sum-total').textContent)`);
  const price360 = await js("document.getElementById('bar-total').textContent");
  const bar2 = await js(BAR_LINES);
  check('панель 360 с доставкой: сумма в одну строку', bar2.lines === 1 && bar2.fits, `«${bar2.text}» — строк: ${bar2.lines}`);
  await tap('#submit');
  await sleep(300);
  const sh1 = await js(SHEET);
  check('360: «Отправить» открывает окно заявки снизу во всю ширину (bottom sheet)', sh1.open && sh1.w === sh1.vw && sh1.bottom === sh1.vh,
    `«${sh1.title}» ${sh1.sub}; ширина ${sh1.w} из ${sh1.vw}, низ ${sh1.bottom} = ${sh1.vh}`);
  check('360: фокус внутри окна', sh1.focusInside, `на ${sh1.active}`);
  for (let i = 0; i < 6; i++) await key('Tab', 'Tab');
  const trap = await js(SHEET);
  check('360: Tab не выводит фокус из окна', trap.focusInside, `после 6×Tab на ${trap.active}`);
  shots.push(await shot('360-sheet', false));
  await key('Escape', 'Escape');
  const afterEsc = await js("({ open: !document.getElementById('sheet').hidden, active: document.activeElement.id })");
  check('360: Esc закрывает окно, фокус возвращается на кнопку', !afterEsc.open && afterEsc.active === 'submit', JSON.stringify(afterEsc));
  await tap('#submit');
  await tap('#sheet-copy');
  await sleep(200);
  const copied = await js(`(async () => { const label = document.querySelector('.js-copy-label').textContent;
    let clip = ''; try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'нет доступа: ' + e.name; }
    // Windows отдаёт буфер с переводами строк \\r\\n — сравниваем без них.
    return { label, same: clip.replace(/\\r\\n/g, '\\n') === document.getElementById('sheet-text').textContent, clip: clip.slice(0, 40) }; })()`);
  check('360: «Скопировать заявку» → «Скопировано ✓», в буфере текст заявки', copied.label === 'Скопировано ✓' && copied.same, JSON.stringify(copied));
  const sheetText360 = sh1.text;
  const linksBefore = waLinks.length;
  await tap('#sheet-open');
  await sleep(1200);
  const opened = await js(SHEET).catch(() => ({ hint: false }));
  check(`360: «${(await js("document.getElementById('sheet-open').textContent.trim()").catch(() => 'Открыть'))}» ведёт в мессенджер`, waLinks.length > linksBefore,
    waLinks[waLinks.length - 1] ? waLinks[waLinks.length - 1].slice(0, 60) + '…' : 'перехода не было');
  const openedHint = opened.hint;
  const shareHref = sh1.share;

  // ---------- 1280 ----------
  await open(1280, 800, false);
  const dcols = await js("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length");
  check('карточки 4 колонки на 1280px', dcols === 4, `${dcols}`);
  const d1 = await js(NOSCROLL);
  check('нет горизонтального скролла (1280)', d1.sw === d1.iw, `${d1.sw} = ${d1.iw}`);
  shots.push(await shot('1280', true));
  const rows = await js(`(() => { const byRow = {};
    document.querySelectorAll('.mc').forEach((c) => { const t = Math.round(c.getBoundingClientRect().top);
      (byRow[t] = byRow[t] || []).push(Math.round(c.querySelector('.mc__btn').getBoundingClientRect().top)); });
    return Object.values(byRow); })()`);
  check('1280: в каждом ряду кнопки карточек на одной высоте', rows.every((r) => r.every((y) => y === r[0])), rows.map((r) => r.join('/')).join(' | '));
  const opts1280 = await js("[...document.querySelectorAll('#machine option')].filter((o) => o.value).map((o) => o.textContent)");
  const dates1280 = await js(DATE_CHECK);
  check('1280: чипы даты в одну строку, в списке техники — с ценой', dates1280.oneLine && dates1280.chipsFit && opts1280.every((t) => t.includes('·')), opts1280[0]);
  await tap(FIRST_FREE);
  await sleep(150);
  const desk = await js(`(() => { const f = document.getElementById('order-form').getBoundingClientRect(), s = document.querySelector('.summary').getBoundingClientRect();
    return { sumLeft: Math.round(s.left), formRight: Math.round(f.right), barShown: getComputedStyle(document.getElementById('bar')).display !== 'none',
      ratio: Math.round(f.width / (f.width + s.width) * 100) }; })()`);
  check('1280: «Итоговая стоимость» справа от формы, нижней панели нет', !desk.barShown && desk.formRight <= desk.sumLeft,
    `форма ${desk.ratio}% ширины, правый край ${desk.formRight} ≤ ${desk.sumLeft}`);
  const sticky = await js(`(() => { window.scrollBy(0, 400); const s = document.querySelector('.summary').getBoundingClientRect();
    const top = document.querySelector('.sticky').getBoundingClientRect().bottom; return { sum: Math.round(s.top), sticky: Math.round(top) }; })()`);
  check('1280: «Итоговая стоимость» закреплена ниже шапки', sticky.sum >= sticky.sticky, `верх карточки ${sticky.sum} ≥ низ шапки ${sticky.sticky}`);
  await js("document.getElementById('calc').scrollIntoView({ block: 'start' })");
  await sleep(150);
  shots.push(await shot('1280-selected', false));
  const small1280 = await js(SMALL);
  check('кнопки, чипы и поля ≥ 44px (1280)', small1280.length === 0, JSON.stringify(small1280));

  await open(1280, 800, false);
  await fillOrder();
  await tap('.summary .js-submit');
  await sleep(300);
  const sh2 = await js(SHEET);
  check('1280: окно заявки по центру, ширина 480px', sh2.open && sh2.w === 480 && Math.abs(sh2.left - (sh2.vw - 480) / 2) <= 1,
    `ширина ${sh2.w}, слева ${sh2.left}, сверху ${sh2.top}`);
  shots.push(await shot('1280-sheet', false));
  for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: 20, y: 400, button: 'left', clickCount: 1 });
  await sleep(200);
  const afterBackdrop = await js("({ open: !document.getElementById('sheet').hidden, active: document.activeElement.className })");
  check('1280: тап по фону закрывает окно, фокус на кнопке', !afterBackdrop.open && /js-submit/.test(afterBackdrop.active), JSON.stringify(afterBackdrop));
  await tap('.summary .js-submit');
  await tap('.sheet__close');
  check('1280: крестик закрывает окно', await js("document.getElementById('sheet').hidden"), '');

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
  console.log(`После заполнения (360): панель «${price360}»; ${summary360.join('; ')}`);
  if (waLinks.length) {
    console.log(`Переход по «Открыть …» (перехвачен, не отправлен): ${waLinks[waLinks.length - 1]}`);
    const text = new URL(waLinks[waLinks.length - 1]).searchParams.get('text');
    if (text) console.log(`Текст заявки из ссылки:\n${text.split('\n').map((l) => `  | ${l}`).join('\n')}`);
    console.log(`Текст в ссылке совпадает с окном: ${text === sheetText360 ? 'да' : 'НЕТ'}`);
  } else {
    console.log('Переход по «Открыть …»: не было');
  }
  if (openedHint) console.log('Подсказка «Заявка скопирована — вставьте её в чат и отправьте»: показана');
  if (shareHref) console.log(`«Поделиться через Telegram»: ${decodeURIComponent(shareHref).slice(0, 80)}…`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
