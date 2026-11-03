import { join } from 'node:path';
import { locations, loadConfiguredConnection } from './config.js';
import { FileStore } from './store.js';
import { createRuntime } from './runtime.js';
import { PetClient } from './pet.js';
import { createHandler } from './http.js';

export const name = 'zentao';
export const inject = ['webServer'];
export async function apply(ctx, config = {}) {
  const paths = locations(config); const store = await FileStore.open(join(paths.storageDir, 'state.json'));
  let initialConnection = null; let connectionError = null; let connectionSource = paths.privateConnectionFile;
  try { const loaded = await loadConfiguredConnection(paths); initialConnection = loaded.connection; connectionSource = loaded.source; } catch (error) { connectionError = error.message; }
  const pet = new PetClient({ origin: () => ctx.webServer.port ? `http://127.0.0.1:${ctx.webServer.port}` : null, petId: () => store.state.settings.petId });
  const service = createRuntime({ initialConnection, store, pet, connectionFile: paths.privateConnectionFile, connectionSource, connectionError });
  ctx.provide('zentao', service);
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: '/api/zentao', handler: createHandler({ service, getClient: service.getClient, pet }) });
    service.start();
    return async () => { const settling = service.stop(); if (typeof unregister === 'function') await unregister(); await settling; };
  }, 'zentao: HTTP API and background sync');
}
