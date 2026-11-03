'use strict';
const React = require('react');
const model = require('./client-model.cjs');
const { createElement: h, useState, useEffect, useMemo, useRef } = React;
const { STATUS_LABELS, NOTICE_LABELS, TASK_STATUSES, BUG_STATUSES, filterItems, paginateItems, summarize, settingsPatch, connectionPatch, safeSiteUrl, buildSafeDocument, createApi, createOverviewStore } = model;
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

function ItemList({ items, kind, filters, onFilter, account, selection, onSelect, loading }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const filtered = useMemo(() => filterItems(items, filters, account), [items, filters, account]);
  const paged = paginateItems(filtered, page, size);
  const changeFilter = next => { setPage(1); onFilter(next); };
  const filteredActive = filters.query || filters.status !== 'all' || filters.priority !== 'all';
  return h('div', { className: 'zt-list-panel' }, h(Filters, { kind, value: filters, onChange: changeFilter, account, count: filtered.length }),
    loading ? h(LoadingState) : !paged.total ? h(EmptyState, { icon: kind === 'bug' ? 'bug' : 'task', title: filteredActive ? '没有匹配的结果' : filters.scope === 'mine' ? `暂无指派给你的${kind === 'bug' ? 'Bug' : '任务'}` : `暂无${kind === 'bug' ? 'Bug' : '任务'}`, description: filteredActive ? '试试其他关键字，或清除筛选条件。' : '同步完成后，事项会在这里显示。', action: filteredActive ? h(Button, { onClick: () => changeFilter({ ...filters, query: '', status: 'all', priority: 'all' }) }, '清除筛选') : null }) :
      h('div', { className: 'zt-table-scroll' }, h('table', { className: 'zt-table' }, h('thead', null, h('tr', null, h('th', null, kind === 'bug' ? 'Bug / 问题' : '任务 / 事项'), h('th', null, '状态'), h('th', null, '优先级'), h('th', null, '负责人'), h('th', { className: 'zt-context-col' }, kind === 'bug' ? '所属产品' : '所属项目'), h('th', { className: 'zt-date-col' }, '更新'))),
        h('tbody', null, ...paged.items.map(item => {
          const selected = selection?.kind === kind && Number(selection.id) === Number(item.id);
          const owner = item.assignedTo?.realname || item.assignedTo?.account;
          const context = kind === 'bug' ? item.productName || item.projectName || item.executionName : item.projectName || item.executionName || item.productName;
          return h('tr', { key: `${kind}-${item.id}`, className: selected ? 'zt-row-selected' : '', onClick: () => onSelect({ kind, id: item.id }), 'aria-selected': selected },
            h('td', { className: 'zt-item-cell' }, h('span', { className: 'zt-item-id' }, `#${item.id}`), h('button', { type: 'button', className: 'zt-item-link', onClick: e => { e.stopPropagation(); onSelect({ kind, id: item.id }); } }, item.title || '未命名事项'), item.deadline ? h('span', { className: 'zt-item-sub' }, `截止 ${item.deadline}`) : null),
            h('td', null, h(StatusBadge, { status: item.status })), h('td', null, h(Priority, { value: item.pri })),
            h('td', null, h('span', { className: 'zt-assignee' }, owner ? h('span', { className: 'zt-avatar', 'aria-hidden': true }, String(owner).slice(0, 1)) : null, h('span', null, owner || '未指派'))),
            h('td', { className: 'zt-context-col zt-muted', title: context }, context || '—'),
            h('td', { className: 'zt-date-col zt-muted', title: formatTime(item.lastEditedDate || item.openedDate) }, formatTime(item.lastEditedDate || item.openedDate, true)));
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

function DetailDrawer({ selection, api, baseUrl, onClose }) {
  const key = `${selection.kind}:${selection.id}`;
  const [state, setState] = useState({ key: '', loading: true, data: null, error: null });
  const [section, setSection] = useState('description');
  const [retry, setRetry] = useState(0);
  const closeButton = useRef(null);
  const dark = useDarkTheme();
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setState({ key, loading: true, data: null, error: null }); setSection('description');
    api.detail(selection.kind, selection.id, { signal: controller.signal }).then(data => {
      if (alive) setState({ key, loading: false, data, error: null });
    }).catch(error => { if (alive && error.name !== 'AbortError') setState({ key, loading: false, data: null, error: error.message }); });
    return () => { alive = false; controller.abort(); };
  }, [key, api, retry]);
  useEffect(() => {
    const doc = globalThis.document;
    if (!doc) return undefined;
    const previous = doc.activeElement;
    closeButton.current?.focus();
    const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
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
          external ? h('a', { href: external, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer', className: 'zt-external-link' }, '在禅道中打开', h(Icon, { name: 'external', size: 13 })) : null),
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
  return h('div', { className: 'zt-workspace-entry' }, h(EmptyState, { icon: 'grid', title: failed ? '请从侧栏打开禅道工作台' : '正在打开禅道工作台…', description: failed ? '禅道工作台会在右侧主区域完整显示。' : undefined, action: failed && openWorkspace ? h(Button, { onClick: openWorkspace }, '打开禅道工作台') : null }));
}

function SettingsPanel({ settings = {}, connection, store, api, busy }) {
  const initial = () => ({ pollSeconds: settings.pollSeconds ?? 45, notificationsEnabled: settings.notificationsEnabled !== false, petEnabled: settings.petEnabled !== false, petId: settings.petId || '' });
  const [draft, setDraft] = useState(initial);
  const [pets, setPets] = useState({ loading: true, available: false, pets: [], error: null });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const alive = useRef(true);
  const testController = useRef(null);
  const id = React.useId ? React.useId() : 'zentao-settings';
  useEffect(() => { setDraft(initial()); }, [settings.pollSeconds, settings.notificationsEnabled, settings.petEnabled, settings.petId]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    api.pets({ signal: controller.signal }).then(data => { if (alive.current) setPets({ ...data, pets: asList(data.pets), loading: false }); }).catch(error => { if (alive.current && error.name !== 'AbortError') setPets({ loading: false, available: false, pets: [], error: error.message }); });
    return () => { alive.current = false; controller.abort(); testController.current?.abort(); };
  }, [api]);
  const update = patch => { setDraft(current => ({ ...current, ...patch })); setFeedback(null); };
  async function save(event) {
    event.preventDefault(); setFeedback(null);
    let patch;
    try { patch = settingsPatch(draft); } catch (error) { setFeedback({ error: true, text: error.message }); return; }
    setSaving(true);
    try {
      const result = await store.saveSettings(patch);
      if (alive.current) setFeedback(result ? { text: '设置已保存，立即生效' } : { error: true, text: '保存失败，请检查连接后重试' });
    } catch (error) { if (alive.current) setFeedback({ error: true, text: error.message }); }
    finally { if (alive.current) setSaving(false); }
  }
  async function testPet() {
    setTesting(true); setFeedback(null);
    const controller = new AbortController(); testController.current = controller;
    try {
      await api.petTest({ signal: controller.signal });
      if (alive.current) setFeedback({ text: '测试请求已受理：禅道插件：桌宠提醒测试' });
    } catch (error) { if (alive.current && error.name !== 'AbortError') setFeedback({ error: true, text: error.message }); }
    finally { if (alive.current) setTesting(false); }
  }
  const knownPet = asList(pets.pets).some(pet => pet.id === draft.petId);
  return h('div', { className: 'zt-settings' }, h('div', { className: 'zt-settings-heading' }, h('span', { className: 'zt-settings-symbol' }, h(Icon, { name: 'settings', size: 22 })), h('div', null, h('h2', null, '同步与提醒设置'), h('p', null, '让工作进展保持同步，让提醒恰到好处。'))),
    h(ConnectionPanel, { connection, store, busy }),
    h('form', { className: 'zt-sync-form', onSubmit: save, noValidate: true },
      h('section', { className: 'zt-settings-section' }, h('h3', null, '同步'), h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { htmlFor: `${id}-poll` }, '后台轮询间隔'), h('p', null, '每次同步任务与 Bug；可设置 30～60 秒。')), h('div', { className: 'zt-number-input' }, h('input', { id: `${id}-poll`, type: 'number', min: 30, max: 60, step: 1, inputMode: 'numeric', value: draft.pollSeconds, disabled: saving, onChange: e => update({ pollSeconds: e.target.value }), 'aria-label': '后台轮询间隔（秒）' }), h('span', null, '秒')))),
      h('section', { className: 'zt-settings-section' }, h('h3', null, '通知与桌宠'),
        h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { id: `${id}-notifications` }, '接收新事项提醒'), h('p', null, '追踪新建、指派和重新指派给你的事项。')), h('button', { type: 'button', role: 'switch', 'aria-checked': draft.notificationsEnabled, 'aria-labelledby': `${id}-notifications`, className: 'zt-switch', disabled: saving, onClick: () => update({ notificationsEnabled: !draft.notificationsEnabled }) }, h('span', null))),
        h('div', { className: 'zt-setting-row' }, h('div', null, h('label', { id: `${id}-pet` }, '桌宠气泡提醒'), h('p', null, '合并展示新事项；桌宠不可用时仍保留通知。')), h('button', { type: 'button', role: 'switch', 'aria-checked': draft.petEnabled, 'aria-labelledby': `${id}-pet`, className: 'zt-switch', disabled: saving, onClick: () => update({ petEnabled: !draft.petEnabled }) }, h('span', null))),
        h('div', { className: 'zt-setting-row zt-setting-pet' }, h('div', null, h('label', { htmlFor: `${id}-pet-target` }, '提醒桌宠'), h('p', null, pets.loading ? '正在读取可用桌宠…' : pets.available ? '自动选择支持桌面提醒的首只可用桌宠。' : '桌宠暂不可用，事项与通知仍可正常查看。')), h('select', { id: `${id}-pet-target`, value: draft.petId, disabled: saving || pets.loading || !draft.petEnabled, onChange: e => update({ petId: e.target.value }) }, h('option', { value: '' }, '自动'), !knownPet && draft.petId ? h('option', { value: draft.petId }, '已保存的桌宠（暂不可用）') : null, ...asList(pets.pets).map(pet => h('option', { value: pet.id, key: pet.id }, pet.name || pet.id)))),
        pets.error ? h('p', { className: 'zt-inline-warning', role: 'status' }, pets.error) : null,
        h('div', { className: 'zt-pet-test' }, h('p', null, '测试使用已保存的设置，发送明确标注的测试提醒。'), h('button', { type: 'button', className: 'zt-button', disabled: testing || saving || !!busy || !pets.available, onClick: testPet }, h(Icon, { name: 'spark', size: 15 }), testing ? '正在发送…' : '发送测试提醒'))),
      h('section', { className: 'zt-settings-section zt-connection' }, h('h3', null, '连接状态'), h('div', { className: 'zt-credential-status' }, h('i', { className: settings.hasCredentials ? 'is-ready' : '' }), settings.hasCredentials ? '宿主已读取连接凭据' : '尚未配置连接凭据'), h('p', null, '连接文件由宿主管理'), h('code', null, settings.connectionFile || '默认连接文件')),
      h('div', { className: 'zt-settings-footer' }, h('span', { className: `zt-settings-feedback ${feedback?.error ? 'is-error' : ''}`, role: feedback?.error ? 'alert' : 'status', 'aria-live': 'polite' }, feedback?.text || '保存后立即生效'), h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: saving || !!busy }, saving ? '正在保存…' : '保存设置'))));
}

function ZentaoApp({ store, api, settingsOnly = false }) {
  const [snapshot, setSnapshot] = useState(store.getSnapshot);
  const [tab, setTab] = useState(settingsOnly ? 'settings' : 'task');
  const [filters, setFilters] = useState({ task: { query: '', status: 'all', priority: 'all', scope: 'mine' }, bug: { query: '', status: 'all', priority: 'all', scope: 'mine' } });
  const [selected, setSelection] = useState(null);
  const dark = useDarkTheme();
  useEffect(() => { const off = store.subscribe(() => setSnapshot(store.getSnapshot())); setSnapshot(store.getSnapshot()); return off; }, [store]);
  const needsConnection = snapshot.data?.settings?.hasCredentials === false;
  useEffect(() => { if (needsConnection) setTab('settings'); }, [needsConnection]);
  const data = snapshot.data || EMPTY;
  const scope = `${data.baseUrl || data.connection?.baseUrl || ''}\n${data.account || data.connection?.account || ''}`;
  const selection = selected?.scope === scope ? selected : null;
  useEffect(() => { setSelection(null); }, [scope]);
  const counts = summarize(data);
  const status = data.status || {};
  const error = snapshot.error || status.error;
  const loading = !snapshot.data && (snapshot.loading || !snapshot.error);
  const syncing = snapshot.busy === 'refresh' || status.syncing;
  const connectionState = error ? 'offline' : syncing ? 'syncing' : status.lastSuccessAt ? 'online' : 'waiting';
  const changeTab = next => { setTab(next); if (next === 'settings') setSelection(null); };
  const selectItem = next => setSelection({ ...next, scope });
  const closeDetail = useMemo(() => () => setSelection(null), []);
  const myTaskTotal = filterItems(data.tasks, { scope: 'mine' }, data.account).length;
  const myBugTotal = filterItems(data.bugs, { scope: 'mine' }, data.account).length;
  const navigation = [['task', '任务', myTaskTotal, 'task'], ['bug', 'Bug', myBugTotal, 'bug'], ['notifications', '通知', counts.unread, 'bell']];
  return h('div', { className: `zt-app ${settingsOnly ? 'zt-config-app' : ''}`, 'data-theme': dark ? 'dark' : 'light' },
    h('header', { className: 'zt-header' }, h('div', { className: 'zt-title-group' }, h('span', { className: 'zt-brand' }, h(Icon, { name: 'grid', size: 24 })), h('div', null, h('div', { className: 'zt-title-line' }, h('h1', null, '禅道'), h('span', { className: `zt-connection-pill is-${connectionState}`, role: 'status' }, h('i', null), error ? '离线' : needsConnection ? '待配置' : syncing ? '同步中' : status.lastSuccessAt ? '已连接' : loading ? '连接中' : '等待同步')), h('p', null, settingsOnly ? '连接你的工作，管理同步与提醒。' : '把待办、问题与进展，放在同一个地方。'))),
      h('div', { className: 'zt-header-actions' }, data.account ? h('span', { className: 'zt-account', title: data.account }, h(Icon, { name: 'user', size: 14 }), data.account) : null,
        h(Button, { icon: 'refresh', onClick: () => store.refresh(), disabled: needsConnection || syncing || !!snapshot.busy, className: syncing ? 'zt-is-syncing' : '' }, syncing ? '同步中…' : '立即同步'),
        !settingsOnly ? h('button', { type: 'button', className: `zt-icon-button ${tab === 'settings' ? 'is-active' : ''}`, onClick: () => changeTab(tab === 'settings' ? 'task' : 'settings'), 'aria-label': '同步与提醒设置', title: '设置', 'aria-pressed': tab === 'settings' }, h(Icon, { name: 'settings', size: 18 })) : null)),
    !settingsOnly ? h('div', { className: 'zt-stats' }, ...[[counts.tasks, '我的待办任务', 'task', 'task'], [counts.bugs, '我的待处理 Bug', 'bug', 'bug'], [counts.urgent, '优先级 P1', 'spark', 'urgent'], [counts.unread, '未读通知', 'bell', 'notice']].map(([count, title, icon, tone]) => h('div', { className: `zt-stat zt-stat-${tone}`, key: tone }, h('span', { className: 'zt-stat-icon' }, h(Icon, { name: icon, size: 19 })), h('div', null, h('span', { className: 'zt-stat-label' }, title), h('strong', null, loading ? '—' : count))))) : null,
    error ? h(ErrorBanner, { error, stale: !!snapshot.data && !!status.lastSuccessAt, onRetry: () => store.reload() }) : null,
    status.petError ? h('div', { className: 'zt-pet-warning', role: 'status' }, h(Icon, { name: 'bell', size: 14 }), `桌宠提醒暂不可用：${status.petError}。通知已保留。`) : null,
    h('section', { className: `zt-workspace ${selection && tab !== 'settings' ? 'has-detail' : ''}` },
      h('div', { className: 'zt-workspace-main' },
        !settingsOnly ? h('div', { className: 'zt-workspace-nav' }, h('nav', { className: 'zt-tabs', 'aria-label': '禅道事项' }, ...navigation.map(([id, title, count, icon]) => h('button', { type: 'button', key: id, 'aria-current': tab === id ? 'page' : undefined, onClick: () => changeTab(id) }, h(Icon, { name: icon, size: 16 }), title, h('span', { className: id === 'notifications' && count ? 'zt-tab-count is-unread' : 'zt-tab-count', title: id === 'task' ? '指派给我的任务总数' : id === 'bug' ? '指派给我的 Bug 总数' : '我的未读通知数' }, count)))), h('span', { className: 'zt-readonly-hint' }, '实时掌握工作进展')) : null,
        tab === 'settings' ? loading ? h(LoadingState) : h(SettingsPanel, { settings: data.settings, connection: data.connection || { baseUrl: data.baseUrl, account: data.account, hasPassword: !!data.settings?.hasCredentials }, store, api, busy: snapshot.busy }) : null,
        tab === 'task' || tab === 'bug' ? h(ItemList, { key: `${scope}:${tab}`, items: tab === 'task' ? data.tasks : data.bugs, kind: tab, filters: filters[tab], onFilter: value => setFilters(current => ({ ...current, [tab]: value })), account: data.account, selection, onSelect: selectItem, loading }) : null,
        tab === 'notifications' ? loading ? h(LoadingState) : h(NoticeList, { notifications: data.notifications, onRead: value => store.markRead(value), onSelect: selectItem, busy: snapshot.busy }) : null),
      selection && tab !== 'settings' ? h(DetailDrawer, { key: `${scope}:${selection.kind}:${selection.id}`, selection, api, baseUrl: data.baseUrl, onClose: closeDetail }) : null),
    h('footer', { className: 'zt-footer' }, h('span', { className: 'zt-last-sync' }, h(Icon, { name: 'clock', size: 12 }), `最近成功同步：${status.lastSuccessAt ? formatTime(status.lastSuccessAt) : '尚未成功同步'}`), h('span', null, needsConnection ? '填写并保存禅道连接后开启自动同步' : data.settings?.pollSeconds ? `每 ${data.settings.pollSeconds} 秒同步` : '自动同步', status.nextSyncAt ? ` · 下次 ${formatTime(status.nextSyncAt, true)}` : '')));
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

module.exports = { name, inject, apply, ...model, ZentaoApp, WorkspaceEntry, ConnectionPanel, DetailDrawer, SettingsPanel, NoticeList, ItemList, RichText };
