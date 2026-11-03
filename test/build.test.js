import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from '../scripts/build.mjs';
import { pack } from '../scripts/pack.mjs';
import { gunzipSync } from 'node:zlib';

test('built browser artifact loads through DSH ModuleLoader and shares the host React', async () => {
  await build(); let entry;
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { entry = value; } } }, URL, console, setTimeout, clearTimeout, AbortController });
  assert.equal(entry.id, 'dsh-zentao');
  const exports = entry.factory(name => { if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useRef() {}, useCallback() {}, useMemo() {} }; throw new Error(`unexpected runtime dependency ${name}`); });
  assert.equal(typeof exports.apply, 'function'); assert.ok(exports.inject.includes('slots'));
});

test('publish archive has an npm package root and contains no credentials, state or source fixtures', async () => {
  const result = await pack(); const tar = gunzipSync(await readFile(result.path)); const names = [];
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const header = tar.subarray(offset, offset + 512); const name = header.subarray(0, 100).toString().replace(/\0.*$/, ''); const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    names.push(name); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(names.includes('package/package.json')); assert.ok(names.includes('package/lib/client.js')); assert.ok(names.includes('package/cordis.patch.yml'));
  assert.ok(names.every(name => !/connection\.json|state\.json|\.test-data|\/test\/|\.probe/.test(name)));
});
