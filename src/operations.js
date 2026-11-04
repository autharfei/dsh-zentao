import { createHash } from 'node:crypto';

const accountOf = value => typeof value === 'object' && value ? String(value.account || '') : String(value ?? '');
const idOf = value => Number(typeof value === 'object' && value ? value.id : value) || 0;
const string = value => value == null ? '' : String(value);
const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function operationError(message, code = 'invalid', status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
export function validateTarget(kind, id) {
  if (!['task', 'bug'].includes(kind) || !Number.isSafeInteger(Number(id)) || Number(id) < 1 || !/^\d+$/.test(String(id))) throw operationError('任务或 Bug 编号无效');
}
function dateTime(value = new Date()) {
  const pad = part => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
function dateValue(value, time = false) {
  const text = string(value).replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}/.test(text) && !text.startsWith('0000') ? text.slice(0, time ? 19 : 10) : '';
}
export function itemVersion(raw) {
  // Include business fields, not the rendered history or ephemeral permission
  // menu, so another editor cannot silently overwrite a stale form.
  const keys = ['id', 'name', 'title', 'status', 'confirmed', 'assignedTo', 'assignedDate', 'lastEditedDate', 'estimate', 'consumed', 'left', 'deadline', 'realStarted', 'finishedDate', 'resolution', 'resolvedBuild', 'openedBuild', 'pri', 'severity', 'parent', 'team', 'mode', 'execution', 'project', 'product', 'deleted', 'toTask'];
  return createHash('sha256').update(JSON.stringify(keys.map(key => [key, raw[key] ?? null]))).digest('hex');
}
function siteUrl(client, kind, action, raw) {
  const methods = { edit: 'edit', assign: 'assignTo', start: 'start', finish: 'finish', cancel: 'cancel', pause: 'pause', restart: 'restart', activate: 'activate', close: 'close', record: 'recordWorkhour', confirm: 'confirm', resolve: 'resolve', toTask: 'toTask' };
  const url = new URL(`${client.baseUrl}/index.php`);
  if (kind === 'bug' && action === 'toTask') {
    // Conversion lives in task.create after the site selects an execution,
    // not in a bug.toTask controller. Preserve bugID for the native linkage.
    if (idOf(raw.execution) && idOf(raw.project)) {
      const params = { m: 'task', f: 'create', executionID: idOf(raw.execution), storyID: 0, moduleID: 0, taskID: 0, todoID: 0, extra: `projectID=${idOf(raw.project)}`, bugID: raw.id };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    } else { url.searchParams.set('m', 'bug'); url.searchParams.set('f', 'view'); url.searchParams.set('bugID', String(raw.id)); }
    return url.href;
  }
  url.searchParams.set('m', kind); url.searchParams.set('f', methods[action] || 'view');
  url.searchParams.set(kind === 'task' ? 'taskID' : 'bugID', String(raw.id));
  if (kind === 'task' && action === 'assign') url.searchParams.set('executionID', String(idOf(raw.execution)));
  return url.href;
}
const comment = () => ({ key: 'comment', label: '备注', type: 'textarea', max: 5000, help: '随本次操作记录到禅道。' });
const hours = (key, label, help, required = true) => ({ key, label, type: 'number', min: 0, max: 1000000, step: 'any', required, help });
const priority = () => ({ key: 'pri', label: '优先级', type: 'select', required: true, options: [0, 1, 2, 3, 4].map(value => ({ value: String(value), label: value ? `P${value}` : '未设置' })) });
function assignee(users, current, required = true) {
  const options = new Map(users.map(user => [user.account, { value: user.account, label: user.realname ? `${user.realname}（${user.account}）` : user.account }]));
  if (current && !options.has(current)) options.set(current, { value: current, label: current });
  return options.size ? { key: 'assignedTo', label: '指派给', type: 'select', required, options: [{ value: '', label: required ? '请选择账号' : '不指派' }, ...options.values()] }
    : { key: 'assignedTo', label: '指派账号', type: 'text', required, max: 100, help: '当前账号无法读取用户列表，请填写禅道登录账号。' };
}
function actionSet(client, kind, raw, users = []) {
  const status = string(raw.status), assignedTo = accountOf(raw.assignedTo), current = assignedTo || client.account;
  const stamp = dateTime(); const today = stamp.slice(0, 10); const remaining = number(raw.left);
  const actions = [];
  const add = (id, label, states, fields = [], defaults = {}, description = '') => {
    const deleted = raw.deleted === true || Number(raw.deleted) === 1; const enabled = !deleted && states.includes(status);
    actions.push({ id, label, enabled, ...(enabled ? {} : { reason: deleted ? '对象已删除' : `当前状态（${status || '未知'}）不支持${label}` }), mode: 'native', url: siteUrl(client, kind, id, raw), fields, defaults, description });
  };
  if (kind === 'task') {
    const active = ['wait', 'doing', 'pause']; const all = [...active, 'done', 'cancel', 'closed'];
    add('start', '开始', ['wait'], [assignee(users, current), hours('consumed', '累计消耗（小时）', '这是任务开始后的累计工时，不是本次新增工时。'), hours('left', '预计剩余（小时）', '开始后预计还需投入的工时；填零时禅道会直接完成任务。'), { key: 'realStarted', label: '实际开始时间', type: 'datetime-local', required: true }, comment()], { assignedTo: current, consumed: number(raw.consumed), left: remaining || number(raw.estimate), realStarted: stamp });
    add('finish', '完成', active, [hours('currentConsumed', '本次消耗（小时）', `本次新增工时；当前累计为 ${number(raw.consumed)} 小时。`), { key: 'realStarted', label: '实际开始时间', type: 'datetime-local', required: true }, { key: 'finishedDate', label: '完成时间', type: 'datetime-local', required: true }, assignee(users, accountOf(raw.openedBy), false), comment()], { currentConsumed: '', realStarted: dateValue(raw.realStarted, true) || stamp, finishedDate: stamp, assignedTo: accountOf(raw.openedBy) }, '完成后剩余工时归零；请确认本次新增工时。');
    add('edit', '编辑', all, [{ key: 'title', label: '任务名称', type: 'text', required: true, max: 255 }, priority(), hours('estimate', '预计工时（小时）', '修改预计总工时，不追加消耗记录。'), { key: 'deadline', label: '截止日期', type: 'date' }], { title: string(raw.name), pri: String(number(raw.pri)), estimate: number(raw.estimate), deadline: dateValue(raw.deadline) }, '在此编辑常用字段；描述、附件、关联关系和自定义字段请使用原站完整编辑。');
    add('assign', '指派', [...active, 'done', 'cancel'], [assignee(users, assignedTo), hours('left', '预计剩余（小时）', '指派后预计剩余工时；已完成或已取消任务仍应保持为零。'), comment()], { assignedTo, left: remaining });
    add('cancel', '取消', active, [], {}, '在禅道原站填写取消原因并完成取消，保留该操作的专用流程。');
    const cancel = actions.at(-1); cancel.mode = 'external';
    add('pause', '暂停', ['doing'], [comment()], {}, '暂停当前任务，保留已记录工时。');
    add('restart', '继续', ['pause'], [hours('consumed', '累计消耗（小时）', '这是继续后的累计工时，不是新增工时。'), hours('left', '预计剩余（小时）', '继续后预计剩余工时；填零时禅道会直接完成任务。'), comment()], { consumed: number(raw.consumed), left: remaining });
    add('activate', '激活', ['done', 'cancel', 'closed'], [assignee(users, current), hours('left', '预计剩余（小时）', '重新激活后预计剩余工时。'), comment()], { assignedTo: current, left: remaining });
    add('close', '关闭', ['done', 'cancel'], [comment()], {}, '关闭已完成或已取消的任务。');
    add('record', '记录工时', active, [{ key: 'date', label: '工作日期', type: 'date', required: true }, hours('consumed', '本次消耗（小时）', '仅追加本次工作消耗，不填写累计工时。'), hours('left', '预计剩余（小时）', '记录本次工作后的预计剩余工时；填零时禅道可能直接完成任务。'), { key: 'work', label: '工作内容', type: 'textarea', required: true, max: 5000 }], { date: today, consumed: '', left: remaining });
    const complex = Number(raw.parent) < 0 || list(raw.children).length || list(raw.team).length || ['multi', 'linear'].includes(string(raw.mode)) || Number(raw.multiple) > 0;
    if (complex) for (const action of actions) { action.mode = 'external'; action.description = '此任务涉及父子汇总或多人协作，请在禅道原站使用完整流程，避免遗漏团队工时和联动规则。'; }
  } else {
    const all = ['active', 'resolved', 'closed'];
    add('confirm', '确认', ['active'], [assignee(users, current), priority(), comment()], { assignedTo: current, pri: String(number(raw.pri)) });
    if (Number(raw.confirmed) === 1) { actions.at(-1).enabled = false; actions.at(-1).reason = '此 Bug 已确认'; }
    add('assign', '指派', ['active', 'resolved'], [assignee(users, assignedTo), comment()], { assignedTo });
    add('resolve', '解决', ['active'], [{ key: 'resolution', label: '解决方案', type: 'select', required: true, options: [{ value: '', label: '请选择解决方案' }, ...[['fixed', '已解决'], ['duplicate', '重复 Bug'], ['bydesign', '设计如此'], ['willnotfix', '不予解决'], ['notrepro', '无法重现'], ['postponed', '延期处理']].map(([value, label]) => ({ value, label }))] }, { key: 'resolvedBuild', label: '解决版本', type: 'text', max: 100, required: true, visibleWhen: { key: 'resolution', values: ['fixed'] }, help: '填写禅道构建版本 ID；使用主干时填写 trunk。请按实际解决版本填写。' }, { key: 'duplicateBug', label: '重复的 Bug 编号', type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, step: 1, required: true, visibleWhen: { key: 'resolution', values: ['duplicate'] } }, { key: 'resolvedDate', label: '解决时间', type: 'datetime-local', required: true }, assignee(users, accountOf(raw.openedBy), false), comment()], { resolution: '', resolvedBuild: '', duplicateBug: '', resolvedDate: stamp, assignedTo: accountOf(raw.openedBy) });
    add('toTask', '转任务', ['active', 'resolved'], [], {}, idOf(raw.execution) && idOf(raw.project) ? '在原站创建表单中核对目标执行并完成转换，保留 Bug 与新任务的关联。' : '此 Bug 尚需选择目标执行。打开原站详情后点击“转任务”，选择执行并完成转换。');
    actions.at(-1).mode = 'external';
    if (idOf(raw.toTask)) { actions.at(-1).enabled = false; actions.at(-1).reason = `此 Bug 已关联转换任务 #${idOf(raw.toTask)}`; }
    add('edit', '编辑', all, [{ key: 'title', label: 'Bug 标题', type: 'text', required: true, max: 255 }, priority(), { key: 'severity', label: '严重程度', type: 'select', required: true, options: [1, 2, 3, 4].map(value => ({ value: String(value), label: String(value) })) }, { key: 'deadline', label: '截止日期', type: 'date' }], { title: string(raw.title), pri: String(number(raw.pri)), severity: String(number(raw.severity) || 3), deadline: dateValue(raw.deadline) }, '在此编辑常用字段；重现步骤、附件、关联关系和自定义字段请使用原站完整编辑。');
    add('close', '关闭', ['resolved'], [comment()], {}, '关闭已解决的 Bug。');
    add('activate', '激活', ['resolved', 'closed'], [assignee(users, current), { key: 'openedBuild', label: '重新发现版本', type: 'text', required: true, max: 500, help: '填写构建版本 ID；多个版本用英文逗号分隔，主干填写 trunk。' }, comment()], { assignedTo: current, openedBuild: list(raw.openedBuild).length ? list(raw.openedBuild).map(value => string(value.id ?? value)).join(',') : string(raw.openedBuild || '') });
  }
  return actions;
}
export async function getOperationContext(client, kind, id) {
  validateTarget(kind, id); const raw = await client.rawItem(kind, id); const warnings = []; let users = [];
  try {
    const rows = await client.pages('users', 'users');
    users = rows.filter(row => row && typeof row.account === 'string' && row.account && row.deleted !== true && Number(row.deleted) !== 1).map(row => ({ account: row.account, realname: string(row.realname) }));
  } catch { warnings.push('无法读取用户列表，指派时可填写登录账号；最终可指派范围由禅道校验。'); }
  return { scopeKey: client.scopeKey, version: itemVersion(raw), item: client.detailFromRaw(kind, id, raw), actions: actionSet(client, kind, raw, users), warnings };
}
function visible(field, values) { return !field.visibleWhen || field.visibleWhen.values.includes(values[field.visibleWhen.key]); }
function validDate(value, time) {
  const match = value.match(time ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/ : /^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number(year) >= 1970 && Number(year) <= 9999 && parsed.getFullYear() === Number(year) && parsed.getMonth() + 1 === Number(month) && parsed.getDate() === Number(day) && parsed.getHours() === Number(hour) && parsed.getMinutes() === Number(minute) && parsed.getSeconds() === Number(second);
}
function validateValues(action, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !action.fields.some(field => field.key === key))) throw operationError('操作包含不允许的字段');
  const result = {};
  for (const field of action.fields) {
    if (!visible(field, values)) continue;
    const value = values[field.key]; const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
    if (field.required && empty) throw operationError(`请填写${field.label}`);
    if (empty) { if (field.type === 'date' || field.type === 'text' || field.type === 'textarea' || field.type === 'select') result[field.key] = ''; continue; }
    if (field.type === 'number') {
      if (!['number', 'string'].includes(typeof value) || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value) < field.min || Number(value) > field.max || (field.step === 1 && !Number.isSafeInteger(Number(value)))) throw operationError(`${field.label}数值无效`);
      result[field.key] = Number(value); continue;
    }
    if (typeof value !== 'string' || value.length > (field.max || 5000) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw operationError(`${field.label}格式无效或过长`);
    if (field.type === 'select' && !field.options.some(option => String(option.value) === value)) throw operationError(`请选择有效的${field.label}`);
    if (['date', 'datetime-local'].includes(field.type) && !validDate(value, field.type === 'datetime-local')) throw operationError(`${field.label}日期或时间无效`);
    result[field.key] = field.type === 'datetime-local' ? value.replace('T', ' ') + (value.length === 16 ? ':00' : '') : value.trim();
  }
  return result;
}
export function validateOperationRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['kind', 'id', 'action', 'values', 'scopeKey', 'version', 'requestId'].includes(key))) throw operationError('操作请求格式无效');
  validateTarget(input.kind, input.id);
  if (typeof input.action !== 'string' || input.action.length > 40 || !/^[a-zA-Z]+$/.test(input.action) || !/^[a-f0-9]{64}$/.test(input.scopeKey) || !/^[a-f0-9]{64}$/.test(input.version) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId)) throw operationError('操作校验信息无效，请重新打开表单');
  return input;
}
export async function performOperation(client, input) {
  validateOperationRequest(input);
  if (input.scopeKey !== client.scopeKey) throw operationError('连接已切换，请重新打开操作表单', 'conflict', 409);
  const raw = await client.rawItem(input.kind, input.id);
  if (itemVersion(raw) !== input.version) throw operationError('该事项已被修改，请重新加载操作表单后再提交', 'conflict', 409);
  const action = actionSet(client, input.kind, raw).find(action => action.id === input.action);
  if (!action || !action.enabled) throw operationError(action?.reason || '该操作不可用', 'unavailable', 409);
  if (action.mode !== 'native') throw operationError('此操作请在禅道原站完成', 'unsupported', 422);
  // Assignees remain free text at this layer: the upstream controller checks
  // membership and permission, without trusting an optional users dropdown.
  for (const field of action.fields) if (field.key === 'assignedTo') { field.type = 'text'; delete field.options; }
  const values = validateValues(action, input.values);
  if (input.kind === 'task') {
    if (['start', 'restart'].includes(action.id) && values.consumed < number(raw.consumed)) throw operationError('累计消耗不能小于当前已记录工时');
    if (action.id === 'finish' && values.finishedDate < values.realStarted) throw operationError('完成时间不能早于实际开始时间');
    if (action.id === 'record' && values.consumed <= 0) throw operationError('本次消耗须大于零');
  } else {
    if (action.id === 'resolve' && values.resolution === 'duplicate' && values.duplicateBug === Number(input.id)) throw operationError('不能把 Bug 标记为与自身重复');
    for (const key of ['resolvedBuild', 'openedBuild']) if (values[key] && !(key === 'resolvedBuild' ? /^(?:trunk|[1-9]\d*)$/ : /^(?:trunk|[1-9]\d*)(?:,(?:trunk|[1-9]\d*))*$/).test(values[key])) throw operationError('版本须填写构建 ID 或 trunk；重新发现版本支持用英文逗号分隔多个 ID');
  }
  const group = input.kind === 'task' ? 'tasks' : 'bugs';
  const routes = input.kind === 'task' ? { start: 'start', finish: 'finish', assign: 'assignto', pause: 'pause', restart: 'restart', activate: 'active', close: 'close', record: 'estimate' }
    : { confirm: 'confirm', assign: 'assign', resolve: 'resolve', activate: 'active', close: 'close' };
  let payload = values;
  if (action.id === 'edit') {
    const { title, ...fields } = values; payload = { ...fields, [input.kind === 'task' ? 'name' : 'title']: title };
  }
  if (input.kind === 'task' && action.id === 'record') payload = Object.fromEntries(['date', 'consumed', 'left', 'work'].map(key => [key, [values[key]]]));
  const endpoint = `${group}/${Number(input.id)}${action.id === 'edit' ? '' : `/${routes[action.id]}`}`;
  const result = await client.write(endpoint, payload, { method: action.id === 'edit' ? 'PUT' : 'POST' });
  const expected = { start: ['doing', 'done'], finish: ['done'], pause: ['pause'], restart: ['doing', 'done'], activate: input.kind === 'task' ? ['wait', 'doing'] : ['active'], close: ['closed'], resolve: ['resolved'] }[action.id];
  const mismatch = Number(result.id) !== Number(input.id) || (expected && !expected.includes(result.status)) || (action.id === 'confirm' && Number(result.confirmed) !== 1) || (action.id === 'assign' && accountOf(result.assignedTo) !== values.assignedTo);
  if (mismatch) throw operationError('禅道返回的操作结果未能确认预期变更，请先刷新或在原站核对，勿重复提交', 'result-unknown', 502);
  return result;
}
