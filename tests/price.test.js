// Проверки расчёта, склонений, статусов, дат, ввода и текста заявки: node tests/price.test.js
// Только встроенные модули Node. Функции берутся из template/core.js — того же файла, что работает на странице.

'use strict';

const assert = require('assert');
const Calc = require('../template/core.js');
const { pageVars, resolveChannel, render, palette, contrast } = require('../build.js');

const NB = ' '; // неразрывный пробел в суммах и количестве на странице
const plain = (s) => String(s).replace(/ /g, ' ');

const excavator = { id: 'ekskavator', title: 'Экскаватор-погрузчик (тест)', unit: 'час', rate_from: 12000, rate_to: 15000, min_units: 4, status: 'free' };
const crane = { id: 'avtokran', title: 'Автокран 25 т (тест)', unit: 'час', rate_from: null, rate_to: null, min_units: null, status: 'confirm' };
const dump = { id: 'samosval', title: 'Самосвал 20 т (тест)', unit: 'час', rate_from: 10000, rate_to: null, min_units: null, status: 'busy' };
const loader = { id: 'pogruzchik', title: 'Фронтальный погрузчик', unit: 'час', rate_from: 3200, rate_to: null, min_units: 4, status: 'free' };
const city = { title: 'Город (тест)', delivery_from: 0, delivery_to: 0 };
const suburb = { title: 'Пригород (тест)', delivery_from: 5000, delivery_to: 8000 };
const flatZone = { title: 'В пределах города', delivery_from: 5000, delivery_to: null };
const WA = '77000000000'; // вымышленный номер для проверок

const baseOrder = {
  machine: excavator, units: 6, date: '2026-10-28', time: '', today: '2026-10-27', hasZones: true, zone: suburb,
  address: 'Тестовый адрес, 5', name: 'Тест', phone: '+7 700 000 00 00', comment: '', consent: true, currency: '₸',
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- Формула и разбивка ----------

test('ниже минимума: введено 2 при min_units 4 → 4 часа, подсказка о минимуме', () => {
  const p = Calc.calcPrice(excavator, 2, null);
  assert.deepStrictEqual([p.units, p.belowMin, p.low, p.high], [4, true, 48000, 60000]);
});

test('ровно минимум: введено 4 → без подсказки', () => {
  const p = Calc.calcPrice(excavator, 4, null);
  assert.deepStrictEqual([p.units, p.belowMin], [4, false]);
});

test('без min_units: минимум 1, ноль и мусор → 1, дробь округляется вниз', () => {
  const m = { ...loader, min_units: null };
  assert.strictEqual(Calc.calcPrice(m, 0, null).units, 1);
  assert.strictEqual(Calc.calcPrice(m, 'abc', null).units, 1);
  assert.strictEqual(Calc.calcPrice(m, 3.7, null).units, 3);
});

test('разбивка: «Стоимость аренды» = часы × ставка, «Доставка» = зона', () => {
  const p = Calc.calcPrice(loader, 8, flatZone);
  assert.deepStrictEqual([p.rentLow, p.rentHigh, p.deliveryLow, p.deliveryHigh, p.low, p.high], [25600, 25600, 5000, 5000, 30600, 30600]);
  const r = Calc.calcPrice(excavator, 6, suburb);
  assert.deepStrictEqual([r.rentLow, r.rentHigh, r.deliveryLow, r.deliveryHigh, r.low, r.high], [72000, 90000, 5000, 8000, 77000, 98000]);
});

test('точная сумма без «от»; диапазон «X–Y ₸» в итоге и в строках', () => {
  assert.strictEqual(Calc.priceText(Calc.calcPrice(loader, 8, flatZone), '₸'), `30${NB}600 ₸`);
  assert.strictEqual(Calc.priceText(Calc.calcPrice(excavator, 4, null), '₸'), `48${NB}000–60${NB}000 ₸`);
  const z = Calc.calcPrice(loader, 8, suburb);
  assert.strictEqual(Calc.moneyRange(z.deliveryLow, z.deliveryHigh, '₸'), `5${NB}000–8${NB}000 ₸`);
});

test('диапазоны согласованы: карточка, список, итог и заявка показывают «от–до»', () => {
  assert.strictEqual(Calc.rateText(excavator, '₸'), `12${NB}000–15${NB}000 ₸`);
  assert.strictEqual(plain(Calc.optionLabel(excavator, '₸')), 'Экскаватор-погрузчик (тест) · 12 000–15 000 ₸/ч');
  assert.strictEqual(Calc.rateText(loader, '₸'), `3${NB}200 ₸`);
  assert.ok(Calc.buildMessage({ ...baseOrder, units: 4, zone: suburb }).includes('Предварительная стоимость: 53 000–68 000 ₸'));
});

test('без зон: доставка 0, в заявке нет «Зона доставки»', () => {
  const p = Calc.calcPrice(excavator, 6, null);
  assert.deepStrictEqual([p.deliveryLow, p.deliveryHigh, p.low, p.high], [0, 0, 72000, 90000]);
  assert.ok(!Calc.buildMessage({ ...baseOrder, hasZones: false, zone: null }).includes('Зона доставки'));
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, hasZones: false, zone: null }), null);
});

test('без цены: суммы null, итог не показывается, в заявке нет «Предварительная стоимость»', () => {
  const p = Calc.calcPrice(crane, 5, suburb);
  assert.deepStrictEqual([p.rentLow, p.low, p.high], [null, null, null]);
  assert.strictEqual(Calc.priceText(p, '₸'), null);
  assert.ok(!Calc.buildMessage({ ...baseOrder, machine: crane, units: 5 }).includes('Предварительная стоимость'));
});

test('большие числа: 1 000 000+ с пробелами', () => {
  const big = { ...excavator, rate_from: 250000, rate_to: 400000, min_units: null };
  const p = Calc.calcPrice(big, 8, { title: 'Z', delivery_from: 150000, delivery_to: 250000 });
  assert.strictEqual(Calc.priceText(p, '₸', ' '), '2 150 000–3 450 000 ₸');
  assert.strictEqual(Calc.fmtNum(1000000, ' '), '1 000 000');
});

// Перебор: 2000 случайных сочетаний ставок, минимумов, зон и объёмов (детерминированный генератор).
test('перебор 2000 сочетаний: итог = units × ставка + доставка, без NaN/undefined/null в тексте', () => {
  let seed = 20261027;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  for (let i = 0; i < 2000; i++) {
    const from = rnd() < 0.15 ? null : Math.round(1000 + rnd() * 300000);
    const to = from != null && rnd() < 0.4 ? from + Math.round(rnd() * 50000) : null;
    const m = { id: 'x', title: pick(['Экскаватор', 'Кран 25 т', 'Самосвал']), unit: pick(['час', 'смена', 'день', 'рейс', 'м³']), rate_from: from, rate_to: to,
      min_units: rnd() < 0.5 ? null : 1 + Math.floor(rnd() * 10), status: pick(['free', 'confirm']) };
    const zone = rnd() < 0.3 ? null : { title: 'Зона', delivery_from: Math.round(rnd() * 30000), delivery_to: rnd() < 0.5 ? null : Math.round(30000 + rnd() * 20000) };
    const entered = pick([-5, 0, 1, 2, 3, 7, 16, 100, 2.5, NaN, '8', 'abc']);
    const p = Calc.calcPrice(m, entered, zone);
    assert.ok(p.units >= Calc.minUnits(m) && Number.isInteger(p.units), `units ${p.units}`);
    if (from == null) {
      assert.strictEqual(p.low, null);
    } else {
      const dLow = zone ? zone.delivery_from : 0;
      const dHigh = zone ? (zone.delivery_to != null ? zone.delivery_to : zone.delivery_from) : 0;
      assert.strictEqual(p.low, p.units * from + dLow);
      assert.strictEqual(p.high, p.units * (to != null ? to : from) + dHigh);
      assert.ok(p.low >= 0 && p.high >= p.low);
    }
    const text = Calc.buildMessage({ ...baseOrder, machine: m, units: p.units, zone, hasZones: Boolean(zone), comment: rnd() < 0.5 ? '' : 'Коммент' });
    assert.ok(!/undefined|null|NaN/.test(text), text);
    assert.ok(!/\n\n\n/.test(text) && text.split('\n\n').length === 2, 'лишние пустые строки');
  }
});

// ---------- Статусы ----------

test('status: busy не выбирается, confirm и free — выбираются', () => {
  assert.strictEqual(Calc.calcPrice(dump, 5, null), null);
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, machine: dump }), ['machine', 'Выберите технику']);
  assert.strictEqual(Calc.isSelectable(crane), true);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, machine: crane, units: 1 }), null);
});

test('confirm: «Наличие: требует подтверждения» сразу после «Техника»; у free нет', () => {
  const t = Calc.buildMessage({ ...baseOrder, machine: crane, units: 3 }).split('\n');
  assert.deepStrictEqual(t.slice(2, 4), ['Техника: Автокран 25 т (тест)', 'Наличие: требует подтверждения']);
  assert.ok(!Calc.buildMessage(baseOrder).includes('Наличие'));
});

test('available → status: true → free, false → busy (старые конфиги)', () => {
  assert.strictEqual(Calc.statusOf({ available: true }), 'free');
  assert.strictEqual(Calc.statusOf({ available: false }), 'busy');
  assert.strictEqual(Calc.statusOf({}), 'free');
  assert.strictEqual(Calc.statusOf({ status: 'confirm', available: false }), 'confirm');
});

test('сборка: available в конфиге превращается в status в данных страницы', () => {
  const cfg = {
    demo: true, slug: 'x', name: 'X', whatsapp: WA, currency: '₸',
    machines: [{ ...excavator, status: undefined, available: false, kind: 'excavator' }, { ...loader, status: undefined, available: true, kind: 'loader' }],
    zones: [],
  };
  const data = JSON.parse(pageVars(cfg).data_json);
  assert.deepStrictEqual(data.machines.map((m) => m.status), ['busy', 'free']);
});

// ---------- Склонения ----------

test('plural: час — 1, 2, 5, 11, 21, 22, 25, 111', () => {
  const got = [1, 2, 5, 11, 21, 22, 25, 111].map((n) => plain(Calc.qty(n, 'час')));
  assert.deepStrictEqual(got, ['1 час', '2 часа', '5 часов', '11 часов', '21 час', '22 часа', '25 часов', '111 часов']);
});

test('plural: смена, день, рейс; неизвестная единица — без изменений; «мин. заказ — 3 рейса»', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21].map((n) => plain(Calc.qty(n, 'смена'))), ['1 смена', '2 смены', '5 смен', '11 смен', '21 смена']);
  assert.deepStrictEqual([1, 2, 5, 12, 22].map((n) => plain(Calc.qty(n, 'день'))), ['1 день', '2 дня', '5 дней', '12 дней', '22 дня']);
  assert.deepStrictEqual([1, 3, 5, 14, 101].map((n) => plain(Calc.qty(n, 'рейс'))), ['1 рейс', '3 рейса', '5 рейсов', '14 рейсов', '101 рейс']);
  assert.deepStrictEqual([1, 2, 5].map((n) => plain(Calc.qty(n, 'м³'))), ['1 м³', '2 м³', '5 м³']);
  assert.strictEqual(plain(Calc.minText({ unit: 'рейс', min_units: 3 })), 'мин. заказ — 3 рейса');
  assert.strictEqual(plain(Calc.minText({ unit: 'час', min_units: 4 })), 'мин. смена — 4 часа');
});

test('быстрые значения: часы 4/8/16, смены и дни 1/2/3 (не меньше минимума), рейсы — нет', () => {
  assert.deepStrictEqual(Calc.quickUnits({ unit: 'час', min_units: 4 }), [4, 8, 16]);
  assert.deepStrictEqual(Calc.quickUnits({ unit: 'смена', min_units: 2 }), [2, 3]);
  assert.deepStrictEqual(Calc.quickUnits({ unit: 'день' }), [1, 2, 3]);
  assert.deepStrictEqual(Calc.quickUnits({ unit: 'рейс', min_units: 3 }), []);
});

test('«N единиц техники» в первом экране', () => {
  const forms = ['единица', 'единицы', 'единиц'];
  assert.deepStrictEqual([1, 4, 5, 21].map((n) => Calc.pluralForms(n, forms)), ['единица', 'единицы', 'единиц', 'единица']);
});

// ---------- Проверка формы ----------

test('обязательные: техника, адрес, дата, часы, зона, согласие — по порядку формы', () => {
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, machine: null })[0], 'machine');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, address: '  ' })[0], 'address');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, date: '' })[0], 'date');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, date: '2026-10-26' }), ['date', 'Эта дата уже прошла — выберите другую']);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, units: 2 })[0], 'units');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, zone: null })[0], 'zone');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, consent: false }), ['consent', 'Отметьте согласие на обработку данных']);
  assert.strictEqual(Calc.validateOrder(baseOrder), null);
});

test('имя и телефон необязательны; введённый телефон — минимум 10 цифр', () => {
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, name: '', phone: '' }), null);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, phone: '+7 700 000' })[0], 'phone');
});

// ---------- Ввод пользователя ----------

const tricky = 'Подъезд «со двора» & #2, 50% + 🚜🏗️ "кавычки" <b>не тег</b>\nвторая строка';

test('ввод: эмодзи, кавычки, &, #, %, +, переводы строк — ссылка корректна и раскодируется в тот же текст', () => {
  const o = { ...baseOrder, address: 'ул. Абая 10 & 12 #3\nподъезд 2', comment: tricky };
  const { text, link, cut } = Calc.buildOrderLink(o, { channel: 'whatsapp', whatsapp: WA });
  assert.strictEqual(cut, false);
  assert.ok(text.includes('Адрес: ул. Абая 10 & 12 #3, подъезд 2'), text);
  assert.ok(text.includes('🚜🏗️') && text.includes('<b>не тег</b>'));
  const u = new URL(link);
  assert.strictEqual(u.searchParams.get('text'), text);
  assert.ok(!/[\s#]/.test(link.slice(link.indexOf('?'))), 'в ссылке не должно быть пробелов и «#»');
});

test('лимиты: адрес 200, комментарий 500 символов — эмодзи не разрываются', () => {
  assert.deepStrictEqual([Calc.LIMITS.address, Calc.LIMITS.comment], [200, 500]);
  const emoji = '🚜'.repeat(600);
  const clipped = Calc.clip(emoji, 500);
  assert.strictEqual(Array.from(clipped).length, 500);
  assert.ok(!/[\uD800-\uDBFF]$/.test(clipped), 'обрезано посреди эмодзи');
});

test('длинная заявка: ссылка ≤ 4000 символов, комментарий в ссылке сокращён, полный текст сохранён', () => {
  const long = Calc.clip(('Очень длинный комментарий с подробностями работ. ').repeat(20), 500);
  const o = { ...baseOrder, address: 'А'.repeat(200), comment: long };
  const r = Calc.buildOrderLink(o, { channel: 'whatsapp', whatsapp: WA });
  assert.strictEqual(r.cut, true);
  assert.ok(r.link.length <= Calc.MAX_LINK, `длина ${r.link.length}`);
  assert.ok(r.text.includes(long), 'полный текст для копирования');
  const inLink = new URL(r.link).searchParams.get('text');
  assert.ok(inLink.includes('… (полный комментарий пришлю следующим сообщением)'), inLink.slice(-120));
  assert.ok(inLink.includes('Предварительная стоимость'), 'обрезается только комментарий');
  const short = Calc.buildOrderLink({ ...baseOrder, comment: 'нужен ковш 0,5' }, { channel: 'whatsapp', whatsapp: WA });
  assert.strictEqual(short.cut, false);
});

// ---------- Даты (по местному времени устройства) ----------

test('даты: «Сегодня» в 20:00 и 23:59 — тот же день; вечером — подсказка', () => {
  assert.strictEqual(Calc.dateFor('today', new Date(2026, 9, 27, 23, 59)), '2026-10-27');
  assert.strictEqual(Calc.dateFor('tomorrow', new Date(2026, 9, 27, 23, 59)), '2026-10-28');
  assert.strictEqual(Calc.isLate(new Date(2026, 9, 27, 19, 59)), false);
  assert.strictEqual(Calc.isLate(new Date(2026, 9, 27, 20, 0)), true);
  assert.strictEqual(Calc.dateFor('today', new Date(2026, 9, 28, 0, 0)), '2026-10-28');
});

test('даты: 31 декабря → 1 января, 28 февраля → 29 (високосный) и → 1 марта (обычный)', () => {
  assert.strictEqual(Calc.dateFor('tomorrow', new Date(2026, 11, 31, 21, 0)), '2027-01-01');
  assert.strictEqual(Calc.dateFor('tomorrow', new Date(2028, 1, 28, 12, 0)), '2028-02-29');
  assert.strictEqual(Calc.dateFor('tomorrow', new Date(2027, 1, 28, 12, 0)), '2027-03-01');
  assert.strictEqual(Calc.formatDate('2028-02-29'), '29 февраля 2028 г. (вторник)');
  assert.strictEqual(Calc.formatDate('2027-01-01'), '1 января 2027 г. (пятница)');
});

test('даты: часовые пояса (Алматы, Лос-Анджелес, Берлин с переходом на летнее время)', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['Asia/Almaty', 'America/Los_Angeles', 'Europe/Berlin']) {
      process.env.TZ = tz;
      const late = new Date(2026, 2, 28, 23, 30); // местное время; в Берлине ночью переход на летнее
      assert.strictEqual(Calc.isoDate(late), '2026-03-28', tz);
      assert.strictEqual(Calc.dateFor('tomorrow', late), '2026-03-29', tz);
      assert.strictEqual(Calc.formatDate('2026-03-29'), '29 марта 2026 г. (воскресенье)', tz);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

// ---------- Текст заявки и каналы ----------

test('текст заявки (порядок как в референсе): экскаватор, 6 часов, Пригород, завтра, 09:00', () => {
  assert.strictEqual(Calc.buildMessage({ ...baseOrder, time: '09:00', comment: 'Тестовый комментарий' }), [
    'Здравствуйте! Хочу заказать спецтехнику.',
    '',
    'Техника: Экскаватор-погрузчик (тест)',
    'Адрес: Тестовый адрес, 5',
    'Дата: 28 октября 2026 г. (среда)',
    'Время подачи: 09:00',
    'Продолжительность: 6 часов',
    'Зона доставки: Пригород (тест)',
    'Предварительная стоимость: 77 000–98 000 ₸',
    'Имя: Тест',
    'Телефон: +7 700 000 00 00',
    'Комментарий: Тестовый комментарий',
  ].join('\n'));
});

test('пустые необязательные строки не выводятся: время, имя, телефон, комментарий', () => {
  const t = Calc.buildMessage({ ...baseOrder, name: ' ', phone: '', comment: '' });
  for (const s of ['Время подачи', 'Имя:', 'Телефон:', 'Комментарий:']) assert.ok(!t.includes(s), `${s} в ${t}`);
});

test('канал по умолчанию — WhatsApp; Telegram — только если нет WhatsApp', () => {
  assert.strictEqual(resolveChannel({ whatsapp: WA, telegram: 'test_user' }), 'whatsapp');
  assert.strictEqual(resolveChannel({ telegram: 'test_user' }), 'telegram');
  assert.strictEqual(resolveChannel({ whatsapp: WA, telegram: 'test_user', channel: 'telegram' }), 'telegram');
  assert.strictEqual(resolveChannel({ phone: '+7 701 123 45 67' }), 'phone');
});

test('ссылки: wa.me и t.me с текстом, «Поделиться» — t.me/share/url, без мессенджеров — tel:', () => {
  const text = Calc.buildMessage(baseOrder);
  const wa = Calc.buildLink(text, { channel: 'whatsapp', whatsapp: WA });
  assert.ok(wa.startsWith(`https://wa.me/${WA}?text=`));
  assert.strictEqual(new URL(wa).searchParams.get('text'), text);
  const tg = Calc.buildLink(text, { channel: 'telegram', telegram: 'test_user' });
  assert.ok(tg.startsWith('https://t.me/test_user?text='));
  const share = new URL(Calc.buildShareLink('https://example.github.io/repo/_sample/', 'А\nБ'));
  assert.deepStrictEqual([share.origin + share.pathname, share.searchParams.get('text')], ['https://t.me/share/url', 'А\nБ']);
  assert.strictEqual(Calc.buildLink('x', { channel: 'phone', phone: '77011234567' }), 'tel:+77011234567');
});

test('номер в шапке окна: 77011234567 → «+7 701 123 45 67»', () => {
  assert.strictEqual(Calc.formatPhone('77011234567'), '+7 701 123 45 67');
});

// ---------- Демо-панель: изменения владельца поверх конфига ----------

const siteBase = { slug: '_sample', currency: '₸', channel: 'whatsapp', whatsapp: WA, telegram: '', phone: '', machines: [excavator, crane], zones: [] };

test('панель: статус и цена поверх конфига; новая цена без «до» снимает диапазон', () => {
  const d = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { status: 'busy', rate_from: 14000, min_units: 4 }, avtokran: { status: 'free' } } });
  assert.deepStrictEqual([d.machines[0].status, d.machines[0].rate_from, d.machines[0].rate_to], ['busy', 14000, null]);
  assert.strictEqual(d.machines[1].status, 'free');
  assert.strictEqual(siteBase.machines[0].rate_from, 12000, 'исходные данные не меняются');
});

test('панель: диапазон «от–до» сохраняется и меняется; «до» меньше «от» не принимается', () => {
  const same = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { rate_from: 12000, rate_to: 15000 } } });
  assert.deepStrictEqual([same.machines[0].rate_from, same.machines[0].rate_to], [12000, 15000]);
  const both = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { rate_from: 13000, rate_to: 16000 } } });
  assert.deepStrictEqual([both.machines[0].rate_from, both.machines[0].rate_to], [13000, 16000]);
  const bad = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { rate_from: 13000, rate_to: 9000 } } });
  assert.deepStrictEqual([bad.machines[0].rate_from, bad.machines[0].rate_to], [13000, null]);
  const none = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { rate_from: null, min_units: null } } });
  assert.deepStrictEqual([none.machines[0].rate_from, none.machines[0].rate_to, none.machines[0].min_units], [null, null, null]);
});

test('панель: мусорные значения игнорируются', () => {
  const d = Calc.mergeOverrides(siteBase, { machines: { ekskavator: { status: 'maybe', rate_from: -5, min_units: 2.5 }, nope: { status: 'busy' } }, whatsapp: '12', telegram: '@x', channel: 'telegram' });
  assert.deepStrictEqual([d.machines[0].status, d.machines[0].rate_from, d.machines[0].min_units], ['free', 12000, 4]);
  assert.deepStrictEqual([d.whatsapp, d.telegram, d.channel], [WA, '', 'whatsapp']);
  assert.deepStrictEqual(Calc.mergeOverrides(siteBase, null), siteBase);
});

test('панель: контакт и главный канал (Telegram — только если задан username)', () => {
  const d = Calc.mergeOverrides(siteBase, { telegram: 'owner_name', channel: 'telegram', whatsapp: '77011234567' });
  assert.deepStrictEqual([d.whatsapp, d.telegram, d.channel], ['77011234567', 'owner_name', 'telegram']);
});

// ---------- Сборка ----------

test('шаблон: метки подставляются за один проход — «{{…}}» из данных не подставляется повторно', () => {
  const out = render('<h1>{{a}}</h1>{{{b}}}<p>{{c}}</p>', { a: '{{c}}', b: '<i>{{{c}}}</i>', c: 'X' });
  assert.strictEqual(out, '<h1>{{c}}</h1><i>{{{c}}}</i><p>X</p>');
  assert.strictEqual(render('{{a}}', { a: '<img src=x onerror=alert(1)>' }), '&lt;img src=x onerror=alert(1)&gt;');
});

test('палитра: контраст текста ≥ 4,5 для тёмного и светлого primary/accent', () => {
  for (const colors of [{}, { primary: '#f2c94c', accent: '#ffe08a' }, { primary: '#0b3d2e', accent: '#1f8a5c' }, { primary: '#ffffff', accent: '#ffff00' }, { primary: '#000', accent: '#000' }]) {
    const p = palette(colors);
    assert.ok(contrast(p['primary-ink'], p.primary) >= 4.5, `primary ${JSON.stringify(colors)}`);
    assert.ok(contrast(p['on-primary-muted'], p.primary) >= 4.5, `muted ${JSON.stringify(colors)}`);
    assert.ok(contrast(p['accent-ink'], p.accent) >= 4.5, `accent ${JSON.stringify(colors)}`);
    assert.ok(contrast(p['accent-text'], '#f1efea') >= 4.5, `accent-text ${JSON.stringify(colors)}`);
    assert.ok(contrast(p['accent-on-dark'], p.primary) >= 4.5, `accent-on-dark ${JSON.stringify(colors)}`);
  }
});

test('фото компании > 300 КБ или шире 1600 px — предупреждение с советом, как сжать', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { validate } = require('../build.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-'));
  // Заголовок PNG 2000×1000 (для проверки размера достаточно IHDR).
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(2000, 16); png.writeUInt32BE(1000, 20);
  fs.writeFileSync(path.join(dir, 'wide.png'), png);
  const cfg = { demo: true, slug: 'x', name: 'X', whatsapp: WA, currency: '₸', logo: 'wide.png', machines: [{ id: 'a', title: 'A', unit: 'час' }] };
  const { errors, warnings } = validate(cfg, 'x/config.json', 'x', dir);
  assert.strictEqual(errors.length, 0, errors.join('\n'));
  assert.ok(warnings.some((w) => /2000×1000/.test(w) && /squoosh\.app/.test(w) && /1600/.test(w)), warnings.join('\n'));
});

// ---------- Запуск ----------

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${t.name}\n      ${e.message.split('\n').join('\n      ')}`);
  }
}
console.log(`\nПройдено: ${tests.length - failed} из ${tests.length}${failed ? `, ошибок: ${failed}` : ''}`);
process.exit(failed ? 1 : 0);
