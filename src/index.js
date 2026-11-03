import { join } from 'node:path';
import { locations, loadConfiguredConnection } from './config.js';
import { FileStore } from './store.js';
import { createRuntime } from './runtime.js';
import { PetClient } from './pet.js';
import { AlertImageStore } from './alert-images.js';
import { createHandler } from './http.js';

export const name = 'zentao';
export const inject = ['webServer', 'connection'];
export async function apply(ctx, config = {}) {
  const paths = locations(config); const store = await FileStore.open(join(paths.storageDir, 'state.json'));
  let initialConnection = null; let connectionError = null; let connectionSource = paths.privateConnectionFile;
  try { const loaded = await loadConfiguredConnection(paths); initialConnection = loaded.connection; connectionSource = loaded.source; } catch (error) { connectionError = error.message; }
  const imageStore = new AlertImageStore(join(paths.storageDir, 'alert-images'));
  const pet = new PetClient({ origin: () => ctx.webServer.port ? `http://127.0.0.1:${ctx.webServer.port}` : null, petId: () => store.state.settings.petId,
    settings: () => store.state.settings, imageStore, authenticatedUrl: ctx.connection?.authenticatedUrl ? origin => ctx.connection.authenticatedUrl(origin) : null });
  const service = createRuntime({ initialConnection, store, pet, connectionFile: paths.privateConnectionFile, connectionSource, connectionError });
  ctx.provide('zentao', service);
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: '/api/zentao', handler: createHandler({ service, getClient: service.getClient, pet, imageStore }) });
    service.start();
    return async () => { imageStore.stop(); const settling = service.stop(); if (typeof unregister === 'function') await unregister(); await settling; };
  }, 'zentao: HTTP API and background sync');
}
