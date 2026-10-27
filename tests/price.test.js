// Проверки расчёта, склонений, статусов и текста заявки: node tests/price.test.js
// Только встроенные модули Node. Функции берутся из template/app.js — того же файла, что работает на странице.

'use strict';

const assert = require('assert');
const Calc = require('../template/app.js');
const { pageVars, resolveChannel } = require('../build.js');

const NB = ' '; // неразрывный пробел в суммах на странице

const excavator = { id: 'ekskavator', title: 'Экскаватор-погрузчик (тест)', unit: 'час', rate_from: 12000, rate_to: 15000, min_units: 4, status: 'free' };
const crane = { id: 'avtokran', title: 'Автокран 25 т (тест)', unit: 'час', rate_from: null, rate_to: null, min_units: null, status: 'confirm' };
const dump = { id: 'samosval', title: 'Самосвал 20 т (тест)', unit: 'час', rate_from: 10000, rate_to: null, min_units: null, status: 'busy' };
const loader = { id: 'pogruzchik', title: 'Фронтальный погрузчик', unit: 'час', rate_from: 3200, rate_to: null, min_units: 4, status: 'free' };
const city = { title: 'Город (тест)', delivery_from: 0, delivery_to: 0 };
const suburb = { title: 'Пригород (тест)', delivery_from: 5000, delivery_to: 8000 };
const flatZone = { title: 'В пределах города', delivery_from: 5000, delivery_to: null };

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

test('точная сумма: нет rate_to и нет delivery_to → «30 600 ₸» без «от»', () => {
  const p = Calc.calcPrice(loader, 8, flatZone);
  assert.strictEqual(Calc.priceText(p, '₸'), `30${NB}600 ₸`);
  assert.strictEqual(Calc.moneyRange(p.rentLow, p.rentHigh, '₸'), `25${NB}600 ₸`);
});

test('диапазон: есть rate_to или delivery_to → «X–Y ₸», в строках тоже диапазоны', () => {
  const p = Calc.calcPrice(excavator, 4, null);
  assert.strictEqual(Calc.priceText(p, '₸'), `48${NB}000–60${NB}000 ₸`);
  const z = Calc.calcPrice(loader, 8, suburb);
  assert.strictEqual(Calc.priceText(z, '₸'), `30${NB}600–33${NB}600 ₸`);
  assert.strictEqual(Calc.moneyRange(z.deliveryLow, z.deliveryHigh, '₸'), `5${NB}000–8${NB}000 ₸`);
});

test('без зон: доставка 0, в заявке нет «Зона»', () => {
  const p = Calc.calcPrice(excavator, 6, null);
  assert.deepStrictEqual([p.deliveryLow, p.deliveryHigh, p.low, p.high], [0, 0, 72000, 90000]);
  const text = Calc.buildMessage({ ...baseOrder, hasZones: false, zone: null });
  assert.ok(!text.includes('Зона доставки'), text);
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

// ---------- Статусы ----------

test('status: busy не выбирается, confirm и free — выбираются', () => {
  assert.strictEqual(Calc.calcPrice(dump, 5, null), null);
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, machine: dump }), ['machine', 'Выберите технику']);
  assert.strictEqual(Calc.isSelectable(crane), true);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, machine: crane, units: 1 }), null);
  assert.strictEqual(Calc.isSelectable(excavator), true);
});

test('confirm: в заявке строка «Наличие: требует подтверждения», у free её нет', () => {
  assert.ok(Calc.buildMessage({ ...baseOrder, machine: crane, units: 3 }).includes('Техника: Автокран 25 т (тест)\nНаличие: требует подтверждения'));
  assert.ok(!Calc.buildMessage(baseOrder).includes('Наличие'));
});

test('available → status: true → free, false → busy (старые конфиги)', () => {
  assert.strictEqual(Calc.statusOf({ available: true }), 'free');
  assert.strictEqual(Calc.statusOf({ available: false }), 'busy');
  assert.strictEqual(Calc.statusOf({}), 'free');
  assert.strictEqual(Calc.statusOf({ status: 'confirm', available: false }), 'confirm');
  const old = { ...excavator, status: undefined, available: false };
  assert.strictEqual(Calc.calcPrice(old, 4, null), null);
});

test('сборка: available в конфиге превращается в status в данных страницы', () => {
  const cfg = {
    demo: true, slug: 'x', name: 'X', whatsapp: '77000000000', currency: '₸',
    machines: [{ ...excavator, status: undefined, available: false, kind: 'excavator' }, { ...loader, status: undefined, available: true, kind: 'loader' }],
    zones: [],
  };
  const data = JSON.parse(pageVars(cfg).data_json);
  assert.deepStrictEqual(data.machines.map((m) => m.status), ['busy', 'free']);
});

// ---------- Склонения ----------

test('plural: час — 1, 2, 5, 11, 21, 22, 25, 111', () => {
  const got = [1, 2, 5, 11, 21, 22, 25, 111].map((n) => Calc.qty(n, 'час'));
  assert.deepStrictEqual(got, ['1 час', '2 часа', '5 часов', '11 часов', '21 час', '22 часа', '25 часов', '111 часов']);
});

test('plural: смена, день, рейс; неизвестная единица — без изменений', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21].map((n) => Calc.qty(n, 'смена')), ['1 смена', '2 смены', '5 смен', '11 смен', '21 смена']);
  assert.deepStrictEqual([1, 2, 5, 12, 22].map((n) => Calc.qty(n, 'день')), ['1 день', '2 дня', '5 дней', '12 дней', '22 дня']);
  assert.deepStrictEqual([1, 3, 5, 14, 101].map((n) => Calc.qty(n, 'рейс')), ['1 рейс', '3 рейса', '5 рейсов', '14 рейсов', '101 рейс']);
  assert.deepStrictEqual([1, 2, 5].map((n) => Calc.qty(n, 'м³')), ['1 м³', '2 м³', '5 м³']);
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
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, date: '2026-10-26' })[0], 'date');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, units: 2 })[0], 'units');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, zone: null })[0], 'zone');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, consent: false })[0], 'consent');
  assert.strictEqual(Calc.validateOrder(baseOrder), null);
});

test('имя и телефон необязательны; введённый телефон — минимум 10 цифр', () => {
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, name: '', phone: '' }), null);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, phone: '+7 700 000' })[0], 'phone');
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

test('текст заявки: confirm — «Наличие» сразу после «Техника»', () => {
  const t = Calc.buildMessage({ ...baseOrder, machine: crane, units: 3 }).split('\n');
  assert.deepStrictEqual(t.slice(2, 4), ['Техника: Автокран 25 т (тест)', 'Наличие: требует подтверждения']);
});

test('пустые необязательные строки не выводятся: время, имя, телефон, комментарий', () => {
  const t = Calc.buildMessage({ ...baseOrder, name: ' ', phone: '', comment: '' });
  for (const s of ['Время подачи', 'Имя:', 'Телефон:', 'Комментарий:']) assert.ok(!t.includes(s), `${s} в ${t}`);
  const noZone = Calc.buildMessage({ ...baseOrder, hasZones: false, zone: null, machine: crane, units: 2, name: '', phone: '', comment: '' });
  assert.deepStrictEqual(noZone.split('\n').map((l) => l.split(':')[0]),
    ['Здравствуйте! Хочу заказать спецтехнику.', '', 'Техника', 'Наличие', 'Адрес', 'Дата', 'Продолжительность']);
});

test('точная сумма в заявке — без «от»', () => {
  const t = Calc.buildMessage({ ...baseOrder, machine: loader, units: 8, zone: flatZone });
  assert.ok(t.includes('Предварительная стоимость: 30 600 ₸'), t);
});

test('канал по умолчанию — WhatsApp; Telegram — только если нет WhatsApp', () => {
  assert.strictEqual(resolveChannel({ whatsapp: '77000000000', telegram: 'test_user' }), 'whatsapp');
  assert.strictEqual(resolveChannel({ telegram: 'test_user' }), 'telegram');
  assert.strictEqual(resolveChannel({ whatsapp: '77000000000', telegram: 'test_user', channel: 'telegram' }), 'telegram');
  assert.strictEqual(resolveChannel({ phone: '+7 701 123 45 67' }), 'phone');
});

test('ссылка WhatsApp: текст закодирован и раскодируется без потерь', () => {
  const text = Calc.buildMessage(baseOrder);
  const link = Calc.buildLink(text, { channel: 'whatsapp', whatsapp: '77000000000' });
  assert.ok(link.startsWith('https://wa.me/77000000000?text='), link);
  assert.strictEqual(new URL(link).searchParams.get('text'), text);
  assert.ok(!/\s/.test(link));
});

test('ссылка Telegram: t.me/<username>?text=… (core.telegram.org/api/links), текст раскодируется без потерь', () => {
  const text = Calc.buildMessage(baseOrder);
  const link = Calc.buildLink(text, { channel: 'telegram', telegram: 'test_user', whatsapp: '77000000000' });
  assert.ok(link.startsWith('https://t.me/test_user?text='), link);
  assert.strictEqual(new URL(link).searchParams.get('text'), text);
});

test('«Поделиться через Telegram»: t.me/share/url с адресом страницы и текстом', () => {
  const link = Calc.buildShareLink('https://example.github.io/repo/_sample/', 'Строка 1\nСтрока 2');
  const u = new URL(link);
  assert.strictEqual(u.origin + u.pathname, 'https://t.me/share/url');
  assert.strictEqual(u.searchParams.get('url'), 'https://example.github.io/repo/_sample/');
  assert.strictEqual(u.searchParams.get('text'), 'Строка 1\nСтрока 2');
});

test('номер в шапке окна: 77000000000 → «+7 700 000 00 00»', () => {
  assert.strictEqual(Calc.formatPhone('77000000000'), '+7 700 000 00 00');
});

test('без мессенджеров — tel:', () => {
  assert.strictEqual(Calc.buildLink('x', { channel: 'phone', phone: '77011234567' }), 'tel:+77011234567');
  assert.strictEqual(Calc.buildLink('x', { channel: 'phone' }), '');
});

test('дата: «9 октября 2026 г. (пятница)», «1 января 2027 г. (пятница)»', () => {
  assert.strictEqual(Calc.formatDate('2026-10-09'), '9 октября 2026 г. (пятница)');
  assert.strictEqual(Calc.formatDate('2027-01-01'), '1 января 2027 г. (пятница)');
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
