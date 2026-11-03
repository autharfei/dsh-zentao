import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function build() {
  const lib = join(root, 'lib'); await mkdir(lib, { recursive: true });
  for (const file of ['index.js', 'alert-images.js', 'config.js', 'zentao.js', 'http.js', 'store.js', 'sync.js', 'pet.js', 'runtime.js']) await copyFile(join(root, 'src', file), join(lib, file));
  const [client, model, css] = await Promise.all(['client.cjs', 'client-model.cjs', 'client.css'].map(file => readFile(join(root, 'src', file), 'utf8')));
  const content = `window.__ModuleLoader__.load({id:'dsh-zentao',factory:(require)=>{\nconst modelModule={exports:{}};\n((module,exports)=>{\n${model}\n})(modelModule,modelModule.exports);\nconst module={exports:{}};\nconst localRequire=(name)=>name==='./client-model.cjs'?modelModule.exports:require(name);\n((require,module,exports)=>{\nconst STYLES=${JSON.stringify(css)};\n${client}\n})(localRequire,module,module.exports);\nreturn module.exports;\n}});\n`;
  await writeFile(join(lib, 'client.js'), content, 'utf8');
  return { hostFiles: 9, clientBytes: Buffer.byteLength(content) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await build()));
