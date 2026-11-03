import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build, root } from './build.mjs';

function tarEntry(name, bytes) {
  const header = Buffer.alloc(512);
  const put = (text, start, length) => header.write(text, start, length, 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  put(name, 0, 100); put(octal(0o644, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8); put(octal(bytes.length, 12), 124, 12); put(octal(0, 12), 136, 12);
  put('        ', 148, 8); put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2);
  put(header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
export async function pack() {
  await build(); const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // Distribute only these known artifacts; never discover files in a user's
  // storage, MCP configuration, or extra files left in the build directory.
  const files = ['package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE',
    ...['alert-images.js', 'client.js', 'config.js', 'http.js', 'index.js', 'pet.js', 'runtime.js', 'store.js', 'sync.js', 'zentao.js'].map(name => `lib/${name}`)];
  const entries = [];
  for (const name of files) entries.push(tarEntry(`package/${name}`, await readFile(join(root, name))));
  entries.push(Buffer.alloc(1024)); const bytes = gzipSync(Buffer.concat(entries), { level: 9 });
  const dir = join(root, 'dist'); await mkdir(dir, { recursive: true });
  const path = join(dir, `${manifest.name}-${manifest.version}.tgz`); await writeFile(path, bytes);
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await pack()));
