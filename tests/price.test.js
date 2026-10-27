// Проверки формулы цены, склонений и текста заявки: node tests/price.test.js
// Только встроенные модули Node. Функции берутся из template/app.js — того же файла, что работает на странице.

'use strict';

const assert = require('assert');
const Calc = require('../template/app.js');

const NB = ' '; // неразрывный пробел в ценах на странице

const excavator = { id: 'ekskavator', title: 'Экскаватор-погрузчик (тест)', unit: 'час', rate_from: 12000, rate_to: 15000, min_units: 4, available: true };
const crane = { id: 'avtokran', title: 'Автокран 25 т (тест)', unit: 'час', rate_from: null, rate_to: null, min_units: null, available: true };
const dump = { id: 'samosval', title: 'Самосвал 20 т (тест)', unit: 'час', rate_from: 10000, rate_to: null, min_units: null, available: false };
const loader = { id: 'pogruzchik', title: 'Фронтальный погрузчик (тест)', unit: 'час', rate_from: 9000, rate_to: 11000, min_units: null, available: true };
const city = { title: 'Город (тест)', delivery_from: 0, delivery_to: 0 };
const suburb = { title: 'Пригород (тест)', delivery_from: 5000, delivery_to: 8000 };

const baseOrder = {
  machine: excavator, units: 6, date: '2026-10-28', today: '2026-10-27', hasZones: true, zone: suburb,
  address: 'Тестовый адрес, 5', name: 'Тест', phone: '+7 700 000 00 00', comment: '', consent: true, currency: '₸',
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- Формула цены ----------

test('ниже минимума: введено 2 при min_units 4 → 4 часа, подсказка о минимуме', () => {
  const p = Calc.calcPrice(excavator, 2, null);
  assert.deepStrictEqual(p, { units: 4, belowMin: true, low: 48000, high: 60000 });
});

test('ровно минимум: введено 4 → 4 часа, без подсказки', () => {
  const p = Calc.calcPrice(excavator, 4, null);
  assert.deepStrictEqual(p, { units: 4, belowMin: false, low: 48000, high: 60000 });
});

test('без min_units: минимум 1, ноль и мусор → 1', () => {
  assert.strictEqual(Calc.calcPrice(loader, 0, null).units, 1);
  assert.strictEqual(Calc.calcPrice(loader, 'abc', null).units, 1);
  assert.strictEqual(Calc.calcPrice(loader, 3.7, null).units, 3);
});

test('без цены: low/high = null, текст цены null, в заявке нет «Ориентир»', () => {
  const p = Calc.calcPrice(crane, 5, suburb);
  assert.deepStrictEqual(p, { units: 5, belowMin: false, low: null, high: null });
  assert.strictEqual(Calc.priceText(p, '₸'), null);
  const text = Calc.buildMessage({ ...baseOrder, machine: crane, units: 5 });
  assert.ok(!text.includes('Ориентир'), text);
  assert.ok(text.includes('Объём: 5 часов'), text);
});

test('без зон: доставка не добавляется, в заявке нет «Зона»', () => {
  const p = Calc.calcPrice(excavator, 6, null);
  assert.deepStrictEqual([p.low, p.high], [72000, 90000]);
  const text = Calc.buildMessage({ ...baseOrder, hasZones: false, zone: null });
  assert.ok(!text.includes('Зона:'), text);
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, hasZones: false, zone: null }), null);
});

test('с зоной: low + delivery_from, high + delivery_to', () => {
  const p = Calc.calcPrice(excavator, 6, suburb);
  assert.deepStrictEqual([p.low, p.high], [77000, 98000]);
  assert.strictEqual(Calc.priceText(p, '₸'), `77${NB}000–98${NB}000 ₸`);
});

test('rate_to = null: high считается по rate_from', () => {
  const free = { ...dump, available: true };
  assert.deepStrictEqual(Calc.calcPrice(free, 3, null), { units: 3, belowMin: false, low: 30000, high: 30000 });
  assert.strictEqual(Calc.priceText(Calc.calcPrice(free, 3, null), '₸'), `от 30${NB}000 ₸`);
  const p = Calc.calcPrice(free, 3, suburb);
  assert.deepStrictEqual([p.low, p.high], [35000, 38000]);
});

test('delivery_to = null: high берёт delivery_from', () => {
  const p = Calc.calcPrice(excavator, 4, { title: 'Z', delivery_from: 3000, delivery_to: null });
  assert.deepStrictEqual([p.low, p.high], [51000, 63000]);
});

test('low == high → «от X ₸»', () => {
  const flat = { ...loader, rate_to: 9000 };
  const p = Calc.calcPrice(flat, 2, city);
  assert.strictEqual(p.low, p.high);
  assert.strictEqual(Calc.priceText(p, '₸'), `от 18${NB}000 ₸`);
  assert.ok(Calc.buildMessage({ ...baseOrder, machine: flat, units: 2, zone: city }).includes('Ориентир: от 18 000 ₸ (предварительно)'));
});

test('занятая позиция: цены нет, заявка не проходит проверку', () => {
  assert.strictEqual(Calc.calcPrice(dump, 5, null), null);
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, machine: dump }), ['machine', 'Выберите свободную технику']);
});

test('большие числа: 1 000 000+ форматируются с пробелами', () => {
  const big = { ...excavator, rate_from: 250000, rate_to: 400000, min_units: null };
  const p = Calc.calcPrice(big, 8, { title: 'Z', delivery_from: 150000, delivery_to: 250000 });
  assert.deepStrictEqual([p.low, p.high], [2150000, 3450000]);
  assert.strictEqual(Calc.priceText(p, '₸'), `2${NB}150${NB}000–3${NB}450${NB}000 ₸`);
  assert.strictEqual(Calc.priceText(p, '₸', ' '), '2 150 000–3 450 000 ₸');
  assert.strictEqual(Calc.fmtNum(1000000, ' '), '1 000 000');
  assert.strictEqual(Calc.fmtNum(999, ' '), '999');
});

// ---------- Склонения ----------

test('plural: час — 1, 2, 5, 11, 21, 22, 25, 111', () => {
  const got = [1, 2, 5, 11, 21, 22, 25, 111].map((n) => Calc.qty(n, 'час'));
  assert.deepStrictEqual(got, ['1 час', '2 часа', '5 часов', '11 часов', '21 час', '22 часа', '25 часов', '111 часов']);
});

test('plural: 12, 13, 14, 112 → множественное', () => {
  assert.deepStrictEqual([12, 13, 14, 112].map((n) => Calc.plural(n, 'час')), ['часов', 'часов', 'часов', 'часов']);
});

test('plural: смена, день, рейс', () => {
  assert.deepStrictEqual([1, 2, 5, 11, 21].map((n) => Calc.qty(n, 'смена')), ['1 смена', '2 смены', '5 смен', '11 смен', '21 смена']);
  assert.deepStrictEqual([1, 2, 5, 11, 22].map((n) => Calc.qty(n, 'день')), ['1 день', '2 дня', '5 дней', '11 дней', '22 дня']);
  assert.deepStrictEqual([1, 3, 5, 14, 101].map((n) => Calc.qty(n, 'рейс')), ['1 рейс', '3 рейса', '5 рейсов', '14 рейсов', '101 рейс']);
});

test('plural: неизвестная единица — без изменений', () => {
  assert.deepStrictEqual([1, 2, 5].map((n) => Calc.qty(n, 'м³')), ['1 м³', '2 м³', '5 м³']);
});

// ---------- Проверка формы ----------

test('проверка формы: по порядку дата, зона, адрес, телефон, согласие', () => {
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, date: '' })[0], 'date');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, date: '2026-10-26' })[0], 'date');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, zone: null })[0], 'zone');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, address: '   ' })[0], 'address');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, phone: '+7 700 000 00' })[0], 'phone');
  assert.deepStrictEqual(Calc.validateOrder({ ...baseOrder, consent: false })[0], 'consent');
  assert.strictEqual(Calc.validateOrder({ ...baseOrder, date: '2026-10-27' }), null);
  assert.strictEqual(Calc.validateOrder(baseOrder), null);
});

// ---------- Текст заявки и ссылка ----------

test('дата в заявке: «28.10.2026 (среда)»', () => {
  assert.strictEqual(Calc.formatDate('2026-10-28'), '28.10.2026 (среда)');
  assert.strictEqual(Calc.formatDate('2026-11-01'), '01.11.2026 (воскресенье)');
});

test('текст заявки: экскаватор, 6 часов, Пригород, завтра', () => {
  assert.strictEqual(Calc.buildMessage(baseOrder), [
    'Здравствуйте! Заявка с сайта.',
    'Техника: Экскаватор-погрузчик (тест)',
    'Объём: 6 часов',
    'Дата: 28.10.2026 (среда)',
    'Адрес: Тестовый адрес, 5',
    'Зона: Пригород (тест)',
    'Ориентир: 77 000–98 000 ₸ (предварительно)',
    'Имя: Тест',
    'Телефон: +7 700 000 00 00',
  ].join('\n'));
});

test('текст заявки: комментарий — только если заполнен; имя — только если заполнено', () => {
  const t = Calc.buildMessage({ ...baseOrder, name: ' ', comment: 'Нужен ковш 0,5 м³' });
  assert.ok(t.endsWith('Телефон: +7 700 000 00 00\nКомментарий: Нужен ковш 0,5 м³'), t);
  assert.ok(!t.includes('Имя:'), t);
});

test('ссылка wa.me: текст закодирован и раскодируется обратно без потерь', () => {
  const text = Calc.buildMessage(baseOrder);
  const link = Calc.buildLink(text, '77000000000', '');
  assert.ok(link.startsWith('https://wa.me/77000000000?text='), link);
  assert.strictEqual(new URL(link).searchParams.get('text'), text);
  assert.ok(!/[\s]/.test(link), 'в ссылке не должно быть пробелов и переносов');
});

test('без WhatsApp — tel: с телефоном компании', () => {
  assert.strictEqual(Calc.buildLink('x', '', '+7 (701) 123-45-67'), 'tel:+77011234567');
  assert.strictEqual(Calc.buildLink('x', '', ''), '');
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
