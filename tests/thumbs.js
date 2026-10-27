// Уменьшенные копии общих фото: assets/stock/<имя>.jpg → <имя>-640.jpg (ширина 640, ≤ 80 КБ).
// Делается один раз (результат коммитится) средствами установленного Edge/Chrome: canvas → JPEG. Зависимостей нет.
// node tests/thumbs.js

'use strict';

const fs = require('fs');
const path = require('path');
const { launch } = require('./browser.js');

const STOCK = path.join(__dirname, '..', 'assets', 'stock');
const WIDTH = 640;
const MAX_BYTES = 80 * 1024;

(async () => {
  const files = fs.readdirSync(STOCK).filter((f) => /\.jpg$/.test(f) && !/-640\.jpg$/.test(f));
  const b = await launch();
  await b.send('Runtime.enable');
  for (const f of files) {
    const src = `data:image/jpeg;base64,${fs.readFileSync(path.join(STOCK, f)).toString('base64')}`;
    let out = null;
    for (const q of [0.8, 0.74, 0.68, 0.62, 0.56, 0.5]) {
      const r = await b.send('Runtime.evaluate', {
        awaitPromise: true, returnByValue: true,
        expression: `new Promise((ok) => { const img = new Image(); img.onload = () => {
          const c = document.createElement('canvas'); c.width = ${WIDTH}; c.height = Math.round(img.height * ${WIDTH} / img.width);
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', ${q})); }; img.src = ${JSON.stringify(src)}; })`,
      });
      out = Buffer.from(r.result.value.split(',')[1], 'base64');
      if (out.length <= MAX_BYTES) break;
    }
    const name = f.replace(/\.jpg$/, '-640.jpg');
    fs.writeFileSync(path.join(STOCK, name), out);
    console.log(`  ${name}: ${Math.round(out.length / 1024)} КБ`);
  }
  b.close();
})();
