'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modelPath = path.join(__dirname, '../src/client-model.cjs');
const model = fs.existsSync(modelPath) ? require(modelPath) : {};

const items = [
  { kind: 'task', id: 11, title: '修复登录超时', status: 'doing', pri: 1, assignedTo: { account: 'alice', realname: '小林' }, projectName: '仓储', execution: '迭代一' },
  { kind: 'task', id: 12, title: '新增报表', status: 'wait', pri: 2, assignedTo: { account: 'bob', realname: '小周' }, projectName: '财务' },
  { kind: 'task', id: 13, title: 'LOGIN validation', status: 'doing', pri: 2, assignedTo: { account: 'alice', realname: '小林' } },
];

test('筛选同时核对关键字、状态、优先级与当前账号，不修改原列表', () => {
  assert.equal(typeof model.filterItems, 'function');
  const original = JSON.stringify(items);
  assert.deepEqual(model.filterItems(items, { query: ' 登录 ', status: 'doing', priority: '1', scope: 'mine' }, 'alice').map(x => x.id), [11]);
  assert.deepEqual(model.filterItems(items, { query: 'login', scope: 'all' }, 'alice').map(x => x.id), [13]);
  assert.deepEqual(model.filterItems(items, { query: '仓储', scope: 'all' }, 'alice').map(x => x.id), [11]);
  assert.deepEqual(model.filterItems(items, { query: '#12', scope: 'all' }, 'alice').map(x => x.id), [12]);
  assert.deepEqual(model.filterItems(items, { scope: 'mine' }, '').map(x => x.id), []);
  assert.equal(JSON.stringify(items), original);
});

test('项目缺失的任务仍可显示和搜索所属执行，Bug优先展示产品', () => {
  const task = { kind: 'task', id: 7, title: '测试事项', executionName: '仓库迭代三', assignedTo: { account: 'alice' } };
  assert.deepEqual(model.filterItems([task], { query: '迭代三', scope: 'all' }, 'alice').map(item => item.id), [7]);
  const ui = componentHarness('ItemList', { items: [task], kind: 'task', filters: { query: '', scope: 'all', status: 'all', priority: 'all' }, account: 'alice', onFilter() {}, onSelect() {} });
  assert.match(plainText(ui.render()), /仓库迭代三/);
  ui.dispose();
});

test('分页在筛选后收缩页码，空数据也有可用的第一页', () => {
  assert.equal(typeof model.paginateItems, 'function');
  assert.deepEqual(model.paginateItems(items, 9, 2), { items: [items[2]], page: 2, pageSize: 2, total: 3, pages: 2, from: 3, to: 3 });
  assert.deepEqual(model.paginateItems([], 0, 0), { items: [], page: 1, pageSize: 20, total: 0, pages: 1, from: 0, to: 0 });
});

test('统计从账号待办和通知已读状态计算，不把桌宠未送达当未读', () => {
  assert.equal(typeof model.summarize, 'function');
  assert.deepEqual(model.summarize({ tasks: [...items, { ...items[0], id: 14, status: 'done' }], bugs: [
    { id: 1, status: 'active', assignedTo: { account: 'alice' } },
    { id: 2, status: 'closed', assignedTo: { account: 'alice' } },
  ], notifications: [{ read: false, delivered: true }, { read: true, delivered: false }], account: 'alice' }), { tasks: 2, bugs: 1, urgent: 1, unread: 1 });
});

test('设置仅提交白名单，拒绝越界、非整数轮询值并隐藏凭据', () => {
  assert.equal(typeof model.settingsPatch, 'function');
  assert.deepEqual(model.settingsPatch({ pollSeconds: '30', notificationsEnabled: false, petEnabled: true, petId: 'pet-1', password: 'secret', connectionFile: 'C:/x', baseUrl: 'https://evil.test' }), { pollSeconds: 30, notificationsEnabled: false, petEnabled: true, petId: 'pet-1', petDurationSeconds: 10, petAlerts: { task: { animation: '', imageType: 'none', image: '' }, bug: { animation: '', imageType: 'none', image: '' } } });
  for (const pollSeconds of [29, 61, 30.5, '', 'bad']) assert.throws(() => model.settingsPatch({ pollSeconds }), /30.*60/);
});

test('连接表单只在同网址账号时允许空密码保留，密码原文不被裁剪', () => {
  assert.equal(typeof model.connectionPatch, 'function');
  const saved = { baseUrl: 'https://zt.example/zentao/', account: 'alice', hasPassword: true };
  assert.deepEqual(model.connectionPatch({ baseUrl: ' https://zt.example/zentao ', account: ' alice ', password: '' }, saved), { baseUrl: 'https://zt.example/zentao/', account: 'alice' });
  assert.deepEqual(model.connectionPatch({ baseUrl: saved.baseUrl, account: 'bob', password: ' p a s s ' }, saved), { baseUrl: saved.baseUrl, account: 'bob', password: ' p a s s ' });
  for (const draft of [{ ...saved, account: 'bob' }, { ...saved, baseUrl: 'https://new.example/' }]) assert.throws(() => model.connectionPatch(draft, saved), /密码/);
  assert.throws(() => model.connectionPatch({ ...saved, password: '' }, { ...saved, hasPassword: false }), /密码/);
  for (const baseUrl of ['javascript:alert(1)', 'https://u:p@zt.example/', 'https://zt.example/?token=x']) assert.throws(() => model.connectionPatch({ baseUrl, account: 'a', password: 'x' }, saved), /网址/);
});

test('图片只从禅道附件路径或固定读图接口提取正整数id', () => {
  assert.equal(typeof model.extractImageId, 'function');
  const cases = [
    ['/zentao/file-read-123.png', 123],
    ['https://zentao.example/zentao/file-read-42.jpg?token=private', 42],
    ['/index.php?m=file&f=read&fileID=31', 31],
    ['/api/zentao/image?id=17', 17],
    ['https://tracker.example/collect?id=17', null],
    ['https://tracker.example/image.png', null],
    ['javascript:alert(1)', null], ['data:image/svg+xml,hi', null],
    ['/file-read-0.png', null], ['/file-read-9007199254740993.png', null],
    ['/index.php?m=file&f=download&fileID=31', null],
  ];
  for (const [input, expected] of cases) assert.equal(model.extractImageId(input), expected, input);
});

test('站外打开与附件链接仅允许契约站点，拒绝凭据、危险scheme和外域', () => {
  assert.equal(typeof model.safeSiteUrl, 'function');
  assert.equal(model.safeSiteUrl('https://zt.example/task-view-1.html', 'https://zt.example/zentao/'), 'https://zt.example/task-view-1.html');
  assert.equal(model.safeSiteUrl('/zentao/task-view-1.html', 'https://zt.example/zentao/'), 'https://zt.example/zentao/task-view-1.html');
  assert.equal(model.safeSiteUrl('https://evil.example/task-1', 'https://zt.example'), null);
  assert.equal(model.safeSiteUrl('https://u:p@zt.example/task-1', 'https://zt.example'), null);
  assert.equal(model.safeSiteUrl('javascript:alert(1)', 'https://zt.example'), null);
  assert.equal(model.safeSiteUrl('https://zt.example/task?token=secret', 'https://zt.example'), null);
  assert.equal(model.safeSiteUrl('/task-1', ''), null);
});

test('缺少DOMParser时安全降级成纯文本，强CSP仍阻止脚本、表单与外部资源', () => {
  assert.equal(typeof model.buildSafeDocument, 'function');
  const html = model.buildSafeDocument('<script>alert(1)</script><img src="https://evil.test/a">', { DOMParser: null });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src 'self'/);
  assert.match(html, /style-src 'unsafe-inline'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&lt;script&gt;/);
});

test('沙箱opaque来源只补充当前DSH同源图片地址，拒绝把任意外域加入CSP', () => {
  const html = model.buildSafeDocument('说明', { DOMParser: null, origin: 'http://127.0.0.1:53536' });
  assert.match(html, /img-src 'self' http:\/\/127\.0\.0\.1:53536;/);
  const unsafe = model.buildSafeDocument('说明', { DOMParser: null, origin: 'https://evil.test\"; script-src *' });
  assert.doesNotMatch(unsafe, /evil\.test/);
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

test('API只使用固定同源路径，POST发白名单JSON并校验错误信封', async () => {
  assert.equal(typeof model.createApi, 'function');
  const calls = [];
  const api = model.createApi({ fetchImpl: async (url, options) => { calls.push({ url, options }); return jsonResponse({ ok: true, data: { accepted: true } }); } });
  assert.deepEqual(await api.detail('task', 12), { accepted: true });
  await api.read({ ids: ['notice-1'] });
  await api.saveSettings({ pollSeconds: 45, notificationsEnabled: true, petEnabled: false, petId: '', password: 'secret' });
  assert.equal(calls[0].url, '/api/zentao/detail?kind=task&id=12');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, '/api/zentao/read');
  assert.deepEqual(JSON.parse(calls[1].options.body), { ids: ['notice-1'] });
  assert.deepEqual(JSON.parse(calls[2].options.body), { pollSeconds: 45, notificationsEnabled: true, petEnabled: false, petId: '' });
  await assert.rejects(api.detail('story', 1), /任务|Bug/);
  await assert.rejects(api.detail('task', -1), /编号/);
  const failing = model.createApi({ fetchImpl: async () => jsonResponse({ ok: false, error: '禅道连接失败' }, 503) });
  await assert.rejects(failing.overview(), /禅道连接失败/);
  const malformed = model.createApi({ fetchImpl: async () => jsonResponse({ hello: 'world' }) });
  await assert.rejects(malformed.overview(), /响应/);
});

test('连接API只发送指定字段，失败反馈不带密码或Host原始错误', async () => {
  const calls = [];
  const api = model.createApi({ fetchImpl: async (url, options) => { calls.push({ url, options }); return jsonResponse({ ok: true, data: { baseUrl: 'https://zt.example/', account: 'alice', hasPassword: true } }); } });
  assert.equal(typeof api.connection, 'function'); assert.equal(typeof api.saveConnection, 'function');
  await api.connection();
  await api.saveConnection({ baseUrl: 'https://zt.example/', account: 'alice', password: 'new-password', token: 'forbidden' });
  assert.equal(calls[0].url, '/api/zentao/connection'); assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].url, '/api/zentao/connection'); assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { baseUrl: 'https://zt.example/', account: 'alice', password: 'new-password' });
  const bad = model.createApi({ fetchImpl: async () => jsonResponse({ ok: false, error: 'leaked-new-password' }, 500) });
  await assert.rejects(bad.saveConnection({ baseUrl: 'https://zt.example/', account: 'alice', password: 'new-password' }), error => /连接失败/.test(error.message) && !/new-password/.test(error.message));
});

test('连接登录超过20秒仍可完成，30秒前不被普通请求超时提前取消', async () => {
  const timers = new Map(); let nextId = 0, resolveLogin, loginSignal;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(modelPath, 'utf8'), { module, AbortController, URL, setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
  const api = module.exports.createApi({ fetchImpl: (url, { signal }) => { loginSignal = signal; return new Promise((resolve, reject) => { resolveLogin = resolve; signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))); }); } });
  const login = api.saveConnection({ baseUrl: 'https://zt.example/', account: 'alice', password: 'private' });
  for (const timer of [...timers.values()]) if (timer.ms <= 21000) timer.fn();
  assert.equal(loginSignal.aborted, false, 'Host登录20秒后客户端仍须接收成功响应');
  resolveLogin(jsonResponse({ ok: true, data: overview })); await login; assert.equal(timers.size, 0);
});

test('API超时会中止请求，主动卸载中止不会误报连接失败', async () => {
  assert.equal(typeof model.createApi, 'function');
  let receivedSignal;
  const fetchImpl = (url, { signal }) => { receivedSignal = signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); };
  const api = model.createApi({ fetchImpl, timeoutMs: 5 });
  await assert.rejects(api.overview(), /超时/);
  assert.equal(receivedSignal.aborted, true);
  const controller = new AbortController();
  const pending = api.overview({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

const overview = { tasks: items, bugs: [], notifications: [{ id: 'n1', read: false }], status: { lastSuccessAt: '2026-11-02T10:00:00Z', error: null }, settings: { pollSeconds: 45 }, account: 'alice', baseUrl: 'https://zt.example/' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function timerHarness() {
  const timers = new Map(); let nextId = 0;
  return { timers, setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
}

test('共享overview订阅只启一次轮询，断网保留旧数据，最后卸载清理计时器', async () => {
  assert.equal(typeof model.createOverviewStore, 'function');
  const clock = timerHarness(); let calls = 0;
  const api = { overview: async () => { calls++; if (calls > 1) throw new Error('连接已断开'); return overview; } };
  const store = model.createOverviewStore({ api, ...clock });
  const offA = store.subscribe(() => {}); const offB = store.subscribe(() => {});
  await tick();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().data, overview);
  assert.equal(clock.timers.size, 1);
  await store.reload();
  assert.equal(store.getSnapshot().data, overview);
  assert.match(store.getSnapshot().error, /连接已断开/);
  offA(); assert.equal(clock.timers.size, 1);
  offB(); assert.equal(clock.timers.size, 0);
});

test('较迟返回的overview不能覆盖更新的已读结果，卸载后忽略响应', async () => {
  assert.equal(typeof model.createOverviewStore, 'function');
  const clock = timerHarness(); let resolveLoad; let loadSignal;
  const afterRead = { ...overview, notifications: [{ id: 'n1', read: true }] };
  const api = { overview: ({ signal }) => { loadSignal = signal; return new Promise(resolve => { resolveLoad = resolve; }); }, read: async () => afterRead };
  const store = model.createOverviewStore({ api, ...clock });
  const off = store.subscribe(() => {});
  await store.markRead({ ids: ['n1'] });
  assert.equal(loadSignal.aborted, true);
  resolveLoad(overview); await tick();
  assert.equal(store.getSnapshot().data, afterRead);
  off();
  assert.equal(clock.timers.size, 0);
});

test('连接保存成功替换账号缓存并阻止旧overview回写，失败保留已显示账号', async () => {
  const clock = timerHarness(); let resolveOld; let oldSignal;
  const switched = { ...overview, tasks: [], account: 'bob', connection: { baseUrl: 'https://other.example/', account: 'bob', hasPassword: true } };
  let fail = false;
  const api = { overview: ({ signal }) => { oldSignal = signal; return new Promise(resolve => { resolveOld = resolve; }); }, saveConnection: async () => { if (fail) throw new Error('连接失败'); return switched; } };
  const store = model.createOverviewStore({ api, ...clock });
  assert.equal(typeof store.saveConnection, 'function');
  const off = store.subscribe(() => {});
  await store.saveConnection({ baseUrl: 'https://other.example/', account: 'bob', password: 'private' });
  assert.equal(oldSignal.aborted, true); resolveOld(overview); await tick();
  assert.equal(store.getSnapshot().data.account, 'bob'); assert.deepEqual(store.getSnapshot().data.tasks, []);
  assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /private/);
  fail = true; await store.saveConnection({ baseUrl: 'https://bad.example/', account: 'c', password: 'private' });
  assert.equal(store.getSnapshot().data.account, 'bob'); assert.match(store.getSnapshot().error, /连接失败/);
  off(); store.dispose();
});

function loadClient(reactOverrides = {}, globals = {}) {
  const filename = path.join(__dirname, '../src/client.cjs');
  assert.ok(fs.existsSync(filename), 'Client入口应存在');
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, STYLES: '.zt-app{}', AbortController, setTimeout, clearTimeout,
    require(id) { if (id === 'react') return { createElement(type, props, ...children) { return { type, props: { ...props, children } }; }, ...reactOverrides }; if (id === './client-model.cjs') return model; throw new Error(`unexpected require: ${id}`); },
    ...globals,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return module.exports;
}

// React is provided only by the host. This small hook driver exercises our handlers and
// rendered security attributes without pretending to test React's rendering machinery.
function componentHarness(exportName, props, globals = {}) {
  const states = [], refs = [], memos = [], effects = [];
  let cursor = 0, pendingEffects = [], tree;
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return refs[index] ||= { current: initial }; },
    useMemo(factory, deps) { const index = cursor++; if (!memos[index] || changed(memos[index].deps, deps)) memos[index] = { deps, value: factory() }; return memos[index].value; },
    useEffect(setup, deps) { const index = cursor++; if (!effects[index] || changed(effects[index].deps, deps || [])) pendingEffects.push(() => { effects[index]?.off?.(); effects[index] = { deps, off: setup() }; }); },
    useId() { return `test-${cursor++}`; },
  };
  const client = loadClient(hooks, globals);
  assert.equal(typeof client[exportName], 'function', `${exportName} should be exported for host-boundary tests`);
  const expand = value => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== 'object') return value;
    if (typeof value.type === 'function') return expand(value.type(value.props));
    return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
  };
  const render = () => { cursor = 0; pendingEffects = []; tree = expand(client[exportName](props)); for (const effect of pendingEffects) effect(); return tree; };
  return { render, setProps(next) { props = { ...props, ...next }; }, dispose() { effects.forEach(effect => effect?.off?.()); } };
}
function nodes(tree, predicate, output = []) {
  if (Array.isArray(tree)) for (const child of tree) nodes(child, predicate, output);
  else if (tree && typeof tree === 'object') { if (predicate(tree)) output.push(tree); nodes(tree.props?.children, predicate, output); }
  return output;
}
function plainText(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (Array.isArray(tree)) return tree.map(plainText).join(''); return typeof tree === 'object' ? plainText(tree.props?.children) : String(tree); }

test('详情渲染空sandbox和受控srcDoc，换条目会中止旧请求并只展示新详情', async () => {
  let resolveFirst, firstSignal;
  const api = { detail(kind, id, { signal }) { if (id === 1) { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve; }); } return Promise.resolve({ kind, id, title: '第二条详情', status: 'doing', pri: 2, fields: { 负责人: '小林' }, html: '<b>描述</b>', actions: [], files: [], url: 'https://zt.example/task-view-2.html' }); } };
  const ui = componentHarness('DetailDrawer', { selection: { kind: 'task', id: 1 }, api, baseUrl: 'https://zt.example', onClose() {} });
  ui.render();
  ui.setProps({ selection: { kind: 'task', id: 2 } }); ui.render(); await tick();
  resolveFirst({ title: '过期详情', html: '旧内容', fields: {}, actions: [], files: [] }); await tick();
  const view = ui.render(); const frames = nodes(view, node => node.type === 'iframe');
  assert.equal(firstSignal.aborted, true); assert.match(plainText(view), /第二条详情/); assert.doesNotMatch(plainText(view), /过期详情/);
  assert.equal(frames.length, 1); assert.equal(frames[0].props.sandbox, ''); assert.match(frames[0].props.srcDoc, /default-src 'none'/);
  const outbound = nodes(view, node => node.type === 'a');
  assert.equal(outbound[0].props.href, 'https://zt.example/task-view-2.html'); assert.match(outbound[0].props.rel, /noreferrer/);
  ui.dispose();
});

test('详情补充契约中的负责人，并将操作记录与附件入口正确切换展示', async () => {
  const api = { detail: async () => ({ kind: 'bug', id: 3, title: '问题详情', status: 'active', pri: 1, assignedTo: { account: 'alice', realname: '小林' }, fields: {}, html: '步骤', actions: [{ id: 1, actor: 'alice', action: 'opened', date: '2026-11-02T10:00:00Z', comment: '<b>备注</b>', history: [{ field: '状态', old: 'wait', new: 'doing' }] }], files: [{ id: 9, title: '截图.png', url: 'https://zt.example/file-read-9.png' }, { id: 10, title: '危险链接', url: 'https://evil.test/secret' }], url: 'https://zt.example/bug-view-3.html' }) };
  const ui = componentHarness('DetailDrawer', { selection: { kind: 'bug', id: 3 }, api, baseUrl: 'https://zt.example', onClose() {} }); ui.render(); await tick();
  let view = ui.render(); assert.match(plainText(view), /负责人小林/);
  nodes(view, node => node.type === 'button' && plainText(node).startsWith('操作记录'))[0].props.onClick(); view = ui.render();
  assert.match(plainText(view), /aliceopened/); assert.match(plainText(view), /状态：wait → doing/);
  assert.equal(nodes(view, node => node.type === 'iframe')[0].props.sandbox, '');
  nodes(view, node => node.type === 'button' && plainText(node).startsWith('附件'))[0].props.onClick(); view = ui.render();
  assert.equal(nodes(view, node => node.type === 'a' && node.props.href.includes('evil.test')).length, 0);
  assert.equal(nodes(view, node => node.type === 'a' && node.props.href === 'https://zt.example/file-read-9.png').length, 1);
  ui.dispose();
});

test('同步设置独立保存30到60整数，连接表单不回显Host密码', async () => {
  const saved = [];
  const settings = { pollSeconds: 45, notificationsEnabled: true, petEnabled: true, petId: '', connectionFile: 'C:/private/connection.json', hasCredentials: true, password: 'must-never-render' };
  const store = { async saveSettings(patch) { saved.push(patch); return { settings: patch }; } };
  const api = { pets: async () => ({ available: true, pets: [{ id: 'cat', name: '猫', display: ['desktop'] }] }), petTest: async () => ({ accepted: true }) };
  const ui = componentHarness('SettingsPanel', { settings, store, api, busy: null }); ui.render(); await tick();
  let view = ui.render(); const poll = () => nodes(view, node => node.type === 'input' && node.props.type === 'number')[0];
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'password')[0].props.value, ''); assert.doesNotMatch(plainText(view), /must-never-render/);
  assert.equal(nodes(view, node => node.type === 'form').length, 2); assert.equal(nodes(view, node => node.type === 'form' && nodes(node.props.children, child => child.type === 'form').length > 0).length, 0);
  poll().props.onChange({ target: { value: '29' } }); view = ui.render();
  const submit = async () => { const form = nodes(view, node => node.type === 'form' && node.props.className === 'zt-sync-form')[0]; await form.props.onSubmit({ preventDefault() {} }); view = ui.render(); };
  await submit(); assert.equal(saved.length, 0); assert.match(plainText(view), /30.*60/);
  poll().props.onChange({ target: { value: '60' } }); view = ui.render(); await submit();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ pollSeconds: 60, notificationsEnabled: true, petEnabled: true, petId: '', petDurationSeconds: 10, petAlerts: { task: { animation: '', imageType: 'none', image: '' }, bug: { animation: '', imageType: 'none', image: '' } } }]);
  ui.dispose();
});

test('连接表单默认空密码，同连接可保留、换账号需密码，成功清空而失败可重试', async () => {
  const saved = []; let reject = false;
  const connection = { baseUrl: 'https://zt.example/', account: 'alice', hasPassword: true, password: 'host-secret-must-never-render' };
  const store = { async saveConnection(body) { saved.push(body); if (reject) throw new Error(`host echoed ${body.password}`); return { connection: { baseUrl: body.baseUrl, account: body.account, hasPassword: true } }; } };
  const ui = componentHarness('ConnectionPanel', { connection, store, busy: null });
  let view = ui.render();
  const input = name => nodes(view, node => node.type === 'input' && node.props.name === name)[0];
  const change = (name, value) => { input(name).props.onChange({ target: { value } }); view = ui.render(); };
  const submit = async () => { await nodes(view, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); view = ui.render(); };
  assert.equal(input('password').props.type, 'password'); assert.equal(input('password').props.value, '');
  assert.doesNotMatch(plainText(view), /host-secret/); assert.match(input('password').props.placeholder, /留空/);
  await submit(); assert.equal(saved.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(saved[0])), { baseUrl: 'https://zt.example/', account: 'alice' });
  change('account', 'bob'); await submit(); assert.equal(saved.length, 1); assert.match(plainText(view), /密码/);
  change('password', 'retry-secret'); reject = true; await submit();
  assert.equal(input('password').props.value, 'retry-secret'); assert.match(plainText(view), /连接失败/); assert.doesNotMatch(plainText(view), /retry-secret|host echoed/);
  reject = false; await submit(); assert.equal(input('password').props.value, ''); assert.match(plainText(view), /连接成功/);
  assert.doesNotMatch(JSON.stringify(saved[0]), /password/); ui.dispose();
});

test('插件业务tab挂载只触发一次跳转，直接打开全高main工作台', () => {
  const opened = [], openWorkspace = () => opened.push('zentao');
  const ui = componentHarness('WorkspaceEntry', { openWorkspace });
  ui.render(); ui.render(); ui.render();
  assert.deepEqual(opened, ['zentao']); ui.dispose();
});

test('业务tab跳main前复位宿主持久tab，返回插件管理页不会再次被跳走', () => {
  const navigation = { panel: 'plugins', tab: 'zentao', view: { kind: 'list' } };
  const order = [];
  const openPackage = packageName => { order.push(`package:${packageName}`); navigation.tab = 'installed'; navigation.view = { kind: 'package', name: packageName }; };
  const openWorkspace = () => { order.push('workspace'); navigation.panel = 'zentao'; navigation.view = { kind: 'list' }; };
  const ui = componentHarness('WorkspaceEntry', { openWorkspace, openPackage }); ui.render(); ui.render(); ui.dispose();
  assert.deepEqual(order, ['package:dsh-zentao', 'workspace']);
  assert.equal(navigation.tab, 'installed'); assert.equal(navigation.panel, 'zentao');
  navigation.panel = 'plugins';
  if (navigation.tab === 'zentao') { const reentry = componentHarness('WorkspaceEntry', { openWorkspace, openPackage }); reentry.render(); reentry.dispose(); }
  assert.equal(navigation.panel, 'plugins', '宿主记住installed后应停留在插件管理页');
  assert.deepEqual(navigation.view, { kind: 'list' });
});

test('插件tab把宿主openPackage动作传给跳转入口', () => {
  const host = slotLifecycleHarness(); host.ctx.layout = { selectPanel() {} };
  const client = loadClient(); client.apply(host.ctx); host.declare('plugins.tab');
  const tab = [...host.active].find(record => record.spec.name === 'plugins.tab');
  const openPackage = () => {};
  assert.equal(tab.render({ openPackage }).props.openPackage, openPackage);
  host.dispose();
});

test('主题使用宿主body暗色标记而不是用户系统偏好，body标记变化可重读', () => {
  let marked = true; const observed = [];
  const element = { className: '', getAttribute() { return ''; }, hasAttribute(name) { return name === 'data-ds-dark-theme' && marked; } };
  const doc = { documentElement: { ...element, hasAttribute() { return false; } }, body: element };
  const ui = componentHarness('ZentaoApp', { store: { getSnapshot: () => ({ data: overview }), subscribe: () => () => {} }, api: {} }, {
    document: doc, getComputedStyle: () => ({ colorScheme: 'normal', getPropertyValue: () => '#fff' }), matchMedia: () => ({ matches: false }),
    MutationObserver: class { constructor(callback) { this.callback = callback; observed.push(this); } observe(target, options) { this.options = options; } disconnect() {} },
  });
  let view = ui.render(); assert.equal(view.props['data-theme'], 'dark');
  assert.ok(observed.some(row => row.options.attributeFilter.includes('data-ds-dark-theme')));
  marked = false; observed.forEach(row => row.callback()); view = ui.render(); assert.equal(view.props['data-theme'], 'light'); ui.dispose();
});

test('通知区分已读与桌宠送达，支持单条已读和全部已读', () => {
  const reads = []; const opened = [];
  const ui = componentHarness('NoticeList', { notifications: [{ id: 'n1', kind: 'task', itemId: 7, title: '待办事项', reason: 'reassigned', read: false, delivered: true, createdAt: '2026-11-02T10:00:00Z' }, { id: 'n2', kind: 'bug', itemId: 8, title: '已读事项', reason: 'created', read: true, delivered: false, createdAt: '2026-11-01T10:00:00Z' }], onRead: body => reads.push(body), onSelect: value => opened.push(value), busy: null });
  const view = ui.render(); assert.match(plainText(view), /重新指派/);
  const buttons = nodes(view, node => node.type === 'button');
  buttons.find(node => plainText(node) === '全部已读').props.onClick();
  buttons.find(node => plainText(node) === '标为已读').props.onClick();
  buttons.find(node => plainText(node).includes('待办事项')).props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(reads)), [{ all: true }, { ids: ['n1'] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ kind: 'task', id: 7 }]);
  ui.dispose();
});

// rc5 runs each available slot callback in an effect scope. Registered resources
// belong to that generation and disappear when the slot declaration collapses.
function slotLifecycleHarness() {
  const waits = new Map(), active = new Set(), roots = [];
  let currentScope = null, localeCleaned = 0;
  function effect(setup, parent = currentScope) {
    const scope = { active: true, offs: [] };
    scope.dispose = () => {
      if (!scope.active) return;
      scope.active = false;
      for (const off of scope.offs.splice(0).reverse()) off();
    };
    if (parent) parent.offs.push(scope.dispose); else roots.push(scope.dispose);
    const previous = currentScope; currentScope = scope;
    try { const off = setup(); if (typeof off === 'function') scope.offs.push(off); }
    finally { currentScope = previous; }
    return scope;
  }
  const ctx = {
    effect(setup) { return effect(setup).dispose; },
    locale: { register() { return () => { localeCleaned++; }; }, bind() { return () => '禅道'; } },
    slots: {
      inject(name, callback) {
        const waiter = { callback, owner: currentScope, generation: null }; waits.set(name, waiter);
        return () => { waiter.generation?.dispose(); waits.delete(name); };
      },
      register(spec, render) {
        const record = { spec, render }; active.add(record);
        const off = () => active.delete(record);
        currentScope?.offs.push(off);
        return off;
      },
    },
  };
  return { ctx, active, waits,
    declare(name) {
      const waiter = waits.get(name);
      if (!waiter.generation?.active) waiter.generation = effect(waiter.callback, waiter.owner);
    },
    repeat(name) {
      const waiter = waits.get(name), previous = currentScope; currentScope = waiter.generation;
      try { const off = waiter.callback(); if (typeof off === 'function') currentScope.offs.push(off); }
      finally { currentScope = previous; }
    },
    collapse(name) { const waiter = waits.get(name); waiter.generation?.dispose(); waiter.generation = null; },
    dispose() { for (const off of roots.splice(0).reverse()) off(); },
    get localeCleaned() { return localeCleaned; },
  };
}

test('slot每代自动清理后重新声明会恢复sidebar配对、业务tab和配置入口', () => {
  const client = loadClient();
  const host = slotLifecycleHarness(); client.apply(host.ctx);
  for (const name of ['sidebar.panellist', 'plugins.tab', 'plugins.bundle.config']) host.declare(name);
  assert.equal(host.active.size, 4);
  const staleCallback = host.waits.get('sidebar.panellist').callback;
  const count = name => [...host.active].filter(record => record.spec.name === name).length;
  for (let generation = 0; generation < 3; generation++) {
    host.repeat('sidebar.panellist'); host.repeat('plugins.tab'); host.repeat('plugins.bundle.config');
    assert.equal(host.active.size, 4, '同一代重复回调不能产生重复入口');
    host.collapse('sidebar.panellist');
    assert.equal(count('main'), 0); assert.equal(count('sidebar.panellist'), 0);
    host.declare('sidebar.panellist');
    assert.equal(count('main'), 1, 'sidebar重声明必须恢复main面板');
    assert.equal(count('sidebar.panellist'), 1, 'sidebar重声明必须恢复导航入口');
    const main = [...host.active].find(record => record.spec.name === 'main');
    const sidebar = [...host.active].find(record => record.spec.name === 'sidebar.panellist');
    assert.equal(main.spec.key, 'zentao'); assert.equal(sidebar.spec.id, 'zentao');
    for (const name of ['plugins.tab', 'plugins.bundle.config']) {
      host.collapse(name); assert.equal(count(name), 0);
      host.declare(name); assert.equal(count(name), 1, `${name}重声明必须恢复入口`);
    }
    assert.equal(host.active.size, 4, '每代重建后仅保留4个有效注册');
  }
  host.dispose();
  assert.equal(host.active.size, 0); assert.equal(host.waits.size, 0); assert.equal(host.localeCleaned, 1);
  staleCallback(); assert.equal(host.active.size, 0, '插件卸载后迟到回调不能重新注册');
});

test('Client等待可用slot后配对注册，重复回调和apply不重复，卸载无残留', () => {
  const client = loadClient();
  assert.equal(client.name, 'zentao-ui');
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'layout']);
  const waits = new Map(), registrations = [], active = new Set(), effects = []; let localeCleaned = 0;
  const ctx = {
    effect(setup) { const off = setup(); if (typeof off === 'function') effects.push(off); },
    locale: { register(ns, dict) { assert.equal(ns, 'zentao'); assert.ok(dict.zh.nav && dict.en.nav); return () => { localeCleaned++; }; }, bind(ns) { assert.equal(ns, 'zentao'); return () => '禅道'; } },
    slots: { inject(name, callback) { waits.set(name, callback); return () => waits.delete(name); }, register(spec, render) { const record = { spec, render }; registrations.push(record); active.add(record); return () => active.delete(record); } },
  };
  client.apply(ctx); client.apply(ctx);
  assert.equal(registrations.length, 0);
  const lateSidebar = waits.get('sidebar.panellist');
  lateSidebar(); lateSidebar();
  waits.get('plugins.tab')(); waits.get('plugins.tab')();
  waits.get('plugins.bundle.config')();
  assert.equal(registrations.length, 4);
  assert.equal(registrations.find(x => x.spec.name === 'main').spec.key, 'zentao');
  assert.equal(registrations.find(x => x.spec.name === 'sidebar.panellist').spec.id, 'zentao');
  assert.equal(registrations.find(x => x.spec.name === 'plugins.tab').spec.id, 'zentao');
  const config = registrations.find(x => x.spec.name === 'plugins.bundle.config');
  assert.equal(config.spec.key, 'dsh-zentao');
  assert.equal(config.render({ view: 'summary' }), null);
  for (const effect of effects.reverse()) effect();
  assert.equal(active.size, 0); assert.equal(waits.size, 0); assert.equal(localeCleaned, 1);
  lateSidebar(); assert.equal(active.size, 0);
});
