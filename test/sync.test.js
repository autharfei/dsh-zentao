import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileStore } from '../src/store.js';
import { createService } from '../src/sync.js';

async function setup(t) {
  const root = resolve('.test-data'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'sync-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json'); const store = await FileStore.open(file);
  let items = []; let fail = false; let sent = []; let petFail = false; let delay = null;
  const item = (id, assignee = 'me', date = '2026-11-02T01:00:00Z') => ({ id, kind: 'task', title: `任务${id}`, assignedTo: { account: assignee, realname: '' }, assignedDate: date, openedDate: date, status: 'wait' });
  const client = { account: 'me', baseUrl: 'http://z.test', scopeKey: 'scope1', async snapshot() { if (delay) await delay; if (fail) throw new Error('offline'); return { tasks: structuredClone(items), bugs: [], account: 'me', baseUrl: 'http://z.test', scopeKey: 'scope1' }; }, stop() {} };
  const pet = { async send(text) { if (petFail) throw new Error('桌宠未启动'); sent.push(text); return { accepted: true }; } };
  const service = createService({ client, store, pet, connectionFile: 'connection.json' }); t.after(() => service.stop());
  return { service, item, file, store, client, pet, sent, setItems: value => { items = value; }, setFail: value => { fail = value; }, setPetFail: value => { petFail = value; }, setDelay: value => { delay = value; } };
}

test('first successful scan establishes baseline without notifying historical assignments', async t => {
  const f = await setup(t); f.setItems([f.item(1)]); const result = await f.service.refresh();
  assert.equal(result.status.syncing, false, 'a completed refresh must not leave the UI showing an active sync');
  assert.equal(f.service.overview().tasks.length, 1); assert.equal(f.service.overview().notifications.length, 0); assert.equal(f.sent.length, 0);
});

test('new and reassigned tasks create persistent unread notifications and a merged pet message', async t => {
  const f = await setup(t); f.setItems([f.item(1, 'other')]); await f.service.refresh();
  f.setItems([f.item(1), f.item(2)]); await f.service.refresh();
  const notices = f.service.overview().notifications;
  assert.equal(notices.length, 2); assert.ok(notices.every(x => !x.read && x.delivered)); assert.equal(f.sent.length, 1); assert.match(f.sent[0], /2/);
  await f.service.refresh(); assert.equal(f.sent.length, 1);
  const saved = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(saved.scopes.scope1.notifications.length, 2);
});

test('an assignment away and back, and changed assignment date, each notify once', async t => {
  const f = await setup(t); f.setItems([f.item(1)]); await f.service.refresh();
  f.setItems([f.item(1, 'other')]); await f.service.refresh();
  f.setItems([f.item(1, 'me', '2026-11-02T03:00:00Z')]); await f.service.refresh();
  f.setItems([f.item(1, 'me', '2026-11-02T04:00:00Z')]); await f.service.refresh();
  assert.equal(f.service.overview().notifications.length, 2);
});

test('restart retains read state and never replays already delivered notifications', async t => {
  const f = await setup(t); await f.service.refresh(); f.setItems([f.item(1)]); await f.service.refresh();
  const id = f.service.overview().notifications[0].id; await f.service.markRead([id]); f.service.stop();
  const secondStore = await FileStore.open(f.file); const second = createService({ client: f.client, store: secondStore, pet: f.pet }); t.after(() => second.stop());
  await second.refresh(); assert.equal(second.overview().notifications[0].read, true); assert.equal(f.sent.length, 1);
});

test('failed scans preserve baseline and old rows and recover without historical alerts', async t => {
  const f = await setup(t); f.setItems([f.item(1)]); await f.service.refresh(); f.setFail(true);
  await assert.rejects(f.service.refresh(), /offline/); assert.equal(f.service.overview().tasks.length, 1); assert.match(f.service.overview().status.error, /offline/);
  f.setFail(false); await f.service.refresh(); assert.equal(f.service.overview().notifications.length, 0);
});

test('failed pet sends stay unread and retry once after the pet becomes available', async t => {
  const f = await setup(t); await f.service.refresh(); f.setPetFail(true); f.setItems([f.item(1)]); await f.service.refresh();
  assert.equal(f.service.overview().notifications[0].delivered, false); assert.match(f.service.overview().status.petError, /桌宠/);
  f.setPetFail(false); await f.service.refresh(); assert.equal(f.sent.length, 1); assert.equal(f.service.overview().notifications[0].delivered, true);
});

test('concurrent refreshes share one scan and preserve read changes made during fetching', async t => {
  const f = await setup(t); await f.service.refresh(); f.setItems([f.item(1)]); await f.service.refresh();
  let release; f.setDelay(new Promise(r => { release = r; })); f.setItems([f.item(1), f.item(2)]);
  const a = f.service.refresh(); const b = f.service.refresh(); await f.service.markRead([f.service.overview().notifications[0].id]); release(); await Promise.all([a, b]);
  assert.equal(f.service.overview().notifications.length, 2); assert.equal(f.service.overview().notifications.find(x => x.itemId === 1).read, true); assert.equal(f.sent.length, 2);
});

test('disabling notices still updates the baseline so reenabling does not replay history', async t => {
  const f = await setup(t); await f.service.refresh(); await f.service.updateSettings({ notificationsEnabled: false });
  f.setItems([f.item(1)]); await f.service.refresh(); await f.service.updateSettings({ notificationsEnabled: true }); await f.service.refresh();
  assert.equal(f.service.overview().notifications.length, 0);
});

test('corrupt persistent state is reported without silently replacing existing content', async t => {
  const f = await setup(t);
  for (const content of ['{broken', 'null', 'false', '0', '\"\"']) {
    await writeFile(f.file, content);
    await assert.rejects(FileStore.open(f.file), /状态文件/); assert.equal(await readFile(f.file, 'utf8'), content);
  }
});

test('shutdown drains an already queued write and rejects mutations after unload', async t => {
  const f = await setup(t); await f.service.refresh(); const before = await readFile(f.file, 'utf8');
  let release; f.store.queue = new Promise(resolve => { release = resolve; }); f.setItems([f.item(1)]);
  const pending = f.service.refresh(); await Promise.resolve(); await Promise.resolve();
  const stopping = f.service.stop(); const waitable = Boolean(stopping && typeof stopping.then === 'function');
  release(); await pending; await stopping;
  assert.equal(waitable, true, 'Host must be able to await all state writes before reloading');
  assert.equal(await readFile(f.file, 'utf8'), before, 'a queued snapshot must not replace the state after unload');
  await assert.rejects(f.service.updateSettings({ pollSeconds: 30 }), /卸载|停止/);
});

test('stopped service never commits a late result', async t => {
  const f = await setup(t); await f.service.refresh(); let release; f.setDelay(new Promise(r => { release = r; })); f.setItems([f.item(1)]);
  const pending = f.service.refresh(); f.service.stop(); release(); await pending;
  assert.equal(f.service.overview().tasks.length, 0); assert.equal(f.sent.length, 0);
});
