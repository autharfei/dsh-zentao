import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
const hostFiles = ['index.js', 'alert-images.js', 'config.js', 'zentao.js', 'http.js', 'store.js', 'sync.js', 'pet.js', 'runtime.js', 'operations.js'];

// Render expected artifacts from source only. Never import or start the plugin.
export async function buildArtifacts() {
  const artifacts = new Map(await Promise.all(hostFiles.map(async file => [`lib/${file}`, await readFile(join(root, 'src', file))])));
  const [client, model, operations, css] = await Promise.all(['client.cjs', 'client-model.cjs', 'client-operations.cjs', 'client.css'].map(file => readFile(join(root, 'src', file), 'utf8')));
  const content = `window.__ModuleLoader__.load({id:'dsh-zentao',factory:(require)=>{\nconst modelModule={exports:{}};\n((module,exports)=>{\n${model}\n})(modelModule,modelModule.exports);\nconst module={exports:{}};\nconst operationsModule={exports:{}};\nconst localRequire=(name)=>name==='./client-model.cjs'?modelModule.exports:name==='./client-operations.cjs'?operationsModule.exports:require(name);\n((require,module,exports)=>{\n${operations}\n})(localRequire,operationsModule,operationsModule.exports);\n((require,module,exports)=>{\nconst STYLES=${JSON.stringify(css)};\n${client}\n})(localRequire,module,module.exports);\nreturn module.exports;\n}});\n`;
  artifacts.set('lib/client.js', Buffer.from(content, 'utf8'));
  return artifacts;
}

export async function build() {
  const artifacts = await buildArtifacts();
  await mkdir(join(root, 'lib'), { recursive: true });
  await Promise.all([...artifacts].map(([file, bytes]) => writeFile(join(root, file), bytes)));
  return { hostFiles: hostFiles.length, clientBytes: artifacts.get('lib/client.js').length };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await build()));
