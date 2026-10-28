// Полный прогон: price.test.js, сборка --test и screens.js по всем тестовым страницам (_sample, _test, фикстуры).
// node tests/run-all.js [--quick] [slug ...]
// Контакты для сборки — из TEST_WA / TEST_TG / TEST_PHONE; если не заданы, берутся вымышленные номера только для проверок.

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.filter((a) => !a.startsWith('--'));
const env = { ...process.env, TEST_WA: process.env.TEST_WA || '77000000000', TEST_TG: process.env.TEST_TG || 'test_tg_user', TEST_PHONE: process.env.TEST_PHONE || '77000000001' };
const node = process.execPath;

const price = spawnSync(node, [path.join(__dirname, 'price.test.js')], { cwd: ROOT, encoding: 'utf8' });
const priceLine = (price.stdout.match(/Пройдено: .*/) || ['price.test.js: ошибка'])[0];
console.log(`price.test.js — ${priceLine}`);

const build = spawnSync(node, [path.join(ROOT, 'build.js'), '--test'], { cwd: ROOT, env, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout + build.stderr);
  process.exit(1);
}

const slugs = only.length ? only : fs.readdirSync(path.join(ROOT, 'preview'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('_')).map((d) => d.name).sort();

// Задание: [slug, тег результата, доп. аргументы]. _sample ещё раз — из подпапки /repo/, как на GitHub Pages.
const jobs = slugs.map((s) => [s, s, []]);
if (!only.length || only.includes('_sample')) jobs.push(['_sample', '_sample-repo', ['--prefix', 'repo']]);

const run = ([slug, tag, extra]) => new Promise((resolve) => {
  const p = spawn(node, [path.join(__dirname, 'screens.js'), slug, ...extra, ...(quick ? ['--quick'] : [])], { cwd: ROOT, env });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ slug: tag, code, out }));
});

(async () => {
  const results = [];
  const queue = [...jobs];
  const worker = async () => { while (queue.length) results.push(await run(queue.shift())); };
  await Promise.all([worker(), worker(), worker()]);
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log('\nslug          | да  | НЕТ | Slow 3G');
  for (const r of results) {
    let res = null;
    try { res = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', `${r.slug}-result.json`), 'utf8')); } catch (e) { /* упал до итога */ }
    const slow = res && res.slow ? `DCL ${(res.slow.dcl / 1000).toFixed(2)} с, ${res.slow.kb} КБ` : '—';
    console.log(`${r.slug.padEnd(13)} | ${String(res ? res.yes : '?').padStart(3)} | ${String(res ? res.no : '?').padStart(3)} | ${slow}`);
    if (r.code !== 0) {
      const bad = r.out.split('\n').filter((l) => /^ {2}НЕТ|Error|Ошибка/.test(l)).slice(0, 8);
      console.log(bad.map((l) => `    ${l.trim()}`).join('\n'));
    }
  }
  const xss = spawnSync(node, [path.join(__dirname, 'xss.js')], { cwd: ROOT, encoding: 'utf8' });
  console.log(`\nxss.js — ${(xss.stdout.match(/Итог XSS: .*/) || ['ошибка'])[0]}`);
  if (xss.status !== 0) console.log(xss.stdout.split('\n').filter((l) => /НЕТ|Ошибка/.test(l)).join('\n') + xss.stderr);
  const failed = results.filter((r) => r.code !== 0).length + (price.status !== 0 ? 1 : 0) + (xss.status !== 0 ? 1 : 0);
  console.log(failed ? `\nЕсть ошибки: ${failed}` : '\nВсё зелёное');
  process.exit(failed ? 1 : 0);
})();
