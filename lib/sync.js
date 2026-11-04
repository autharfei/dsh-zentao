import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, validateSettings, publicSettings } from './config.js';
import { normalizeItem } from './zentao.js';

const keyOf = item => `${item.kind}:${item.id}`;
const initialScope = () => ({ baseline: null, tasks: [], bugs: [], notifications: [], lastSuccessAt: null });
export function createService({ client, store, pet, clock = () => new Date(), connectionFile = '', connectionError = null }) {
  let inFlight = null; let stopped = false; let timer = null; let shutdown = null; let delivery = null; let bubbleUntil = 0;
  let deliveryAbort = new AbortController(); let mutationRevision = 0; const mutations = new Map();
  const pause = (ms, signal) => new Promise(resolve => {
    const finish = () => { clearTimeout(timeout); signal.removeEventListener('abort', finish); resolve(); };
    const timeout = setTimeout(finish, ms); timeout.unref?.();
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
  const commitGuard = { shouldCommit: () => !stopped };
  const status = { syncing: false, lastAttemptAt: null, error: connectionError, petError: null, nextSyncAt: null };
  const scopeKey = client?.scopeKey || 'unconfigured';
  const settings = () => ({ ...DEFAULT_SETTINGS, ...store.state.settings });
  const scope = () => store.state.scopes[scopeKey] || initialScope();
  const now = () => clock().toISOString();
  const overview = () => ({ scopeKey, tasks: scope().tasks, bugs: scope().bugs, notifications: [...scope().notifications].reverse(),
    status: { ...status, lastSuccessAt: scope().lastSuccessAt }, settings: publicSettings(settings(), connectionFile, Boolean(client)), account: client?.account || '', baseUrl: client?.baseUrl || '' });
  function deliver() {
    if (delivery || stopped || !pet || !settings().petEnabled || !settings().notificationsEnabled) return;
    if (!scope().notifications.some(notice => !notice.read && !notice.delivered)) return;
    const signal = (deliveryAbort = new AbortController()).signal;
    delivery = (async () => {
      while (!stopped && !signal.aborted && settings().petEnabled && settings().notificationsEnabled) {
        if (bubbleUntil > Date.now()) await pause(bubbleUntil - Date.now(), signal);
        if (stopped || signal.aborted || !settings().petEnabled || !settings().notificationsEnabled) return;
        const pending = scope().notifications.filter(notice => !notice.read && !notice.delivered);
        if (!pending.length) return;
        const kind = pending[0].kind; const batch = pending.filter(notice => notice.kind === kind);
        const ids = new Set(batch.map(notice => notice.id));
        const titles = batch.slice(-2).map(notice => notice.title.replace(/\s+/g, ' ').slice(0, 48)).join('；');
        const duration = settings().petDurationSeconds;
        const result = await pet.send(`禅道：你有 ${batch.length} 个${kind === 'task' ? '任务' : ' Bug'}新指派。${titles}${batch.length > 2 ? '…' : ''}`, { kind, signal });
        if (!result?.accepted) throw new Error('桌宠未受理提醒');
        if (stopped) return;
        bubbleUntil = Date.now() + (result.durationSeconds ?? duration) * 1000;
        await store.update(state => { for (const notice of state.scopes[scopeKey]?.notifications || []) if (ids.has(notice.id)) notice.delivered = true; }, commitGuard);
        status.petError = result.warning || null;
      }
    })().catch(error => { if (!stopped && !signal.aborted) status.petError = error.message; }).finally(() => { delivery = null; });
  }
  function refresh() {
    if (stopped) return Promise.resolve(overview());
    if (inFlight) return inFlight;
    status.syncing = true; status.lastAttemptAt = now();
    inFlight = (async () => {
      if (!client) throw new Error(connectionError || '尚未配置禅道连接');
      const scanRevision = mutationRevision; const snapshot = await client.snapshot(); if (stopped) return overview();
      await store.update(state => {
        // A scan that began before a successful write must not restore old rows.
        for (const kind of ['task', 'bug']) {
          const key = kind === 'task' ? 'tasks' : 'bugs'; const rows = new Map(snapshot[key].map(item => [item.id, item]));
          for (const entry of mutations.values()) if (entry.revision > scanRevision && entry.item.kind === kind) rows.set(entry.item.id, entry.item);
          snapshot[key] = [...rows.values()];
        }
        const current = state.scopes[scopeKey] || initialScope(); const baseline = { ...(current.baseline || {}) };
        const first = current.baseline === null; const stamp = now();
        for (const item of [...snapshot.tasks, ...snapshot.bugs]) {
          const key = keyOf(item); const old = baseline[key]; const assignedTo = item.assignedTo?.account || '';
          const changed = !old || old.assignedTo !== client.account || (item.assignedDate && old.assignedDate && item.assignedDate !== old.assignedDate);
          if (!first && state.settings.notificationsEnabled && assignedTo === client.account && changed) {
            current.notifications.push({ id: randomUUID(), kind: item.kind, itemId: item.id, title: item.title,
              reason: old ? 'reassigned' : (item.openedDate && item.openedDate >= current.lastSuccessAt ? 'created' : 'assigned'), createdAt: stamp, read: false, delivered: false });
          }
          baseline[key] = { assignedTo, assignedDate: item.assignedDate || '' };
        }
        // Keep unread records; retain a bounded history of read records only.
        const unread = current.notifications.filter(notice => !notice.read); const read = current.notifications.filter(notice => notice.read).slice(-500);
        current.notifications = [...unread, ...read].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        current.baseline = baseline; current.tasks = snapshot.tasks; current.bugs = snapshot.bugs; current.lastSuccessAt = stamp;
        state.scopes[scopeKey] = current;
      }, commitGuard);
      for (const [key, entry] of mutations) if (entry.revision <= scanRevision) mutations.delete(key);
      status.error = null; deliver(); return overview();
    })().catch(error => { if (!stopped) status.error = error.message; throw error; }).finally(() => { status.syncing = false; inFlight = null; }).then(() => overview());
    return inFlight;
  }
  function schedule() {
    if (stopped) return;
    clearTimeout(timer); const delay = settings().pollSeconds * 1000; status.nextSyncAt = new Date(clock().getTime() + delay).toISOString();
    timer = setTimeout(async () => { try { await refresh(); } catch {} finally { schedule(); } }, delay); timer.unref?.();
  }
  const service = { overview, refresh,
    async refreshAfterMutation() { if (inFlight) await inFlight.catch(() => {}); return refresh(); },
    async applyMutation(kind, raw) {
      if (stopped) throw new Error('插件已卸载');
      const key = kind === 'task' ? 'tasks' : 'bugs'; const previous = scope()[key].find(item => item.id === Number(raw.id));
      const item = normalizeItem(kind, raw, previous || {}); const revision = ++mutationRevision;
      mutations.set(keyOf(item), { revision, item });
      await store.update(state => {
        const current = state.scopes[scopeKey] || initialScope(); const index = current[key].findIndex(row => row.id === item.id);
        if (index < 0) current[key].push(item); else current[key][index] = item;
        if (current.baseline) current.baseline[keyOf(item)] = { assignedTo: item.assignedTo.account, assignedDate: item.assignedDate };
        state.scopes[scopeKey] = current;
      }, commitGuard);
      return overview();
    },
    settings: () => overview().settings,
    async markRead(ids) { if (stopped) throw new Error('插件已卸载'); const selected = ids === 'all' ? null : new Set(ids); await store.update(state => { for (const notice of state.scopes[scopeKey]?.notifications || []) if (!selected || selected.has(notice.id)) notice.read = true; }, commitGuard); return overview(); },
    async updateSettings(patch) {
      if (stopped) throw new Error('插件已卸载'); const next = validateSettings(patch);
      await store.update(state => { state.settings = { ...DEFAULT_SETTINGS, ...state.settings, ...next }; }, commitGuard);
      if (!settings().petEnabled || !settings().notificationsEnabled) { deliveryAbort.abort(); status.petError = null; }
      if (timer) schedule(); return overview();
    },
    start() { if (stopped || timer || !client) return; void refresh().catch(() => {}).finally(schedule); },
    stop() {
      if (shutdown) return shutdown;
      stopped = true; deliveryAbort.abort(); clearTimeout(timer); timer = null; status.nextSyncAt = null; client?.stop?.(); pet?.stop?.();
      shutdown = Promise.allSettled([inFlight, delivery, store.queue]).then(() => undefined); return shutdown;
    },
  };
  return service;
}
