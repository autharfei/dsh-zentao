import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZentaoClient, normalizeItem } from '../src/zentao.js';

const response = (body, status = 200) => Response.json(body, { status });
function fixture() {
  const calls = [];
  const pages = {
    'executions:1': { executions: [{ id: 5, name: '开发迭代' }], total: 1, limit: 100 },
    'executions/5/tasks:1': { tasks: [{ id: 11, name: '旧任务', status: 'done', assignedTo: null }, { id: 12, name: '新任务', status: 'doing', assignedTo: { account: 'me', realname: '我' }, assignedDate: '2026-11-02T01:00:00Z' }], total: 2, limit: 100 },
    'tasks:1': { tasks: [{ id: 12, name: '简化任务', assignedTo: 'me' }], total: 1, limit: 1, page: 1 },
    'products:1': { products: [{ id: 1, name: '产品' }], total: 1, limit: 100 },
    'bugs:1': { bugs: [{ id: 3, title: '第一页', assignedTo: 'other', status: 'active' }], total: 2, limit: 1, page: 1 },
    'bugs:2': { bugs: [{ id: 2, title: '第二页', assignedTo: { account: 'me', realname: '我' }, status: 'resolved' }], total: 2, limit: 1, page: 2 },
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input); const endpoint = url.pathname.split('/api.php/v1/')[1];
    calls.push({ endpoint, page: url.searchParams.get('page'), token: options.headers?.Token });
    if (endpoint === 'tokens') return response({ token: 'secret-token' });
    if (endpoint === 'bugs/3') return response({ id: 3, title: '复现', assignedTo: null, steps: '<p>步骤</p>', actions: [{ id: 1, date: '2026-11-02', actor: '我', action: 'commented', comment: '<b>评论</b>' }], files: [] });
    const page = Number(url.searchParams.get('page') || 1);
    const data = pages[`${endpoint}:${page}`];
    assert.ok(data, `unexpected request ${endpoint}:${page}`);
    return response(data);
  };
  return { calls, client: new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'private', fetchImpl }) };
}

test('snapshot traverses execution tasks and every bug page rather than trusting /tasks totals', async () => {
  const { client, calls } = fixture(); const result = await client.snapshot();
  assert.deepEqual(result.tasks.map(x => x.id), [11, 12]);
  assert.equal(result.tasks.find(x => x.id === 12).title, '新任务');
  assert.deepEqual(result.bugs.map(x => x.id), [3, 2]);
  assert.equal(result.bugs[1].assignedTo.account, 'me');
  assert.equal(result.bugs[0].productName, '产品');
  assert.ok(calls.some(x => x.endpoint === 'bugs' && x.page === '2'));
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('secret-token'));
});

test('the live server task supplement page-as-limit quirk is checked for completeness', async () => {
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'p', fetchImpl: async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/tokens')) return response({ token: 't' });
    if (url.pathname.endsWith('/executions')) return response({ executions: [], total: 0 });
    if (url.pathname.endsWith('/products')) return response({ products: [], total: 0 });
    if (url.pathname.endsWith('/tasks')) { const effectiveLimit = Number(url.searchParams.get('page')); return response({ tasks: [1, 2, 3].slice(0, effectiveLimit).map(id => ({ id })), total: 3, page: 1, limit: effectiveLimit }); }
    throw new Error('unexpected endpoint');
  } });
  assert.deepEqual((await client.snapshot()).tasks.map(item => item.id), [1, 2, 3]);
});

test('nullable and string users normalize to a usable account', () => {
  assert.deepEqual(normalizeItem('task', { id: 1, name: '任务', assignedTo: null }).assignedTo, { account: '', realname: '' });
  assert.equal(normalizeItem('bug', { id: 2, title: 'Bug', assignedTo: 'me' }).assignedTo.account, 'me');
});

test('detail retains rich description, actions and safe object links', async () => {
  const { client } = fixture(); const detail = await client.detail('bug', 3);
  assert.equal(detail.html, '<p>步骤</p>');
  assert.equal(detail.actions[0].comment, '<b>评论</b>');
  assert.match(detail.url, /bugID=3/);
  assert.ok(!JSON.stringify(detail).includes('secret-token'));
  await assert.rejects(client.detail('bug', '../tokens'), /编号/);
  await assert.rejects(client.detail('story', 3), /类型/);
});

test('a repeated API page fails the entire scan instead of silently dropping rows', async () => {
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'p', fetchImpl: async input => {
    const p = new URL(input).pathname;
    if (p.endsWith('/tokens')) return response({ token: 't' });
    if (p.endsWith('/executions')) return response({ executions: [{ id: 5 }], total: 2, limit: 1 });
    if (p.endsWith('/products')) return response({ products: [], total: 0 });
    throw new Error('Unexpected downstream request');
  } });
  await assert.rejects(client.snapshot(), /分页|重复/);
});

test('overlapping pages cannot satisfy totals with duplicate IDs and commit an incomplete snapshot', async () => {
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'p', fetchImpl: async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/tokens')) return response({ token: 't' });
    const page = Number(url.searchParams.get('page'));
    return response({ executions: (page === 1 ? [1, 2] : [2, 3]).map(id => ({ id })), total: 4, limit: 2, page });
  } });
  await assert.rejects(client.pages('executions', 'executions'), /分页|重复/);
});

test('401 refreshes authentication once and never sends credentials in GET URLs', async () => {
  let logins = 0; let reads = 0;
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'private', fetchImpl: async (input, options) => {
    assert.ok(!String(input).includes('private'));
    if (new URL(input).pathname.endsWith('/tokens')) { logins++; return response({ token: `t${logins}` }); }
    reads++; if (reads === 1) return response({}, 401);
    return response({ id: 4, name: '任务', desc: '描述' });
  } });
  assert.equal((await client.detail('task', 4)).title, '任务');
  assert.equal(logins, 2); assert.equal(reads, 2);
});

test('raster screenshots returned as octet-stream are sniffed without enabling active content', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'p', fetchImpl: async input => new URL(input).pathname.endsWith('/tokens') ? response({ token: 't' }) : new Response(png, { headers: { 'Content-Type': 'application/octet-stream' } }) });
  const image = await client.image(8307); assert.equal(image.type, 'image/png'); assert.deepEqual(image.body, png);
});

test('partial product failures reject snapshots so notification baselines cannot be erased', async () => {
  const client = new ZentaoClient({ baseUrl: 'http://zentao.test', account: 'me', password: 'p', fetchImpl: async input => {
    const p = new URL(input).pathname;
    if (p.endsWith('/tokens')) return response({ token: 't' });
    if (p.endsWith('/executions')) return response({ executions: [], total: 0 });
    if (p.endsWith('/tasks')) return response({ tasks: [], total: 0 });
    if (p.endsWith('/products')) return response({ products: [{ id: 1 }], total: 1 });
    return response({ password: 'should-not-echo' }, 500);
  } });
  await assert.rejects(client.snapshot(), e => /500/.test(e.message) && !e.message.includes('should-not-echo'));
});
