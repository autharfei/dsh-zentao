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
