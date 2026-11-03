'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// Real Chromium DOM exercises HTML parsing and iframe policy without adding a DOM dependency.
const browserPath = process.env.DSH_ZENTAO_BROWSER || (process.env.DSH_ZENTAO_BROWSER_TEST === '1' ? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(file => fs.existsSync(file)) : null);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, tempDir, server, socket, origin, nextId = 0;
const pending = new Map();
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 10000);
    pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
}

test.before(async () => {
  if (!browserPath) return;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-zentao-client-'));
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><body></body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${tempDir}`, 'about:blank'], { stdio: 'inherit' });
  const portFile = path.join(tempDir, 'DevToolsActivePort');
  let port;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (fs.existsSync(portFile)) { port = fs.readFileSync(portFile, 'utf8').split('\n')[0]; break; }
    if (browser.exitCode !== null) throw new Error(`Browser exited ${browser.exitCode}`);
    await delay(50);
  }
  assert.ok(port, 'Chromium debugging endpoint should start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const callback = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) callback.reject(new Error(msg.error.message)); else callback.resolve(msg.result);
  });
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: origin });
  for (let i = 0; i < 100; i++) { if (await evaluate('location.origin') === origin) break; await delay(20); }
  const modelPath = path.join(__dirname, '../src/client-model.cjs');
  const source = fs.existsSync(modelPath) ? fs.readFileSync(modelPath, 'utf8') : 'module.exports = {}';
  await evaluate(`(() => { const module = { exports: {} }; ${source}\nwindow.ZentaoModel = module.exports; })()`);
});

test.after(async () => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), delay(1000)]); }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  // The directory is an exact, verified mkdtemp result owned by this test.
  if (tempDir && tempDir.startsWith(path.join(os.tmpdir(), 'dsh-zentao-client-'))) {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Chromium may briefly retain its profile lock. */ }
  }
});

test('真实DOM清理主动内容、链接与危险属性，只保留代理图片和富文本格式', { skip: !browserPath }, async () => {
  const result = await evaluate(`(() => {
    if (!ZentaoModel.buildSafeDocument) return { missing: true };
    const raw = '<h2>复现步骤</h2><p style="color:red;background-image:url(https://evil.test/leak)">保留<strong>粗体</strong></p>' +
      '<script>parent.__leaked=1</script><svg onload="alert(1)"><script>alert(2)</script></svg>' +
      '<form action="https://evil.test"><input name="secret"></form><meta http-equiv="refresh" content="0;url=https://evil.test">' +
      '<a href="https://evil.test/collect">外部地址</a><iframe src="https://evil.test"></iframe>' +
      '<img src="https://zentao.example/file-read-123.png?token=private" onerror="alert(1)" srcset="https://evil.test/a 2x">' +
      '<img src="https://evil.test/tracker.png"><table><tbody><tr><td>格式</td></tr></tbody></table>';
    const output = ZentaoModel.buildSafeDocument(raw);
    const doc = new DOMParser().parseFromString(output, 'text/html');
    return { missing: false, active: doc.querySelectorAll('script,form,input,svg,iframe,meta[http-equiv="refresh"],a').length,
      images: Array.from(doc.images, img => img.getAttribute('src')), events: doc.querySelectorAll('[onerror],[onload],[srcset]').length,
      text: doc.body.textContent, strong: doc.querySelector('strong')?.textContent, table: doc.querySelector('td')?.textContent,
      style: doc.querySelector('p')?.getAttribute('style'), csp: doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content };
  })()`);
  assert.equal(result.missing, false, 'sanitizer should exist');
  assert.equal(result.active, 0); assert.equal(result.events, 0);
  assert.deepEqual(result.images, ['/api/zentao/image?id=123']);
  assert.equal(result.strong, '粗体'); assert.equal(result.table, '格式');
  assert.match(result.text, /外部地址/); assert.doesNotMatch(result.text, /parent.__leaked/);
  assert.match(result.style, /color:\s*red/); assert.doesNotMatch(result.style, /url|background-image/);
  assert.match(result.csp, /default-src 'none'/); assert.match(result.csp, /form-action 'none'/);
});

test('清理阶段不产生外网请求，沙箱iframe不能执行脚本、表单或顶层导航', { skip: !browserPath }, async () => {
  await cdp('Network.enable');
  const requests = [];
  const watch = event => { const msg = JSON.parse(event.data); if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url); };
  socket.addEventListener('message', watch);
  try {
    const result = await evaluate(`(async () => {
      if (!ZentaoModel.buildSafeDocument) return { missing: true };
      window.__leaked = 0;
      const src = ZentaoModel.buildSafeDocument('<img src="https://evil.test/secret"><script>parent.__leaked=1</script><form action="https://evil.test"></form><a href="https://evil.test">跳转</a>');
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox', ''); frame.srcdoc = src;
      document.body.append(frame); await new Promise(resolve => setTimeout(resolve, 120));
      const result = { missing: false, leaked: window.__leaked, sandbox: frame.getAttribute('sandbox'), origin: location.origin };
      frame.remove(); return result;
    })()`);
    assert.equal(result.missing, false); assert.equal(result.leaked, 0); assert.equal(result.sandbox, ''); assert.equal(result.origin, origin);
    assert.equal(requests.some(url => /evil\.test/.test(url)), false);
  } finally { socket.removeEventListener('message', watch); }
});
