import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHandler, trustedRequest } from '../src/http.js';

async function server(t) {
  const overview = { tasks: [{ id: 1, title: '任务' }], bugs: [], notifications: [], settings: { pollSeconds: 45 } };
  const handler = createHandler({ service: { overview: () => overview, refresh: async () => overview, settings: () => overview.settings, updateSettings: async patch => { if ('password' in patch) throw new Error('不允许'); return overview; }, markRead: async () => overview, connection: () => ({ baseUrl: 'https://zt.test', account: 'me', hasPassword: true }), saveConnection: async patch => { if (patch.password !== 'new-secret' || patch.account !== 'new-account') throw new Error('参数错误'); return { ...overview, account: patch.account, connection: { baseUrl: patch.baseUrl, account: patch.account, hasPassword: true } }; } },
    getClient: () => ({ detail: async (kind, id) => { if (kind !== 'task' || !/^\d+$/.test(id)) throw new Error('参数错误'); return { title: '详情', html: '<p>描述</p>' }; }, image: async () => ({ type: 'image/png', body: Buffer.from([137, 80, 78, 71]) }) }), pet: { list: async () => ({ available: false, pets: [] }), send: async () => ({ accepted: true }) } });
  const http = createServer(handler); http.listen(0, '127.0.0.1'); await once(http, 'listening'); t.after(() => new Promise(r => { http.closeAllConnections(); http.close(r); }));
  return `http://127.0.0.1:${http.address().port}/api/zentao`;
}

test('host serves cached overview and full detail without credential fields', async t => {
  const base = await server(t); const overview = await (await fetch(`${base}/overview`)).json(); assert.equal(overview.ok, true); assert.equal(overview.data.tasks[0].title, '任务');
  const detail = await (await fetch(`${base}/detail?kind=task&id=1`)).json(); assert.equal(detail.data.html, '<p>描述</p>');
});

test('connection routes expose only public metadata and accept same-origin configuration', async t => {
  const base = await server(t);
  const metadata = await (await fetch(`${base}/connection`)).json();
  assert.equal(metadata.ok, true); assert.equal(metadata.data.hasPassword, true); assert.equal(metadata.data.account, 'me'); assert.equal('password' in metadata.data, false);
  const response = await fetch(`${base}/connection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://zt.test', account: 'new-account', password: 'new-secret' }) });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.data.account, 'new-account'); assert.doesNotMatch(JSON.stringify(result), /new-secret/);
  assert.equal((await fetch(`${base}/connection`, { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('cross-origin mutation and DNS rebinding host headers are rejected', async t => {
  const base = await server(t); const response = await fetch(`${base}/refresh`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 403);
  assert.equal(trustedRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'evil.example', origin: 'http://evil.example' } }), false);
  assert.equal(trustedRequest({ socket: { remoteAddress: '192.168.0.1' }, headers: { host: '127.0.0.1:1' } }), false);
});

test('invalid JSON, unsupported methods, unsafe IDs and unknown endpoints return real errors', async t => {
  const base = await server(t);
  assert.equal((await fetch(`${base}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await fetch(`${base}/overview`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/detail?kind=task&id=../tokens`)).status, 400);
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) })).status, 400);
});

test('image proxy serves only controlled IDs with nosniff and a raster content type', async t => {
  const base = await server(t); const image = await fetch(`${base}/image?id=23`); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${base}/image?id=https://evil.example`)).status, 400);
});
