import { createHash } from 'node:crypto';

const user = value => value && typeof value === 'object' ? { account: String(value.account || ''), realname: String(value.realname || '') } : { account: value == null ? '' : String(value), realname: '' };
const text = value => value == null ? '' : String(value);
export function normalizeItem(kind, raw, extra = {}) {
  return { kind, id: Number(raw.id), title: text(raw.name || raw.title), status: text(raw.status), pri: Number(raw.pri) || 0,
    assignedTo: user(raw.assignedTo), assignedDate: text(raw.assignedDate), openedDate: text(raw.openedDate), lastEditedDate: text(raw.lastEditedDate),
    projectName: text(raw.projectName || extra.projectName), productName: text(raw.productName || extra.productName), executionName: text(raw.executionName || extra.executionName),
    estimate: text(raw.estimate), consumed: text(raw.consumed), left: text(raw.left), deadline: text(raw.deadline), execution: raw.execution || 0, story: raw.story || 0,
    severity: Number(raw.severity) || 0, resolution: text(raw.resolution), resolvedDate: text(raw.resolvedDate), confirmed: Number(raw.confirmed) || 0,
    parent: Number(raw.parent) || 0, type: text(raw.type), mode: text(raw.mode), product: Number(raw.product?.id ?? raw.product) || 0, project: Number(raw.project?.id ?? raw.project) || 0 };
}
const unique = rows => [...new Map(rows.filter(row => Number.isSafeInteger(row.id) && row.id > 0).map(row => [row.id, row])).values()];

export class ZentaoClient {
  constructor({ baseUrl, account, password, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); this.account = account; this.password = password;
    this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.token = null; this.loginPromise = null;
    this.abort = new AbortController();
    this.scopeKey = createHash('sha256').update(`${this.baseUrl}\n${account}`).digest('hex');
  }
  async request(url, options = {}, mutation = false) {
    try { return await this.fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.timeoutMs)]) }); }
    catch (error) {
      if (mutation) { const pending = new Error('禅道提交结果尚未确认，操作可能已经生效。请先刷新或在禅道核对，勿直接重复提交'); pending.code = 'result-unknown'; pending.status = 504; throw pending; }
      throw new Error(error.name === 'TimeoutError' ? '禅道请求超时，请检查网络后重试' : '无法连接禅道，请检查网络及地址');
    }
  }
  async login(force = false) {
    if (this.loginPromise) return this.loginPromise;
    if (this.token && !force) return this.token;
    this.loginPromise = (async () => {
      const response = await this.request(`${this.baseUrl}/api.php/v1/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: this.account, password: this.password }) });
      if (!response.ok) throw new Error(`禅道登录失败（HTTP ${response.status}），请检查账号配置`);
      let data; try { data = await response.json(); } catch { throw new Error('禅道登录返回了无效数据'); }
      if (typeof data.token !== 'string' || !data.token) throw new Error('禅道登录未返回有效令牌');
      this.token = data.token; return this.token;
    })();
    try { return await this.loginPromise; } finally { this.loginPromise = null; }
  }
  async get(endpoint, params = {}) {
    const url = new URL(`${this.baseUrl}/api.php/v1/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    await this.login();
    let response = await this.request(url, { headers: { Token: this.token } });
    if ([401, 403].includes(response.status)) { await this.login(true); response = await this.request(url, { headers: { Token: this.token } }); }
    if (!response.ok) throw new Error(`禅道 ${endpoint} 读取失败（HTTP ${response.status}）`);
    try { return await response.json(); } catch { throw new Error(`禅道 ${endpoint} 返回了无效数据`); }
  }
  async write(endpoint, body, { method = 'POST' } = {}) {
    if (!['POST', 'PUT'].includes(method) || !/^(tasks|bugs)\/[1-9]\d*(?:\/[a-z]+)?$/.test(endpoint)) throw new Error('禅道操作接口无效');
    await this.login();
    // A business write is sent exactly once. A timeout or an unreadable success
    // response is ambiguous and must never trigger an automatic replay.
    const usedToken = this.token;
    const response = await this.request(`${this.baseUrl}/api.php/v1/${endpoint}`, { method, headers: { Token: usedToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, true);
    let data; try { data = await response.json(); } catch {
      const unknown = response.ok || response.status >= 500;
      const error = new Error(unknown ? '禅道已响应但操作结果无法识别，请先刷新或在禅道核对，勿重复提交' : `禅道操作失败（HTTP ${response.status}），请在原站检查权限与接口版本`);
      error.code = unknown ? 'result-unknown' : [404, 405].includes(response.status) ? 'unsupported' : 'remote-error'; error.status = unknown ? 502 : response.status; throw error;
    }
    if (response.status >= 500) { const error = new Error('禅道服务返回异常，操作结果尚未确认。请先刷新或在原站核对，勿重复提交'); error.code = 'result-unknown'; error.status = 502; throw error; }
    if (!response.ok || data?.status === 'fail' || data?.result === 'fail' || data?.error) {
      if (response.status === 401) this.token = null;
      const source = data?.message ?? data?.error ?? '';
      const parts = typeof source === 'string' ? [source] : source && typeof source === 'object' ? Object.entries(source).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter(item => typeof item === 'string').map(item => `${key}: ${item}`)) : [];
      let message = parts.join('；').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f]/g, ' ');
      for (const secret of [this.password, usedToken]) if (secret) message = message.split(secret).join('[已隐藏]');
      message = message.slice(0, 600);
      const reason = response.status === 403 ? '当前账号没有此操作权限' : response.status === 401 ? '登录已失效，请刷新后重新操作' : [404, 405].includes(response.status) ? '当前禅道版本未提供此操作接口，请使用原站入口' : '禅道拒绝了该操作，请检查必填项和当前状态';
      const error = new Error(`${reason}${message ? `：${message}` : ''}`); error.status = response.status >= 400 ? response.status : 422; error.code = [404, 405].includes(response.status) ? 'unsupported' : 'rejected'; throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { const error = new Error('禅道操作结果无法识别，请刷新核对后再操作'); error.code = 'result-unknown'; error.status = 502; throw error; }
    return data;
  }
  async rawItem(kind, id) {
    if (!['task', 'bug'].includes(kind)) throw new Error('对象类型无效');
    if (!/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error('对象编号无效');
    const raw = await this.get(`${kind === 'task' ? 'tasks' : 'bugs'}/${Number(id)}`); const item = raw.id ? raw : raw[kind];
    if (!item || typeof item !== 'object' || Array.isArray(item) || Number(item.id) !== Number(id)) throw new Error('禅道详情格式错误');
    return item;
  }
  async pages(endpoint, key, params = {}) {
    const all = []; const seen = new Set(); const seenIds = new Set(); let expectedTotal = null;
    for (let page = 1; page <= 1000; page++) {
      const data = await this.get(endpoint, { ...params, limit: 100, page });
      const rows = data[key];
      if (!Array.isArray(rows)) throw new Error(`禅道 ${endpoint} 列表格式错误`);
      const signature = rows.map(row => row.id).join(',');
      if (rows.length && seen.has(signature)) throw new Error(`禅道 ${endpoint} 分页返回重复数据，已保留原快照`);
      if (rows.length) seen.add(signature);
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id < 1) throw new Error(`禅道 ${endpoint} 分页包含无效编号`);
        if (seenIds.has(id)) throw new Error(`禅道 ${endpoint} 分页编号重叠，已保留原快照`);
        seenIds.add(id);
      }
      all.push(...rows);
      const total = data.total == null ? NaN : Number(data.total);
      if (Number.isFinite(total) && total >= 0) {
        if (expectedTotal !== null && expectedTotal !== total) throw new Error(`禅道 ${endpoint} 分页期间总数变化，请稍后重试`);
        expectedTotal = total;
      }
      if (expectedTotal !== null && seenIds.size >= expectedTotal) return unique(all);
      if (!rows.length) {
        if (expectedTotal !== null && all.length < expectedTotal) throw new Error(`禅道 ${endpoint} 分页不完整（${all.length}/${expectedTotal}）`);
        return unique(all);
      }
      const limit = Number(data.limit) || 100;
      if (expectedTotal === null && rows.length < limit) return unique(all);
    }
    throw new Error(`禅道 ${endpoint} 超出分页上限，已停止同步`);
  }
  async snapshot() {
    const [executions, products] = await Promise.all([this.pages('executions', 'executions'), this.pages('products', 'products')]);
    const tasks = new Map();
    // /tasks 在当前22.6站点会按账号过滤，且total与limit不可靠；执行内列表才是完整主来源。
    for (const execution of executions) {
      const rows = await this.pages(`executions/${execution.id}/tasks`, 'tasks');
      for (const row of rows) tasks.set(Number(row.id), normalizeItem('task', row, { executionName: execution.name, projectName: execution.projectName }));
    }
    // 22.6此站点的/tasks把page映射为条数：先核对回显和总量；
    // 正常分页服务器则使用常规完整翻页，任何补充扫描失败都保留旧快照。
    const first = await this.get('tasks', { limit: 100, page: 1 });
    if (!Array.isArray(first.tasks)) throw new Error('禅道任务补充列表格式错误');
    let supplement = first.tasks; const total = first.total == null ? null : Number(first.total);
    if (total !== null && supplement.length < total) {
      if (Number(first.page) === 1 && Number(first.limit) === 1 && supplement.length === 1) {
        if (!Number.isSafeInteger(total) || total > 10000) throw new Error('禅道 tasks 补充接口超出兼容扫描上限，未提交不完整数据');
        const compatible = await this.get('tasks', { limit: total, page: total });
        supplement = compatible.tasks;
        if (!Array.isArray(supplement) || Number(compatible.page) !== 1 || Number(compatible.total) !== total || supplement.length !== total) throw new Error('禅道 tasks 补充分页不完整，已保留原快照');
      } else supplement = await this.pages('tasks', 'tasks');
    }
    if (supplement.some(row => !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1) || new Set(supplement.map(row => Number(row.id))).size !== supplement.length) throw new Error('禅道 tasks 补充接口编号无效或重复');
    for (const row of supplement) if (!tasks.has(Number(row.id))) tasks.set(Number(row.id), normalizeItem('task', row));
    const bugs = [];
    for (const product of products) {
      const rows = await this.pages('bugs', 'bugs', { product: product.id });
      bugs.push(...rows.map(row => normalizeItem('bug', row, { productName: product.name })));
    }
    return { tasks: [...tasks.values()], bugs: unique(bugs), account: this.account, baseUrl: this.baseUrl, scopeKey: this.scopeKey };
  }
  async detail(kind, id) { return this.detailFromRaw(kind, id, await this.rawItem(kind, id)); }
  detailFromRaw(kind, id, item) {
    const fields = {};
    const mapping = kind === 'task' ? { '所属执行': 'executionName', '关联需求': 'storyTitle', '预计工时': 'estimate', '已消耗工时': 'consumed', '剩余工时': 'left', '截止日期': 'deadline', '创建时间': 'openedDate', '指派时间': 'assignedDate' }
      : { '所属产品': 'productName', '所属执行': 'executionName', '关联需求': 'storyTitle', '解决方案': 'resolution', '解决版本': 'resolvedBuild', '创建时间': 'openedDate', '指派时间': 'assignedDate', '解决时间': 'resolvedDate' };
    for (const [label, key] of Object.entries(mapping)) if (item[key] != null && typeof item[key] !== 'object') fields[label] = String(item[key]);
    const files = Array.isArray(item.files) ? item.files : Object.values(item.files || {});
    return { ...normalizeItem(kind, item), fields, html: text(kind === 'task' ? item.desc : item.steps),
      actions: (Array.isArray(item.actions) ? item.actions : Object.values(item.actions || {})).map(action => ({ id: action.id, date: text(action.date), actor: text(action.actor), action: text(action.action), comment: text(action.comment), history: action.history || [] })),
      files: files.map(file => ({ id: Number(file.id), title: text(file.title || file.name), url: `${this.baseUrl}/index.php?m=file&f=read&fileID=${Number(file.id)}` })).filter(file => Number.isSafeInteger(file.id) && file.id > 0),
      url: `${this.baseUrl}/index.php?m=${kind}&f=view&${kind}ID=${Number(id)}` };
  }
  async image(id) {
    if (!/^\d+$/.test(String(id)) || Number(id) < 1) throw new Error('图片编号无效');
    await this.login();
    const endpoints = [`${this.baseUrl}/api.php/v1/files/${Number(id)}`, `${this.baseUrl}/index.php?m=file&f=read&fileID=${Number(id)}`];
    for (const url of endpoints) {
      let response;
      try { response = await this.request(url, { headers: { Token: this.token } }); } catch { continue; }
      const declared = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!response.ok || !['application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(declared)) { await response.body?.cancel(); continue; }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 12 * 1024 * 1024) throw new Error('图片超过12MB显示限制'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      // This Zentao server labels file downloads octet-stream; only recognized
      // raster signatures are exposed to the browser, never SVG/HTML/XML.
      let type = null;
      if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'image/jpeg';
      else if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) type = 'image/gif';
      else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') type = 'image/webp';
      else if (bytes.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString())) type = 'image/avif';
      if (type) return { body: bytes, type };
    }
    throw new Error('当前禅道接口无法读取该图片，可在禅道原页面查看');
  }
  stop() { this.abort.abort(); }
}
