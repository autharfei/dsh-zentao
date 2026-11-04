window.__ModuleLoader__.load({id:'dsh-zentao',factory:(require)=>{
const modelModule={exports:{}};
((module,exports)=>{
'use strict';

const STATUS_LABELS = {
  wait: '未开始', doing: '进行中', done: '已完成', pause: '已暂停', cancel: '已取消', closed: '已关闭',
  active: '激活', resolved: '已解决', postponed: '已延期',
};
const NOTICE_LABELS = { assigned: '新指派', created: '新建', reassigned: '重新指派' };
const TASK_STATUSES = ['wait', 'doing', 'done', 'pause', 'cancel', 'closed'];
const BUG_STATUSES = ['active', 'resolved', 'closed'];
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);

function filterItems(items, filters = {}, account = '') {
  const query = text(filters.query).trim().toLocaleLowerCase();
  return list(items).filter(item => {
    if (filters.scope === 'mine' && (!account || item.assignedTo?.account !== account)) return false;
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.priority && filters.priority !== 'all' && Number(item.pri) !== Number(filters.priority)) return false;
    if (!query) return true;
    if (/^#\d+$/.test(query)) return text(item.id) === query.slice(1);
    return [item.id, item.title, item.projectName, item.productName, item.executionName, item.execution, item.assignedTo?.account, item.assignedTo?.realname]
      .some(value => text(value).toLocaleLowerCase().includes(query));
  });
}

function paginateItems(items, requestedPage = 1, requestedSize = 20) {
  const source = list(items);
  const pageSize = Number.isInteger(Number(requestedSize)) && Number(requestedSize) > 0 ? Math.min(100, Number(requestedSize)) : 20;
  const pages = Math.max(1, Math.ceil(source.length / pageSize));
  const page = Math.max(1, Math.min(pages, Math.floor(Number(requestedPage)) || 1));
  const start = (page - 1) * pageSize;
  return { items: source.slice(start, start + pageSize), page, pageSize, total: source.length, pages, from: source.length ? start + 1 : 0, to: Math.min(start + pageSize, source.length) };
}

function summarize(data = {}) {
  const account = data.account;
  const tasks = list(data.tasks).filter(item => account && item.assignedTo?.account === account && !['done', 'cancel', 'closed'].includes(item.status));
  const bugs = list(data.bugs).filter(item => account && item.assignedTo?.account === account && item.status === 'active');
  return { tasks: tasks.length, bugs: bugs.length, urgent: [...tasks, ...bugs].filter(item => Number(item.pri) === 1).length, unread: list(data.notifications).filter(notice => !notice.read).length };
}

function petAlertsDraft(alerts = {}) {
  return Object.fromEntries(['task', 'bug'].map(kind => {
    const profile = alerts?.[kind] || {};
    return [kind, { animation: text(profile.animation), imageType: profile.imageType ?? 'none', image: text(profile.image) }];
  }));
}

function safePetImageUrl(candidate) {
  try {
    const url = new URL(text(candidate).trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash || url.href.includes('#')) return null;
    return url.href;
  } catch { return null; }
}

function settingsPatch(settings = {}) {
  const pollSeconds = Number(settings.pollSeconds);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 30 || pollSeconds > 60) throw new Error('轮询间隔须为 30～60 秒之间的整数');
  const petDurationSeconds = Number(settings.petDurationSeconds ?? 10);
  if (!Number.isInteger(petDurationSeconds) || petDurationSeconds < 5 || petDurationSeconds > 120) throw new Error('气泡显示时长须为 5～120 秒之间的整数');
  const petAlerts = petAlertsDraft(settings.petAlerts);
  for (const [kind, profile] of Object.entries(petAlerts)) {
    const title = kind === 'bug' ? 'Bug' : '任务';
    profile.animation = profile.animation.trim();
    profile.image = profile.image.trim();
    if (!['none', 'meme', 'upload', 'url'].includes(profile.imageType)) throw new Error(`${title}提醒的图片模式无效`);
    if (profile.imageType === 'none') profile.image = '';
    else if (!profile.image) throw new Error(`请为${title}提醒选择图片、上传图片或填写图片网址`);
    else if (profile.imageType === 'upload' && !/^[a-f\d]{64}$/i.test(profile.image)) throw new Error(`${title}提醒的上传图片无效，请重新上传`);
    else if (profile.imageType === 'url' && !safePetImageUrl(profile.image)) throw new Error(`${title}图片网址须为 HTTP 或 HTTPS，且不含用户名、密码或片段（#）`);
  }
  return { pollSeconds, notificationsEnabled: settings.notificationsEnabled !== false, petEnabled: settings.petEnabled !== false, petId: text(settings.petId).trim(), petDurationSeconds, petAlerts };
}

function connectionPatch(draft = {}, saved = {}) {
  let baseUrl;
  try {
    const url = new URL(text(draft.baseUrl).trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    baseUrl = url.href;
  } catch { throw new Error('请输入有效的 HTTP 或 HTTPS 禅道网址，不含账号、密码或查询参数'); }
  const account = text(draft.account).trim();
  if (!account) throw new Error('请输入禅道账号');
  const password = text(draft.password);
  const sameSite = baseUrl === text(saved.baseUrl).trim().replace(/\/*$/, '/');
  if (!password && (!sameSite || account !== saved.account || !saved.hasPassword)) throw new Error('首次连接或更换网址、账号时请输入密码');
  return { baseUrl, account, ...(password ? { password } : {}) };
}

function extractImageId(source) {
  try {
    const url = new URL(text(source), 'https://zentao.invalid');
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    let id;
    const match = url.pathname.match(/(?:^|\/)file-read-(\d+)(?:\.[a-z\d]+)?$/i);
    if (match) id = match[1];
    else if (url.pathname === '/api/zentao/image') id = url.searchParams.get('id');
    else {
      const params = {};
      for (const [key, value] of url.searchParams) params[key.toLowerCase()] = value;
      if (params.m === 'file' && params.f === 'read' && /(?:^|\/)index\.php$/i.test(url.pathname)) id = params.fileid;
    }
    return /^\d+$/.test(text(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
  } catch { return null; }
}

function safeSiteUrl(candidate, baseUrl) {
  if (!candidate || !baseUrl) return null;
  try {
    const base = new URL(baseUrl);
    const url = new URL(candidate, base);
    if (!/^https?:$/.test(base.protocol) || !/^https?:$/.test(url.protocol) || base.username || base.password || url.username || url.password || url.origin !== base.origin) return null;
    for (const key of url.searchParams.keys()) if (/^(?:token|password|passwd|authorization|access_token|session|sid|zentaosid)$/i.test(key)) return null;
    return url.href;
  } catch { return null; }
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const ALLOWED_TAGS = new Set('p br div span h1 h2 h3 h4 h5 h6 strong b em i u s del blockquote pre code ul ol li table thead tbody tfoot tr th td caption hr img sub sup dl dt dd figure figcaption section article'.split(' '));
const BLOCKED_TAGS = new Set('script style iframe frame frameset object embed applet svg math form input button textarea select option link meta base audio video source track canvas template noscript portal'.split(' '));
const SAFE_STYLE = new Set('color background-color font-size font-family font-style font-weight line-height text-align text-decoration white-space vertical-align border border-color border-style border-width border-collapse border-spacing border-radius padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left width height max-width min-width max-height'.split(' '));

function buildSafeDocument(html, options = {}) {
  const Parser = Object.prototype.hasOwnProperty.call(options, 'DOMParser') ? options.DOMParser : globalThis.DOMParser;
  let content = `<pre>${escapeHtml(html)}</pre>`;
  if (Parser) {
    try {
      // A template fragment is inert even while parsing: untrusted resource URLs never enter a live document.
      const doc = new Parser().parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html');
      const template = doc.createElement('template');
      template.innerHTML = text(html);
      const clean = root => {
        for (const node of Array.from(root.childNodes)) {
          if (node.nodeType === 8) { node.remove(); continue; }
          if (node.nodeType !== 1) continue;
          const tag = node.localName.toLowerCase();
          if (BLOCKED_TAGS.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') { node.remove(); continue; }
          clean(node);
          // Unwrap links only after cleaning their children, so linked screenshots survive.
          if (!ALLOWED_TAGS.has(tag)) { node.replaceWith(...Array.from(node.childNodes)); continue; }
          const style = [];
          for (let i = 0; i < node.style.length; i++) {
            const key = node.style.item(i);
            const value = node.style.getPropertyValue(key);
            if (SAFE_STYLE.has(key) && value.length < 200 && !/url\s*\(|expression\s*\(|image-set|var\s*\(|attr\s*\(|[\\@<>]/i.test(value)) style.push(`${key}:${value}`);
          }
          const attrs = {};
          if (tag === 'img') {
            const id = extractImageId(node.getAttribute('src'));
            if (!id) { node.remove(); continue; }
            attrs.src = `/api/zentao/image?id=${id}`;
            attrs.alt = text(node.getAttribute('alt')).slice(0, 300);
            attrs.loading = 'lazy';
            attrs.referrerpolicy = 'no-referrer';
          }
          if (tag === 'td' || tag === 'th') for (const name of ['colspan', 'rowspan']) {
            const value = Number(node.getAttribute(name));
            if (Number.isInteger(value) && value > 0 && value <= 100) attrs[name] = String(value);
          }
          for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
          for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
          if (style.length) node.setAttribute('style', style.join(';'));
        }
      };
      clean(template.content);
      content = template.innerHTML;
    } catch { /* Fail closed to escaped text if the browser cannot parse safely. */ }
  }
  const dark = options.dark === true;
  let imageOrigin = '';
  const currentOrigin = options.origin ?? globalThis.location?.origin;
  try {
    const origin = new URL(currentOrigin);
    if (/^https?:$/.test(origin.protocol) && origin.origin === currentOrigin) imageOrigin = ` ${origin.origin}`;
  } catch { /* Omit an untrusted or unavailable document origin. */ }
  const csp = `default-src 'none'; script-src 'none'; img-src 'self'${imageOrigin}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;padding:16px 18px;color:${dark ? '#dce3ee' : '#30394b'};background:${dark ? '#171c25' : '#fff'};font:14px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}body>:first-child{margin-top:0}body>:last-child{margin-bottom:0}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:${dark ? '#222b39' : '#f5f7fb'};padding:12px;border-radius:6px}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid ${dark ? '#364153' : '#dfe5ef'};padding:8px 10px}blockquote{margin-left:0;border-left:3px solid #8a94ff;padding-left:14px}h1,h2,h3,h4{line-height:1.4}hr{border:0;border-top:1px solid ${dark ? '#364153' : '#dfe5ef'}}</style></head><body>${content}</body></html>`;
}

function createApi({ fetchImpl = (...args) => fetch(...args), timeoutMs = 20000 } = {}) {
  async function request(path, { body, signal, requestTimeoutMs = timeoutMs } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    try {
      const response = await fetchImpl(`/api/zentao${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      let payload;
      try { payload = await response.json(); }
      catch { const error = new Error(`服务返回了无效响应（HTTP ${response.status}）`); error.code = 'invalid-response'; throw error; }
      if (!response.ok || payload?.ok !== true) {
        const error = new Error(typeof payload?.error === 'string' ? payload.error : `请求失败，服务响应异常（HTTP ${response.status}）`);
        if (payload?.code !== undefined) error.code = payload.code;
        error.status = response.status;
        throw error;
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'data')) { const error = new Error('服务响应缺少数据'); error.code = 'invalid-response'; throw error; }
      return payload.data;
    } catch (error) {
      if (timedOut) { const timeoutError = new Error('请求超时，请检查连接后重试'); timeoutError.code = 'request-timeout'; throw timeoutError; }
      if (signal?.aborted) { const aborted = new Error('请求已取消'); aborted.name = 'AbortError'; throw aborted; }
      if (error?.name === 'TypeError') { const networkError = new Error('无法连接插件服务，请检查网络后重试'); networkError.code = 'network-error'; throw networkError; }
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); }
  }
  return {
    overview: options => request('/overview', options),
    refresh: options => request('/refresh', { ...options, body: {} }),
    detail: async (kind, id, options) => {
      if (!['task', 'bug'].includes(kind)) throw new Error('仅支持任务和 Bug 详情');
      if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('详情编号无效');
      return request(`/detail?kind=${kind}&id=${Number(id)}`, options);
    },
    operationContext: async (kind, id, options = {}) => {
      if (!['task', 'bug'].includes(kind)) throw new Error('仅支持任务和 Bug 操作');
      if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('操作事项编号无效');
      if (typeof options.scopeKey !== 'string' || !/^[a-f\d]{64}$/i.test(options.scopeKey)) throw new Error('列表连接标识缺失或无效，请先同步后重新打开操作表单');
      return request(`/operation-context?kind=${kind}&id=${Number(id)}&scopeKey=${encodeURIComponent(options.scopeKey)}`, options);
    },
    operate: async (body, options = {}) => {
      try { return await request('/operation', { ...options, body, requestTimeoutMs: Math.max(60000, timeoutMs, Number(options.requestTimeoutMs) || 0) }); }
      catch (error) {
        if (['request-timeout', 'network-error', 'invalid-response'].includes(error?.code) || ['TypeError', 'AbortError'].includes(error?.name)) {
          const unknown = new Error('操作结果可能已生效。请先刷新事项或到禅道原站核对，勿重复提交；核对后重新加载表单。');
          unknown.code = 'result-unknown'; throw unknown;
        }
        throw error;
      }
    },
    read: (body, options) => request('/read', { ...options, body: body?.all ? { all: true } : { ids: list(body?.ids).filter(id => typeof id === 'string') } }),
    connection: options => request('/connection', options),
    saveConnection: async (body = {}, options) => {
      const patch = { baseUrl: text(body.baseUrl), account: text(body.account), ...(typeof body.password === 'string' && body.password ? { password: body.password } : {}) };
      try { return await request('/connection', { ...options, body: patch, requestTimeoutMs: Math.max(30000, timeoutMs) }); }
      catch (error) { if (error?.name === 'AbortError') throw error; throw new Error('连接失败，请检查网址、账号和密码后重试'); }
    },
    settings: options => request('/settings', options),
    saveSettings: (body, options) => request('/settings', { ...options, body: settingsPatch(body) }),
    pets: options => request('/pets', options),
    uploadPetImage: (body, options) => request('/pet-image', { ...options, body: { data: text(body?.data) } }),
    petTest: (options = {}) => request('/pet-test', { ...options, body: { kind: options.kind || 'task' } }),
  };
}

function createOverviewStore({ api = createApi(), setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, pollMs = 15000 } = {}) {
  let state = { data: null, loading: false, error: null, busy: null };
  let timer = null, active = null, revision = 0, disposed = false, operation = null;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const schedule = () => {
    clearTimer();
    if (listeners.size && !disposed) timer = later(() => { timer = null; run('overview'); }, pollMs);
  };
  async function run(method, body) {
    if (disposed || operation || state.busy) return null;
    clearTimer();
    const current = ++revision;
    active?.abort();
    const controller = new AbortController(); active = controller;
    publish({ loading: !state.data, error: null, busy: method === 'overview' ? null : method });
    try {
      const data = await (body === undefined ? api[method]({ signal: controller.signal }) : api[method](body, { signal: controller.signal }));
      if (current !== revision || disposed) return null;
      publish({ data, loading: false, error: null, busy: null });
      return data;
    } catch (error) {
      if (current !== revision || disposed) return null;
      publish({ loading: false, busy: null, ...(error.name === 'AbortError' ? {} : { error: error.message || '请求失败，请重试' }) });
      return null;
    } finally {
      if (current === revision && !disposed) { active = null; schedule(); }
    }
  }
  function stop() {
    ++revision; clearTimer(); active?.abort(); active = null;
    state = { ...state, loading: false, busy: operation ? 'operation' : null };
  }
  function acceptOverview(data) {
    if (disposed || !data || (state.busy && state.busy !== 'operation')) return false;
    // Only an overview GET can be superseded here; never abort another panel's write.
    ++revision; clearTimer(); active?.abort(); active = null;
    publish({ data, loading: false, error: null });
    if (!operation) schedule();
    return true;
  }
  function beginOperation() {
    if (disposed || operation || state.busy) return null;
    ++revision; clearTimer(); active?.abort(); active = null;
    operation = {};
    publish({ loading: false, error: null, busy: 'operation' });
    return operation;
  }
  function endOperation(token) {
    if (!token || token !== operation) return;
    operation = null;
    if (!disposed) { publish({ busy: null }); schedule(); }
  }
  return {
    getSnapshot: () => state,
    acceptOverview, beginOperation, endOperation,
    subscribe(listener) {
      if (disposed) return () => {};
      const first = !listeners.size; listeners.add(listener);
      if (first) run('overview');
      return () => { listeners.delete(listener); if (!listeners.size) stop(); };
    },
    reload: () => run('overview'), refresh: () => run('refresh'), markRead: body => run('read', body), saveSettings: body => run('saveSettings', body), saveConnection: body => run('saveConnection', body),
    dispose() { disposed = true; stop(); listeners.clear(); },
  };
}

module.exports = { STATUS_LABELS, NOTICE_LABELS, TASK_STATUSES, BUG_STATUSES, filterItems, paginateItems, summarize, petAlertsDraft, safePetImageUrl, settingsPatch, connectionPatch, extractImageId, safeSiteUrl, escapeHtml, buildSafeDocument, createApi, createOverviewStore };

})(modelModule,modelModule.exports);
const module={exports:{}};
const operationsModule={exports:{}};
const localRequire=(name)=>name==='./client-model.cjs'?modelModule.exports:name==='./client-operations.cjs'?operationsModule.exports:require(name);
((require,module,exports)=>{
'use strict';
const React = require('react');
const { safeSiteUrl, STATUS_LABELS } = require('./client-model.cjs');
const { createElement: h, useEffect, useRef, useState } = React;
const asList = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'datetime-local', 'select']);
const ACTIONS = {
  task: [
    { id: 'start', label: '开始', statuses: ['wait'] },
    { id: 'finish', label: '完成', statuses: ['wait', 'doing', 'pause'] },
    { id: 'edit', label: '编辑' },
    { id: 'assign', label: '指派', statuses: ['wait', 'doing', 'pause', 'done'] },
    { id: 'cancel', label: '取消', statuses: ['wait', 'doing', 'pause'] },
    { id: 'pause', label: '暂停', statuses: ['doing'], more: true },
    { id: 'restart', label: '继续', statuses: ['pause'], more: true },
    { id: 'activate', label: '激活', statuses: ['done', 'cancel', 'closed'], more: true },
    { id: 'close', label: '关闭', statuses: ['done', 'cancel'], more: true },
    { id: 'record', label: '记录工时', statuses: ['wait', 'doing', 'pause', 'done'], more: true },
  ],
  bug: [
    { id: 'confirm', label: '确认', statuses: ['active'] },
    { id: 'assign', label: '指派', statuses: ['active', 'resolved'] },
    { id: 'resolve', label: '解决', statuses: ['active'] },
    { id: 'toTask', label: '转任务', statuses: ['active', 'resolved'] },
    { id: 'edit', label: '编辑', more: true },
    { id: 'close', label: '关闭', statuses: ['resolved'], more: true },
    { id: 'activate', label: '激活', statuses: ['resolved', 'closed'], more: true },
  ],
};

function ItemActions({ kind, item, onOperate, disabled = false }) {
  const candidates = ACTIONS[kind] || [];
  const button = action => {
    const confirmed = action.id === 'confirm' && (item.confirmed === true || Number(item.confirmed) === 1);
    const eligible = (!item.status || !action.statuses || action.statuses.includes(item.status)) && !confirmed;
    const reason = confirmed ? '此 Bug 已确认' : !eligible ? `列表状态为“${STATUS_LABELS[item.status] || item.status}”，此入口暂不适用` : '打开表单核对最新状态、可用操作与权限';
    return h('button', { key: action.id, type: 'button', className: 'zt-text-button zt-item-action', 'data-action': action.id, disabled: disabled || !eligible, title: disabled ? '请等待当前操作完成' : reason, 'aria-label': `${action.label}${kind === 'bug' ? ' Bug' : '任务'} #${item.id}`, onClick: event => {
      event.stopPropagation();
      const more = event.currentTarget.closest('details');
      const trigger = more?.querySelector('summary') || event.currentTarget;
      more?.removeAttribute('open');
      if (!disabled && eligible) onOperate({ kind, id: item.id, action: action.id, item, trigger });
    } }, action.label);
  };
  return h('div', { className: 'zt-item-actions', role: 'group', 'aria-label': `${kind === 'bug' ? 'Bug' : '任务'} #${item.id} 操作入口`, title: '入口按列表状态提示，可用操作与权限以最新表单为准', onClick: event => event.stopPropagation(), onKeyDown: event => {
    event.stopPropagation();
    if (event.key === 'Escape') { const more = event.currentTarget.querySelector('details[open]'); if (more) { more.removeAttribute('open'); more.querySelector('summary')?.focus(); } }
  } }, ...candidates.filter(action => !action.more).map(button),
  h('details', { className: 'zt-item-more' }, h('summary', { 'aria-label': '更多操作', 'aria-disabled': disabled, tabIndex: disabled ? -1 : undefined, onClick: event => { event.stopPropagation(); if (disabled) event.preventDefault(); } }, '更多'), h('div', { className: 'zt-item-more-actions' }, ...candidates.filter(action => action.more).map(button))));
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `zt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function fieldsFor(action) { return asList(action?.fields); }
function visibleFields(action, values) {
  return fieldsFor(action).filter(field => !field.visibleWhen || asList(field.visibleWhen.values).some(value => text(value) === text(values[field.visibleWhen.key])));
}
function draftFor(action, previous = {}) {
  return Object.fromEntries(fieldsFor(action).map(field => [field.key, text(Object.prototype.hasOwnProperty.call(previous, field.key) ? previous[field.key] : action.defaults?.[field.key])]));
}
function validFields(action) {
  const fields = fieldsFor(action);
  return fields.every(field => field && typeof field.key === 'string' && field.key && FIELD_TYPES.has(field.type)) && new Set(fields.map(field => field.key)).size === fields.length;
}
function validateOperationValues(action, draft) {
  const errors = {}, values = {};
  for (const field of visibleFields(action, draft)) {
    const raw = text(draft[field.key]);
    const empty = !raw.trim();
    if (field.required && empty) { errors[field.key] = `请填写${field.label || field.key}`; continue; }
    if (field.type === 'number' && !empty) {
      const value = Number(raw);
      const hasMin = field.min !== undefined && field.min !== null && Number.isFinite(Number(field.min));
      const hasMax = field.max !== undefined && field.max !== null && Number.isFinite(Number(field.max));
      const step = Number(field.step);
      if (!Number.isFinite(value)) errors[field.key] = '请输入有效数字';
      else if (hasMin && value < Number(field.min)) errors[field.key] = `不得小于 ${field.min}`;
      else if (hasMax && value > Number(field.max)) errors[field.key] = `不得大于 ${field.max}`;
      else if (Number.isFinite(step) && step > 0 && Math.abs((value - (hasMin ? Number(field.min) : 0)) / step - Math.round((value - (hasMin ? Number(field.min) : 0)) / step)) > 1e-7) errors[field.key] = `请按 ${field.step} 的步长填写`;
      values[field.key] = value;
    } else {
      if (field.type === 'select' && !empty && !asList(field.options).some(option => text(option.value) === raw)) errors[field.key] = '请重新选择可用选项';
      values[field.key] = raw;
    }
  }
  return { values, errors };
}

function OperationDialog({ selection, api, store, baseUrl, busy, onDismiss, onApplied, onFeedback }) {
  const { kind, id, hostScope } = selection;
  const [context, setContext] = useState({ loading: true, data: null, error: '' });
  const [reload, setReload] = useState(0);
  const [actionId, setActionId] = useState(selection.action);
  const [drafts, setDrafts] = useState({});
  const [requestId, setRequestId] = useState(createRequestId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [blocked, setBlocked] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const [dialogId] = useState(() => `zt-operation-${createRequestId()}`);
  const panel = useRef(null);
  const alive = useRef(true);
  const sending = useRef(false);
  const callbacks = useRef({ onDismiss, onApplied, onFeedback });
  callbacks.current = { onDismiss, onApplied, onFeedback };
  const actions = asList(context.data?.actions);
  const action = actions.find(candidate => candidate.id === actionId);
  const draft = action ? drafts[action.id] || draftFor(action) : {};
  const fields = action ? visibleFields(action, draft) : [];
  const schemaValid = !!action && validFields(action);
  const otherBusy = !!busy && !(busy === 'operation' && sending.current);
  const item = context.data?.item || selection.item || {};
  const siteUrl = safeSiteUrl(item.url, baseUrl);
  const externalUrl = action?.mode === 'external' ? safeSiteUrl(action.url, baseUrl) : null;
  const targetName = `${kind === 'bug' ? 'Bug' : '任务'} #${id}`;
  const dismiss = () => { if (!sending.current) callbacks.current.onDismiss(); };

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (typeof hostScope !== 'string' || !/^[a-f\d]{64}$/i.test(hostScope)) {
      setContext({ loading: false, data: null, error: '列表连接标识缺失或无效，请关闭表单，先同步后重新打开。' });
      return undefined;
    }
    const controller = new AbortController(); let current = true;
    setContext(previous => ({ ...previous, loading: true, error: '' }));
    // A context load or explicit action selection defines a new submission intent.
    const nextRequestId = createRequestId(); setFieldErrors({});
    api.operationContext(kind, id, { signal: controller.signal, scopeKey: hostScope }).then(data => {
      if (!current || !alive.current) return;
      if (!data || typeof data.scopeKey !== 'string' || !data.scopeKey || data.version === undefined || !Array.isArray(data.actions) || !data.item) throw new Error('操作表单响应不完整，请重新加载');
      if (data.scopeKey !== hostScope) throw new Error('禅道连接已变化，请关闭表单，先同步后重新打开。');
      const allowed = new Set((ACTIONS[kind] || []).map(candidate => candidate.id));
      const nextActions = data.actions.filter(candidate => candidate && allowed.has(candidate.id) && ['native', 'external'].includes(candidate.mode));
      if (nextActions.some(candidate => !validFields(candidate))) throw new Error('操作表单包含不支持的字段，请重新加载或在原站操作');
      setDrafts(previous => Object.fromEntries(nextActions.map(candidate => [candidate.id, draftFor(candidate, previous[candidate.id])])));
      setActionId(previous => nextActions.some(candidate => candidate.id === previous) ? previous : (nextActions.find(candidate => candidate.enabled)?.id || nextActions[0]?.id || ''));
      setContext({ loading: false, data: { ...data, actions: nextActions }, error: '' }); setRequestId(nextRequestId);
      setBlocked(null); setAcknowledged(false); setError(''); setReloaded(reload > 0);
    }).catch(failure => {
      if (current && alive.current && failure.name !== 'AbortError') setContext(previous => ({ ...previous, loading: false, error: failure.message || '无法读取操作表单' }));
    });
    // Only this read is cancelled. A submitted write survives re-renders and unmounts.
    return () => { current = false; controller.abort(); };
  }, [api, kind, id, hostScope, reload]);

  useEffect(() => {
    const doc = globalThis.document;
    if (!doc || !panel.current) return undefined;
    const previous = selection.trigger || doc.activeElement;
    const appRoot = panel.current.closest('.zt-app');
    const focusables = () => Array.from(panel.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length && !node.closest('[hidden], [inert]'));
    const focusInside = () => (focusables()[0] || panel.current)?.focus();
    panel.current.focus();
    const onKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!sending.current) callbacks.current.onDismiss();
      } else if (event.key === 'Tab') {
        const nodes = focusables();
        if (!nodes.length) { event.preventDefault(); panel.current?.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !nodes.includes(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !nodes.includes(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const onFocus = event => { if (panel.current && !panel.current.contains(event.target)) focusInside(); };
    doc.addEventListener('keydown', onKey, true); doc.addEventListener('focusin', onFocus, true);
    return () => {
      doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('focusin', onFocus, true);
      let restore = previous;
      if (!restore?.isConnected || restore.disabled || restore.getAttribute?.('aria-disabled') === 'true' || !restore.getClientRects?.().length) restore = previous?.closest?.('.zt-detail, tr')?.querySelector('.zt-detail-header button:not([disabled]), .zt-item-link');
      if (!restore?.isConnected && appRoot?.isConnected) restore = appRoot.querySelector('.zt-workspace button:not([disabled])');
      if (restore?.isConnected && !restore.closest?.('[inert]')) restore.focus?.();
    };
  }, []);
  useEffect(() => {
    const active = globalThis.document?.activeElement;
    if (panel.current && (!panel.current.contains(active) || active?.disabled)) panel.current.focus();
  }, [submitting, context.loading, actionId]);

  function choose(next) {
    if (sending.current || blocked || context.loading) return;
    setActionId(next); setRequestId(createRequestId()); setError(''); setFieldErrors({});
  }
  function update(field, value) {
    if (sending.current || blocked || !action) return;
    setDrafts(previous => ({ ...previous, [action.id]: { ...draft, [field.key]: value } }));
    setFieldErrors(previous => { const next = { ...previous }; delete next[field.key]; return next; }); setError('');
  }
  function reloadContext() {
    if (sending.current || otherBusy || (blocked?.type === 'result-unknown' && !acknowledged)) return;
    setReload(value => value + 1);
  }
  async function submit(event) {
    event.preventDefault();
    if (sending.current || blocked || context.loading || context.error || otherBusy || !action?.enabled || action.mode !== 'native' || !schemaValid) return;
    const checked = validateOperationValues(action, draft);
    setFieldErrors(checked.errors); setError('');
    if (Object.keys(checked.errors).length) {
      panel.current?.querySelector(`[data-field-index="${fields.findIndex(field => checked.errors[field.key])}"]`)?.focus(); return;
    }
    const token = store.beginOperation();
    if (!token) { setError('另一个窗口正在保存或同步，请等待完成后再提交。'); return; }
    sending.current = true; setSubmitting(true);
    try {
      const result = await api.operate({ kind, id: Number(id), action: action.id, values: checked.values, scopeKey: context.data.scopeKey, version: context.data.version, requestId });
      if (result?.applied !== true) { const failure = new Error('服务未能确认操作结果，请先刷新事项或到原站核对，勿重复提交。'); failure.code = 'result-unknown'; throw failure; }
      if (alive.current) callbacks.current.onApplied(result, { kind, id, action: action.id, label: action.label, scope: selection.scope });
    } catch (failure) {
      if (!alive.current) return;
      const code = text(failure.code).toLowerCase().replace(/_/g, '-');
      const unknown = code === 'result-unknown';
      const conflict = code === 'conflict' || (!code && failure.status === 409);
      const message = unknown ? `${failure.message || '无法确认操作结果。'}${/勿重复提交/.test(failure.message || '') ? '' : ' 请先刷新事项或到原站核对，勿重复提交；核对后重新加载表单。'}` : conflict ? `${failure.message || '事项状态或连接已变化'} 请重新加载表单，核对后再提交。` : failure.message || '操作失败，填写内容已保留，请检查后重试。';
      setError(message);
      if (unknown || conflict) { setBlocked({ type: unknown ? 'result-unknown' : 'conflict' }); setAcknowledged(false); }
      callbacks.current.onFeedback?.({ error: true, warning: unknown, text: `${targetName}：${message}`, scope: selection.scope });
    } finally {
      sending.current = false; store.endOperation(token);
      if (alive.current) setSubmitting(false);
    }
  }

  function renderField(field, index) {
    const fieldId = `${dialogId}-field-${index}`;
    const helpId = `${fieldId}-help`, errorId = `${fieldId}-error`;
    const failure = fieldErrors[field.key];
    const props = { id: fieldId, name: field.key, value: text(draft[field.key]), required: !!field.required, disabled: submitting || !!blocked || otherBusy, 'data-field-index': index, 'aria-invalid': !!failure, 'aria-describedby': [field.help ? helpId : '', failure ? errorId : ''].filter(Boolean).join(' ') || undefined, onChange: event => update(field, event.target.value) };
    let control;
    if (field.type === 'textarea') control = h('textarea', { ...props, rows: 4 });
    else if (field.type === 'select') control = h('select', props, h('option', { value: '' }, field.required ? '请选择' : '未选择'), ...asList(field.options).map((option, optionIndex) => h('option', { key: `${text(option.value)}:${optionIndex}`, value: text(option.value) }, option.label || text(option.value))));
    else control = h('input', { ...props, type: field.type, min: field.min, max: field.max, step: field.step ?? (field.type === 'number' ? 'any' : undefined), autoComplete: 'off' });
    return h('div', { className: `zt-operation-field ${field.type === 'textarea' ? 'zt-operation-field-wide' : ''}`, key: field.key }, h('label', { htmlFor: fieldId }, field.label || field.key, field.required ? h('span', { className: 'zt-operation-required', 'aria-hidden': true }, ' *') : null, field.required ? h('span', { className: 'zt-sr-only' }, '（必填）') : null), control,
      field.help ? h('p', { id: helpId, className: 'zt-operation-help' }, field.help) : null,
      failure ? h('p', { id: errorId, className: 'zt-operation-field-error' }, failure) : null);
  }

  return h('div', { className: 'zt-operation-overlay', onMouseDown: event => { if (event.target === event.currentTarget) dismiss(); } },
    h('section', { className: 'zt-operation-dialog', ref: panel, role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${dialogId}-title`, 'aria-describedby': `${dialogId}-target`, 'aria-busy': context.loading || submitting, tabIndex: -1 },
      h('header', { className: 'zt-operation-header' }, h('div', null, h('p', { className: 'zt-operation-kicker' }, targetName), h('h2', { id: `${dialogId}-title` }, '事项操作')), h('button', { type: 'button', className: 'zt-icon-button', onClick: dismiss, disabled: submitting, 'aria-label': '关闭操作表单，不提交' }, '×')),
      h('form', { onSubmit: submit, noValidate: true, className: 'zt-operation-form' },
        h('div', { className: 'zt-operation-scroll' },
          h('p', { id: `${dialogId}-target`, className: 'zt-operation-target' }, item.title || selection.item?.title || targetName),
          h('p', { className: 'zt-operation-help' }, '入口按列表状态提示，最新可用操作与权限在加载后核对。'),
          context.loading ? h('p', { className: 'zt-operation-loading', role: 'status' }, '正在读取最新事项与操作表单…') : null,
          context.error ? h('div', { className: 'zt-operation-message is-error', role: 'alert' }, h('p', null, context.error), h('button', { type: 'button', className: 'zt-text-button', onClick: reloadContext, disabled: submitting || otherBusy || (blocked?.type === 'result-unknown' && !acknowledged) }, '重新加载表单')) : null,
          !context.loading && !context.error ? h(React.Fragment, null,
            ...asList(context.data?.warnings).map((warning, index) => h('p', { key: index, className: 'zt-operation-message is-warning', role: 'status' }, text(warning))),
            reloaded ? h('p', { className: 'zt-operation-help', role: 'status' }, '已重新加载最新表单并保留填写内容，请核对后再提交。') : null,
            !actions.length ? h('p', { className: 'zt-operation-message', role: 'status' }, '当前事项没有可用操作，请在禅道原站查看。') : h('div', { className: 'zt-operation-field zt-operation-choice' }, h('label', { htmlFor: `${dialogId}-action` }, '本次操作'), h('select', { id: `${dialogId}-action`, value: actionId, disabled: submitting || !!blocked || otherBusy, onChange: event => choose(event.target.value) }, ...actions.map(candidate => h('option', { key: candidate.id, value: candidate.id }, `${candidate.label}${candidate.enabled ? '' : '（暂不可用）'}${candidate.mode === 'external' ? ' · 原站' : ''}`)))),
            action ? h(React.Fragment, null,
              !action.enabled ? h('p', { className: 'zt-operation-message is-warning', role: 'status' }, action.reason || '当前状态或权限不支持此操作，请选择其他操作。') : null,
              action.description ? h('p', { className: 'zt-operation-description' }, action.description) : null,
              ['cancel', 'close'].includes(action.id) ? h('p', { className: 'zt-operation-message is-warning' }, `本次将对${targetName}执行“${action.label}”。关闭此表单不会提交；${action.mode === 'external' ? '请在原站表单中确认该行为。' : `点击“确认${action.label}”才会提交。`}`) : null,
              action.mode === 'external' ? h('div', { className: 'zt-operation-external' }, h('p', null, '此操作在禅道原站表单中完成。打开后请核对事项与填写内容，再在原站确认提交。'), externalUrl ? h('a', { className: 'zt-button zt-button-primary', href: action.enabled && !otherBusy ? externalUrl : undefined, 'aria-disabled': !action.enabled || otherBusy, tabIndex: !action.enabled || otherBusy ? -1 : undefined, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, `前往禅道${action.label} ↗`) : h('p', { className: 'zt-operation-field-error', role: 'status' }, '未获得安全的同站操作链接，请重新加载或从禅道详情进入。')) : h(React.Fragment, null,
                kind === 'task' && ['start', 'finish', 'record', 'edit'].includes(action.id) ? h('p', { className: 'zt-operation-help zt-operation-hours' }, '工时单位为小时。“本次”表示本次新增工时，“累计”表示任务总量；请按各字段标签与说明填写。') : null,
                h('div', { className: 'zt-operation-fields' }, ...fields.map(renderField)),
                !fields.length ? h('p', { className: 'zt-operation-help' }, '此操作无需填写额外字段，请核对事项后确认提交。') : null)) : null) : null,
          error ? h('p', { className: `zt-operation-message ${blocked?.type === 'result-unknown' ? 'is-warning' : 'is-error'}`, role: 'alert' }, error) : null,
          blocked ? h('div', { className: 'zt-operation-recovery' },
            blocked.type === 'result-unknown' ? h('label', { className: 'zt-operation-ack' }, h('input', { type: 'checkbox', checked: acknowledged, disabled: submitting || context.loading, onChange: event => setAcknowledged(event.target.checked) }), h('span', null, '我已刷新事项或在原站核对结果，确认仍需操作')) : null,
            h('button', { type: 'button', className: 'zt-button', disabled: submitting || context.loading || otherBusy || (blocked.type === 'result-unknown' && !acknowledged), onClick: reloadContext }, blocked.type === 'result-unknown' ? '核对后重新加载表单' : '重新加载最新表单')) : null,
          siteUrl ? h('a', { href: submitting ? undefined : siteUrl, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer', className: 'zt-operation-site-link', tabIndex: submitting ? -1 : undefined, onClick: event => { if (sending.current) event.preventDefault(); }, onAuxClick: event => { if (sending.current) event.preventDefault(); }, 'aria-disabled': submitting }, '在禅道原站核对此事项 ↗') : null,
          otherBusy ? h('p', { className: 'zt-operation-help', role: 'status' }, '另一窗口正在保存或同步，请等待完成。') : null),
        h('footer', { className: 'zt-operation-footer' }, h('span', { className: 'zt-operation-help', role: 'status' }, submitting ? '正在提交，请等待结果，勿重复操作。' : '提交按钮是本次操作的最后确认。'), h('div', { className: 'zt-operation-footer-actions' },
          h('button', { type: 'button', className: 'zt-button', onClick: dismiss, disabled: submitting }, '关闭表单（不提交）'),
          action?.mode === 'native' ? h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: submitting || context.loading || !!context.error || !!blocked || otherBusy || !action.enabled || !schemaValid }, submitting ? '正在提交…' : `确认${action.label}`) : null)))));
}

module.exports = { ItemActions, OperationDialog, visibleFields, validateOperationValues };

})(localRequire,operationsModule,operationsModule.exports);
((require,module,exports)=>{
const STYLES=".zt-app {\n  /* Readable typography shared by the workbench, settings and action forms. */\n  --zt-font-xs: 12px;\n  --zt-font-sm: 13px;\n  --zt-font-md: 14px;\n  --zt-font-lg: 16px;\n  --zt-font-section: 20px;\n  --zt-font-title: 26px;\n  --zt-font-metric: 30px;\n  --zt-weight-normal: 400;\n  --zt-weight-medium: 600;\n  --zt-weight-bold: 700;\n  --zt-control-height: 38px;\n  --zt-accent: #5753ce;\n  --zt-accent-soft: color-mix(in srgb, var(--zt-accent) 9%, transparent);\n  --zt-canvas: #f7f8fc;\n  --zt-surface: #fff;\n  --zt-raised: #f9fafd;\n  --zt-ink: #263044;\n  --zt-secondary: #4e5d73;\n  --zt-muted: #5e6b80;\n  --zt-border: #dfe5ef;\n  --zt-hover: #f4f6fb;\n  --zt-green: #146c4e;\n  --zt-green-soft: #eaf7f0;\n  --zt-red: #a73b49;\n  --zt-red-soft: #fff0f1;\n  --zt-amber: #85570e;\n  --zt-amber-soft: #fff7e6;\n  --zt-shadow: 0 6px 24px #18264d08;\n  box-sizing: border-box;\n  container-name: zentao;\n  container-type: inline-size;\n  display: flex;\n  position: relative;\n  flex-direction: column;\n  gap: 20px;\n  width: 100%;\n  flex: 1 1 0;\n  height: 100%;\n  min-height: 0;\n  min-width: 0;\n  overflow: auto;\n  padding: 25px 28px 14px;\n  background: var(--zt-canvas);\n  color: var(--zt-ink);\n  font: var(--zt-font-md)/1.6 -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Microsoft YaHei UI\", \"Microsoft YaHei\", sans-serif;\n  -webkit-font-smoothing: antialiased;\n}\n.zt-app[data-theme=\"dark\"] {\n  --zt-on-accent: #202238;\n  --zt-canvas: #131821;\n  --zt-surface: #1b2230;\n  --zt-raised: #1f2736;\n  --zt-accent: #b0acff;\n  --zt-ink: #e0e6f0;\n  --zt-secondary: #b7c1d2;\n  --zt-muted: #a2aec2;\n  --zt-border: #2b3547;\n  --zt-hover: #232d3f;\n  --zt-green: #6dcaa6;\n  --zt-green-soft: #193b32;\n  --zt-red: #ef939e;\n  --zt-red-soft: #3e2833;\n  --zt-amber: #e7bd76;\n  --zt-amber-soft: #3c3426;\n  --zt-shadow: 0 8px 26px #0002;\n  color-scheme: dark;\n}\n.zt-app *, .zt-app *::before, .zt-app *::after { box-sizing: border-box; }\n.zt-app button, .zt-app input, .zt-app select, .zt-app textarea { font: inherit; }\n.zt-app button { cursor: pointer; font-weight: var(--zt-weight-bold); }\n.zt-app button:disabled { opacity: .48; cursor: not-allowed; }\n.zt-app button, .zt-app a, .zt-app input, .zt-app select { -webkit-tap-highlight-color: transparent; }\n.zt-app :is(button, a, input, select, textarea, summary):focus-visible { outline: 2px solid var(--zt-accent); outline-offset: 3px; }\n.zt-app svg { display: inline-block; flex-shrink: 0; vertical-align: middle; }\n.zt-app a { color: var(--zt-accent); text-decoration: none; }\n.zt-app a:hover { text-decoration: underline; }\n.zt-app button { color: inherit; }\n.zt-app h1, .zt-app h2, .zt-app h3, .zt-app p { margin: 0; }\n.zt-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }\n.zt-muted { color: var(--zt-muted); }\n.zt-header { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-shrink: 0; }\n.zt-title-group, .zt-title-line, .zt-header-actions { display: flex; align-items: center; }\n.zt-title-group { min-width: 0; gap: 14px; }\n.zt-brand { display: grid; place-items: center; width: 48px; height: 48px; flex-shrink: 0; color: #fff; background: linear-gradient(145deg, #8580f6, #5e59d5); border: 1px solid #ffffff25; border-radius: 14px; box-shadow: 0 4px 12px #6560ed24; }\n.zt-title-line { gap: 10px; margin-bottom: 3px; }\n.zt-title-line h1 { font-size: var(--zt-font-title); line-height: 1.25; font-weight: var(--zt-weight-bold); letter-spacing: -.5px; }\n.zt-title-group p { color: var(--zt-muted); font-size: var(--zt-font-sm); line-height: 1.7; }\n.zt-header-actions { gap: 9px; flex-shrink: 0; }\n.zt-account { display: inline-flex; align-items: center; gap: 7px; max-width: 190px; padding: 0 7px; color: var(--zt-secondary); font-size: var(--zt-font-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--zt-weight-medium); }\n.zt-connection-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 6px; background: var(--zt-hover); color: var(--zt-muted); font-size: var(--zt-font-xs); font-weight: var(--zt-weight-medium); white-space: nowrap; }\n.zt-connection-pill i, .zt-credential-status i { width: 5px; height: 5px; flex-shrink: 0; background: currentColor; border-radius: 50%; }\n.zt-connection-pill.is-online { background: var(--zt-green-soft); color: var(--zt-green); }\n.zt-connection-pill.is-offline { background: var(--zt-amber-soft); color: var(--zt-amber); }\n.zt-connection-pill.is-syncing { color: var(--zt-accent); background: var(--zt-accent-soft); }\n.zt-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: var(--zt-control-height); padding: 0 14px; background: var(--zt-surface); border: 1px solid var(--zt-border); border-radius: 8px; color: var(--zt-secondary); font-size: var(--zt-font-sm); font-weight: var(--zt-weight-bold); white-space: nowrap; transition: background .15s, border-color .15s; }\n.zt-button:hover:not(:disabled) { background: var(--zt-hover); border-color: color-mix(in srgb, var(--zt-accent) 35%, var(--zt-border)); color: var(--zt-ink); }\n.zt-button.zt-button-primary { background: var(--zt-accent); border-color: var(--zt-accent); color: var(--zt-on-accent, #fff); box-shadow: 0 2px 5px #5f60df20; padding-inline: 17px; }\n.zt-button.zt-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--zt-accent) 90%, #000); color: var(--zt-on-accent, #fff); }\n.zt-button-small { height: 32px; padding-inline: 11px; }\n.zt-icon-button { display: inline-grid; place-items: center; width: var(--zt-control-height); height: var(--zt-control-height); padding: 0; flex-shrink: 0; background: var(--zt-surface); border: 1px solid var(--zt-border); color: var(--zt-secondary); border-radius: 8px; transition: background .15s; }\n.zt-icon-button:hover:not(:disabled), .zt-icon-button.is-active { color: var(--zt-accent); background: var(--zt-accent-soft); }\n.zt-text-button { padding: 6px 4px; border: 0; background: transparent; color: var(--zt-accent) !important; font-size: var(--zt-font-sm) !important; white-space: nowrap; font-weight: var(--zt-weight-bold); }\n.zt-text-button:hover:not(:disabled) { text-decoration: underline; }\n.zt-is-syncing > svg { animation: zt-spin 1.8s linear infinite; }\n.zt-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; flex-shrink: 0; }\n.zt-stat { display: flex; align-items: center; gap: 14px; padding: 18px 20px; background: var(--zt-surface); border: 1px solid var(--zt-border); border-radius: 12px; box-shadow: 0 2px 4px #18264d02; min-width: 0; }\n.zt-stat-icon { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px; background: var(--zt-accent-soft); color: var(--zt-accent); }\n.zt-stat-bug .zt-stat-icon { background: var(--zt-red-soft); color: var(--zt-red); }\n.zt-stat-urgent .zt-stat-icon { background: var(--zt-amber-soft); color: var(--zt-amber); }\n.zt-stat-notice .zt-stat-icon { background: var(--zt-green-soft); color: var(--zt-green); }\n.zt-stat-label { display: block; color: var(--zt-secondary); font-size: var(--zt-font-sm); white-space: nowrap; font-weight: var(--zt-weight-bold); }\n.zt-stat strong { display: block; margin-top: 3px; color: var(--zt-ink); font-size: var(--zt-font-metric); line-height: 1.25; font-weight: var(--zt-weight-bold); font-variant-numeric: tabular-nums; letter-spacing: -.7px; }\n.zt-error-banner { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--zt-amber) 23%, transparent); background: var(--zt-amber-soft); color: var(--zt-amber); border-radius: 8px; flex-shrink: 0; }\n.zt-error-banner > div { flex: 1; min-width: 0; }\n.zt-error-banner strong { display: block; font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-error-banner span { display: block; margin-top: 2px; font-size: var(--zt-font-sm); overflow-wrap: anywhere; line-height: 1.65; }\n.zt-error-banner .zt-button { background: transparent; border-color: color-mix(in srgb, var(--zt-amber) 28%, transparent); color: var(--zt-amber); }\n.zt-pet-warning { display: flex; align-items: center; gap: 7px; margin-top: -9px; padding: 0 3px; color: var(--zt-amber); font-size: var(--zt-font-sm); overflow-wrap: anywhere; }\n.zt-workspace { display: grid; grid-template-columns: minmax(0, 1fr); position: relative; flex: 1; min-height: 310px; min-width: 0; overflow: hidden; background: var(--zt-surface); border: 1px solid var(--zt-border); border-radius: 14px; box-shadow: var(--zt-shadow); }\n.zt-workspace.has-detail { grid-template-columns: minmax(420px, 1fr) minmax(400px, 460px); }\n.zt-workspace-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; }\n.zt-workspace-nav { display: flex; justify-content: space-between; align-items: center; min-height: 62px; flex-shrink: 0; padding: 0 22px; border-bottom: 1px solid var(--zt-border); gap: 16px; }\n.zt-tabs { display: flex; align-items: stretch; gap: 26px; align-self: stretch; }\n.zt-tabs > button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; position: relative; padding: 0 2px; border: 0; background: transparent; color: var(--zt-secondary); font-size: var(--zt-font-md); white-space: nowrap; font-weight: var(--zt-weight-bold); }\n.zt-tabs > button:hover { color: var(--zt-accent); }\n.zt-tabs > button[aria-current=\"page\"] { color: var(--zt-accent); font-weight: var(--zt-weight-bold); }\n.zt-tabs > button[aria-current=\"page\"]::after { content: \"\"; position: absolute; height: 3px; left: 0; right: 0; bottom: 0; border-radius: 2px; background: var(--zt-accent); }\n.zt-tab-count { min-width: 23px; padding: 2px 6px; border-radius: 6px; color: var(--zt-muted); background: var(--zt-hover); font-size: var(--zt-font-xs); line-height: 18px; text-align: center; font-weight: var(--zt-weight-bold); }\n.zt-tabs [aria-current=\"page\"] .zt-tab-count { color: var(--zt-accent); background: var(--zt-accent-soft); }\n.zt-tab-count.is-unread { color: var(--zt-accent); background: var(--zt-accent-soft); }\n.zt-readonly-hint { color: var(--zt-muted); font-size: var(--zt-font-xs); white-space: nowrap; }\n.zt-list-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }\n.zt-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 18px 22px; flex-shrink: 0; }\n.zt-scope { display: inline-flex; align-items: center; gap: 2px; padding: 3px; background: var(--zt-hover); border: 1px solid var(--zt-border); border-radius: 9px; }\n.zt-scope button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 58px; height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--zt-secondary); font-size: var(--zt-font-sm); white-space: nowrap; font-weight: var(--zt-weight-bold); }\n.zt-scope button[aria-pressed=\"true\"] { background: var(--zt-surface); color: var(--zt-ink); font-weight: var(--zt-weight-bold); box-shadow: 0 1px 3px #18264d12; }\n.zt-search { display: inline-flex; align-items: center; gap: 9px; flex: 1; min-width: 190px; max-width: 360px; height: var(--zt-control-height); padding: 0 12px; background: var(--zt-surface); border: 1px solid var(--zt-border); border-radius: 8px; color: var(--zt-muted); }\n.zt-search:focus-within { outline: 2px solid color-mix(in srgb, var(--zt-accent) 25%, transparent); border-color: var(--zt-accent); }\n.zt-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0 !important; background: transparent; color: var(--zt-ink); font-size: var(--zt-font-sm); }\n.zt-search input::placeholder { color: var(--zt-muted); }\n.zt-app select { height: var(--zt-control-height); max-width: 100%; padding: 0 30px 0 12px; border: 1px solid var(--zt-border); border-radius: 8px; background-color: var(--zt-surface); color: var(--zt-secondary); font-size: var(--zt-font-sm); cursor: pointer; }\n.zt-result-count { margin-left: auto; color: var(--zt-muted); font-size: var(--zt-font-sm); white-space: nowrap; font-weight: var(--zt-weight-medium); }\n.zt-table-scroll { flex: 1; min-height: 80px; width: 100%; overflow: auto; }\n.zt-table { width: 100%; border-collapse: collapse; text-align: left; table-layout: auto; }\n.zt-table th { height: 44px; position: sticky; top: 0; z-index: 1; padding: 10px 14px; background: var(--zt-raised); border-top: 1px solid var(--zt-border); border-bottom: 1px solid var(--zt-border); color: var(--zt-secondary); font-weight: var(--zt-weight-bold); font-size: var(--zt-font-sm); white-space: nowrap; line-height: 1.5; box-shadow: inset 0 -1px var(--zt-border); }\n.zt-table th:first-child { padding-left: 22px; min-width: 230px; width: 40%; }\n.zt-table th:last-child { padding-right: 22px; }\n.zt-table td { height: 78px; padding: 14px; border-bottom: 1px solid var(--zt-border); vertical-align: middle; font-size: var(--zt-font-sm); line-height: 1.65; }\n.zt-table tr:last-child td { border-bottom-color: transparent; }\n.zt-table td:first-child { padding-left: 22px; }\n.zt-table td:last-child { padding-right: 22px; }\n.zt-table tbody tr { cursor: pointer; transition: background .1s; }\n.zt-table tbody tr:hover { background: var(--zt-hover); }\n.zt-table tbody tr.zt-row-selected { background: var(--zt-accent-soft); }\n.zt-table tbody tr.zt-row-selected td:first-child { box-shadow: inset 3px 0 var(--zt-accent); }\n.zt-item-id { display: inline-block; min-width: 46px; margin-right: 8px; color: var(--zt-muted); font-size: var(--zt-font-xs); font-variant-numeric: tabular-nums; font-weight: var(--zt-weight-medium); }\n.zt-item-link { display: inline; padding: 0; border: 0; background: transparent; color: var(--zt-ink); font-size: var(--zt-font-md) !important; line-height: 1.7; text-align: left; font-weight: var(--zt-weight-bold); overflow-wrap: anywhere; }\n.zt-item-link:hover { color: var(--zt-accent); }\n.zt-item-sub { display: block; padding-left: 54px; margin-top: 5px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-status { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 4px 9px; border-radius: 7px; background: var(--zt-hover); color: var(--zt-secondary); font-size: var(--zt-font-xs); line-height: 18px; white-space: nowrap; font-weight: var(--zt-weight-medium); }\n.zt-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }\n.zt-status-doing, .zt-status-active { color: var(--zt-accent); background: var(--zt-accent-soft); }\n.zt-status-done, .zt-status-resolved { color: var(--zt-green); background: var(--zt-green-soft); }\n.zt-status-pause { color: var(--zt-amber); background: var(--zt-amber-soft); }\n.zt-priority { display: inline-flex; align-items: center; gap: 5px; font-size: var(--zt-font-xs); color: var(--zt-muted); white-space: nowrap; font-weight: var(--zt-weight-medium); }\n.zt-priority i { display: inline-block; width: 8px; height: 10px; background: currentColor; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%); opacity: .8; }\n.zt-priority-1 { color: var(--zt-red); font-weight: var(--zt-weight-bold); }\n.zt-priority-2 { color: var(--zt-amber); }\n.zt-priority-3 { color: var(--zt-accent); }\n.zt-assignee { display: inline-flex; align-items: center; gap: 8px; color: var(--zt-secondary); white-space: nowrap; font-weight: var(--zt-weight-medium); }\n.zt-avatar { display: inline-grid; place-items: center; width: 28px; height: 28px; background: var(--zt-hover); border: 1px solid var(--zt-border); border-radius: 50%; color: var(--zt-secondary); font-size: var(--zt-font-xs); }\n.zt-context-col { max-width: 185px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.zt-date-col { white-space: nowrap; font-variant-numeric: tabular-nums; font-size: var(--zt-font-xs) !important; }\n.has-detail .zt-context-col, .has-detail .zt-date-col { display: none; }\n.zt-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 12px 22px; flex-shrink: 0; border-top: 1px solid var(--zt-border); color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-pagination-actions { display: flex; align-items: center; gap: 7px; }\n.zt-pagination select { height: 32px; font-size: var(--zt-font-xs); }\n.zt-pagination .zt-icon-button { width: 32px; height: 32px; border-radius: 7px; }\n.zt-prev svg { transform: rotate(180deg); }\n.zt-page-number { min-width: 46px; color: var(--zt-secondary); text-align: center; font-variant-numeric: tabular-nums; font-weight: var(--zt-weight-bold); }\n.zt-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; flex: 1; min-height: 230px; padding: 34px 24px; text-align: center; }\n.zt-empty-icon { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 5px; color: var(--zt-muted); background: var(--zt-hover); border: 1px solid var(--zt-border); border-radius: 19px; }\n.zt-empty strong { color: var(--zt-secondary); font-size: var(--zt-font-lg); font-weight: var(--zt-weight-bold); }\n.zt-empty p { color: var(--zt-muted); font-size: var(--zt-font-sm); max-width: 360px; overflow-wrap: anywhere; line-height: 1.75; }\n.zt-empty .zt-button { margin-top: 5px; }\n.zt-loading { display: flex; flex-direction: column; gap: 0; flex: 1; min-height: 220px; padding: 0 20px; overflow: hidden; }\n.zt-skeleton { display: flex; align-items: center; gap: 22px; height: 78px; flex-shrink: 0; border-bottom: 1px solid var(--zt-border); }\n.zt-skeleton span { height: 10px; width: 58%; border-radius: 4px; background: linear-gradient(90deg, var(--zt-hover) 25%, var(--zt-border) 45%, var(--zt-hover) 70%); background-size: 240% 100%; animation: zt-shimmer 1.8s ease-in-out infinite; }\n.zt-skeleton span:nth-child(2) { width: 13%; }\n.zt-skeleton span:nth-child(3) { width: 18%; }\n.zt-loading-detail { padding-top: 12px; }\n.zt-loading-detail .zt-skeleton { height: 78px; }\n.zt-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid var(--zt-border); background: var(--zt-surface); z-index: 3; }\n.zt-detail-header { display: flex; align-items: center; justify-content: space-between; min-height: 62px; padding: 12px 20px; flex-shrink: 0; border-bottom: 1px solid var(--zt-border); }\n.zt-detail-kicker { display: flex; align-items: center; gap: 7px; color: var(--zt-secondary); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-detail-kicker > svg { color: var(--zt-accent); }\n.zt-detail-kicker > span { color: var(--zt-muted); font-size: var(--zt-font-xs); font-weight: 400; }\n.zt-detail-header .zt-icon-button { width: 32px; height: 32px; border: 0; background: transparent; }\n.zt-detail-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }\n.zt-detail-heading { padding: 23px 24px 20px; }\n.zt-detail-heading h2 { font-size: var(--zt-font-section); line-height: 1.6; font-weight: var(--zt-weight-bold); letter-spacing: -.2px; overflow-wrap: anywhere; }\n.zt-detail-badges { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }\n.zt-severity { color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-external-link { display: inline-flex; align-items: center; gap: 5px; margin-top: 14px; font-size: var(--zt-font-sm); font-weight: var(--zt-weight-medium); }\n.zt-detail-fields { display: grid; grid-template-columns: minmax(84px, 30%) minmax(0, 1fr); gap: 12px 16px; margin: 0 24px 22px; padding: 18px; background: var(--zt-raised); border: 1px solid var(--zt-border); border-radius: 10px; font-size: var(--zt-font-sm); }\n.zt-detail-fields dt { color: var(--zt-muted); font-weight: var(--zt-weight-medium); }\n.zt-detail-fields dd { margin: 0; color: var(--zt-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }\n.zt-detail-tabs { display: flex; align-items: center; gap: 22px; position: sticky; top: 0; z-index: 2; padding: 0 24px; background: var(--zt-surface); border-top: 1px solid var(--zt-border); border-bottom: 1px solid var(--zt-border); }\n.zt-detail-tabs button { position: relative; height: 48px; padding: 0 1px; background: transparent; border: 0; color: var(--zt-secondary); font-size: var(--zt-font-sm); white-space: nowrap; font-weight: var(--zt-weight-bold); }\n.zt-detail-tabs button[aria-current=\"page\"] { color: var(--zt-accent); font-weight: var(--zt-weight-bold); }\n.zt-detail-tabs button[aria-current=\"page\"]::after { content: \"\"; position: absolute; bottom: -1px; left: 0; right: 0; height: 3px; background: var(--zt-accent); }\n.zt-detail-section { padding: 20px 24px 26px; }\n.zt-no-description { min-height: 150px; padding: 26px 0; color: var(--zt-muted); font-size: var(--zt-font-md); text-align: center; }\n.zt-rich { overflow: hidden; border: 1px solid var(--zt-border); border-radius: 9px; background: var(--zt-surface); }\n.zt-rich-frame { display: block; border: 0; width: 100%; height: 370px; min-height: 180px; resize: vertical; overflow: auto; background: var(--zt-surface); }\n.zt-rich.is-expanded .zt-rich-frame { height: 760px; }\n.zt-rich-compact .zt-rich-frame { height: 165px; min-height: 90px; }\n.zt-rich-expand { display: block; width: 100%; height: 36px; padding: 0; border-top: 1px solid var(--zt-border); background: var(--zt-raised); font-size: var(--zt-font-xs) !important; font-weight: var(--zt-weight-bold); }\n.zt-detail-section .zt-empty { min-height: 220px; padding: 24px 10px; }\n.zt-detail-section .zt-empty-icon { width: 48px; height: 48px; border-radius: 14px; }\n.zt-timeline { list-style: none; padding: 0 0 0 15px; margin: 0; }\n.zt-timeline > li { position: relative; padding: 0 0 23px 18px; border-left: 1px solid var(--zt-border); }\n.zt-timeline > li:last-child { border-left-color: transparent; padding-bottom: 0; }\n.zt-timeline-dot { position: absolute; width: 7px; height: 7px; top: 5px; left: -4px; border-radius: 50%; background: var(--zt-accent); box-shadow: 0 0 0 4px var(--zt-surface); }\n.zt-action-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: var(--zt-secondary); font-size: var(--zt-font-sm); }\n.zt-action-heading strong { color: var(--zt-ink); font-weight: var(--zt-weight-bold); }\n.zt-timeline time { display: block; margin-top: 4px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-timeline .zt-rich { margin-top: 10px; }\n.zt-action-history { padding: 10px 12px; margin-top: 8px; border-radius: 7px; background: var(--zt-raised); color: var(--zt-muted); font-size: var(--zt-font-xs); overflow-wrap: anywhere; line-height: 1.75; }\n.zt-action-history p + p { margin-top: 4px; }\n.zt-files { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }\n.zt-files li { display: flex; align-items: center; gap: 13px; padding: 15px; border: 1px solid var(--zt-border); border-radius: 9px; }\n.zt-file-symbol { display: grid; place-items: center; width: 33px; height: 38px; flex-shrink: 0; border-radius: 5px; background: var(--zt-accent-soft); color: var(--zt-accent); }\n.zt-files li > div { min-width: 0; font-size: var(--zt-font-sm); overflow-wrap: anywhere; }\n.zt-files a { display: inline-flex; align-items: center; gap: 5px; font-weight: var(--zt-weight-medium); }\n.zt-files small { display: block; margin-top: 5px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-notice-toolbar .zt-search { max-width: none; }\n.zt-notices { flex: 1; min-height: 0; overflow: auto; }\n.zt-notice { display: flex; align-items: center; gap: 15px; position: relative; min-height: 110px; padding: 20px 24px; border-top: 1px solid var(--zt-border); }\n.zt-notice.is-unread { background: color-mix(in srgb, var(--zt-accent) 3%, transparent); }\n.zt-notice.is-unread::before { content: \"\"; position: absolute; top: 21px; left: 7px; width: 4px; height: 4px; border-radius: 50%; background: var(--zt-accent); }\n.zt-notice-symbol { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; background: var(--zt-accent-soft); color: var(--zt-accent); border-radius: 12px; align-self: flex-start; margin-top: 4px; }\n.zt-notice-bug { background: var(--zt-red-soft); color: var(--zt-red); }\n.zt-notice-body { flex: 1; min-width: 0; }\n.zt-notice-meta { display: flex; flex-wrap: wrap; gap: 7px 12px; align-items: center; margin-bottom: 6px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-notice-reason { color: var(--zt-secondary); font-weight: var(--zt-weight-bold); }\n.zt-notice-meta time { margin-left: auto; }\n.zt-notice-title { display: block; max-width: 100%; padding: 0; background: transparent; border: 0; color: var(--zt-ink); font-size: var(--zt-font-md) !important; line-height: 1.7; text-align: left; overflow-wrap: anywhere; font-weight: var(--zt-weight-bold); }\n.zt-notice-title:hover { color: var(--zt-accent); }\n.zt-notice-delivery { display: block; margin-top: 4px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-notice.is-read .zt-notice-title { color: var(--zt-secondary); }\n.zt-read-label { color: var(--zt-muted); font-size: var(--zt-font-xs); white-space: nowrap; }\n.zt-settings { width: 100%; max-width: 880px; margin: 0 auto; padding: 28px 32px; overflow: auto; }\n.zt-settings-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }\n.zt-settings-symbol { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--zt-accent-soft); color: var(--zt-accent); }\n.zt-settings-heading h2 { font-size: var(--zt-font-section); font-weight: var(--zt-weight-bold); line-height: 1.5; }\n.zt-settings-heading p { margin-top: 3px; color: var(--zt-muted); font-size: var(--zt-font-sm); line-height: 1.75; }\n.zt-settings-section { margin-bottom: 28px; }\n.zt-settings-section h3 { padding-bottom: 12px; margin-bottom: 2px; border-bottom: 1px solid var(--zt-border); color: var(--zt-ink); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 86px; padding: 16px 0; }\n.zt-setting-row label { display: block; color: var(--zt-ink); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-setting-row p { margin-top: 5px; color: var(--zt-muted); font-size: var(--zt-font-sm); line-height: 1.75; max-width: 54ch; }\n.zt-number-input { display: inline-flex; align-items: center; gap: 7px; color: var(--zt-muted); font-size: var(--zt-font-sm); }\n.zt-number-input input { width: 86px; height: var(--zt-control-height); padding: 0 10px; border: 1px solid var(--zt-border); border-radius: 8px; background: var(--zt-surface); color: var(--zt-ink); font-size: var(--zt-font-md); font-variant-numeric: tabular-nums; }\n.zt-switch { display: block; position: relative; width: 40px; height: 24px; padding: 3px; border: 0; border-radius: 20px; background: var(--zt-border); flex-shrink: 0; transition: background .15s; }\n.zt-switch > span { display: block; height: 18px; width: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; transform: translateX(0); transition: transform .15s; }\n.zt-switch[aria-checked=\"true\"] { background: var(--zt-accent); }\n.zt-switch[aria-checked=\"true\"] > span { transform: translateX(16px); }\n.zt-setting-pet select { min-width: 150px; max-width: 230px; flex-shrink: 0; }\n.zt-inline-warning { margin: -3px 0 12px !important; color: var(--zt-amber); font-size: var(--zt-font-sm); overflow-wrap: anywhere; }\n.zt-pet-test { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; margin-top: 6px; background: var(--zt-raised); border: 1px solid var(--zt-border); border-radius: 10px; }\n.zt-pet-test p { color: var(--zt-muted); font-size: var(--zt-font-xs); line-height: 1.75; }\n.zt-pet-test .zt-button { font-size: var(--zt-font-sm); }\n.zt-pet-test-actions, .zt-settings-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }\n.zt-sync-form > .zt-settings-footer { flex-wrap: wrap; }\n.zt-pet-catalog-help { margin: 0 0 15px !important; color: var(--zt-secondary); font-size: var(--zt-font-sm); line-height: 1.7; overflow-wrap: anywhere; }\n.zt-pet-alert-profiles { display: grid; gap: 20px; margin-bottom: 16px; }\n.zt-pet-alert-fields { display: grid; grid-template-columns: minmax(0, 1fr) 160px; align-items: start; gap: 18px; min-width: 0; margin: 0; padding: 18px; border: 1px solid var(--zt-border); border-radius: 10px; background: var(--zt-raised); }\n.zt-pet-alert-fields > legend { padding: 0 7px; color: var(--zt-ink); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-pet-alert-fields > legend svg { margin-right: 6px; color: var(--zt-accent); }\n.zt-pet-alert-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-width: 0; }\n.zt-pet-alert-field { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0; }\n.zt-pet-alert-field > label { color: var(--zt-ink); font-size: var(--zt-font-sm); font-weight: var(--zt-weight-bold); }\n.zt-pet-alert-field > select { width: 100%; min-width: 0; color: var(--zt-secondary); }\n.zt-pet-alert-field > input[type=\"url\"] { width: 100%; min-width: 0; height: var(--zt-control-height); padding: 0 12px; border: 1px solid var(--zt-border); border-radius: 8px; background: var(--zt-surface); color: var(--zt-ink); font-size: var(--zt-font-sm); }\n.zt-pet-alert-field > input[type=\"url\"]::placeholder { color: var(--zt-muted); }\n.zt-pet-alert-field > input[aria-invalid=\"true\"] { border-color: var(--zt-red); }\n.zt-pet-alert-field > input[type=\"file\"] { width: 100%; min-width: 0; color: var(--zt-secondary); font-size: var(--zt-font-sm); }\n.zt-pet-alert-field > input[type=\"file\"]::file-selector-button { margin-right: 10px; min-height: 36px; padding: 7px 12px; border: 1px solid var(--zt-border); border-radius: 8px; background: var(--zt-surface); color: var(--zt-secondary); font: inherit; font-weight: var(--zt-weight-bold); cursor: pointer; }\n.zt-pet-alert-field > input[type=\"file\"]:disabled::file-selector-button { cursor: not-allowed; opacity: .48; }\n.zt-pet-alert-wide { grid-column: 1 / -1; }\n.zt-pet-alert-help { color: var(--zt-muted); font-size: var(--zt-font-xs); line-height: 1.65; overflow-wrap: anywhere; }\n.zt-pet-upload-status { color: var(--zt-secondary); font-size: var(--zt-font-xs); line-height: 1.65; overflow-wrap: anywhere; }\n.zt-pet-upload-status.is-error { color: var(--zt-red); }\n.zt-pet-image-preview { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; min-width: 0; min-height: 148px; margin: 0; padding: 13px; border: 1px solid var(--zt-border); border-radius: 9px; background: var(--zt-surface); text-align: center; }\n.zt-pet-image-preview img { display: block; width: 100%; max-height: 140px; object-fit: contain; border-radius: 4px; }\n.zt-pet-image-preview figcaption { color: var(--zt-muted); font-size: var(--zt-font-xs); line-height: 1.6; }\n.zt-pet-preview-placeholder { color: var(--zt-secondary); font-size: var(--zt-font-sm); overflow-wrap: anywhere; }\n.zt-settings-feedback.is-warning { color: var(--zt-amber); }\n.zt-connection { padding: 0 0 1px; }\n.zt-credential-status { display: flex; align-items: center; gap: 7px; margin-top: 15px; color: var(--zt-secondary); font-size: var(--zt-font-sm); }\n.zt-credential-status i { background: var(--zt-muted); }\n.zt-credential-status i.is-ready { background: var(--zt-green); }\n.zt-connection p { margin-top: 12px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-connection code { display: block; padding: 11px 13px; margin-top: 6px; background: var(--zt-raised); border: 1px solid var(--zt-border); border-radius: 8px; color: var(--zt-secondary); font: 12px/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; user-select: text; }\n.zt-settings-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 20px; border-top: 1px solid var(--zt-border); flex-wrap: wrap; }\n.zt-settings-feedback { color: var(--zt-green); font-size: var(--zt-font-sm); }\n.zt-settings-feedback:empty { color: var(--zt-muted); }\n.zt-settings-feedback.is-error { color: var(--zt-red); }\n.zt-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-shrink: 0; margin-top: -7px; padding: 0 2px; color: var(--zt-muted); font-size: var(--zt-font-xs); }\n.zt-last-sync { display: inline-flex; align-items: center; gap: 5px; }\n.zt-connection-panel { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--zt-border); }\n.zt-connection-panel h3 { color: var(--zt-ink); font-size: var(--zt-font-lg); font-weight: var(--zt-weight-bold); }\n.zt-connection-intro, .zt-connection-help { margin-top: 6px !important; color: var(--zt-secondary); font-size: var(--zt-font-sm); }\n.zt-connection-form { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; gap: 15px 18px; margin-top: 20px; }\n.zt-connection-form > label { color: var(--zt-ink); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-connection-form > input { width: 100%; min-width: 0; height: 40px; padding: 0 12px; border: 1px solid var(--zt-border); border-radius: 8px; background: var(--zt-surface); color: var(--zt-ink); font: inherit; }\n.zt-connection-form > input::placeholder { color: var(--zt-muted); opacity: 1; }\n.zt-connection-form > .zt-connection-help, .zt-connection-form > .zt-settings-footer { grid-column: 1 / -1; }\n.zt-connection-form > .zt-settings-footer { min-width: 0; }\n.zt-workspace-entry { color: var(--zt-ink); background: var(--zt-canvas); width: 100%; padding: 24px; }\n.zt-workspace-entry .zt-empty { color: inherit; }\n.zt-config-app { flex: none; height: auto; min-height: 0; padding: 21px 22px 14px; }\nhtml[data-platform=\"darwin\"] .zt-app:not(.zt-config-app) { padding-top: calc(25px + var(--dsh-frame-top-clearance, 0px)); padding-left: max(28px, var(--dsh-frame-leading-clearance, 0px)); }\n.zt-config-app .zt-workspace { min-height: 0; flex: auto; }\n.zt-config-app .zt-header-actions .zt-account { display: none; }\n.zt-config-app .zt-title-group p { font-size: var(--zt-font-sm); }\n@container zentao (max-width: 1120px) {\n  .zt-stat { padding: 15px; gap: 10px; }\n  .zt-readonly-hint { display: none; }\n  .zt-workspace.has-detail { grid-template-columns: minmax(0, 1fr); }\n  .zt-detail { position: absolute; inset: 0 0 0 auto; width: min(540px, 100%); border-left: 1px solid var(--zt-border); box-shadow: -15px 0 32px #101b3520; }\n  .has-detail .zt-avatar { display: none; }\n  .has-detail .zt-filters { gap: 7px; }\n  .has-detail .zt-result-count { display: none; }\n}\n@container zentao (max-width: 850px) {\n  .zt-workspace.has-detail { grid-template-columns: minmax(0, 1fr); }\n  .zt-account { display: none; }\n  .zt-stat { padding: 14px 12px; gap: 9px; }\n  .zt-stat-icon { width: 32px; height: 32px; border-radius: 8px; }\n  .zt-stat strong { font-size: 26px; }\n  .zt-stat-label { font-size: var(--zt-font-xs); }\n  .zt-table th:first-child { width: 44%; }\n  .zt-date-col { display: none; }\n}\n@container zentao (max-width: 620px) {\n  .zt-header { flex-wrap: wrap; gap: 12px; }\n  .zt-title-group { flex: 1; }\n  .zt-header-actions { margin-left: auto; }\n  .zt-title-group p { display: none; }\n  .zt-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }\n  .zt-stat { padding: 11px 13px; }\n  .zt-stat > div { display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: center; flex: 1; gap: 8px; }\n  .zt-stat strong { margin-top: 0; font-size: 26px; }\n  .zt-stat-icon { width: 31px; height: 31px; }\n  .zt-workspace-nav { padding: 0 14px; min-height: 56px; }\n  .zt-tabs { gap: 20px; }\n  .zt-filters { padding: 12px 13px; gap: 8px; }\n  .zt-search { max-width: none; }\n  .zt-result-count { margin-right: 1px; }\n  .zt-context-col { display: none; }\n  .zt-table th:first-child { min-width: 205px; }\n  .zt-table td, .zt-table th { padding-left: 8px; padding-right: 8px; }\n  .zt-table th:first-child, .zt-table td:first-child { padding-left: 14px; }\n  .zt-table th:last-child, .zt-table td:last-child { padding-right: 14px; }\n  .zt-table .zt-avatar { display: none; }\n  .zt-pagination { padding: 10px 13px; }\n  .zt-pagination select { display: none; }\n  .zt-settings { padding: 22px 18px; }\n  .zt-setting-row { gap: 12px; }\n  .zt-setting-pet select { min-width: 110px; max-width: 150px; }\n  .zt-pet-test { flex-wrap: wrap; }\n  .zt-pet-alert-fields { grid-template-columns: minmax(0, 1fr); }\n  .zt-pet-image-preview { flex-direction: row; justify-content: flex-start; min-height: 90px; text-align: left; }\n  .zt-pet-image-preview img { width: 95px; max-height: 100px; flex-shrink: 0; }\n  .zt-pet-test-actions { justify-content: flex-start; }\n  .zt-notice { padding: 15px 14px; gap: 10px; }\n  .zt-notice-symbol { width: 30px; height: 30px; border-radius: 8px; }\n  .zt-notice.is-unread::before { left: 4px; }\n  .zt-footer { flex-wrap: wrap; gap: 5px; }\n}\n@container zentao (max-width: 390px) {\n  .zt-title-line h1 { font-size: 24px; }\n  .zt-brand { width: 38px; height: 38px; border-radius: 10px; }\n  .zt-header-actions .zt-button { padding: 0 9px; }\n  .zt-stats { gap: 7px; }\n  .zt-stat { gap: 7px; padding: 10px; }\n  .zt-stat-icon { display: none; }\n  .zt-stat strong { font-size: 26px; }\n  .zt-tabs { gap: 15px; }\n  .zt-tabs > button { font-size: var(--zt-font-sm); gap: 5px; font-weight: var(--zt-weight-bold); }\n  .zt-filters .zt-scope { flex-shrink: 0; }\n  .zt-filters .zt-search { min-width: 130px; }\n  .zt-table td { height: 78px; }\n  .zt-table .zt-assignee { white-space: normal; font-size: var(--zt-font-xs); }\n  .zt-table .zt-item-id { display: block; margin-bottom: 3px; }\n  .zt-item-sub { padding-left: 0; }\n  .zt-notice-toolbar .zt-search { order: 3; flex-basis: 100%; }\n  .zt-notice-toolbar .zt-button { margin-left: auto; }\n  .zt-notice .zt-text-button { font-size: var(--zt-font-xs) !important; }\n  .zt-settings { padding: 20px 14px; }\n  .zt-setting-row p { font-size: var(--zt-font-xs); }\n  .zt-settings-footer { align-items: flex-start; }\n  .zt-settings-heading p { font-size: var(--zt-font-xs); }\n  .zt-pet-alert-fields { padding: 11px; }\n  .zt-pet-alert-inputs { grid-template-columns: minmax(0, 1fr); }\n  .zt-pet-test-actions, .zt-settings-actions { width: 100%; justify-content: flex-start; }\n  .zt-pet-test-actions .zt-button, .zt-settings-actions .zt-button { flex: 1; }\n  .zt-detail-fields { margin-inline: 15px; }\n  .zt-detail-heading { padding-inline: 16px; }\n  .zt-detail-section { padding-inline: 14px; }\n}\n@media (max-width: 700px) {\n  .zt-app { padding: 18px 15px 12px; gap: 15px; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .zt-app *, .zt-app *::before, .zt-app *::after { animation: none !important; transition: none !important; }\n}\n@keyframes zt-spin { to { transform: rotate(360deg); } }\n@keyframes zt-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }\n\n.zt-app .zt-app-content { display: contents; }\n.zt-app .zt-operations-col { width: 216px; min-width: 196px; max-width: 236px; }\n.zt-app .zt-item-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; max-width: 220px; min-width: 0; }\n.zt-app .zt-item-action { font-size: var(--zt-font-xs) !important; line-height: 1.5; font-weight: var(--zt-weight-bold); min-height: 30px; padding: 4px 6px; border-radius: 6px; text-decoration: none; }\n.zt-app .zt-item-more { min-width: 0; }\n.zt-app .zt-item-more[open] { flex-basis: 100%; }\n.zt-app .zt-item-more > summary { display: inline-block; padding: 4px 7px; color: var(--zt-accent); font-size: var(--zt-font-xs); list-style: none; cursor: pointer; min-height: 30px; font-weight: var(--zt-weight-bold); border-radius: 6px; }\n.zt-app .zt-item-more > summary::-webkit-details-marker { display: none; }\n.zt-app .zt-item-more > summary::after { content: ' ▾'; font-size: 9px; }\n.zt-app .zt-item-more[open] > summary::after { content: ' ▴'; }\n.zt-app .zt-item-more > summary[aria-disabled=\"true\"] { opacity: .48; cursor: not-allowed; }\n.zt-app .zt-item-more-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding: 4px 0 2px; }\n.zt-app .zt-detail-heading > .zt-item-actions { max-width: none; margin-top: 17px; padding-top: 13px; border-top: 1px solid var(--zt-border); }\n.zt-app .zt-operation-feedback { display: flex; align-items: center; gap: 12px; flex-shrink: 0; padding: 13px 16px; border: 1px solid color-mix(in srgb, var(--zt-green) 24%, transparent); border-radius: 10px; color: var(--zt-green); background: var(--zt-green-soft); font-size: var(--zt-font-sm); line-height: 1.75; }\n.zt-app .zt-operation-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }\n.zt-app .zt-operation-feedback.is-warning { color: var(--zt-amber); background: var(--zt-amber-soft); border-color: color-mix(in srgb, var(--zt-amber) 24%, transparent); }\n.zt-app .zt-operation-feedback.is-error { color: var(--zt-red); background: var(--zt-red-soft); border-color: color-mix(in srgb, var(--zt-red) 24%, transparent); }\n.zt-app .zt-operation-feedback .zt-icon-button { width: 32px; height: 32px; border: 0; color: inherit; background: transparent; }\n.zt-app .zt-operation-overlay { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; min-width: 0; padding: 24px; background: color-mix(in srgb, var(--zt-ink) 36%, transparent); }\n.zt-app .zt-operation-dialog { display: flex; flex-direction: column; width: min(680px, 100%); max-height: min(820px, calc(100dvh - 48px), 100%); min-height: 0; min-width: 0; overflow: hidden; outline: none; color: var(--zt-ink); background: var(--zt-surface); border: 1px solid var(--zt-border); border-radius: 16px; box-shadow: 0 24px 80px #0004; }\n.zt-app .zt-operation-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-shrink: 0; padding: 20px 24px; border-bottom: 1px solid var(--zt-border); }\n.zt-app .zt-operation-header h2 { margin: 3px 0 0; font-size: var(--zt-font-section); font-weight: var(--zt-weight-bold); }\n.zt-app .zt-operation-kicker { color: var(--zt-muted); font-size: var(--zt-font-xs); font-weight: var(--zt-weight-medium); }\n.zt-app .zt-operation-header .zt-icon-button { font-size: 21px; line-height: 1; }\n.zt-app .zt-operation-form { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }\n.zt-app .zt-operation-scroll { display: flex; flex-direction: column; gap: 16px; min-height: 0; padding: 22px 24px 24px; overflow: auto; overscroll-behavior: contain; }\n.zt-app .zt-operation-target { color: var(--zt-ink); font-size: var(--zt-font-lg); font-weight: var(--zt-weight-bold); line-height: 1.65; overflow-wrap: anywhere; }\n.zt-app .zt-operation-loading { padding: 22px 0; color: var(--zt-muted); text-align: center; }\n.zt-app .zt-operation-description { color: var(--zt-secondary); font-size: var(--zt-font-sm); line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }\n.zt-app .zt-operation-help { color: var(--zt-muted); font-size: var(--zt-font-xs); line-height: 1.8; overflow-wrap: anywhere; }\n.zt-app .zt-operation-hours { padding: 10px 12px; background: var(--zt-raised); border: 1px solid var(--zt-border); border-radius: 6px; }\n.zt-app .zt-operation-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 20px; }\n.zt-app .zt-operation-field { display: flex; flex-direction: column; gap: 9px; min-width: 0; }\n.zt-app .zt-operation-field-wide { grid-column: 1 / -1; }\n.zt-app .zt-operation-field > label { color: var(--zt-ink); font-size: var(--zt-font-md); font-weight: var(--zt-weight-bold); }\n.zt-app .zt-operation-field :is(input, select, textarea) { width: 100%; max-width: 100%; min-width: 0; min-height: 40px; height: auto; padding: 9px 12px; border: 1px solid var(--zt-border); border-radius: 8px; background: var(--zt-surface); color: var(--zt-ink); font-size: var(--zt-font-md); }\n.zt-app .zt-operation-field select { padding-right: 28px; }\n.zt-app .zt-operation-field textarea { min-height: 112px; max-height: 320px; resize: vertical; line-height: 1.8; }\n.zt-app .zt-operation-field :is(input, select, textarea):disabled { opacity: .65; cursor: not-allowed; }\n.zt-app .zt-operation-field [aria-invalid=\"true\"] { border-color: var(--zt-red); }\n.zt-app .zt-operation-required, .zt-app .zt-operation-field-error { color: var(--zt-red); }\n.zt-app .zt-operation-field-error { font-size: var(--zt-font-sm); line-height: 1.6; overflow-wrap: anywhere; }\n.zt-app .zt-operation-message { padding: 12px 14px; border: 1px solid var(--zt-border); border-radius: 9px; color: var(--zt-secondary); background: var(--zt-raised); font-size: var(--zt-font-sm); line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }\n.zt-app .zt-operation-message.is-warning { color: var(--zt-amber); background: var(--zt-amber-soft); border-color: color-mix(in srgb, var(--zt-amber) 22%, transparent); }\n.zt-app .zt-operation-message.is-error { color: var(--zt-red); background: var(--zt-red-soft); border-color: color-mix(in srgb, var(--zt-red) 22%, transparent); }\n.zt-app .zt-operation-external { display: flex; flex-direction: column; align-items: flex-start; gap: 13px; padding: 18px; border: 1px solid var(--zt-border); border-radius: 10px; background: var(--zt-raised); color: var(--zt-secondary); font-size: var(--zt-font-sm); line-height: 1.7; }\n.zt-app .zt-operation-external a[aria-disabled=\"true\"] { opacity: .48; cursor: not-allowed; text-decoration: none; }\n.zt-app .zt-operation-recovery { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }\n.zt-app .zt-operation-ack { display: flex; align-items: flex-start; gap: 8px; color: var(--zt-secondary); font-size: var(--zt-font-sm); line-height: 1.7; cursor: pointer; }\n.zt-app .zt-operation-ack input { flex-shrink: 0; margin: 4px 0 0; accent-color: var(--zt-accent); }\n.zt-app .zt-operation-site-link { align-self: flex-start; font-size: var(--zt-font-sm); font-weight: var(--zt-weight-medium); }\n.zt-app .zt-operation-site-link[aria-disabled=\"true\"] { opacity: .48; cursor: not-allowed; text-decoration: none; }\n.zt-app .zt-operation-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; flex-shrink: 0; padding: 18px 24px; border-top: 1px solid var(--zt-border); background: var(--zt-raised); }\n.zt-app .zt-operation-footer-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 9px; margin-left: auto; }\n@container zentao (max-width: 620px) {\n  .zt-app .zt-operations-col { width: 196px; min-width: 176px; }\n  .zt-app .zt-operation-overlay { padding: 12px; }\n  .zt-app .zt-operation-dialog { max-height: min(calc(100dvh - 24px), 100%); border-radius: 10px; }\n  .zt-app .zt-operation-header { padding: 15px 16px; }\n  .zt-app .zt-operation-scroll { padding: 15px 16px 18px; }\n  .zt-app .zt-operation-fields { grid-template-columns: minmax(0, 1fr); }\n  .zt-app .zt-operation-footer { align-items: stretch; padding: 13px 16px; }\n  .zt-app .zt-operation-footer > .zt-operation-help, .zt-app .zt-operation-footer-actions { width: 100%; }\n  .zt-app .zt-operation-footer-actions > button { flex: 1; min-width: 0; height: auto; min-height: 40px; padding: 9px; white-space: normal; }\n}\n\n/* Comfortable interaction states without adding visual noise to every row. */\n.zt-app .zt-item-action:hover:not(:disabled), .zt-app .zt-item-more > summary:hover { background: var(--zt-accent-soft); text-decoration: none; }\n.zt-app .zt-item-action[data-action=\"cancel\"] { color: var(--zt-red) !important; }\n.zt-app .zt-item-action[data-action=\"cancel\"]:hover:not(:disabled) { background: var(--zt-red-soft); }\n.zt-app .zt-item-action:is([data-action=\"finish\"], [data-action=\"resolve\"]) { color: var(--zt-green) !important; }\n.zt-app .zt-item-action:is([data-action=\"finish\"], [data-action=\"resolve\"]):hover:not(:disabled) { background: var(--zt-green-soft); }\n.zt-app .zt-item-actions > .zt-item-more { align-self: flex-start; }\n.zt-workspace-nav .zt-tabs { min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }\n.zt-tabs > button:focus-visible { outline-offset: -4px; }\n.zt-app .zt-table th.zt-operations-col, .zt-app .zt-table td.zt-operations-col { border-left: 1px solid var(--zt-border); }\n.zt-app .zt-table tbody tr:focus-within { background: var(--zt-hover); }\n.zt-app .zt-table tbody tr.zt-row-selected:focus-within { background: var(--zt-accent-soft); }\n.zt-app :is(.zt-connection-form > input, .zt-number-input input, .zt-pet-alert-field > input[type=\"url\"], .zt-operation-field :is(input, select, textarea)):focus-visible { border-color: var(--zt-accent); }\n.zt-app .zt-operation-header { background: var(--zt-raised); }\n.zt-app .zt-operation-choice { padding-bottom: 18px; border-bottom: 1px solid var(--zt-border); }\n.zt-app .zt-connection-help, .zt-app .zt-connection-intro, .zt-app .zt-inline-warning { line-height: 1.8; }\n@container zentao (max-width: 620px) {\n  .zt-tabs { gap: 18px; }\n  .zt-filters .zt-search { flex-basis: 100%; max-width: none; order: 2; }\n  .zt-filters .zt-result-count { margin-left: auto; }\n  .zt-pagination { flex-wrap: wrap; row-gap: 10px; }\n  .zt-pagination-actions { margin-left: auto; }\n  .zt-setting-row { align-items: flex-start; flex-wrap: wrap; }\n  .zt-setting-row > div { flex: 1 1 200px; min-width: 0; }\n  .zt-setting-row :is(.zt-number-input, .zt-switch) { flex: 0 0 auto; }\n  .zt-setting-pet select { flex: 0 1 100%; max-width: 100%; }\n  .zt-connection-form { grid-template-columns: minmax(0, 1fr); gap: 10px; }\n  .zt-connection-form > label:not(:first-child) { margin-top: 6px; }\n  .zt-connection-form > .zt-settings-footer { margin-top: 8px; }\n  .zt-operation-footer-actions > .zt-button { line-height: 1.6; }\n}\n@container zentao (max-width: 390px) {\n  .zt-tabs { gap: 15px; }\n  .zt-stat > div { flex-wrap: wrap; gap: 2px 10px; }\n}\n";
'use strict';
const React = require('react');
const model = require('./client-model.cjs');
const { ItemActions, OperationDialog } = require('./client-operations.cjs');
const { createElement: h, useState, useEffect, useMemo, useRef } = React;
const { STATUS_LABELS, NOTICE_LABELS, TASK_STATUSES, BUG_STATUSES, filterItems, paginateItems, summarize, petAlertsDraft, safePetImageUrl, settingsPatch, connectionPatch, safeSiteUrl, buildSafeDocument, createApi, createOverviewStore } = model;
const name = 'zentao-ui';
const inject = ['slots', 'locale', 'layout'];
const EMPTY = { tasks: [], bugs: [], notifications: [], status: {}, settings: {}, account: '', baseUrl: '' };
const installed = new WeakMap();
const styleOwners = new WeakMap();
const asList = value => Array.isArray(value) ? value : [];
const label = value => value == null || value === '' ? '—' : String(value);

function Icon({ name: iconName, size = 18, className = '' }) {
  const paths = {
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    task: ['M9 5h11v15H4V5h2', 'M9 3h6v4H9z', 'm8 13 2 2 5-5'],
    bug: ['M9 4 7 2', 'm15 4 2-2', 'M8 8h8v8a4 4 0 0 1-8 0z', 'M8 12H4m12 0h4M8 17l-4 2m12-2 4 2', 'M9 8V6a3 3 0 0 1 6 0v2', 'M12 12v7'],
    bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm17 17 4 4'],
    refresh: ['M20 7a9 9 0 0 0-15-2L3 7', 'M3 3v4h4', 'M4 17a9 9 0 0 0 15 2l2-2', 'M21 21v-4h-4'],
    settings: ['M10 3h4l1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
    external: ['M14 3h7v7', 'm21 3-11 11', 'M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6'],
    close: ['m6 6 12 12', 'M18 6 6 18'],
    check: ['m5 12 4 4L19 6'],
    chevron: ['m9 5 7 7-7 7'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 6v6l4 2'],
    alert: ['m12 3 10 18H2z', 'M12 9v5', 'M12 17h.01'],
    file: ['M14 2H5v20h14V7z', 'M14 2v5h5', 'M8 12h8m-8 4h6'],
    inbox: ['M3 14V5h18v9l-3 6H6z', 'M3 14h5l2 3h4l2-3h5'],
    user: ['M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10', 'M3 22v-2a9 9 0 0 1 18 0v2'],
    spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className }, ...(paths[iconName] || paths.grid).map((d, i) => h('path', { key: i, d })));
}

function formatTime(value, compact = false) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', compact ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function useDarkTheme() {
  function readTheme() {
    const doc = globalThis.document;
    if (!doc) return false;
    const root = doc.documentElement;
    if (doc.body?.hasAttribute('data-ds-dark-theme') || root.hasAttribute('data-ds-dark-theme')) return true;
    const scheme = globalThis.getComputedStyle?.(root).colorScheme;
    if (scheme === 'dark' || scheme === 'light') return scheme === 'dark';
    const marker = `${root.getAttribute('data-theme') || ''} ${root.className} ${doc.body?.getAttribute('data-theme') || ''} ${doc.body?.className || ''}`;
    if (/\bdark\b/i.test(marker)) return true;
    if (/\blight\b/i.test(marker)) return false;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  }
  const [dark, setDark] = useState(readTheme);
  useEffect(() => {
    const doc = globalThis.document;
    if (!doc) return undefined;
    const update = () => setDark(readTheme());
    const observer = globalThis.MutationObserver ? new MutationObserver(update) : null;
    observer?.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'data-ds-theme-source', 'data-ds-dark-theme'] });
    if (doc.body) observer?.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] });
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update); update();
    return () => { observer?.disconnect(); media?.removeEventListener?.('change', update); };
  }, []);
  return dark;
}

function Button({ icon, children, className = '', ...props }) {
  return h('button', { type: 'button', ...props, className: `zt-button ${className}` }, icon ? h(Icon, { name: icon, size: 15 }) : null, children);
}
function StatusBadge({ status }) {
  return h('span', { className: `zt-status zt-status-${/^(doing|active|done|resolved|wait|pause|closed|cancel)$/.test(status) ? status : 'other'}` }, h('i', null), STATUS_LABELS[status] || label(status));
}
function Priority({ value }) {
  const pri = Number(value);
  return h('span', { className: `zt-priority zt-priority-${[1, 2, 3, 4].includes(pri) ? pri : 0}`, title: `优先级 ${pri || '未设置'}` }, h('i', null), pri > 0 ? `P${pri}` : '—');
}
function EmptyState({ icon = 'inbox', title, description, action }) {
  return h('div', { className: 'zt-empty' }, h('span', { className: 'zt-empty-icon' }, h(Icon, { name: icon, size: 28 })), h('strong', null, title), description ? h('p', null, description) : null, action || null);
}
function LoadingState({ detail = false }) {
  return h('div', { className: `zt-loading ${detail ? 'zt-loading-detail' : ''}`, role: 'status', 'aria-label': '正在加载' }, h('span', { className: 'zt-sr-only' }, '正在加载…'), ...Array.from({ length: detail ? 4 : 6 }, (_, i) => h('div', { key: i, className: 'zt-skeleton' }, h('span', null), h('span', null), h('span', null))));
}
function ErrorBanner({ error, stale, onRetry }) {
  return h('div', { className: 'zt-error-banner', role: 'alert' }, h(Icon, { name: 'alert', size: 18 }), h('div', null, h('strong', null, stale ? '连接暂不可用，正在展示上次同步的数据' : '暂时无法获取禅道数据'), h('span', null, error)), onRetry ? h(Button, { onClick: onRetry, className: 'zt-button-small' }, '重试') : null);
}

function Filters({ kind, value, onChange, count, account }) {
  const statuses = kind === 'task' ? TASK_STATUSES : BUG_STATUSES;
  const update = patch => onChange({ ...value, ...patch });
  return h('div', { className: 'zt-filters' },
    h('div', { className: 'zt-scope', role: 'group', 'aria-label': '负责人范围' },
      h('button', { type: 'button', 'aria-pressed': value.scope === 'mine', disabled: !account, onClick: () => update({ scope: 'mine' }) }, h(Icon, { name: 'user', size: 13 }), '我的'),
      h('button', { type: 'button', 'aria-pressed': value.scope === 'all', onClick: () => update({ scope: 'all' }) }, '全部')),
    h('label', { className: 'zt-search' }, h(Icon, { name: 'search', size: 16 }), h('input', { type: 'search', value: value.query, onChange: e => update({ query: e.target.value }), placeholder: '搜索标题、编号或项目…', 'aria-label': '搜索任务或Bug' })),
    h('select', { value: value.status, onChange: e => update({ status: e.target.value }), 'aria-label': '状态筛选' }, h('option', { value: 'all' }, '全部状态'), ...statuses.map(status => h('option', { key: status, value: status }, STATUS_LABELS[status]))),
    h('select', { value: value.priority, onChange: e => update({ priority: e.target.value }), 'aria-label': '优先级筛选' }, h('option', { value: 'all' }, '全部优先级'), ...[1, 2, 3, 4].map(pri => h('option', { key: pri, value: String(pri) }, `P${pri}${pri === 1 ? ' · 紧急' : ''}`))),
    h('span', { className: 'zt-result-count', 'aria-live': 'polite' }, `${count} 项`));
}
function Pagination({ value, onPage, onSize }) {
  return h('div', { className: 'zt-pagination' }, h('span', null, value.total ? `显示 ${value.from}–${value.to} 项，共 ${value.total} 项` : '共 0 项'), h('div', { className: 'zt-pagination-actions' },
    h('select', { value: value.pageSize, onChange: e => onSize(Number(e.target.value)), 'aria-label': '每页条数' }, ...[20, 50, 100].map(size => h('option', { key: size, value: size }, `${size} 条 / 页`))),
    h('button', { type: 'button', className: 'zt-icon-button zt-prev', disabled: value.page <= 1, onClick: () => onPage(value.page - 1), 'aria-label': '上一页' }, h(Icon, { name: 'chevron', size: 15 })),
    h('span', { className: 'zt-page-number', 'aria-live': 'polite' }, `${value.page} / ${value.pages}`),
    h('button', { type: 'button', className: 'zt-icon-button', disabled: value.page >= value.pages, onClick: () => onPage(value.page + 1), 'aria-label': '下一页' }, h(Icon, { name: 'chevron', size: 15 }))));
}

function ItemList({ items, kind, filters, onFilter, account, selection, onSelect, loading, onOperate, busy }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const filtered = useMemo(() => filterItems(items, filters, account), [items, filters, account]);
  const paged = paginateItems(filtered, page, size);
  const changeFilter = next => { setPage(1); onFilter(next); };
  const filteredActive = filters.query || filters.status !== 'all' || filters.priority !== 'all';
  return h('div', { className: 'zt-list-panel' }, h(Filters, { kind, value: filters, onChange: changeFilter, account, count: filtered.length }),
    loading ? h(LoadingState) : !paged.total ? h(EmptyState, { icon: kind === 'bug' ? 'bug' : 'task', title: filteredActive ? '没有匹配的结果' : filters.scope === 'mine' ? `暂无指派给你的${kind === 'bug' ? 'Bug' : '任务'}` : `暂无${kind === 'bug' ? 'Bug' : '任务'}`, description: filteredActive ? '试试其他关键字，或清除筛选条件。' : '同步完成后，事项会在这里显示。', action: filteredActive ? h(Button, { onClick: () => changeFilter({ ...filters, query: '', status: 'all', priority: 'all' }) }, '清除筛选') : null }) :
      h('div', { className: 'zt-table-scroll' }, h('table', { className: 'zt-table' }, h('thead', null, h('tr', null, h('th', null, kind === 'bug' ? 'Bug / 问题' : '任务 / 事项'), h('th', null, '状态'), h('th', null, '优先级'), h('th', null, '负责人'), h('th', { className: 'zt-context-col' }, kind === 'bug' ? '所属产品' : '所属项目'), h('th', { className: 'zt-date-col' }, '更新'), h('th', { className: 'zt-operations-col' }, '操作'))),
        h('tbody', null, ...paged.items.map(item => {
          const selected = selection?.kind === kind && Number(selection.id) === Number(item.id);
          const owner = item.assignedTo?.realname || item.assignedTo?.account;
          const context = kind === 'bug' ? item.productName || item.projectName || item.executionName : item.projectName || item.executionName || item.productName;
          return h('tr', { key: `${kind}-${item.id}`, className: selected ? 'zt-row-selected' : '', onClick: () => onSelect({ kind, id: item.id }), 'aria-selected': selected },
            h('td', { className: 'zt-item-cell' }, h('span', { className: 'zt-item-id' }, `#${item.id}`), h('button', { type: 'button', className: 'zt-item-link', onClick: e => { e.stopPropagation(); onSelect({ kind, id: item.id }); } }, item.title || '未命名事项'), item.deadline ? h('span', { className: 'zt-item-sub' }, `截止 ${item.deadline}`) : null),
            h('td', null, h(StatusBadge, { status: item.status })), h('td', null, h(Priority, { value: item.pri })),
            h('td', null, h('span', { className: 'zt-assignee' }, owner ? h('span', { className: 'zt-avatar', 'aria-hidden': true }, String(owner).slice(0, 1)) : null, h('span', null, owner || '未指派'))),
            h('td', { className: 'zt-context-col zt-muted', title: context }, context || '—'),
            h('td', { className: 'zt-date-col zt-muted', title: formatTime(item.lastEditedDate || item.openedDate) }, formatTime(item.lastEditedDate || item.openedDate, true)),
            h('td', { className: 'zt-operations-col' }, h(ItemActions, { kind, item, onOperate, disabled: !!busy })));

        })))), h(Pagination, { value: paged, onPage: setPage, onSize: next => { setSize(next); setPage(1); } }));
}

function NoticeList({ notifications, onRead, onSelect, busy }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const unread = asList(notifications).filter(notice => !notice.read).length;
  const notices = asList(notifications).filter(notice => (filter !== 'unread' || !notice.read) && (!query.trim() || `${notice.title} #${notice.itemId}`.toLowerCase().includes(query.trim().toLowerCase())));
  const paged = paginateItems(notices, page, size);
  return h('div', { className: 'zt-list-panel' }, h('div', { className: 'zt-filters zt-notice-toolbar' },
    h('div', { className: 'zt-scope', role: 'group', 'aria-label': '通知筛选' }, h('button', { type: 'button', 'aria-pressed': filter === 'all', onClick: () => { setFilter('all'); setPage(1); } }, '全部通知'), h('button', { type: 'button', 'aria-pressed': filter === 'unread', onClick: () => { setFilter('unread'); setPage(1); } }, `未读 ${unread}`)),
    h('label', { className: 'zt-search' }, h(Icon, { name: 'search', size: 16 }), h('input', { type: 'search', value: query, onChange: e => { setQuery(e.target.value); setPage(1); }, placeholder: '搜索通知…', 'aria-label': '搜索通知' })),
    h('button', { type: 'button', className: 'zt-button', disabled: !unread || !!busy, onClick: () => onRead({ all: true }) }, h(Icon, { name: 'check', size: 15 }), '全部已读')),
    !paged.total ? h(EmptyState, { icon: 'bell', title: filter === 'unread' ? '未读通知已处理完毕' : query ? '没有匹配的通知' : '暂时没有新通知', description: '新建、指派与重新指派的事项会汇总在这里。' }) : h('div', { className: 'zt-notices' }, ...paged.items.map(notice => h('article', { key: notice.id, className: `zt-notice ${notice.read ? 'is-read' : 'is-unread'}` },
      h('span', { className: `zt-notice-symbol zt-notice-${notice.kind}` }, h(Icon, { name: notice.kind === 'bug' ? 'bug' : 'task', size: 18 })),
      h('div', { className: 'zt-notice-body' }, h('div', { className: 'zt-notice-meta' }, h('span', { className: 'zt-notice-reason' }, NOTICE_LABELS[notice.reason] || '新指派'), h('span', null, `${notice.kind === 'bug' ? 'Bug' : '任务'} #${notice.itemId}`), h('time', { dateTime: notice.createdAt, title: formatTime(notice.createdAt) }, formatTime(notice.createdAt, true))),
        h('button', { type: 'button', className: 'zt-notice-title', onClick: () => onSelect({ kind: notice.kind, id: notice.itemId }) }, notice.title || '未命名事项'),
        h('span', { className: 'zt-notice-delivery' }, notice.delivered ? '桌宠已提醒' : '已保留在通知中心')),
      notice.read ? h('span', { className: 'zt-read-label' }, '已读') : h('button', { type: 'button', className: 'zt-text-button', disabled: !!busy, onClick: () => onRead({ ids: [notice.id] }) }, '标为已读')))),
    h(Pagination, { value: paged, onPage: setPage, onSize: next => { setSize(next); setPage(1); } }));
}

function RichText({ html, title = '描述', dark = false, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const srcDoc = useMemo(() => buildSafeDocument(html, { dark }), [html, dark]);
  if (!html) return h('p', { className: 'zt-no-description' }, `暂无${title}`);
  return h('div', { className: `zt-rich ${compact ? 'zt-rich-compact' : ''} ${expanded ? 'is-expanded' : ''}` },
    h('iframe', { title, sandbox: '', srcDoc, referrerPolicy: 'no-referrer', className: 'zt-rich-frame' }),
    !compact ? h('button', { type: 'button', className: 'zt-text-button zt-rich-expand', onClick: () => setExpanded(!expanded), 'aria-expanded': expanded }, expanded ? '收起描述' : '展开描述') : null);
}

function DetailDrawer({ selection, api, baseUrl, onClose, onOperate, busy, modalOpen = false, operationRevision = 0 }) {
  const key = `${selection.kind}:${selection.id}`;
  const [state, setState] = useState({ key: '', loading: true, data: null, error: null });
  const [section, setSection] = useState('description');
  const [retry, setRetry] = useState(0);
  const closeButton = useRef(null);
  const modal = useRef(modalOpen); modal.current = modalOpen;
  const dark = useDarkTheme();
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setState({ key, loading: true, data: null, error: null }); setSection('description');
    api.detail(selection.kind, selection.id, { signal: controller.signal }).then(data => {
      if (alive) setState({ key, loading: false, data, error: null });
    }).catch(error => { if (alive && error.name !== 'AbortError') setState({ key, loading: false, data: null, error: error.message }); });
    return () => { alive = false; controller.abort(); };
  }, [key, api, retry, operationRevision]);
  useEffect(() => {
    const doc = globalThis.document;
    if (!doc) return undefined;
    const previous = doc.activeElement;
    closeButton.current?.focus();
    const onKey = event => { if (event.key === 'Escape' && !modal.current) { event.stopPropagation(); onClose(); } };
    doc.addEventListener('keydown', onKey);
    return () => { doc.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus?.(); };
  }, [onClose]);
  const detail = state.key === key ? state.data : null;
  const loading = state.key !== key || state.loading;
  const external = detail ? safeSiteUrl(detail.url, baseUrl) : null;
  const fields = detail ? Object.entries({ 负责人: detail.assignedTo?.realname || detail.assignedTo?.account || '未指派', ...detail.fields }) : [];
  const actions = asList(detail?.actions);
  const files = asList(detail?.files);
  return h('aside', { className: 'zt-detail', role: 'region', 'aria-label': '事项详情', 'aria-busy': loading },
    h('header', { className: 'zt-detail-header' }, h('div', { className: 'zt-detail-kicker' }, h(Icon, { name: selection.kind === 'bug' ? 'bug' : 'task', size: 16 }), `${selection.kind === 'bug' ? 'Bug' : '任务'}详情`, h('span', null, `#${selection.id}`)), h('button', { type: 'button', ref: closeButton, className: 'zt-icon-button', onClick: onClose, 'aria-label': '关闭详情' }, h(Icon, { name: 'close', size: 18 }))),
    loading ? h(LoadingState, { detail: true }) : state.error ? h(EmptyState, { icon: 'alert', title: '详情加载失败', description: state.error, action: h(Button, { onClick: () => setRetry(retry + 1) }, '重试') }) : detail ?
      h('div', { className: 'zt-detail-scroll' },
        h('div', { className: 'zt-detail-heading' }, h('h2', null, detail.title || '未命名事项'), h('div', { className: 'zt-detail-badges' }, h(StatusBadge, { status: detail.status }), h(Priority, { value: detail.pri }), detail.severity ? h('span', { className: 'zt-severity' }, `严重程度 S${detail.severity}`) : null),
          external ? h('a', { href: external, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer', className: 'zt-external-link' }, '在禅道中打开', h(Icon, { name: 'external', size: 13 })) : null,
          h(ItemActions, { kind: selection.kind, item: { ...detail, id: selection.id }, onOperate, disabled: !!busy || modalOpen })),
        fields.length ? h('dl', { className: 'zt-detail-fields' }, ...fields.flatMap(([field, value]) => [h('dt', { key: `${field}-label` }, field), h('dd', { key: `${field}-value` }, label(value))])) : null,
        h('nav', { className: 'zt-detail-tabs', 'aria-label': '详情内容' }, ...[['description', selection.kind === 'bug' ? '复现步骤' : '任务描述'], ['actions', `操作记录 ${actions.length}`], ['files', `附件 ${files.length}`]].map(([id, title]) => h('button', { type: 'button', key: id, 'aria-current': section === id ? 'page' : undefined, onClick: () => setSection(id) }, title))),
        h('section', { className: 'zt-detail-section' },
          section === 'description' ? h(RichText, { html: detail.html, title: selection.kind === 'bug' ? '复现步骤' : '任务描述', dark }) : null,
          section === 'actions' ? !actions.length ? h(EmptyState, { icon: 'clock', title: '暂无操作记录' }) : h('ol', { className: 'zt-timeline' }, ...actions.map((action, i) => h('li', { key: action.id || i }, h('span', { className: 'zt-timeline-dot' }), h('div', { className: 'zt-action-heading' }, h('strong', null, label(action.actor)), h('span', null, label(action.action))), h('time', { dateTime: action.date }, formatTime(action.date)), action.comment ? h(RichText, { html: action.comment, title: '评论', dark, compact: true }) : null,
            action.history ? h('div', { className: 'zt-action-history' }, ...(Array.isArray(action.history) ? action.history : [action.history]).map((entry, n) => h('p', { key: n }, typeof entry === 'string' ? entry : `${label(entry.field)}：${label(entry.old)} → ${label(entry.new)}`))) : null))) : null,
          section === 'files' ? !files.length ? h(EmptyState, { icon: 'file', title: '暂无附件' }) : h('ul', { className: 'zt-files' }, ...files.map((file, i) => {
            const href = safeSiteUrl(file.url, baseUrl);
            return h('li', { key: file.id || i }, h('span', { className: 'zt-file-symbol' }, h(Icon, { name: 'file', size: 19 })), h('div', null, href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, file.title || `附件 #${file.id}`, h(Icon, { name: 'external', size: 12 })) : h('span', null, file.title || `附件 #${file.id}`), h('small', null, href ? '在禅道中查看附件' : '请在禅道详情中查看此附件')));
          })) : null)) : null);
}

function ConnectionPanel({ connection = {}, store, busy }) {
  const initial = () => ({ baseUrl: connection.baseUrl || '', account: connection.account || '', password: '' });
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  const id = React.useId ? React.useId() : 'zentao-connection';
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setDraft(initial()); }, [connection.baseUrl, connection.account, connection.hasPassword]);
  const update = patch => { setDraft(current => ({ ...current, ...patch })); setFeedback(null); };
  const sameConnection = draft.baseUrl.trim().replace(/\/*$/, '/') === (connection.baseUrl || '').replace(/\/*$/, '/') && draft.account.trim() === connection.account;
  async function save(event) {
    event.preventDefault(); if (saving || busy) return;
    setFeedback(null);
    let patch;
    try { patch = connectionPatch(draft, connection); }
    catch (error) { setFeedback({ error: true, text: error.message }); return; }
    setSaving(true);
    try {
      const result = await store.saveConnection(patch);
      if (!alive.current) return;
      if (!result) { setFeedback({ error: true, text: '连接失败，请检查网址、账号和密码后重试' }); return; }
      setDraft({ baseUrl: result.connection?.baseUrl || patch.baseUrl, account: result.connection?.account || patch.account, password: '' });
      setFeedback({ text: '连接成功，已保存并开始同步' });
    } catch { if (alive.current) setFeedback({ error: true, text: '连接失败，请检查网址、账号和密码后重试' }); }
    finally { if (alive.current) setSaving(false); }
  }
  return h('section', { className: 'zt-connection-panel' },
    h('h3', null, '禅道连接'), h('p', { className: 'zt-connection-intro' }, connection.hasPassword ? '填写禅道网址与登录账号，保存时会验证连接。' : '首次使用请填写你自己的禅道网址、账号和密码。插件不预置连接，也不会自动读取 MCP 配置。'),
    h('form', { className: 'zt-connection-form', onSubmit: save, noValidate: true, autoComplete: 'off' },
      h('label', { htmlFor: `${id}-url` }, '禅道网址'), h('input', { id: `${id}-url`, name: 'baseUrl', type: 'url', value: draft.baseUrl, placeholder: '请输入禅道网址（http:// 或 https://）', autoComplete: 'off', spellCheck: false, required: true, disabled: saving || !!busy, onChange: event => update({ baseUrl: event.target.value }) }),
      h('label', { htmlFor: `${id}-account` }, '账号'), h('input', { id: `${id}-account`, name: 'account', type: 'text', value: draft.account, autoComplete: 'off', spellCheck: false, required: true, disabled: saving || !!busy, onChange: event => update({ account: event.target.value }) }),
      h('label', { htmlFor: `${id}-password` }, '密码'), h('input', { id: `${id}-password`, name: 'password', type: 'password', value: draft.password, autoComplete: 'new-password', placeholder: sameConnection && connection.hasPassword ? '已保存密码，留空保留' : '请输入此账号的密码', required: !(sameConnection && connection.hasPassword), disabled: saving || !!busy, onChange: event => update({ password: event.target.value }) }),
      h('p', { className: 'zt-connection-help' }, '更换网址或账号时需要重新输入密码。'),
      h('div', { className: 'zt-settings-footer' }, h('span', { className: `zt-settings-feedback ${feedback?.error ? 'is-error' : ''}`, role: feedback?.error ? 'alert' : 'status', 'aria-live': 'polite' }, feedback?.text || ''), h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: saving || !!busy }, saving ? '验证并保存中…' : '保存连接'))));
}

function WorkspaceEntry({ openWorkspace, openPackage }) {
  const dark = useDarkTheme();
  const [failed, setFailed] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    try {
      if (typeof openWorkspace !== 'function') { setFailed(true); return; }
      // rc5 remembers the selected business tab across panel changes. Its public
      // openPackage action resets that tab before leaving the Plugins page.
      if (typeof openPackage === 'function') openPackage('dsh-zentao');
      openWorkspace(); opened.current = true;
    } catch { setFailed(true); }
  }, [openWorkspace, openPackage]);
  return h('div', { className: 'zt-app zt-config-app zt-workspace-entry', 'data-theme': dark ? 'dark' : 'light' }, h(EmptyState, { icon: 'grid', title: failed ? '请从侧栏打开禅道工作台' : '正在打开禅道工作台…', description: failed ? '禅道工作台会在右侧主区域完整显示。' : undefined, action: failed && openWorkspace ? h(Button, { onClick: openWorkspace }, '打开禅道工作台') : null }));
}

function PetAlertFields({ kind, profile, pet, loading, disabled, api, id, onChange, onUploading }) {
  const title = kind === 'bug' ? 'Bug' : '任务';
  const animations = asList(pet?.animations).filter(value => typeof value === 'string' && value);
  const images = asList(pet?.images).filter(value => typeof value?.name === 'string' && value.name);
  const recommended = animations.find(value => /jump|wave|dance|shake|bounce|excite|跳|挥|舞|摇|蹦/i.test(value));
  const knownAnimation = !profile.animation || animations.includes(profile.animation);
  const selectedImage = images.find(image => image.name === profile.image);
  const [upload, setUpload] = useState({ busy: false, error: '', text: '', id: '', url: '' });
  const [failedPreview, setFailedPreview] = useState('');
  const alive = useRef(true);
  const activeUpload = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; activeUpload.current?.reader?.abort(); activeUpload.current?.controller.abort(); };
  }, []);
  const previewUrl = profile.imageType === 'upload' && /^[a-f\d]{64}$/i.test(profile.image)
    ? upload.id === profile.image ? upload.url : `/api/zentao/pet-image?id=${profile.image}`
    : profile.imageType === 'meme' && selectedImage && typeof pet?.assetRoot === 'string'
      ? `/dsh-pet-7340/pic/memes/${encodeURIComponent(pet.assetRoot)}/${encodeURIComponent(selectedImage.name)}.png`
      : profile.imageType === 'url' ? safePetImageUrl(profile.image) : null;
  useEffect(() => { setFailedPreview(''); }, [previewUrl]);
  const change = patch => { setUpload(current => ({ ...current, error: '', text: '' })); onChange(patch); };
  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled || activeUpload.current) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setUpload(current => ({ ...current, error: '请选择 PNG、JPEG、GIF 或 WebP 图片。', text: '' })); return;
    }
    if (!file.size || file.size > 2 * 1024 * 1024) {
      setUpload(current => ({ ...current, error: '图片不能为空，大小须不超过 2 MiB。', text: '' })); return;
    }
    const operation = { reader: null, controller: new AbortController() };
    activeUpload.current = operation;
    setUpload(current => ({ ...current, busy: true, error: '', text: '' })); setFailedPreview(''); onUploading(kind, true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); operation.reader = reader;
        reader.onload = () => {
          const match = typeof reader.result === 'string' && reader.result.match(/^data:[^,]*;base64,([a-z\d+/]+={0,2})$/i);
          if (match) resolve(match[1]); else reject(new Error('读取图片失败，请重新选择图片。'));
        };
        reader.onerror = () => reject(new Error('读取图片失败，请重新选择图片。'));
        reader.onabort = () => { const error = new Error('上传已取消'); error.name = 'AbortError'; reject(error); };
        reader.readAsDataURL(file);
      });
      if (!alive.current || operation.controller.signal.aborted) return;
      const result = await api.uploadPetImage({ data }, { signal: operation.controller.signal });
      if (!alive.current || activeUpload.current !== operation) return;
      if (!/^[a-f\d]{64}$/i.test(result?.id) || result.url !== `/api/zentao/pet-image?id=${result.id}`) throw new Error('上传响应无效，请重新上传。');
      onChange({ imageType: 'upload', image: result.id });
      setUpload({ busy: true, error: '', text: '图片已上传，保存设置后用于提醒。', id: result.id, url: result.url });
    } catch (error) {
      if (alive.current && error.name !== 'AbortError') setUpload(current => ({ ...current, error: error.message || '上传失败，请重试。', text: '' }));
    } finally {
      if (activeUpload.current === operation) {
        activeUpload.current = null;
        if (alive.current) { setUpload(current => ({ ...current, busy: false })); onUploading(kind, false); }
      }
    }
  }
  const imageHelp = profile.imageType === 'none' ? '头顶气泡仅显示提醒文字。'
    : profile.imageType === 'meme' ? selectedImage?.description || (profile.image ? '当前桌宠暂不提供此池图，原选择会保留。' : '选择当前桌宠表情池中的图片。')
      : profile.imageType === 'upload' ? '支持 PNG、JPEG、GIF、WebP，最多 2 MiB；上传后仍需保存设置。'
        : '仅支持 HTTP / HTTPS，不含用户名、密码或片段（#）。';
  return h('fieldset', { className: 'zt-pet-alert-fields' },
    h('legend', null, h(Icon, { name: kind === 'bug' ? 'bug' : 'task', size: 15 }), `${title}提醒`),
    h('div', { className: 'zt-pet-alert-inputs' },
      h('div', { className: 'zt-pet-alert-field' }, h('label', { htmlFor: `${id}-animation` }, '提醒动作'),
        h('select', { id: `${id}-animation`, value: profile.animation, disabled: disabled || loading, onChange: event => change({ animation: event.target.value }) },
          h('option', { value: '' }, '不额外播放动作'),
          !knownAnimation ? h('option', { value: profile.animation }, `${profile.animation}（当前桌宠暂不提供，保留原选择）`) : null,
          ...animations.map(animation => h('option', { key: animation, value: animation }, `${animation}${animation === recommended ? '（推荐尝试）' : ''}`))),
        h('p', { className: 'zt-pet-alert-help' }, '可尝试跳跃、挥手等较明显的已有动作；具体表现与播放时长由桌宠决定。')),
      h('div', { className: 'zt-pet-alert-field' }, h('label', { htmlFor: `${id}-image-type` }, '气泡配图'),
        h('select', { id: `${id}-image-type`, value: profile.imageType, disabled: disabled || upload.busy, onChange: event => change({ imageType: event.target.value, image: '' }) },
          ...[['none', '不配图'], ['meme', '桌宠表情池'], ['upload', '上传图片'], ['url', '图片网址']].map(([value, caption]) => h('option', { value, key: value }, caption))),
        h('p', { id: `${id}-image-help`, className: 'zt-pet-alert-help' }, imageHelp)),
      profile.imageType === 'meme' ? h('div', { className: 'zt-pet-alert-field zt-pet-alert-wide' },
        h('label', { htmlFor: `${id}-meme` }, '表情池图片'),
        h('select', { id: `${id}-meme`, value: profile.image, disabled: disabled || loading, 'aria-describedby': `${id}-image-help`, onChange: event => change({ image: event.target.value }) },
          h('option', { value: '' }, images.length ? '请选择图片' : '当前桌宠没有可用池图'),
          profile.image && !selectedImage ? h('option', { value: profile.image }, `${profile.image}（当前桌宠暂不提供，保留原选择）`) : null,
          ...images.map(image => h('option', { key: image.name, value: image.name, title: image.description }, image.description ? `${image.name} · ${image.description}` : image.name)))) : null,
      profile.imageType === 'upload' ? h('div', { className: 'zt-pet-alert-field zt-pet-alert-wide', 'aria-busy': upload.busy },
        h('label', { htmlFor: `${id}-upload` }, profile.image ? '替换上传图片' : '上传图片'),
        h('input', { id: `${id}-upload`, type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', disabled: disabled || upload.busy, 'aria-describedby': `${id}-image-help ${id}-upload-status`, onChange: uploadImage }),
        h('span', { id: `${id}-upload-status`, className: `zt-pet-upload-status ${upload.error ? 'is-error' : ''}`, role: upload.error ? 'alert' : 'status', 'aria-live': 'polite' }, upload.busy ? '正在读取并上传图片…' : upload.error || upload.text || (profile.image ? '已选择上传图片，可在下方预览。' : '尚未选择图片。'))) : null,
      profile.imageType === 'url' ? h('div', { className: 'zt-pet-alert-field zt-pet-alert-wide' },
        h('label', { htmlFor: `${id}-url` }, '图片网址'),
        h('input', { id: `${id}-url`, type: 'url', value: profile.image, placeholder: 'https://example.com/image.png', disabled, autoComplete: 'off', spellCheck: false, 'aria-describedby': `${id}-image-help`, 'aria-invalid': !!profile.image && !safePetImageUrl(profile.image), onChange: event => change({ image: event.target.value }) }),
        profile.image && !safePetImageUrl(profile.image) ? h('p', { className: 'zt-pet-upload-status is-error', role: 'status' }, '请输入有效的 HTTP / HTTPS 图片网址，不含用户名、密码或片段（#）。') : null) : null),
    h('figure', { className: 'zt-pet-image-preview' },
      previewUrl && failedPreview !== previewUrl ? h('img', { src: previewUrl, alt: `${title}提醒的气泡配图预览`, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer', onError: () => setFailedPreview(previewUrl) }) : h('span', { className: 'zt-pet-preview-placeholder' }, previewUrl ? '图片加载失败，请检查图片或网址。' : profile.imageType === 'none' ? '仅文字提醒' : '选择图片后在此预览'),
      h('figcaption', null, '气泡配图预览 · 外形由桌宠负责')));
}

function SettingsPanel({ settings = {}, connection, store, api, busy }) {
  const initial = (value = settings) => ({ pollSeconds: value.pollSeconds ?? 45, notificationsEnabled: value.notificationsEnabled !== false, petEnabled: value.petEnabled !== false, petId: value.petId || '', petDurationSeconds: value.petDurationSeconds ?? 10, petAlerts: petAlertsDraft(value.petAlerts) });
  // Canonical field order avoids resetting the draft for fresh objects returned by polling.
  const savedKey = JSON.stringify(initial());
  const [draft, setDraft] = useState(initial);
  const [pets, setPets] = useState({ loading: true, available: false, pets: [], error: null });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [uploading, setUploading] = useState({ task: false, bug: false });
  const [resetRevision, setResetRevision] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  const dirty = useRef(false);
  const uploads = useRef({ task: false, bug: false });
  const testController = useRef(null);
  const id = React.useId ? React.useId() : 'zentao-settings';
  useEffect(() => { if (!dirty.current && !Object.values(uploads.current).some(Boolean)) setDraft(initial()); }, [savedKey]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    api.pets({ signal: controller.signal }).then(data => { if (alive.current) setPets({ ...data, pets: asList(data.pets), loading: false }); }).catch(error => { if (alive.current && error.name !== 'AbortError') setPets({ loading: false, available: false, pets: [], error: error.message }); });
    return () => { alive.current = false; controller.abort(); testController.current?.abort(); };
  }, [api]);
  const update = patch => { dirty.current = true; setDraft(current => ({ ...current, ...patch })); setFeedback(null); };
  const updateProfile = (kind, patch) => {
    dirty.current = true;
    setDraft(current => ({ ...current, petAlerts: { ...current.petAlerts, [kind]: { ...current.petAlerts[kind], ...patch } } })); setFeedback(null);
  };
  const uploadStatus = (kind, pending) => {
    uploads.current = { ...uploads.current, [kind]: pending }; setUploading(uploads.current);
    if (pending) { dirty.current = true; setFeedback(null); }
  };
  const hasUpload = uploading.task || uploading.bug;
  async function save(event) {
    event.preventDefault();
    if (saving || busy || Object.values(uploads.current).some(Boolean)) return;
    setFeedback(null);
    let patch;
    try { patch = settingsPatch(draft); } catch (error) { setFeedback({ error: true, text: error.message }); return; }
    setSaving(true);
    try {
      const result = await store.saveSettings(patch);
      if (!alive.current) return;
      if (result) { dirty.current = false; setDraft(initial(result.settings || patch)); setFeedback({ text: '设置已保存，立即生效' }); }
      else setFeedback({ error: true, text: '保存失败，请检查连接后重试' });
    } catch (error) { if (alive.current) setFeedback({ error: true, text: error.message }); }
    finally { if (alive.current) setSaving(false); }
  }
  function reset(event) {
    event.preventDefault();
    if (saving || busy || Object.values(uploads.current).some(Boolean)) return;
    dirty.current = false; setDraft(initial()); setResetRevision(current => current + 1); setFeedback({ text: '表单已恢复为已保存设置' });
  }
  async function testPet(kind) {
    if (testController.current || saving || busy) return;
    setTesting(kind); setFeedback(null);
    const controller = new AbortController(); testController.current = controller;
    const title = kind === 'bug' ? 'Bug' : '任务';
    try {
      const result = await api.petTest({ kind, signal: controller.signal });
      if (!alive.current) return;
      if (result?.accepted !== true) throw new Error(`${title}测试请求未被受理`);
      setFeedback(result.warning ? { warning: true, text: `${title}测试请求已受理，但有提示：${result.warning}` } : { text: `${title}测试请求已受理（使用已保存设置）` });
    } catch (error) { if (alive.current && error.name !== 'AbortError') setFeedback({ error: true, text: error.message }); }
    finally { if (testController.current === controller) testController.current = null; if (alive.current) setTesting(null); }
  }
  const desktopPets = asList(pets.pets).filter(pet => ['desktop', 'both'].includes(pet.display));
  const selectedPet = draft.petId ? desktopPets.find(pet => pet.id === draft.petId) : desktopPets[0];
  const knownPet = desktopPets.some(pet => pet.id === draft.petId);
  return h('div', { className: 'zt-settings' }, h('div', { className: 'zt-settings-heading' }, h('span', { className: 'zt-settings-symbol' }, h(Icon, { name: 'settings', size: 22 })), h('div', null, h('h2', null, '同步与提醒设置'), h('p', null, '让工作进展保持同步，让提醒恰到好处。'))),
    h(ConnectionPanel, { connection, store, busy }),
    h('form', { className: 'zt-sync-form', onSubmit: save, onReset: reset, noValidate: true },
      h('section', { className: 'zt-settings-section' }, h('h3', null, '同步'), h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { htmlFor: `${id}-poll` }, '后台轮询间隔'), h('p', null, '每次同步任务与 Bug；可设置 30～60 秒。')), h('div', { className: 'zt-number-input' }, h('input', { id: `${id}-poll`, type: 'number', min: 30, max: 60, step: 1, inputMode: 'numeric', value: draft.pollSeconds, disabled: saving || !!busy, onChange: e => update({ pollSeconds: e.target.value }), 'aria-label': '后台轮询间隔（秒）' }), h('span', null, '秒')))),
      h('section', { className: 'zt-settings-section' }, h('h3', null, '通知与桌宠'),
        h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { id: `${id}-notifications` }, '接收新事项提醒'), h('p', null, '追踪新建、指派和重新指派给你的事项。')), h('button', { type: 'button', role: 'switch', 'aria-checked': draft.notificationsEnabled, 'aria-labelledby': `${id}-notifications`, className: 'zt-switch', disabled: saving || !!busy, onClick: () => update({ notificationsEnabled: !draft.notificationsEnabled }) }, h('span', null))),
        h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { id: `${id}-pet` }, '桌宠头顶图文气泡'), h('p', null, '按任务、Bug 分开展示新事项；气泡外形由桌宠负责，不可用时仍保留通知。')), h('button', { type: 'button', role: 'switch', 'aria-checked': draft.petEnabled, 'aria-labelledby': `${id}-pet`, className: 'zt-switch', disabled: saving || !!busy, onClick: () => update({ petEnabled: !draft.petEnabled }) }, h('span', null))),
        h('div', { className: 'zt-setting-row zt-setting-pet' }, h('div', null, h('label', { htmlFor: `${id}-pet-target` }, '提醒桌宠'), h('p', null, pets.loading ? '正在读取可用桌宠…' : pets.available ? '自动选择首个支持桌面提醒的桌宠。' : '桌宠暂不可用，事项与通知仍可正常查看。')), h('select', { id: `${id}-pet-target`, value: draft.petId, disabled: saving || !!busy || pets.loading || !draft.petEnabled, onChange: e => update({ petId: e.target.value }) }, h('option', { value: '' }, '自动'), !knownPet && draft.petId ? h('option', { value: draft.petId }, `${draft.petId}（已保存，当前桌面不可用）`) : null, ...desktopPets.map(pet => h('option', { value: pet.id, key: pet.id }, pet.name || pet.id)))),
        pets.error ? h('p', { className: 'zt-inline-warning', role: 'status' }, pets.error) : null,
        h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { htmlFor: `${id}-pet-duration` }, '气泡显示时长'), h('p', null, '可设置 5～120 秒，默认 10 秒；这不决定动作的播放时长。')), h('div', { className: 'zt-number-input' }, h('input', { id: `${id}-pet-duration`, type: 'number', min: 5, max: 120, step: 1, inputMode: 'numeric', value: draft.petDurationSeconds, disabled: saving || !!busy, onChange: event => update({ petDurationSeconds: event.target.value }), 'aria-label': '气泡显示时长（秒）' }), h('span', null, '秒'))),
        h('p', { className: 'zt-pet-catalog-help', role: 'status' }, pets.loading ? '正在读取动作和表情池…' : selectedPet ? `当前动作与表情池：${selectedPet.name || selectedPet.id}。切换桌宠会保留原选择，暂不支持的项会注明。` : '当前桌宠没有可枚举的桌面动作或表情池，已保存的选择会保留；仍可配置上传图片或图片网址。'),
        h('div', { className: 'zt-pet-alert-profiles' }, ...['task', 'bug'].map(kind => h(PetAlertFields, { key: `${kind}:${resetRevision}`, kind, profile: draft.petAlerts[kind], pet: selectedPet, loading: pets.loading, disabled: saving || !!busy, api, id: `${id}-${kind}`, onChange: patch => updateProfile(kind, patch), onUploading: uploadStatus }))),
        h('div', { className: 'zt-pet-test' }, h('p', null, '以下测试使用已保存设置。修改或上传图片后，请先保存，再手动测试对应提醒。'),
          h('div', { className: 'zt-pet-test-actions' }, ...[['task', '测试任务提醒'], ['bug', '测试 Bug 提醒']].map(([kind, caption]) => h('button', { key: kind, type: 'button', className: 'zt-button', disabled: !!testing || saving || !!busy || !pets.available, onClick: () => testPet(kind) }, h(Icon, { name: 'spark', size: 15 }), testing === kind ? '正在发送…' : caption))))),
      h('section', { className: 'zt-settings-section zt-connection' }, h('h3', null, '连接状态'), h('div', { className: 'zt-credential-status' }, h('i', { className: settings.hasCredentials ? 'is-ready' : '' }), settings.hasCredentials ? '宿主已读取连接凭据' : '尚未配置连接凭据'), h('p', null, '连接文件由宿主管理'), h('code', null, settings.connectionFile || '默认连接文件')),
      h('div', { className: 'zt-settings-footer' }, h('span', { className: `zt-settings-feedback ${feedback?.error ? 'is-error' : feedback?.warning ? 'is-warning' : ''}`, role: feedback?.error ? 'alert' : 'status', 'aria-live': 'polite' }, feedback?.text || (hasUpload ? '图片上传中，请完成后保存设置' : '保存后立即生效')),
        h('div', { className: 'zt-settings-actions' }, h('button', { type: 'reset', className: 'zt-button', disabled: saving || !!busy || hasUpload }, '恢复已保存设置'), h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: saving || !!busy || hasUpload }, saving ? '正在保存…' : '保存设置')))));
}

function overviewScope(data = {}) {
  return `${data.baseUrl || data.connection?.baseUrl || ''}\n${data.account || data.connection?.account || ''}\n${data.scopeKey || ''}`;
}

function ZentaoApp({ store, api, settingsOnly = false }) {
  const [snapshot, setSnapshot] = useState(store.getSnapshot);
  const [tab, setTab] = useState(settingsOnly ? 'settings' : 'task');
  const [filters, setFilters] = useState({ task: { query: '', status: 'all', priority: 'all', scope: 'mine' }, bug: { query: '', status: 'all', priority: 'all', scope: 'mine' } });
  const [selected, setSelection] = useState(null);
  const [operationSelection, setOperationSelection] = useState(null);
  const [operationFeedback, setOperationFeedback] = useState(null);
  const [operationRevision, setOperationRevision] = useState(0);
  const currentScope = useRef('');
  const dark = useDarkTheme();
  useEffect(() => { const off = store.subscribe(() => setSnapshot(store.getSnapshot())); setSnapshot(store.getSnapshot()); return off; }, [store]);
  const needsConnection = snapshot.data?.settings?.hasCredentials === false;
  useEffect(() => { if (needsConnection) setTab('settings'); }, [needsConnection]);
  const data = snapshot.data || EMPTY;
  const scope = overviewScope(data); currentScope.current = scope;
  const selection = selected?.scope === scope ? selected : null;
  const operation = operationSelection?.scope === scope ? operationSelection : null;
  const modalOpen = !!operation;
  const feedback = operationFeedback?.scope === scope ? operationFeedback : null;
  useEffect(() => { setSelection(null); setOperationSelection(null); setOperationFeedback(null); }, [scope]);
  const counts = summarize(data);
  const status = data.status || {};
  const error = snapshot.error || status.error;
  const loading = !snapshot.data && (snapshot.loading || !snapshot.error);
  const syncing = snapshot.busy === 'refresh' || status.syncing;
  const connectionState = error ? 'offline' : syncing ? 'syncing' : status.lastSuccessAt ? 'online' : 'waiting';
  const changeTab = next => { setTab(next); if (next === 'settings') setSelection(null); };
  const selectItem = next => setSelection({ ...next, scope });
  const closeDetail = useMemo(() => () => setSelection(null), []);
  const openOperation = next => {
    if (store.getSnapshot().busy || modalOpen) return;
    setOperationFeedback(null); setOperationSelection({ ...next, scope, hostScope: data.scopeKey });
  };
  const operationApplied = (result, completed) => {
    // Ignore a late response after another panel or the Host switched connections.
    if (completed.scope !== currentScope.current || completed.scope !== overviewScope(store.getSnapshot().data || EMPTY)) return;
    let warning = result.warning || '';
    if (!result.overview || overviewScope(result.overview) !== completed.scope || !store.acceptOverview(result.overview)) warning = [warning, '操作已生效，列表尚未刷新，请同步后核对。'].filter(Boolean).join(' ');
    setOperationRevision(value => value + 1); setOperationSelection(null);
    setOperationFeedback({ scope: completed.scope, warning: !!warning, text: `${completed.label}已应用到${completed.kind === 'bug' ? 'Bug' : '任务'} #${completed.id}。${warning ? ` ${warning}` : ''}` });
  };
  const myTaskTotal = filterItems(data.tasks, { scope: 'mine' }, data.account).length;
  const myBugTotal = filterItems(data.bugs, { scope: 'mine' }, data.account).length;
  const navigation = [['task', '任务', myTaskTotal, 'task'], ['bug', 'Bug', myBugTotal, 'bug'], ['notifications', '通知', counts.unread, 'bell']];
  return h('div', { className: `zt-app ${settingsOnly ? 'zt-config-app' : ''}`, 'data-theme': dark ? 'dark' : 'light' },
    h('div', { className: 'zt-app-content', inert: modalOpen ? '' : undefined, 'aria-hidden': modalOpen ? true : undefined },
    h('header', { className: 'zt-header' }, h('div', { className: 'zt-title-group' }, h('span', { className: 'zt-brand' }, h(Icon, { name: 'grid', size: 24 })), h('div', null, h('div', { className: 'zt-title-line' }, h('h1', null, '禅道'), h('span', { className: `zt-connection-pill is-${connectionState}`, role: 'status' }, h('i', null), error ? '离线' : needsConnection ? '待配置' : syncing ? '同步中' : status.lastSuccessAt ? '已连接' : loading ? '连接中' : '等待同步')), h('p', null, settingsOnly ? '连接你的工作，管理同步与提醒。' : '把待办、问题与进展，放在同一个地方。'))),
      h('div', { className: 'zt-header-actions' }, data.account ? h('span', { className: 'zt-account', title: data.account }, h(Icon, { name: 'user', size: 14 }), data.account) : null,
        h(Button, { icon: 'refresh', onClick: () => store.refresh(), disabled: needsConnection || syncing || !!snapshot.busy, className: syncing ? 'zt-is-syncing' : '' }, syncing ? '同步中…' : '立即同步'),
        !settingsOnly ? h('button', { type: 'button', className: `zt-icon-button ${tab === 'settings' ? 'is-active' : ''}`, onClick: () => changeTab(tab === 'settings' ? 'task' : 'settings'), 'aria-label': '同步与提醒设置', title: '设置', 'aria-pressed': tab === 'settings' }, h(Icon, { name: 'settings', size: 18 })) : null)),
    !settingsOnly ? h('div', { className: 'zt-stats' }, ...[[counts.tasks, '我的待办任务', 'task', 'task'], [counts.bugs, '我的待处理 Bug', 'bug', 'bug'], [counts.urgent, '优先级 P1', 'spark', 'urgent'], [counts.unread, '未读通知', 'bell', 'notice']].map(([count, title, icon, tone]) => h('div', { className: `zt-stat zt-stat-${tone}`, key: tone }, h('span', { className: 'zt-stat-icon' }, h(Icon, { name: icon, size: 19 })), h('div', null, h('span', { className: 'zt-stat-label' }, title), h('strong', null, loading ? '—' : count))))) : null,
    error ? h(ErrorBanner, { error, stale: !!snapshot.data && !!status.lastSuccessAt, onRetry: () => store.reload() }) : null,
    status.petError ? h('div', { className: 'zt-pet-warning', role: 'status' }, h(Icon, { name: 'bell', size: 14 }), `桌宠提醒暂不可用：${status.petError}。通知已保留。`) : null,
    feedback ? h('div', { className: `zt-operation-feedback ${feedback.warning ? 'is-warning' : feedback.error ? 'is-error' : 'is-success'}`, role: feedback.error ? 'alert' : 'status', 'aria-live': 'polite' }, h('p', null, feedback.text), h('button', { type: 'button', className: 'zt-icon-button', 'aria-label': '关闭操作反馈', onClick: () => setOperationFeedback(null) }, '×')) : null,
    h('section', { className: `zt-workspace ${selection && tab !== 'settings' ? 'has-detail' : ''}` },
      h('div', { className: 'zt-workspace-main' },
        !settingsOnly ? h('div', { className: 'zt-workspace-nav' }, h('nav', { className: 'zt-tabs', 'aria-label': '禅道事项' }, ...navigation.map(([id, title, count, icon]) => h('button', { type: 'button', key: id, 'aria-current': tab === id ? 'page' : undefined, onClick: () => changeTab(id) }, h(Icon, { name: icon, size: 16 }), title, h('span', { className: id === 'notifications' && count ? 'zt-tab-count is-unread' : 'zt-tab-count', title: id === 'task' ? '指派给我的任务总数' : id === 'bug' ? '指派给我的 Bug 总数' : '我的未读通知数' }, count)))), h('span', { className: 'zt-readonly-hint' }, '实时掌握工作进展')) : null,
        tab === 'settings' ? loading ? h(LoadingState) : h(SettingsPanel, { settings: data.settings, connection: data.connection || { baseUrl: data.baseUrl, account: data.account, hasPassword: !!data.settings?.hasCredentials }, store, api, busy: snapshot.busy }) : null,
        tab === 'task' || tab === 'bug' ? h(ItemList, { key: `${scope}:${tab}`, items: tab === 'task' ? data.tasks : data.bugs, kind: tab, filters: filters[tab], onFilter: value => setFilters(current => ({ ...current, [tab]: value })), account: data.account, selection, onSelect: selectItem, loading, onOperate: openOperation, busy: snapshot.busy || modalOpen }) : null,
        tab === 'notifications' ? loading ? h(LoadingState) : h(NoticeList, { notifications: data.notifications, onRead: value => store.markRead(value), onSelect: selectItem, busy: snapshot.busy }) : null),
      selection && tab !== 'settings' ? h(DetailDrawer, { key: `${scope}:${selection.kind}:${selection.id}`, selection, api, baseUrl: data.baseUrl || data.connection?.baseUrl, onClose: closeDetail, onOperate: openOperation, busy: snapshot.busy, modalOpen, operationRevision }) : null),
    h('footer', { className: 'zt-footer' }, h('span', { className: 'zt-last-sync' }, h(Icon, { name: 'clock', size: 12 }), `最近成功同步：${status.lastSuccessAt ? formatTime(status.lastSuccessAt) : '尚未成功同步'}`), h('span', null, needsConnection ? '填写并保存禅道连接后开启自动同步' : data.settings?.pollSeconds ? `每 ${data.settings.pollSeconds} 秒同步` : '自动同步', status.nextSyncAt ? ` · 下次 ${formatTime(status.nextSyncAt, true)}` : ''))),
    operation ? h(OperationDialog, { key: `${operation.scope}:${operation.kind}:${operation.id}`, selection: operation, api, store, baseUrl: data.baseUrl || data.connection?.baseUrl, busy: snapshot.busy, onDismiss: () => setOperationSelection(null), onApplied: operationApplied, onFeedback: value => { if (value.scope === currentScope.current) setOperationFeedback(value); } }) : null);
}

function acquireStyles() {
  const doc = globalThis.document;
  if (!doc || typeof STYLES !== 'string') return () => {};
  let owner = styleOwners.get(doc);
  if (!owner) {
    const node = doc.createElement('style'); node.setAttribute('data-dsh-zentao', ''); node.textContent = STYLES;
    doc.head.append(node); owner = { count: 0, node }; styleOwners.set(doc, owner);
  }
  owner.count++;
  return () => { if (--owner.count === 0) { owner.node.remove(); styleOwners.delete(doc); } };
}

function apply(ctx) {
  if (installed.has(ctx)) return;
  const disposeMarker = {}; installed.set(ctx, disposeMarker);
  ctx.effect(() => {
    let alive = true;
    const disposers = [];
    const api = createApi();
    const store = createOverviewStore({ api });
    const own = off => { if (typeof off === 'function') disposers.push(off); };
    own(acquireStyles());
    own(ctx.locale.register('zentao', { zh: { nav: '禅道', settings: '同步与提醒' }, en: { nav: 'Zentao', settings: 'Sync & notifications' } }));
    const t = ctx.locale.bind('zentao');
    const registration = new Map();
    function wait(slot, setup) {
      own(ctx.slots.inject(slot, () => {
        if (!alive || registration.has(slot)) return;
        const generationDisposers = [];
        const release = () => {
          if (registration.get(slot) !== release) return;
          registration.delete(slot);
          for (const off of generationDisposers.splice(0).reverse()) off();
        };
        registration.set(slot, release);
        // rc5 owns this callback's effect scope. Its cleanup must release the
        // generation marker too, so a later declaration can register again.
        try {
          setup(off => { if (typeof off === 'function') generationDisposers.push(off); });
        } catch (error) { release(); throw error; }
        return release;
      }));
    }
    const render = props => h(ZentaoApp, { ...props, store, api });
    const openWorkspace = typeof ctx.layout?.selectPanel === 'function' ? () => ctx.layout.selectPanel('zentao') : undefined;
    wait('sidebar.panellist', ownSlot => {
      ownSlot(ctx.slots.register({ name: 'main', key: 'zentao', locale: 'zentao', inject: () => ({ t }) }, () => render({})));
      ownSlot(ctx.slots.register({ name: 'sidebar.panellist', id: 'zentao', order: 30, label: () => t('nav'), locale: 'zentao' }, (owner = {}) => h(Icon, { name: 'grid', size: owner.size || 18 })));
    });
    wait('plugins.tab', ownSlot => ownSlot(ctx.slots.register({ name: 'plugins.tab', id: 'zentao', order: 30, label: () => t('nav'), locale: 'zentao', inject: () => ({ t }) }, (owner = {}) => h(WorkspaceEntry, { openWorkspace, openPackage: owner.openPackage }))));
    wait('plugins.bundle.config', ownSlot => ownSlot(ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-zentao', locale: 'zentao', inject: () => ({ t }) }, (owner = {}) => owner.view === 'summary' ? null : render({ settingsOnly: true }))));
    return () => {
      alive = false; store.dispose();
      for (const release of [...registration.values()].reverse()) release();
      for (const off of disposers.reverse()) off();
      if (installed.get(ctx) === disposeMarker) installed.delete(ctx);
    };
  }, 'zentao: client interface');
}

module.exports = { name, inject, apply, ...model, ZentaoApp, WorkspaceEntry, ConnectionPanel, DetailDrawer, SettingsPanel, NoticeList, ItemList, RichText, ItemActions, OperationDialog };

})(localRequire,module,module.exports);
return module.exports;
}});
