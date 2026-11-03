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
          if (tag === 'a') { node.replaceWith(doc.createTextNode(node.textContent)); continue; }
          clean(node);
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
      try { payload = await response.json(); } catch { throw new Error(`服务返回了无效响应（HTTP ${response.status}）`); }
      if (!response.ok || payload?.ok !== true) throw new Error(typeof payload?.error === 'string' ? payload.error : `请求失败，服务响应异常（HTTP ${response.status}）`);
      if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error('服务响应缺少数据');
      return payload.data;
    } catch (error) {
      if (timedOut) throw new Error('请求超时，请检查连接后重试');
      if (signal?.aborted) { const aborted = new Error('请求已取消'); aborted.name = 'AbortError'; throw aborted; }
      if (error?.name === 'TypeError') throw new Error('无法连接插件服务，请检查网络后重试');
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
  let timer = null, active = null, revision = 0, disposed = false;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const schedule = () => {
    clearTimer();
    if (listeners.size && !disposed) timer = later(() => { timer = null; run('overview'); }, pollMs);
  };
  async function run(method, body) {
    if (disposed) return null;
    if (state.busy && method === 'overview') return null;
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
    state = { ...state, loading: false, busy: null };
  }
  return {
    getSnapshot: () => state,
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
