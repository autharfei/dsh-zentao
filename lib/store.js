import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from './config.js';

export class FileStore {
  constructor(file, state) { this.file = file; this.state = state; this.queue = Promise.resolve(); }
  static async open(file) {
    let state; let exists = true;
    try { state = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') exists = false; else throw new Error('插件状态文件无法读取或已损坏，请备份后检查，原文件未被覆盖'); }
    if (exists && (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 || !state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes) || !state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings))) throw new Error('插件状态文件格式不兼容，原文件未被覆盖');
    return new FileStore(file, exists ? state : { version: 1, settings: { ...DEFAULT_SETTINGS }, scopes: {} });
  }
  update(mutator, { shouldCommit = () => true } = {}) {
    const job = this.queue.then(async () => {
      if (!shouldCommit()) return;
      const next = structuredClone(this.state); const value = mutator(next);
      if (!shouldCommit()) return;
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        if (!shouldCommit()) return;
        await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
        if (!shouldCommit()) { await unlink(temporary); return; }
        await rename(temporary, this.file);
      }
      catch (error) { await unlink(temporary).catch(() => {}); throw new Error('无法保存禅道插件状态，请检查存储目录权限'); }
      this.state = next; return value;
    });
    this.queue = job.catch(() => {}); return job;
  }
}
