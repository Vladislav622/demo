// Скриншоты и проверки страницы компании в headless Edge/Chrome (протокол DevTools).
// Только встроенные модули Node (нужен Node ≥ 22: глобальные fetch и WebSocket) + установленный Edge или Chrome.
//
// node tests/screens.js <slug> [--quick]
//   Берёт preview/<slug>/ (после node build.js --test) или docs/<slug>/.
//   Сам определяет, что есть на странице (свободные позиции, зоны, канал), и запускает подходящие проверки.
//   Пишет скриншоты checks/<slug>-*.png и итог checks/<slug>-result.json, печатает проверки «да/нет».
//   --quick — без замера Slow 3G. Код выхода 1, если какая-то проверка «нет».

'use strict';

const fs = require('fs');
const path = require('path');
const { serve, launch, sleep, fail } = require('./browser.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'checks');

// ---------- Проверки доступности (выполняются на странице; передаются через toString) ----------

// Контраст текста ≥ 4,5:1 по вычисленным цветам: фон — с учётом полупрозрачных слоёв, текст — с учётом opacity.
function contrastProbe() {
  const parse = (c) => {
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] != null ? Number(m[4]) : 1];
    return [0, 0, 0, 0];
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const blend = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bad = [];
  let n = 0;
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (seen.has(el)) continue;
    seen.add(el);
    if (!el.getClientRects().length || el.closest('[hidden], [aria-hidden="true"], script, style, option, .sheet__area')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fg = parse(cs.color);
    const bg = bgOf(el);
    const r = ratio(blend([fg[0], fg[1], fg[2], fg[3] * opacityOf(el)], bg), bg);
    n++;
    if (r < 4.5) bad.push(`«${t.textContent.trim().slice(0, 22)}» ${r.toFixed(2)}`);
  }
  document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((i) => {
    if (!i.getClientRects().length) return;
    const bg = bgOf(i);
    const r = ratio(blend(parse(getComputedStyle(i, '::placeholder').color), bg), bg);
    n++;
    if (r < 4.5) bad.push(`плейсхолдер #${i.id} ${r.toFixed(2)}`);
  });
  return { n, total: bad.length, bad: bad.slice(0, 8) };
}

// Структура: язык, ориентиры, один h1, заголовки без пропусков уровней, подписи у полей, подписи карточек.
function structureProbe() {
  const levels = [...document.querySelectorAll('h1, h2, h3, h4')].filter((e) => !e.closest('[hidden]')).map((e) => Number(e.tagName[1]));
  let skip = '';
  for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skip = `h${levels[i - 1]} → h${levels[i]}`;
  const unlabeled = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
    .filter((e) => e.id !== 'sheet-area' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby'))
    .map((e) => e.id || e.name);
  return {
    lang: document.documentElement.lang, h1: levels.filter((x) => x === 1).length, skip,
    landmarks: ['header', 'main', 'footer'].filter((t) => !document.querySelector(t)),
    unlabeled,
    cards: [...document.querySelectorAll('.mc__btn:not([disabled])')].every((b) => /^Выбрать: .+, (свободна|требует подтверждения)$/.test(b.getAttribute('aria-label') || '')),
    live: Boolean(document.querySelector('#sum-total[aria-live]') || !document.querySelector('#sum-total')) && Boolean(document.querySelector('#park-counter[aria-live]') || !document.querySelector('#park-counter')),
  };
}

function readConfig(slug) {
  for (const dir of ['companies', path.join('tests', 'fixtures')]) {
    const f = path.join(ROOT, dir, slug, 'config.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return {};
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--prefix');
  const quick = args.includes('--quick');
  if (!slug) fail('укажите slug: node tests/screens.js _sample');
  const base = ['preview', 'docs'].map((d) => path.join(ROOT, d)).find((d) => fs.existsSync(path.join(d, slug, 'index.html')));
  if (!base) fail(`нет preview/${slug}/index.html и docs/${slug}/index.html — сначала соберите: node build.js --test`);

  const cfg = readConfig(slug);
  // city_in или hero_title: заголовку первого экрана допустимо 3 строки; длинное название в шапке — до 3 строк.
  const heroMaxLines = String(cfg.city_in || '').trim() || String(cfg.hero_title || '').trim() ? 3 : 2;
  const nameMaxLines = Array.from(String(cfg.name || '')).length > 28 ? 3 : 2;

  fs.mkdirSync(OUT, { recursive: true });
  // --prefix /repo/ — раздача из подпапки, как на GitHub Pages (https://<user>.github.io/<repo>/): все пути должны быть относительными.
  const pi = args.indexOf('--prefix');
  const prefix = pi >= 0 ? `/${args[pi + 1].replace(/^\/+|\/+$/g, '')}/` : '/';
  const tag = prefix === '/' ? slug : `${slug}-${prefix.replace(/\//g, '')}`;
  const server = await serve(base, prefix);
  const url = `http://127.0.0.1:${server.address().port}${prefix}${slug}/`;
  const b = await launch();

  const errors = [];
  const navLinks = [];
  b.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || 'ошибка JS');
    if (msg.method === 'Fetch.requestPaused') {
      navLinks.push(msg.params.request.url);
      b.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Aborted' }).catch(() => {});
    }
    // Диалог (например, beforeunload) не должен останавливать прогон — закрываем и считаем ошибкой.
    if (msg.method === 'Page.javascriptDialogOpening') {
      errors.push(`неожиданный диалог ${msg.params.type}: ${msg.params.message}`);
      b.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });

  const js = async (expr) => {
    const r = await b.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description || 'ошибка в проверке'}\n  в выражении: ${expr.slice(0, 160)}`);
    return r.result.value;
  };
  const open = async (w, h, mobile, target = url, keepDraft = false) => {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    if (!keepDraft) await js('try { sessionStorage.clear(); } catch (e) {}').catch(() => {});
    await b.send('Page.navigate', { url: target });
    for (let i = 0; i < 60; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; }
    await sleep(300);
  };
  const shot = async (name, full) => {
    let params = { format: 'png' };
    if (full) {
      // Снимок всей страницы — от самого верха, иначе закреплённая шапка окажется посередине.
      await js('window.scrollTo(0, 0)');
      // Ленивые картинки ниже экрана сами не загрузятся — догружаем перед съёмкой всей страницы.
      await js(`Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); }))`);
      // vh при съёмке всей страницы растягивается — фиксируем высоту первого экрана; закреплённые снизу панели ставим в поток.
      // Через CSSOM (element.style), а не <style>: страница под CSP и чужой <style> не примет.
      await js(`(() => { const hero = document.querySelector('.hero'); const fixed = [];
        const set = (e, prop, v) => { fixed.push([e, prop]); e.style.setProperty(prop, v, 'important'); };
        document.querySelectorAll('.adm-bar').forEach((e) => set(e, 'position', 'static'));
        if (hero) { const h = hero.getBoundingClientRect().height + 'px'; set(hero, 'min-height', h); set(hero, 'max-height', h); }
        window.__fixShot = fixed; })()`);
      const size = await js('({ w: document.documentElement.clientWidth, h: document.documentElement.scrollHeight })');
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 } };
    }
    const r = await b.send('Page.captureScreenshot', params);
    if (full) await js("(window.__fixShot || []).forEach(([e, prop]) => e.style.removeProperty(prop))");
    const file = path.join(OUT, `${tag}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return path.relative(ROOT, file).split(path.sep).join('/');
  };
  // Настоящий тап мышью в центр элемента (а не element.click()).
  const tap = async (sel) => {
    const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!p) throw new Error(`нет элемента ${sel} на ${await js("location.href")}`);
    for (const t of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type: t, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    }
    await sleep(250);
  };
  const type = async (sel, text) => { await tap(sel); await b.send('Input.insertText', { text }); };
  const setValue = (sel, value) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const KEYS = { Escape: 27, Tab: 9, Enter: 13, ' ': 32, ArrowDown: 40 };
  const key = async (k, mods = 0) => {
    // Enter и пробел нажимают кнопку только вместе с текстом символа — как настоящая клавиатура.
    const text = { Enter: '\r', ' ': ' ' }[k];
    for (const t of ['keyDown', 'keyUp']) {
      await b.send('Input.dispatchKeyEvent', { type: t === 'keyDown' && text ? 'keyDown' : t, key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: KEYS[k], modifiers: mods, ...(t === 'keyDown' && text ? { text } : {}) });
    }
    await sleep(120);
  };

  await b.send('Page.enable');
  await b.send('Runtime.enable');
  // Нарушения CSP: страница сообщает о них через привязку __csp (скрипт добавляется до кода страницы, CSP на него не действует).
  const cspViolations = [];
  b.on((msg) => { if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__csp') cspViolations.push(msg.params.payload); });
  await b.send('Runtime.addBinding', { name: '__csp' });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('securitypolicyviolation', (e) => window.__csp(location.pathname + ': ' + e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '')));" });
  await b.send('Fetch.enable', { patterns: [{ urlPattern: 'https://wa.me/*' }, { urlPattern: 'https://api.whatsapp.com/*' }, { urlPattern: 'https://t.me/*' }] });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail == null ? '' : String(detail) });
  const shots = [];
  const notes = [];
  const NOSCROLL = '({ sw: document.documentElement.scrollWidth, iw: innerWidth })';
  const SMALL = `[...document.querySelectorAll('a.btn, button, .chip, .check, .input')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'))
    .map((e) => ({ t: (e.textContent.trim() || e.id || e.className).slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
    .filter((e) => e.h < 44)`;
  const SELECTED = "({ cards: [...document.querySelectorAll('.mc.is-selected')].map((e) => e.dataset.id), select: document.getElementById('machine').value })";
  const FEATURES = `(() => { const d = JSON.parse(document.getElementById('site-data').textContent);
    const st = (s) => d.machines.filter((m) => m.status === s).map((m) => m.id);
    return { channel: d.channel, zones: d.zones.length, cards: d.machines.length, free: st('free'), busy: st('busy'), confirm: st('confirm'),
      priced: d.machines.filter((m) => m.status !== 'busy' && m.rate_from != null).map((m) => m.id) }; })()`;
  const SHEET = `(() => { const sh = document.getElementById('sheet'), p = sh.querySelector('.sheet__panel'), r = p.getBoundingClientRect();
    return { open: !sh.hidden, title: document.getElementById('sheet-title').textContent, sub: document.getElementById('sheet-sub').textContent,
      text: document.getElementById('sheet-text').textContent, w: Math.round(r.width), left: Math.round(r.left), bottom: Math.round(r.bottom), top: Math.round(r.top),
      vw: innerWidth, vh: innerHeight, focusInside: p.contains(document.activeElement), active: document.activeElement.id || document.activeElement.className,
      share: document.getElementById('sheet-share')?.getAttribute('href') || '', hint: !document.getElementById('sheet-hint').hidden,
      copy: document.querySelector('.js-copy-label').textContent }; })()`;

  const F = await (async () => { await open(360, 740, true); return js(FEATURES); })();
  const selectable = [...F.free, ...F.confirm];
  const firstFree = F.free[0] || F.confirm[0];
  const card = (id) => `.mc[data-id="${id}"]`;

  // Заполнить заявку: позиция, адрес, завтра, 09:00, +2 к минимуму, зона «Пригород…», комментарий, согласие.
  const fillOrder = async (id) => {
    await tap(`${card(id)} .mc__btn`);
    await type('#address', 'Тестовый адрес, 5');
    await tap('[data-date="tomorrow"]');
    await setValue('#time', '09:00');
    await tap('#units-plus'); await tap('#units-plus');
    if (F.zones) {
      await setValue('#zone', await js("([...document.querySelectorAll('#zone option')].find((o) => /Пригород/.test(o.textContent)) || [...document.querySelectorAll('#zone option')].pop()).value"));
    }
    await type('#comment', 'нужен ковш 0,5');
    if (await js("!document.querySelector('[data-field=\"consent\"]').hidden")) await tap('#consent');
  };

  // Доступна ровно одна позиция — она выбрана сразу при загрузке.
  if (selectable.length === 1) {
    const auto = await js(`(() => { const c = document.querySelector('.mc[data-id="${selectable[0]}"]'); const t = document.getElementById('sum-total');
      return { selected: c.classList.contains('is-selected'), btn: c.querySelector('.mc__btn-text').textContent, select: document.getElementById('machine').value,
        total: t ? t.textContent.trim() : '', priced: JSON.parse(document.getElementById('site-data').textContent).machines.some((m) => m.id === '${selectable[0]}' && m.rate_from != null) }; })()`);
    check('одна доступная позиция выбрана сразу: «Техника выбрана», список заполнен, итог посчитан (если есть цена)',
      auto.selected && auto.btn === 'Техника выбрана' && auto.select === selectable[0] && (!auto.priced || /\d/.test(auto.total)), JSON.stringify(auto));
  }

  // ---------- 360: шапка, первый экран, каталог ----------
  const demo = await js("({ bar: document.querySelector('.demo-bar')?.getBoundingClientRect().height ?? null, robots: document.querySelector('meta[name=robots]')?.content ?? null })");
  if (demo.bar !== null) {
    check('плашка демо видна и ≤ 36px', demo.bar > 0 && demo.bar <= 36, `${demo.bar}px`);
    check('meta robots noindex', demo.robots === 'noindex, nofollow', demo.robots);
  }
  const meta = await js(`(async () => { const q = (s) => document.querySelector(s);
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = src; });
    return { title: document.title, desc: q('meta[name=description]')?.content, og: q('meta[property="og:title"]')?.content, locale: q('meta[property="og:locale"]')?.content,
      theme: q('meta[name=theme-color]')?.content, icon: await load(q('link[rel=icon]').href), touch: await load(q('link[rel=apple-touch-icon]').href) }; })()`);
  check('превью и значки: title, description, og:title, ru_RU, theme-color, favicon, apple-touch-icon 180',
    /^Аренда спецтехники — /.test(meta.title) && meta.desc && meta.og === meta.title && meta.locale === 'ru_RU' && /^#[0-9a-f]{6}$/.test(meta.theme) && meta.icon > 0 && meta.touch === 180,
    `«${meta.title}», theme ${meta.theme}, значок ${meta.icon}px, touch ${meta.touch}px`);
  const st = await js(`(${structureProbe})()`);
  check('доступность: lang=ru, header/main/footer, один h1, заголовки без пропусков, у полей есть подписи',
    st.lang === 'ru' && !st.landmarks.length && st.h1 === 1 && !st.skip && !st.unlabeled.length,
    `h1: ${st.h1}${st.skip ? `, пропуск ${st.skip}` : ''}${st.landmarks.length ? `, нет ${st.landmarks}` : ''}${st.unlabeled.length ? `, без подписи: ${st.unlabeled}` : ''}`);
  check('карточки — кнопки с понятной подписью; сумма и счётчик ленты озвучиваются (aria-live)', st.cards && st.live, '');
  const c360 = await js(`(${contrastProbe})()`);
  check('контраст текста ≥ 4,5:1 (360, страница)', c360.total === 0, `проверено ${c360.n}${c360.total ? `; ниже нормы: ${c360.bad.join(', ')}` : ''}`);
  const motion = await js("({ scroll: getComputedStyle(document.documentElement).scrollBehavior, anim: getComputedStyle(document.querySelector('.bar')).animationName })");
  check('prefers-reduced-motion: без плавной прокрутки и анимаций', motion.scroll === 'auto' && motion.anim === 'none', JSON.stringify(motion));
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
  check(`нет многоточия у названия в шапке (≤ ${nameMaxLines} строк)`,
    head.name.sw === head.name.cw && head.name.overflow !== 'ellipsis' && head.name.lines <= nameMaxLines,
    `${head.name.sw} = ${head.name.cw}, строк: ${head.name.lines}`);
  check('шапка 360: круглая кнопка канала 44×44 с aria-label', head.btn.w === 44 && head.btn.h === 44 && !head.btn.textShown && Boolean(head.btn.label),
    `${head.btn.w}×${head.btn.h}, «${head.btn.label}»`);
  const titles = await js("[...document.querySelectorAll('.mc__title')].map((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)");
  check('названия карточек на 360px не обрезаны', titles.every((c) => !c), `${titles.length} карточек`);
  const s1 = await js(NOSCROLL);
  check('нет горизонтального скролла страницы (360)', s1.sw === s1.iw, `${s1.sw} = ${s1.iw}`);

  const strip = await js(`(() => { const g = document.querySelector('.grid'); const st = getComputedStyle(g);
    return { overflow: st.overflowX, sw: g.scrollWidth, cw: g.clientWidth, inner: Math.round(g.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)), cardW: Math.round(g.children[0].getBoundingClientRect().width),
      counter: document.getElementById('park-counter')?.textContent ?? null, dots: document.querySelectorAll('#park-dots button').length }; })()`);
  if (F.cards > 1) {
    check('360: каталог — горизонтальная лента, видна следующая карточка', strip.overflow === 'auto' && strip.sw > strip.cw && strip.cardW < strip.cw,
      `${F.cards} карточек, карточка ${strip.cardW} из ${strip.cw}px`);
    check('360: точки-индикаторы ≤ 8', strip.dots > 0 && strip.dots <= 8, `${strip.dots}`);
    await js("document.querySelector('.grid').scrollBy({ left: document.querySelector('.mc').offsetWidth + 12 })");
    await sleep(500);
    const c2 = await js("document.getElementById('park-counter').textContent");
    await tap('#park-dots button:first-child');
    await sleep(600);
    const c3 = await js("document.getElementById('park-counter').textContent");
    await js("document.querySelector('.grid').scrollTo({ left: 0 })");
    await sleep(400);
    check('360: лента прокручивается, счётчик меняется (листание, тап по точке)', strip.counter !== c2 && c3 === strip.counter, `${strip.counter} → ${c2} → ${c3}`);
  } else {
    check('одна позиция: без счётчика и точек, карточка во всю ширину', strip.counter === null && strip.dots === 0 && strip.cardW === strip.inner,
      `карточка ${strip.cardW} из ${strip.inner}px`);
  }
  const small360a = await js(SMALL);
  shots.push(await shot('360-full', true));

  let sheetText = '';
  let sheetLink = '';
  if (!selectable.length) {
    // ---------- Всё занято ----------
    const ab = await js(`({ notice: !document.getElementById('allbusy').hidden, calc: !document.getElementById('calc-body').hidden,
      text: document.querySelector('#allbusy p').textContent, href: document.getElementById('allbusy-link').getAttribute('href'),
      bar: !document.getElementById('bar').hidden })`);
    check('всё занято: вместо расчёта сообщение и кнопка связи', ab.notice && !ab.calc && !ab.bar && /вся техника занята/.test(ab.text), ab.text);
    check('всё занято: кнопка ведёт в мессенджер с готовым вопросом', /^https:\/\/(wa\.me|t\.me)\/.+\?text=/.test(ab.href) || ab.href.startsWith('tel:'), decodeURIComponent(ab.href).slice(0, 90));
    await tap(`${card(F.busy[0])} .mc__media`);
    check('всё занято: карточки не выбираются', (await js(SELECTED)).cards.length === 0, '');
  } else {
    // ---------- Выбор и расчёт ----------
    if (F.busy.length) {
      await tap(`${card(F.busy[0])} .mc__btn`);
      const r = await js(SELECTED);
      const inSelect = await js(`[...document.querySelectorAll('#machine option')].some((o) => o.value === ${JSON.stringify(F.busy[0])})`);
      check('busy: карточка не выбирается и её нет в списке расчёта', r.cards.length === 0 && r.select === '' && !inSelect, JSON.stringify(r));
    }
    if (F.confirm.length) {
      await tap(`${card(F.confirm[0])} .mc__btn`);
      const r = await js(SELECTED);
      check('confirm: карточка выбирается, список синхронизирован', r.cards[0] === F.confirm[0] && r.select === F.confirm[0], JSON.stringify(r));
    }
    await tap(`${card(firstFree)} .mc__btn`);
    const picked = await js(SELECTED);
    check('выбор карточкой → позиция в расчёте', picked.cards[0] === firstFree && picked.select === firstFree, JSON.stringify(picked));
    const calcTop = await js("({ calc: Math.round(document.getElementById('calc').getBoundingClientRect().top), sticky: Math.round(document.querySelector('.sticky').getBoundingClientRect().bottom) })");
    check('после выбора экран у расчёта, не под шапкой', calcTop.calc >= calcTop.sticky && calcTop.calc < 220, `верх расчёта ${calcTop.calc}, низ шапки ${calcTop.sticky}`);
    shots.push(await shot('360-selected', false));
    const s2 = await js(NOSCROLL);
    check('нет горизонтального скролла страницы (360, после выбора)', s2.sw === s2.iw, `${s2.sw} = ${s2.iw}`);
    if (selectable.length > 1) {
      const otherId = selectable[selectable.length - 1];
      await setValue('#machine', otherId);
      check('выбор в списке → карточка в каталоге', (await js(SELECTED)).cards[0] === otherId, otherId);
      await tap(`${card(firstFree)} .mc__btn`);
    }

    // Нижняя панель: сумма в одну строку.
    const BAR = `(() => { const el = document.getElementById('bar-total'); const range = document.createRange(); range.selectNodeContents(el);
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      return { text: el.textContent, lines: tops.size, fits: el.parentElement.scrollWidth <= el.parentElement.clientWidth,
        btn: document.getElementById('submit').innerText.trim() }; })()`;
    const bar1 = await js(BAR);
    const priced = F.priced.includes(firstFree);
    check(priced ? 'панель 360: сумма в одну строку' : 'панель 360: «Цену назовёт менеджер» помещается', (priced ? bar1.lines === 1 : bar1.lines <= 2) && bar1.fits, `«${bar1.text}», кнопка «${bar1.btn}»`);

    // Подписи количества и быстрые значения по единице.
    const unitsInfo = await js("({ label: document.getElementById('units-label').textContent, out: document.getElementById('units-out').textContent, chips: [...document.querySelectorAll('#units-chips .chip')].map((c) => c.textContent) })");
    check('количество: подпись и склонение по единице', !/undefined|null|NaN/.test(JSON.stringify(unitsInfo)) && /\d/.test(unitsInfo.out),
      `${unitsInfo.label}: ${unitsInfo.out.replace(/\u00a0/g, ' ')}; чипы: ${unitsInfo.chips.join(', ').replace(/\u00a0/g, ' ') || '—'}`);

    if (F.channel === 'phone') {
      // ---------- Только телефон ----------
      const ph = await js(`({ consent: document.querySelector('[data-field="consent"]').hidden, hint: document.querySelector('.summary__phone')?.textContent || '',
        btn: document.getElementById('submit').innerText.trim(), href: document.querySelector('[data-ch-href]').getAttribute('href') })`);
      check('только телефон: кнопки «Позвонить», подсказка, согласие не нужно', ph.btn === 'Позвонить' && ph.consent && /по телефону/.test(ph.hint) && ph.href.startsWith('tel:'), `${ph.btn}; ${ph.href}`);
      // Нажатие ведёт на tel: — в headless-браузере это внешний протокол, после него ввод мышью не доходит;
      // поэтому проверяем, куда ведёт кнопка, без нажатия.
      const telHrefs = await js("[...document.querySelectorAll('[data-ch-href], #allbusy-link')].map((a) => a.getAttribute('href'))");
      check('только телефон: все кнопки связи ведут на tel:', telHrefs.every((h) => h.startsWith('tel:+')), telHrefs.join(', '));
    } else {
      await tap('#submit');
      const firstErr = await js("({ f: document.querySelector('.field.is-invalid')?.dataset.field, msg: document.querySelector('.field.is-invalid .err')?.textContent })");
      check('пустая отправка: подсвечено первое незаполненное поле', firstErr.f === 'address', `${firstErr.f}: ${firstErr.msg}`);
      const aria = await js("({ inv: document.getElementById('address').getAttribute('aria-invalid'), desc: document.getElementById('address').getAttribute('aria-describedby'), focus: document.activeElement.id })");
      check('ошибка связана с полем: aria-invalid, aria-describedby, фокус на поле', aria.inv === 'true' && /err-address/.test(aria.desc) && aria.focus === 'address', JSON.stringify(aria));

      // Дата: три чипа в одну строку; «Другая дата» — поле на всю ширину колонки.
      const dates = await js(`(() => { const chips = [...document.querySelectorAll('[data-date]')].map((c) => c.getBoundingClientRect());
        return { oneLine: chips.every((r) => Math.round(r.top) === Math.round(chips[0].top)), fit: [...document.querySelectorAll('[data-date]')].every((c) => c.scrollWidth <= c.clientWidth) }; })()`);
      await tap('[data-date="other"]');
      const other = await js(`(() => { const box = document.getElementById('date-other'), f = document.querySelector('[data-field="date"]'), i = document.getElementById('date');
        return { shown: !box.hidden, full: Math.round(box.getBoundingClientRect().width) === Math.round(f.getBoundingClientRect().width), fits: i.scrollWidth <= i.clientWidth }; })()`);
      check('360: «Сегодня / Завтра / Другая дата» в одну строку, «Другая дата» — поле на всю ширину', dates.oneLine && dates.fit && other.shown && other.full && other.fits, JSON.stringify({ ...dates, ...other }));
      const opts = await js("[...document.querySelectorAll('#machine option')].filter((o) => o.value).map((o) => o.textContent)");
      check('360: в списке техники только названия', opts.every((t) => !t.includes('·')), opts.slice(0, 2).join('; '));

      await js('document.activeElement.blur()');
      await sleep(100);
      const overlap = await js(`(() => { const f = document.querySelector('[data-field="consent"]'); f.scrollIntoView({ block: 'end' });
        const fr = f.getBoundingClientRect(), br = document.getElementById('bar').getBoundingClientRect();
        return { field: Math.round(fr.bottom), bar: Math.round(br.top), pad: parseFloat(getComputedStyle(document.body).paddingBottom), barH: Math.round(br.height) }; })()`);
      check('нижняя панель не перекрывает последнее поле', overlap.field <= overlap.bar && overlap.pad >= overlap.barH, `низ поля ${overlap.field} ≤ верх панели ${overlap.bar}`);

      // Комментарий: не больше 500 символов, счётчик; эмодзи не разрываются.
      await setValue('#comment', '🚜'.repeat(300) + 'а'.repeat(300));
      const cm = await js("({ len: Array.from(document.getElementById('comment').value).length, count: document.getElementById('comment-count').textContent, addr: document.getElementById('address').maxLength })");
      check('комментарий ≤ 500 символов со счётчиком, адрес ≤ 200', cm.len <= 500 && cm.count === `${cm.len} / 500` && cm.addr === 200, `${cm.count}, адрес ${cm.addr}`);

      await open(360, 740, true);
      await fillOrder(firstFree);
      await tap('#address');
      const typing = await js("({ cls: document.body.classList.contains('typing'), bar: getComputedStyle(document.getElementById('bar')).display })");
      await js('document.activeElement.blur()');
      await sleep(150);
      const typed = await js("({ cls: document.body.classList.contains('typing'), bar: getComputedStyle(document.getElementById('bar')).display })");
      check('клавиатура: пока набирают текст, нижняя панель не висит над полем', typing.cls && typing.bar === 'none' && !typed.cls && typed.bar !== 'none', JSON.stringify({ typing, typed }));
      const bar2 = await js(BAR);
      check('панель 360 после заполнения: сумма помещается', (priced ? bar2.lines === 1 : bar2.lines <= 2) && bar2.fits, `«${bar2.text.replace(/\u00a0/g, ' ')}»`);
      notes.push(`После заполнения (360): ${await js(`[...document.querySelectorAll('.summary__rows div')].filter((d) => !d.hidden).map((d) => d.querySelector('dt').textContent + ': ' + d.querySelector('dd').textContent).concat('Итого: ' + document.getElementById('sum-total').textContent).join('; ')`)}`.replace(/\u00a0/g, ' '));
      await tap('#submit');
      await sleep(300);
      const lockedY = await js("({ y: -parseInt(document.body.style.top || '0', 10), pos: getComputedStyle(document.body).position })");
      const sh1 = await js(SHEET);
      const chName = F.channel === 'telegram' ? 'Telegram' : 'WhatsApp';
      check(`окно «Заявка для ${chName}» снизу во всю ширину`, sh1.open && sh1.title === `Заявка для ${chName}` && sh1.w === sh1.vw && sh1.bottom === sh1.vh, `${sh1.sub}; ${sh1.w}×, низ ${sh1.bottom}`);
      check('при открытии фокус на самом окне', sh1.focusInside && /sheet__panel/.test(sh1.active), sh1.active);
      for (let i = 0; i < 6; i++) await key('Tab');
      check('Tab не выводит фокус из окна', (await js(SHEET)).focusInside, '');
      shots.push(await shot('360-sheet', false));
      await key('Escape');
      const afterEsc = await js("({ open: !document.getElementById('sheet').hidden, active: document.activeElement.id })");
      check('Esc закрывает окно, фокус возвращается на кнопку', !afterEsc.open && afterEsc.active === 'submit', JSON.stringify(afterEsc));
      const yAfter = await js('Math.round(scrollY)');
      check('окно: страница под ним зафиксирована, после закрытия прокрутка на месте', lockedY.pos === 'fixed' && Math.abs(yAfter - lockedY.y) <= 2, `было ${lockedY.y}, стало ${yAfter}`);
      await tap('#submit');
      await tap('#sheet-copy');
      await sleep(250);
      const copied = await js(`(async () => { const label = document.querySelector('.js-copy-label').textContent;
        let clip = ''; try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'нет доступа: ' + e.name; }
        return { label, same: clip.replace(/\\r\\n/g, '\\n') === document.getElementById('sheet-text').textContent }; })()`);
      check('«Скопировать заявку» → «Скопировано ✓», в буфере текст заявки', copied.label === 'Скопировано ✓' && copied.same, JSON.stringify(copied));
      const before = navLinks.length;
      await tap('#sheet-open');
      const busyBtn = await js("({ disabled: document.getElementById('sheet-open').disabled, label: document.querySelector('[data-ch-open]').textContent })");
      await tap('#sheet-open');
      await sleep(1500);
      check('двойное нажатие «Открыть …» — один переход', navLinks.length - before === 1 && busyBtn.disabled && busyBtn.label === 'Открываем…', `переходов: ${navLinks.length - before}, «${busyBtn.label}»`);
      sheetLink = navLinks[navLinks.length - 1] || '';
      sheetText = sh1.text;
      const hintShown = await js("!document.getElementById('sheet-hint').hidden").catch(() => false);
      const linkText = sheetLink ? new URL(sheetLink).searchParams.get('text') : '';
      check(`«Открыть ${chName}» ведёт в мессенджер с текстом заявки`, navLinks.length > before && linkText === sh1.text, sheetLink.slice(0, 70));
      await open(360, 740, true, url, true);
      const draft = await js(`({ machine: document.getElementById('machine').value, address: document.getElementById('address').value,
        comment: document.getElementById('comment').value, total: document.getElementById('sum-total').textContent, newOrder: !document.getElementById('new-order').hidden })`);
      check('черновик: после возврата на страницу форма и расчёт на месте', draft.machine === firstFree && draft.address === 'Тестовый адрес, 5' && draft.comment === 'нужен ковш 0,5' && draft.newOrder,
        `${draft.machine}, «${draft.address}», итого ${draft.total.replace(/\u00a0/g, ' ')}`);
      await tap('#new-order-btn');
      await sleep(800);
      for (let i = 0; i < 40; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; }
      const cleared = await js("({ machine: document.getElementById('machine').value, address: document.getElementById('address').value })");
      // Единственная доступная позиция после очистки снова выбирается сама.
      check('«Начать новую заявку» очищает форму', cleared.machine === (selectable.length === 1 ? selectable[0] : '') && cleared.address === '', JSON.stringify(cleared));
      if (F.channel === 'telegram') {
        check('Telegram: подсказка «Заявка скопирована…» и «Поделиться через Telegram»', hintShown && /^https:\/\/t\.me\/share\/url\?/.test(sh1.share), sh1.share.slice(0, 50));
      }
    }
  }
  const small360 = [...small360a, ...(await js(SMALL))];
  check('кнопки, чипы и поля ≥ 44px (360)', small360.length === 0, JSON.stringify(small360));

  // ---------- 1280 ----------
  await open(1280, 800, false);
  const dcols = await js("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length");
  check('карточки 4 колонки на 1280px', dcols === 4, `${dcols}`);
  const d1 = await js(NOSCROLL);
  check('нет горизонтального скролла (1280)', d1.sw === d1.iw, `${d1.sw} = ${d1.iw}`);
  if (F.cards === 1) {
    check('одна позиция: карточка не растянута на весь экран', await js("document.querySelector('.mc').getBoundingClientRect().width < 400"), '');
  }
  shots.push(await shot('1280', true));
  const rows = await js(`(() => { const byRow = {};
    document.querySelectorAll('.mc').forEach((c) => { const t = Math.round(c.getBoundingClientRect().top);
      (byRow[t] = byRow[t] || []).push(Math.round(c.querySelector('.mc__btn').getBoundingClientRect().top)); });
    return Object.values(byRow); })()`);
  check('1280: в каждом ряду кнопки карточек на одной высоте', rows.every((r) => r.every((y) => y === r[0])), rows.map((r) => r.join('/')).join(' | '));
  if (slug === '_sample') {
    const photos = await js("(() => { const s = [...document.querySelectorAll('.hero__media img, .mc__media img')].map((i) => i.getAttribute('src')); return { n: s.length, u: new Set(s).size }; })()");
    check('1280: фото первого экрана и всех карточек — разные файлы', photos.n === photos.u, `${photos.u} из ${photos.n}`);
  }
  const units = await js(`(() => { const out = [];
    document.querySelectorAll('.mc__title, .mc__purpose').forEach((el) => {
      const node = el.firstChild; if (!node || node.nodeType !== 3) return;
      for (const m of node.textContent.matchAll(/\\d+(?:,\\d+)?\\u00a0(?:т|м³|м²|м|кг|ч|км)/g)) {
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        out.push(new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size === 1);
      } });
    return out; })()`);
  if (units.length) check('1280: число и единица не разрываются («20 т»)', units.every(Boolean), `${units.length} мест`);
  if (selectable.length && F.channel !== 'phone') {
    await tap(`${card(firstFree)} .mc__btn`);
    await sleep(150);
    const desk = await js(`(() => { const f = document.getElementById('order-form').getBoundingClientRect(), s = document.querySelector('.summary').getBoundingClientRect();
      return { sumLeft: Math.round(s.left), formRight: Math.round(f.right), barShown: getComputedStyle(document.getElementById('bar')).display !== 'none' }; })()`);
    check('1280: «Итоговая стоимость» справа от формы, нижней панели нет', !desk.barShown && desk.formRight <= desk.sumLeft, `${desk.formRight} ≤ ${desk.sumLeft}`);
    const sticky = await js(`(() => { window.scrollBy(0, 400); const s = document.querySelector('.summary').getBoundingClientRect();
      return { sum: Math.round(s.top), sticky: Math.round(document.querySelector('.sticky').getBoundingClientRect().bottom) }; })()`);
    check('1280: «Итоговая стоимость» закреплена ниже шапки', sticky.sum >= sticky.sticky, `${sticky.sum} ≥ ${sticky.sticky}`);
    await js("document.getElementById('calc').scrollIntoView({ block: 'start' })");
    await sleep(150);
    shots.push(await shot('1280-selected', false));
    await open(1280, 800, false);
    await fillOrder(firstFree);
    await tap('.summary .js-submit');
    await sleep(300);
    const sh2 = await js(SHEET);
    check('1280: окно заявки по центру, ширина 480px', sh2.open && sh2.w === 480 && Math.abs(sh2.left - (sh2.vw - 480) / 2) <= 1, `слева ${sh2.left}`);
    const cSheet = await js(`(${contrastProbe})()`);
    check('контраст текста ≥ 4,5:1 (1280, расчёт заполнен, окно заявки открыто)', cSheet.total === 0, `проверено ${cSheet.n}${cSheet.total ? `; ниже нормы: ${cSheet.bad.join(', ')}` : ''}`);
    shots.push(await shot('1280-sheet', false));
    for (const t of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type: t, x: 20, y: 400, button: 'left', clickCount: 1 });
    await sleep(200);
    check('1280: тап по фону закрывает окно', await js("document.getElementById('sheet').hidden"), '');
  }
  check('кнопки, чипы и поля ≥ 44px (1280)', (await js(SMALL)).length === 0, '');

  // ---------- Только клавиатура: каталог → расчёт → окно → отправка ----------
  if (selectable.length && F.channel !== 'phone') {
    await open(1280, 800, false);
    const focus = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await focus(`${card(firstFree)} .mc__btn`);
    await key('Enter');
    const kSel = (await js(SELECTED)).cards[0] === firstFree;
    await focus('#address');
    await b.send('Input.insertText', { text: 'Тестовый адрес, 5' });
    await key('Tab');
    const ring = await js("({ el: document.activeElement.dataset.date || document.activeElement.id, visible: document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none' })");
    await key('Tab');
    await key(' ');
    const kDate = await js("document.querySelector('[data-date=\"tomorrow\"]').getAttribute('aria-pressed') === 'true'");
    if (F.zones) {
      await focus('#zone');
      await key('ArrowDown');
      if (!(await js("document.getElementById('zone').value"))) await setValue('#zone', '0');
    }
    await focus('#consent');
    await key(' ');
    const kConsent = await js("document.getElementById('consent').checked");
    await focus('.summary .js-submit');
    await key('Enter');
    await sleep(300);
    const kSheet = await js("!document.getElementById('sheet').hidden");
    let hops = 0;
    while (hops < 8 && (await js("document.activeElement.id")) !== 'sheet-open') { await key('Tab'); hops++; }
    const before = navLinks.length;
    await key('Enter');
    await sleep(1200);
    check('клавиатура: выбор карточки Enter, дата Space, согласие Space, окно Enter, «Открыть» Enter', kSel && kDate && kConsent && kSheet && navLinks.length > before,
      JSON.stringify({ kSel, kDate, kConsent, kSheet, tabs: hops, sent: navLinks.length > before }));
    check('клавиатура: видимая обводка фокуса (:focus-visible)', ring.visible, `на ${ring.el}`);
  }

  // ---------- Ширины 320…1920: нет горизонтального скролла, ничего не обрезано, на 1920 контент не растянут ----------
  const CUT = `(() => { const iw = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll('body *')].filter((e) => {
      if (!e.getClientRects().length || e.closest('[hidden], .grid, .reviews, .sheet, .sheet__area')) return false;
      const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > iw + 1 || r.left < -1);
    }).slice(0, 4).map((e) => e.className || e.tagName);
    const wrap = Math.max(...[...document.querySelectorAll('.wrap')].map((w) => w.getBoundingClientRect().width));
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad, wrap: Math.round(wrap) }; })()`;
  const widthIssues = [];
  for (const w of [320, 360, 390, 412, 768, 1024, 1280, 1440, 1920]) {
    await open(w, w < 768 ? 800 : 900, w < 768);
    const r = await js(CUT);
    if (r.sw !== r.iw || r.bad.length) widthIssues.push(`${w}: ${r.sw}/${r.iw} ${r.bad.join(',')}`);
    if (w === 1920 && r.wrap > 1240) widthIssues.push(`1920: контейнер ${r.wrap}px`);
    if (w === 390 || w === 1920) shots.push(await shot(`${w}-full`, true));
  }
  check('ширины 320/360/390/412/768/1024/1280/1440/1920: без горизонтального скролла и обрезки, на 1920 контейнер ≤ 1240px', !widthIssues.length, widthIssues.join('; ') || 'все ширины');

  // Телефон боком 740×360: заголовок и кнопка первого экрана видны сразу, окно заявки помещается и прокручивается.
  await open(740, 360, true);
  const land = await js(`(() => { const t = document.querySelector('.hero__actions').getBoundingClientRect(); return { actionsBottom: Math.round(t.bottom), vh: innerHeight }; })()`);
  check('альбомная 740×360: кнопки первого экрана видны без прокрутки', land.actionsBottom <= land.vh, `низ кнопок ${land.actionsBottom}, экран ${land.vh}`);
  if (selectable.length && F.channel !== 'phone') {
    await fillOrder(firstFree);
    await js("document.activeElement.blur(); document.getElementById('submit').click()");
    await sleep(300);
    const ls = await js(`(() => { const p = document.querySelector('.sheet__panel').getBoundingClientRect(), o = document.getElementById('sheet-open').getBoundingClientRect(), c = document.querySelector('.sheet__chat');
      return { open: !document.getElementById('sheet').hidden, top: Math.round(p.top), bottom: Math.round(p.bottom), openBottom: Math.round(o.bottom), vh: innerHeight, scroll: c.scrollHeight > c.clientHeight }; })()`);
    check('альбомная 740×360: окно заявки помещается, кнопка «Открыть» видна', ls.open && ls.top >= 0 && ls.bottom <= ls.vh && ls.openBottom <= ls.vh && ls.openBottom > 0, JSON.stringify(ls));
    shots.push(await shot('740x360-sheet', false));
  }

  // iOS Safari: риски по вычисленным стилям (Safari в headless нет — проверяем то, что ломает iOS).
  await open(390, 844, true);
  const ios = await js(`(() => {
    const css = [...document.querySelectorAll('style')].map((st) => st.textContent).join(' ');
    const fonts = [...document.querySelectorAll('input, select, textarea')].filter((e) => e.type !== 'checkbox' && e.type !== 'hidden' && (e.getClientRects().length || e.id === 'sheet-area')).map((e) => parseFloat(getComputedStyle(e).fontSize));
    return { minFont: Math.min(...fonts), safe: /[.]bar ?[{][^}]*safe-area-inset-bottom/.test(css) && /[.]sheet__panel ?[{][^}]*safe-area-inset-bottom/.test(css),
      dvh: /dvh/.test(css), sticky: getComputedStyle(document.querySelector('.sticky')).position, tap: /tap-highlight/.test(css),
      inertia: /overflow-scrolling: ?touch/.test(css), vh100: /100vh/.test(css) }; })()`);
  check('iOS: шрифт полей ≥ 16px (нет зума), safe-area у панели и окна, dvh, sticky, tap-highlight, инерционная лента, нет 100vh',
    ios.minFont >= 16 && ios.safe && ios.dvh && ios.sticky === 'sticky' && ios.tap && ios.inertia && !ios.vh100, JSON.stringify(ios));

  // ---------- 404: плашка демо, noindex, без списка компаний ----------
  await open(360, 740, true, `${url}net-takoy-stranicy/`);
  const nf = await js(`({ robots: document.querySelector('meta[name=robots]')?.content, demo: document.querySelector('.demo-bar')?.textContent || '',
    links: document.querySelectorAll('a').length, h1: document.querySelector('h1')?.textContent, sw: document.documentElement.scrollWidth, iw: innerWidth })`);
  check('404: «Страница не найдена», плашка демо, noindex, ни одной ссылки (списка компаний нет)', nf.robots === 'noindex, nofollow' && /^Демо-концепт/.test(nf.demo)
    && nf.links === 0 && nf.h1 === 'Страница не найдена' && nf.sw === nf.iw, JSON.stringify(nf));

  // ---------- Безопасность: CSP, внешние ссылки, окно «Как используются данные» ----------
  await open(360, 740, true);
  const sec = await js(`(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); const c = m ? m.content : '';
    return { csp: c, unsafe: /unsafe-inline/.test(c), first: document.head.firstElementChild.nextElementSibling === m,
      rel: [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !a.relList.contains('noopener') || !a.relList.contains('noreferrer')).map((a) => a.textContent.trim()) }; })()`);
  check("CSP: meta в начале head, default-src 'none', хеши вместо 'unsafe-inline', connect-src/base-uri/form-action 'none'",
    sec.first && !sec.unsafe && /default-src 'none'/.test(sec.csp) && /img-src 'self' data:/.test(sec.csp) && /style-src 'sha256-/.test(sec.csp) && /script-src 'sha256-/.test(sec.csp)
    && /connect-src 'none'/.test(sec.csp) && /base-uri 'none'/.test(sec.csp) && /form-action 'none'/.test(sec.csp) && !/frame-ancestors/.test(sec.csp), sec.csp.slice(0, 80));
  check('внешние ссылки target=_blank — rel="noopener noreferrer"', sec.rel.length === 0, sec.rel.join(', '));
  const ABS = `[...document.querySelectorAll('[href], [src], [srcset]')].flatMap((e) => [e.getAttribute('href'), e.getAttribute('src'), ...(e.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(' ')[0])])
    .filter((v) => v && v.startsWith('/') && !v.startsWith('//'))`;
  const absSite = await js(ABS);
  check(`пути относительные (сайт работает из подпапки, сейчас ${prefix})`, absSite.length === 0 && await js('document.images.length === 0 || [...document.images].filter((i) => i.complete && i.currentSrc).every((i) => i.naturalWidth > 0)'), absSite.join(', '));
  // Ссылка видна, только если есть форма с согласием (нет при «всё занято» и «только телефон»).
  if (await js("document.getElementById('privacy-btn').getClientRects().length > 0")) {
    await tap('#privacy-btn');
    const pv = await js(`(() => { const d = document.getElementById('privacy'); return { open: d.open, text: d.textContent.split(String.fromCharCode(10)).map((x) => x.trim()).join(' '),
      name: document.querySelector('.brand__name').textContent.trim(), focus: document.activeElement.id }; })()`);
    check('«Как используются данные» → окно: не сохраняются на сайте, напрямую в мессенджер компании, обрабатывает компания «{name}»',
      pv.open && /не сохраняет/.test(pv.text) && /напрямую компании/.test(pv.text) && pv.text.includes(`Обрабатывает данные компания ${/[«»"]/.test(pv.name) ? pv.name : `«${pv.name}»`}`) && pv.focus === 'privacy-close', pv.text.slice(0, 90));
    shots.push(await shot('360-privacy', false));
    await key('Escape');
    const pc = await js("({ open: document.getElementById('privacy').open, focus: document.activeElement.id })");
    check('окно данных: Esc закрывает, фокус возвращается на ссылку', !pc.open && pc.focus === 'privacy-btn', JSON.stringify(pc));
  }

  // ---------- Панель владельца (демо-режим, localStorage) ----------
  const adminUrl = `${url}admin/`;
  await open(360, 740, true, adminUrl);
  const adm = await js(`({ demo: Boolean(document.querySelector('.demo-bar')), robots: document.querySelector('meta[name=robots]')?.content,
    warn: document.querySelector('.adm-warn').textContent.trim(), sw: document.documentElement.scrollWidth, iw: innerWidth })`);
  check('панель: плашка демо, noindex, полоса «Демо-режим панели…»', adm.demo && adm.robots === 'noindex, nofollow' && /^Демо-режим панели/.test(adm.warn), '');
  check('панель 360: нет горизонтального скролла', adm.sw === adm.iw, `${adm.sw} = ${adm.iw}`);
  const absAdm = await js(ABS);
  check(`панель: пути относительные (подпапка ${prefix})`, absAdm.length === 0, absAdm.join(', '));
  const ast = await js(`(${structureProbe})()`);
  check('панель: lang, header/main/footer, один h1, заголовки без пропусков, у полей подписи', ast.lang === 'ru' && !ast.landmarks.length && ast.h1 === 1 && !ast.skip && !ast.unlabeled.length,
    `${ast.skip}${ast.landmarks.length ? ` нет ${ast.landmarks}` : ''}${ast.unlabeled.length ? ` без подписи: ${ast.unlabeled}` : ''}`);
  const cAdm = await js(`(${contrastProbe})()`);
  check('контраст текста ≥ 4,5:1 (панель)', cAdm.total === 0, `проверено ${cAdm.n}${cAdm.total ? `; ниже нормы: ${cAdm.bad.join(', ')}` : ''}`);
  check('панель 360: кнопки и поля ≥ 44px', (await js(SMALL)).length === 0, JSON.stringify(await js(SMALL)));
  const mode = await js(`(() => { const vis = (e) => Boolean(e && e.getClientRects().length);
    const card = document.querySelector('.ac'); const tops = [...card.querySelectorAll('.seg__btn')].map((x) => Math.round(x.getBoundingClientRect().top));
    const help = document.querySelector('details.adm-help');
    return { toggle: vis(document.querySelector('.adm-mode')), def: document.querySelector('[data-mode="status"]').getAttribute('aria-pressed'),
      rate: vis(card.querySelector('[name="rate"]')), thumb: vis(card.querySelector('.ac__thumb')), oneRow: new Set(tops).size === 1,
      help: help && !help.open && help.querySelector('summary').textContent.trim(), helpLines: help ? help.querySelectorAll('li').length : 0 }; })()`);
  check('панель 360: режим «Статусы» по умолчанию — миниатюра, название, три кнопки статуса в строку, без полей цены',
    mode.toggle && mode.def === 'true' && !mode.rate && mode.thumb && mode.oneRow, JSON.stringify(mode));
  check('панель: свёрнутая справка «Как пользоваться», 5–6 строк', mode.help === 'Как пользоваться' && mode.helpLines >= 5 && mode.helpLines <= 6, `${mode.helpLines} строк`);
  shots.push(await shot('admin-360', true));
  const EDGE = `(() => { const bad = []; const lines = [];
    document.querySelectorAll('#adm-form .input, #adm-form .seg, #adm-form .btn, #adm-form .seg__btn').forEach((e) => {
      if (!e.getClientRects().length) return;
      const box = e.closest('.ac, .adm-contact, .card'); if (!box) return;
      const r = e.getBoundingClientRect().right, lim = box.getBoundingClientRect().right - 12;
      if (r > lim + 0.5) bad.push((e.id || e.name || e.className.split(' ')[0]) + ' ' + Math.round(r) + '>' + Math.round(lim));
    });
    document.querySelectorAll('.ac .seg__btn--confirm').forEach((b) => {
      const span = [...b.children].find((x) => x.getClientRects().length) || b;
      const n = Math.round(span.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight));
      lines.push({ text: span.textContent, n, shy: b.textContent.includes(String.fromCharCode(173)), over: b.scrollWidth > b.clientWidth + 1, aria: b.getAttribute('aria-label') });
    });
    return { bad, lines }; })()`;
  const edgeIssues = [];
  const confirmIssues = [];
  for (const w of [320, 360, 390]) {
    await open(w, 800, true, adminUrl);
    for (const mode of ['status', 'full']) {
      await tap(`[data-mode="${mode}"]`);
      const e = await js(EDGE);
      if (e.bad.length) edgeIssues.push(`${w} ${mode}: ${e.bad.slice(0, 3).join(', ')}`);
      if (mode === 'status' && w <= 360) {
        for (const l of e.lines) if (l.shy || l.n > 2 || l.over || l.aria !== 'Требует подтверждения') confirmIssues.push(`${w}: ${JSON.stringify(l)}`);
      }
    }
  }
  check('панель 320/360/390: правый край каждого поля и кнопки ≤ край карточки − 12px (оба режима)', !edgeIssues.length, edgeIssues.join('; ') || 'все в пределах');
  check('«Требует подтверждения» в режиме «Статусы»: без переноса по слогам, ≤ 2 строк, не обрезана на 320/360 (на 320 — «Уточнить», aria-label полный)',
    !confirmIssues.length, confirmIssues.slice(0, 3).join('; ') || 'ок');
  await open(360, 740, true, adminUrl);
  await tap('[data-mode="full"]');
  const full = await js(`({ rate: Boolean(document.querySelector('.ac [name="rate"]').getClientRects().length), pressed: document.querySelector('[data-mode="full"]').getAttribute('aria-pressed') })`);
  check('панель 360: «Цены и статусы» показывает поля цены', full.rate && full.pressed === 'true', JSON.stringify(full));
  check('панель 360 «Цены и статусы»: кнопки и поля ≥ 44px', (await js(SMALL)).length === 0, JSON.stringify(await js(SMALL)));
  shots.push(await shot('admin-360-full', true));
  await open(1280, 800, false, adminUrl);
  const desk = await js(`({ toggle: Boolean(document.querySelector('.adm-mode').getClientRects().length), rate: Boolean(document.querySelector('.ac [name="rate"]').getClientRects().length) })`);
  check('панель 1280: переключателя нет, поля цены видны', !desk.toggle && desk.rate, JSON.stringify(desk));
  shots.push(await shot('admin-1280', true));

  // Проверка полей: цена — целое > 0, мин. смена — целое ≥ 1; ошибка не даёт сохранить.
  const INVALID = `[...document.querySelectorAll('.is-invalid')].map((f) => { const i = f.querySelector('input'); const e = f.querySelector('.err');
    return { text: e.textContent, aria: i ? i.getAttribute('aria-invalid') === 'true' && i.getAttribute('aria-describedby') === e.id : true }; })`;
  const firstId = await js("document.querySelector('.ac').dataset.id");
  const bad = [];
  for (const [name, value] of [['rate', '15,5'], ['rate', '0'], ['min', '0'], ['min', '2ч']]) {
    await setValue(`.ac[data-id="${firstId}"] [name="${name}"]`, value);
    await tap('#adm-save');
    const inv = await js(INVALID);
    const saved = await js(`localStorage.getItem('specsite-demo:' + JSON.parse(document.getElementById('site-data').textContent).slug)`);
    if (inv.length !== 1 || !inv[0].aria || saved) bad.push(`${name}=${value}: ${JSON.stringify(inv)} ${saved ? 'сохранено' : ''}`);
    await tap('#adm-reset');
  }
  check('панель: «15,5», «0» в цене и «0», «2ч» в мин. смене — ошибка у поля (aria-invalid), не сохраняется', bad.length === 0, bad.join('; '));
  await setValue(`.ac[data-id="${firstId}"] [name="rate"]`, '');
  if (await js(`Boolean(document.querySelector('.ac[data-id="${firstId}"] [name="rate_to"]'))`)) await setValue(`.ac[data-id="${firstId}"] [name="rate_to"]`, '');
  await tap('#adm-save');
  const emptyOk = await js(`(${INVALID}).length === 0 && !document.getElementById('adm-toast').hidden`);
  check('панель: пустая цена допустима — подпись «Пусто — «цена по запросу»»', emptyOk && await js("document.querySelector('.ac__field .hint').textContent === 'Пусто — «цена по запросу»'"), '');
  await tap('#adm-reset');

  // WhatsApp: номер не для Казахстана — предупреждение, не запрет; тестовая заявка на номер из панели.
  const waBefore = await js("document.getElementById('adm-wa').value");
  await setValue('#adm-wa', '4915112345678');
  const waWarn = await js(`({ warn: !document.getElementById('adm-wa-warn').hidden, inv: (${INVALID}).length, href: document.getElementById('adm-test').href })`);
  check('панель: WhatsApp не 7XXXXXXXXXX — предупреждение «Проверьте номер», ошибки нет', waWarn.warn && waWarn.inv === 0, JSON.stringify(waWarn));
  check('панель: «Отправить тестовую заявку себе» → wa.me на номер из панели с текстом «Тестовая заявка с сайта — всё работает ✓»',
    waWarn.href === 'https://wa.me/4915112345678?text=' + encodeURIComponent('Тестовая заявка с сайта — всё работает ✓')
    && await js("document.getElementById('adm-test').rel === 'noopener noreferrer'"), waWarn.href);
  await setValue('#adm-wa', '');
  const noWa = await js("({ dis: document.getElementById('adm-test').getAttribute('aria-disabled'), hint: document.getElementById('adm-test-hint').textContent })");
  check('панель: без номера тестовая заявка неактивна и подсказывает «Сначала укажите номер WhatsApp»', noWa.dis === 'true' && /^Сначала укажите номер WhatsApp/.test(noWa.hint), JSON.stringify(noWa));
  await setValue('#adm-wa', waBefore);

  // Несохранённые изменения: плашка, beforeunload, подтверждение у «Открыть сайт».
  const clean = await js("document.getElementById('adm-dirty').hidden");
  await tap(`.ac[data-id="${firstId}"] .seg__btn[aria-pressed="false"]`);
  const dirty = await js(`(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev);
    let asked = ''; const orig = window.confirm; window.confirm = (m) => { asked = m; return false; };
    document.querySelector('.adm-site').click(); window.confirm = orig;
    return { banner: !document.getElementById('adm-dirty').hidden && document.getElementById('adm-dirty').textContent.trim(), prevented: ev.defaultPrevented, asked, stay: /admin/.test(location.pathname) }; })()`);
  check('панель: без изменений плашки нет; после изменения — «Есть несохранённые изменения», предупреждение при уходе и при «Открыть сайт»',
    clean && dirty.banner === 'Есть несохранённые изменения' && dirty.prevented && /несохранённые/.test(dirty.asked) && dirty.stay, JSON.stringify(dirty));
  await tap('#adm-reset');

  // Сценарий: свободной позиции — «Занята» и новая цена; «требует подтверждения» (или занятой, если всё занято) — «Свободна».
  const target = F.free[0] || null;
  const freed = F.confirm[0] || (!selectable.length ? F.busy[0] : null);
  if (target) {
    await tap(`.ac[data-id="${target}"] .seg__btn--busy`);
    await setValue(`.ac[data-id="${target}"] [name="rate"]`, '14 000');
  }
  if (freed) await tap(`.ac[data-id="${freed}"] .seg__btn--free`);
  await tap('#adm-save');
  const toast = await js("!document.getElementById('adm-toast').hidden && document.querySelector('#adm-toast span').textContent");
  const admErr = await js("[...document.querySelectorAll('.field.is-invalid')].map((f) => f.dataset.field + ': ' + f.querySelector('.err').textContent).join('; ') + ' | ' + location.href");
  check('панель: «Сохранить» → тост «Сохранено. Откройте сайт, чтобы проверить», плашка изменений исчезла', toast === 'Сохранено. Откройте сайт, чтобы проверить'
    && await js("document.getElementById('adm-dirty').hidden"), `${toast} ${toast ? '' : admErr}`);
  const STATE = (id) => `(() => { const c = document.querySelector('.mc[data-id="${id}"]'); const opts = [...document.querySelectorAll('#machine option')].map((o) => o.value);
    return { status: c.dataset.status, chip: c.querySelector('.status').className, disabled: c.querySelector('.mc__btn').disabled,
      price: c.querySelector('.mc__price').textContent.replace(/\\u00a0/g, ' '), inSelect: opts.includes('${id}'),
      calc: !document.getElementById('calc-body').hidden }; })()`;
  await open(1280, 800, false);
  if (target) {
    const a = await js(STATE(target));
    check('сайт после панели: позиция «Занята», не выбирается, нет в списке', a.status === 'busy' && a.disabled && !a.inSelect, a.price);
    check('сайт после панели: новая цена 14 000 ₸ («до» из конфига сохраняется)', /^14 000( ₸|–)/.test(a.price), a.price);
  }
  if (freed) {
    const f = await js(STATE(freed));
    check('сайт после панели: позиция «Свободна», зелёный чип, есть в списке', f.status === 'free' && /status--free/.test(f.chip) && f.inSelect && f.calc, freed);
  }
  await js("document.getElementById('choose').scrollIntoView({ block: 'start' })");
  await sleep(200);
  shots.push(await shot('1280-after-admin', false));
  await open(1280, 800, false, adminUrl);
  await tap('#adm-reset');
  await open(1280, 800, false);
  const resetOk = await js(`(() => { const d = JSON.parse(document.getElementById('site-data').textContent);
    return d.machines.every((m) => document.querySelector('.mc[data-id="' + m.id + '"]').dataset.status === m.status); })()`);
  check('«Сбросить к исходным» → сайт как в конфиге', resetOk, '');

  check('нет ошибок JS', errors.length === 0, errors.join('; '));
  check('CSP: в консоли нет нарушений (сайт и панель)', cspViolations.length === 0, cspViolations.slice(0, 4).join('; '));

  // ---------- Скорость: внешние запросы и вес фото ----------
  const requests = [];
  b.on((msg) => { if (msg.method === 'Network.responseReceived') requests.push({ url: msg.params.response.url, kb: Math.round((msg.params.response.encodedDataLength || 0) / 1024), type: msg.params.type }); });
  await b.send('Network.enable');
  await b.send('Network.setCacheDisabled', { cacheDisabled: true });
  await open(360, 740, true);
  await sleep(800);
  const host = new URL(url).host;
  const external = requests.filter((r) => !r.url.startsWith('data:') && new URL(r.url).host !== host);
  check('ни одного внешнего запроса при загрузке', external.length === 0, external.map((r) => r.url).join(', ') || `${requests.length} запросов, все со своего адреса`);
  const imgs = await js(`[...document.querySelectorAll('.mc__media img, .hero__media img')].filter((i) => i.complete && i.currentSrc)
    .map((i) => { const e = performance.getEntriesByName(i.currentSrc)[0]; return { src: i.currentSrc.split('/').pop(), hero: Boolean(i.closest('.hero')), kb: e ? Math.round(e.encodedBodySize / 1024) : null }; })`);
  const cardImgs = imgs.filter((i) => !i.hero && i.kb != null);
  const heroImg = imgs.find((i) => i.hero);
  if (cardImgs.length) check('360: карточки грузят уменьшенные фото ≤ 80 КБ', cardImgs.every((i) => i.kb <= 80), cardImgs.map((i) => `${i.src} ${i.kb} КБ`).join(', '));
  if (heroImg && heroImg.kb != null) check('фото первого экрана ≤ 200 КБ', heroImg.kb <= 200, `${heroImg.src} ${heroImg.kb} КБ`);
  await b.send('Network.setCacheDisabled', { cacheDisabled: false });

  // ---------- Slow 3G, без фото, без кэша ----------
  let slow = null;
  if (!quick) {
    // Пресет DevTools «Slow 3G»: задержка 2000 мс, ~400 Кбит/с в обе стороны.
    await b.send('Network.enable');
    await b.send('Network.setCacheDisabled', { cacheDisabled: true });
    await b.send('Network.setBlockedURLs', { urls: ['*/img/*', '*.jpg', '*.jpeg', '*.png', '*.webp'] });
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
    // При параллельном прогоне замер бывает «шумным» — если вышло за предел, повторяем один раз.
    for (let attempt = 0; attempt < 2; attempt++) {
      await b.send('Page.navigate', { url });
      for (let i = 0; i < 300; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; }
      slow = await js(`(() => { const n = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { dcl: Math.round(n.domContentLoadedEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null, kb: Math.round((n.transferSize || 0) / 1024 * 10) / 10 }; })()`);
      if (slow.fcp != null && slow.fcp <= 2500) break;
    }
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check('Slow 3G без фото: первый экран ≤ 2,5 с, страница ≤ 30 КБ gzip', slow.fcp != null && slow.fcp <= 2500 && slow.kb <= 30,
      `первый экран ${slow.fcp != null ? (slow.fcp / 1000).toFixed(2) : '?'} с, DCL ${(slow.dcl / 1000).toFixed(2)} с, ${slow.kb} КБ`);
  }

  b.close();
  server.close();

  const ok = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), JSON.stringify({ slug, prefix, ok, yes: checks.filter((c) => c.ok).length, no: checks.filter((c) => !c.ok).length, checks, shots, notes, slow, sheetText, sheetLink }, null, 2));
  console.log(`Страница: ${slug} (${path.relative(ROOT, base)}/${slug}/)`);
  console.log('Скриншоты:');
  shots.forEach((s) => console.log(`  ${s}`));
  console.log('Проверки:');
  checks.forEach((c) => console.log(`  ${c.ok ? 'да ' : 'НЕТ'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`));
  notes.forEach((n) => console.log(n));
  if (sheetText) console.log(`Текст заявки:\n${sheetText.split('\n').map((l) => `  | ${l}`).join('\n')}`);
  console.log(`Итог: да ${checks.filter((c) => c.ok).length}, НЕТ ${checks.filter((c) => !c.ok).length}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
