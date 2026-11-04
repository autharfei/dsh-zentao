import { ZentaoClient } from './zentao.js';
import { createService } from './sync.js';
import { connectionPatch, saveConnectionFile } from './config.js';
import { createHash } from 'node:crypto';
import { getOperationContext, performOperation, validateOperationRequest, operationError } from './operations.js';

// Own the active connection separately from the sync service, so replacing an
// account drains all old writes while the pet transport remains usable.
export function createRuntime({ store, pet, initialConnection = null, connectionFile, connectionSource = connectionFile, connectionError = null, writeConnection = saveConnectionFile, clientFactory = connection => new ZentaoClient(connection) }) {
  let config = initialConnection; let client = config ? clientFactory(config) : null;
  let source = connectionSource; let running = false; let stopped = false; let saving = Promise.resolve(); let shutdown = null;
  const candidates = new Set(); const operations = new Set(); const receipts = new Map(); const targetBusy = new Set(); const uncertainTargets = new Set(); let connectionChanges = 0;
  const makeService = (active, file, error = null) => createService({ client: active, store, pet: pet ? { send: (...args) => pet.send(...args) } : null, connectionFile: file, connectionError: error });
  let service = makeService(client, source, connectionError);
  const connection = () => ({ baseUrl: config?.baseUrl || '', account: config?.account || '', hasPassword: Boolean(config?.password) });
  const overview = () => ({ ...service.overview(), connection: connection() });
  const checkAlive = () => { if (stopped) throw new Error('插件已卸载'); };
  const runtime = {
    connection, overview, getClient: () => client,
    settings: () => service.settings(),
    async operationContext(kind, id, expectedScope) {
      checkAlive(); if (!client) throw operationError('尚未配置禅道连接');
      if (typeof expectedScope !== 'string' || expectedScope !== client.scopeKey) throw operationError('列表连接已过期或已经切换，请先同步后重新打开表单', 'conflict', 409);
      if (connectionChanges) throw operationError('连接正在切换，请稍后重新打开表单', 'conflict', 409);
      const active = client; const data = await getOperationContext(active, kind, id);
      checkAlive(); if (client !== active || connectionChanges) throw operationError('连接已切换，请重新打开表单', 'conflict', 409);
      if (uncertainTargets.has(`${active.scopeKey}:${kind}:${Number(id)}`)) {
        data.warnings.push('此事项的上次提交结果尚未确认。请先在原站核对；本次插件运行期间改用原站表单，核对后重启插件可恢复内嵌提交');
        for (const action of data.actions) if (action.mode === 'native') { action.mode = 'external'; action.description = '上次提交结果尚未确认，已暂停此事项的内嵌提交。请在原站核对后决定下一步。'; }
      }
      return data;
    },
    operate(input) {
      try { checkAlive(); validateOperationRequest(input); } catch (error) { return Promise.reject(error); }
      if (!client || connectionChanges) return Promise.reject(operationError('连接未就绪或正在切换，请重新打开表单', 'conflict', 409));
      const active = client; const activeService = service;
      if (input.scopeKey !== active.scopeKey) return Promise.reject(operationError('连接已切换，请重新打开表单', 'conflict', 409));
      const key = `${active.scopeKey}:${input.requestId}`;
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex'); const existing = receipts.get(key);
      if (existing) return existing.digest === digest ? existing.promise : Promise.reject(operationError('此提交编号已用于另一份内容，请重新打开表单', 'conflict', 409));
      const target = `${active.scopeKey}:${input.kind}:${Number(input.id)}`;
      if (uncertainTargets.has(target)) return Promise.reject(operationError('此事项的上次提交结果尚未确认，请在原站核对；本次插件运行期间已暂停该事项的内嵌提交', 'result-unknown', 409));
      if (targetBusy.has(target)) return Promise.reject(operationError('此事项已有操作正在提交，请勿重复操作', 'busy', 409));
      if (operations.size >= 10) return Promise.reject(operationError('当前提交较多，请稍后操作', 'busy', 429));
      for (const [id, receipt] of receipts) if (receipts.size >= 200 && receipt.state === 'completed') receipts.delete(id);
      targetBusy.add(target);
      const job = (async () => {
        const updated = await performOperation(active, input);
        // A successful upstream response is final even if local persistence or
        // a later scan fails. Return promptly, without awaiting a full site scan.
        const warnings = []; let snapshot = null;
        try { await activeService.applyMutation(input.kind, updated); snapshot = client === active && !stopped ? overview() : null; }
        catch { warnings.push('禅道操作已提交，本地列表暂未更新，请稍后同步或在原站核对'); }
        void activeService.refreshAfterMutation().catch(() => {});
        return { applied: true, kind: input.kind, id: Number(input.id), action: input.action, overview: snapshot, ...(warnings.length ? { warning: warnings.join('；') } : {}) };
      })().then(result => {
        // Keep a compact acknowledgement, not a full business snapshot per
        // completed operation. Ambiguous receipts remain blocked until reload.
        receipts.set(key, { digest, state: 'completed', promise: Promise.resolve({ applied: true, kind: input.kind, id: Number(input.id), action: input.action, overview: null, warning: '此提交已经处理，请同步查看最新状态，未重复执行' }) });
        return result;
      }).catch(error => { if (error.code === 'result-unknown') uncertainTargets.add(target); else receipts.delete(key); throw error; }).finally(() => { operations.delete(job); if (!uncertainTargets.has(target)) targetBusy.delete(target); });
      receipts.set(key, { digest, state: 'pending', promise: job }); operations.add(job); return job;
    },
    async refresh() { await service.refresh(); return overview(); },
    async markRead(ids) { checkAlive(); await service.markRead(ids); return overview(); },
    async updateSettings(patch) { checkAlive(); await service.updateSettings(patch); return overview(); },
    saveConnection(patch) {
      if (stopped) return Promise.reject(new Error('插件已卸载'));
      if (operations.size) return Promise.reject(operationError('业务操作正在提交，请完成后再切换连接', 'busy', 409));
      connectionChanges++;
      const job = saving.then(async () => {
        checkAlive(); const nextConfig = connectionPatch(patch, config); const nextClient = clientFactory(nextConfig); candidates.add(nextClient);
        let adopted = false;
        try {
          await nextClient.login(); checkAlive();
          try { await writeConnection(connectionFile, nextConfig, { shouldCommit: () => !stopped }); }
          catch { throw new Error(stopped ? '插件已卸载' : '无法保存禅道连接，请检查本地配置目录权限'); }
          checkAlive(); await service.stop(); checkAlive();
          config = nextConfig; client = nextClient; source = connectionFile; service = makeService(client, source); adopted = true;
          // Acknowledge verified credentials once committed. A slow list scan
          // continues in the background, rather than timing out a saved form.
          if (running) service.start(); else void service.refresh().catch(() => {});
          return overview();
        } finally { candidates.delete(nextClient); if (!adopted) nextClient.stop?.(); }
      });
      const settled = job.finally(() => { connectionChanges--; });
      saving = settled.catch(() => {}); return settled;
    },
    start() { if (!stopped && !running) { running = true; service.start(); } },
    stop() {
      if (shutdown) return shutdown;
      stopped = true; running = false;
      for (const candidate of candidates) candidate.stop?.();
      const draining = service.stop(); pet?.stop?.();
      shutdown = Promise.allSettled([saving, draining, ...operations, store.queue]).then(() => undefined); return shutdown;
    },
  };
  return runtime;
}
