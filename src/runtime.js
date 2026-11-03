import { ZentaoClient } from './zentao.js';
import { createService } from './sync.js';
import { connectionPatch, saveConnectionFile } from './config.js';

// Own the active connection separately from the sync service, so replacing an
// account drains all old writes while the pet transport remains usable.
export function createRuntime({ store, pet, initialConnection = null, connectionFile, connectionSource = connectionFile, connectionError = null, writeConnection = saveConnectionFile, clientFactory = connection => new ZentaoClient(connection) }) {
  let config = initialConnection; let client = config ? clientFactory(config) : null;
  let source = connectionSource; let running = false; let stopped = false; let saving = Promise.resolve(); let shutdown = null;
  const candidates = new Set();
  const makeService = (active, file, error = null) => createService({ client: active, store, pet: pet ? { send: (...args) => pet.send(...args) } : null, connectionFile: file, connectionError: error });
  let service = makeService(client, source, connectionError);
  const connection = () => ({ baseUrl: config?.baseUrl || '', account: config?.account || '', hasPassword: Boolean(config?.password) });
  const overview = () => ({ ...service.overview(), connection: connection() });
  const checkAlive = () => { if (stopped) throw new Error('插件已卸载'); };
  const runtime = {
    connection, overview, getClient: () => client,
    settings: () => service.settings(),
    async refresh() { await service.refresh(); return overview(); },
    async markRead(ids) { checkAlive(); await service.markRead(ids); return overview(); },
    async updateSettings(patch) { checkAlive(); await service.updateSettings(patch); return overview(); },
    saveConnection(patch) {
      if (stopped) return Promise.reject(new Error('插件已卸载'));
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
      saving = job.catch(() => {}); return job;
    },
    start() { if (!stopped && !running) { running = true; service.start(); } },
    stop() {
      if (shutdown) return shutdown;
      stopped = true; running = false;
      for (const candidate of candidates) candidate.stop?.();
      const draining = service.stop(); pet?.stop?.();
      shutdown = Promise.allSettled([saving, draining, store.queue]).then(() => undefined); return shutdown;
    },
  };
  return runtime;
}
