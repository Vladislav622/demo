// Общее для tests/screens.js и tests/thumbs.js: статический сервер и headless Edge/Chrome по протоколу DevTools.
// Только встроенные модули Node (Node ≥ 22: глобальные fetch и WebSocket) + установленный Edge или Chrome.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain', '.json': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`Ошибка: ${msg}`);
  process.exit(1);
}

// Простой статический сервер для папки сборки. prefix — подпапка, как у GitHub Pages (/repo/).
function serve(dir, prefix = '/') {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!rel.startsWith(prefix)) { res.writeHead(404); res.end(); return; }
    rel = `/${rel.slice(prefix.length)}`;
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const nf = path.join(dir, '404.html');
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : '');
      return;
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
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 100 && !page; i++) {
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
  const close = () => { try { ws.close(); } catch (e) { /* уже закрыт */ } proc.kill(); };
  return { send, on: (fn) => listeners.push(fn), close };
}

module.exports = { serve, launch, sleep, fail, TYPES };
