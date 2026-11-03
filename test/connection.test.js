import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRuntime } from '../src/runtime.js';
import { FileStore } from '../src/store.js';
import { ZentaoClient } from '../src/zentao.js';
import { loadConfiguredConnection, saveConnectionFile } from '../src/config.js';

const original = { baseUrl: 'https://one.test', account: 'alice', password: 'alice-secret' };
async function setup(t, overrides = {}) {
  const root = resolve('.test-data'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'connection-'));
  const store = await FileStore.open(join(dir, 'state.json')); const file = join(dir, 'connection.json'); const clients = [];
  const runtime = createRuntime({ store, initialConnection: original, connectionFile: file, connectionSource: 'mcp-file.json',
    clientFactory: config => {
      const client = new ZentaoClient({ ...config, fetchImpl: async (input, options = {}) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/tokens')) {
          const { account, password } = JSON.parse(options.body);
          if (password !== `${account}-secret`) return Response.json({ error: 'secret upstream content must not leak' }, { status: 401 });
          return Response.json({ token: `private-token-${account}` });
        }
        if (url.pathname.endsWith('/executions')) return Response.json({ executions: [], total: 0 });
        if (url.pathname.endsWith('/products')) return Response.json({ products: [], total: 0 });
        if (url.pathname.endsWith('/tasks')) return Response.json({ tasks: [{ id: config.account === 'alice' ? 1 : 2, name: `item-${config.account}`, assignedTo: config.account }], total: 1, limit: 100, page: 1 });
        throw new Error('unexpected endpoint');
      } }); clients.push(client); return client;
    }, ...overrides });
  t.after(async () => { await runtime.stop(); await rm(dir, { recursive: true, force: true }); }); return { runtime, store, file, dir, clients };
}

test('connection metadata and overview never expose a password or token', async t => {
  const f = await setup(t); await f.runtime.refresh();
  assert.deepEqual(f.runtime.connection(), { baseUrl: 'https://one.test', account: 'alice', hasPassword: true });
  assert.equal(f.runtime.overview().connection.account, 'alice');
  assert.doesNotMatch(JSON.stringify(f.runtime.overview()), /alice-secret|private-token|"password"/);
});

test('a validated account change persists only in the private connection file and isolates data', async t => {
  const f = await setup(t); await f.runtime.refresh();
  const accepted = await f.runtime.saveConnection({ baseUrl: 'https://two.test/', account: 'bob', password: 'bob-secret' });
  assert.equal(accepted.account, 'bob'); assert.equal(accepted.status.syncing, true); assert.equal(accepted.notifications.length, 0);
  const result = await f.runtime.refresh(); assert.deepEqual(result.tasks.map(item => item.id), [2]);
  assert.equal(f.clients[0].abort.signal.aborted, true);
  const persisted = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(persisted.ZENTAO_BASE_URL, 'https://two.test'); assert.equal(persisted.ZENTAO_PASSWORD, 'bob-secret');
  assert.doesNotMatch(await readFile(join(f.dir, 'state.json'), 'utf8'), /bob-secret|alice-secret|private-token/);
  assert.doesNotMatch(JSON.stringify(result), /bob-secret|alice-secret|private-token|"password"/);
});

test('blank password preserves an unchanged connection but cannot cross site or account', async t => {
  const f = await setup(t);
  await f.runtime.saveConnection({ baseUrl: 'https://one.test/', account: 'alice', password: '' });
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).ZENTAO_PASSWORD, 'alice-secret');
  await assert.rejects(f.runtime.saveConnection({ baseUrl: 'https://two.test', account: 'alice', password: '' }), /密码/);
  await assert.rejects(f.runtime.saveConnection({ baseUrl: 'https://one.test', account: 'bob' }), /密码/);
  assert.equal(f.runtime.connection().account, 'alice');
});

test('failed login and unsafe fields keep the active account and stored bytes unchanged', async t => {
  const f = await setup(t); await f.runtime.saveConnection({ baseUrl: original.baseUrl, account: 'alice', password: '' });
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.runtime.saveConnection({ baseUrl: 'https://two.test', account: 'bob', password: 'bad-secret' }), error => /登录失败/.test(error.message) && !/bad-secret|upstream/.test(error.message));
  await assert.rejects(f.runtime.saveConnection({ ...original, connectionFile: 'C:/other.json' }), /字段/);
  await assert.rejects(f.runtime.saveConnection({ baseUrl: 'file:///etc/passwd', account: 'bob', password: 'bob-secret' }), /HTTP/);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.runtime.overview().account, 'alice');
  assert.equal(f.clients.at(-1).abort.signal.aborted, true);
});

test('a disk failure leaves the previous client and cached tasks usable', async t => {
  const f = await setup(t, { writeConnection: async () => { throw new Error('disk full'); } }); await f.runtime.refresh(); const current = f.runtime.getClient();
  await assert.rejects(f.runtime.saveConnection({ baseUrl: 'https://two.test', account: 'bob', password: 'bob-secret' }), /保存/);
  assert.equal(f.runtime.getClient(), current); assert.equal(current.abort.signal.aborted, false); assert.equal(f.runtime.overview().tasks[0].id, 1);
  await f.runtime.refresh();
});

test('fresh installs never import MCP credentials, while a locally saved connection survives restart', async t => {
  const f = await setup(t); const imported = join(f.dir, 'mcp.json'); await writeFile(imported, JSON.stringify({ ZENTAO_BASE_URL: original.baseUrl, ZENTAO_ACCOUNT: 'alice', ZENTAO_PASSWORD: 'alice-secret' }));
  const paths = { privateConnectionFile: f.file, connectionFile: imported };
  assert.deepEqual(await loadConfiguredConnection(paths), { connection: null, source: f.file });
  await saveConnectionFile(f.file, { baseUrl: 'https://two.test', account: 'bob', password: 'bob-secret' });
  const loaded = await loadConfiguredConnection(paths); assert.equal(loaded.connection.account, 'bob'); assert.equal(loaded.source, f.file);
  await writeFile(f.file, '{broken'); await assert.rejects(loadConfiguredConnection(paths), /连接文件/);
});

test('saving a verified connection returns before a slow first scan can cause a false save timeout', async t => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await setup(t, { clientFactory: config => ({ ...config, scopeKey: config.account, async login() {}, async snapshot() { if (config.account === 'bob') { entered(); await gate; } return { tasks: [], bugs: [] }; }, stop() {} }), writeConnection: async () => {} });
  let settled = false;
  const saving = f.runtime.saveConnection({ baseUrl: 'https://two.test', account: 'bob', password: 'bob-secret' });
  saving.then(() => { settled = true; }); await started; await new Promise(resolve => setImmediate(resolve));
  const returnedBeforeScan = settled; release(); const result = await saving; await f.runtime.refresh();
  assert.equal(returnedBeforeScan, true, 'login/persistence success must be acknowledged without waiting for task scans');
  assert.equal(result.connection.account, 'bob');
});

test('shutdown aborts an in-progress validation and never commits its connection afterward', async t => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; }); let writes = 0;
  const f = await setup(t, { clientFactory: config => ({ ...config, scopeKey: config.account, async login() { if (config.account === 'bob') { entered(); await gate; } }, async snapshot() { return { tasks: [], bugs: [] }; }, stop() {} }), writeConnection: async () => { writes++; } });
  const saving = f.runtime.saveConnection({ baseUrl: 'https://two.test', account: 'bob', password: 'bob-secret' });
  const rejection = assert.rejects(saving, /卸载|停止/); await started; const stopping = f.runtime.stop(); release(); await rejection; await stopping;
  assert.equal(writes, 0); assert.equal(f.runtime.connection().account, 'alice');
});
