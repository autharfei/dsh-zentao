import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifacts, root } from './build.mjs';

// A read-only packaging check. It never installs packages or executes plugin code.
export async function checkRelease() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.main !== './lib/index.js' || manifest.exports?.['.'] !== './lib/index.js' || manifest.exports?.['./client'] !== './lib/client.js' || manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('The declared Host, Client or bundle patch entry changed; review the distribution structure.');
  for (const script of ['prepare', 'preinstall', 'install', 'postinstall']) {
    if (manifest.scripts?.[script]) throw new Error(`Git installation must not require the ${script} lifecycle script.`);
  }
  const artifacts = await buildArtifacts();
  const actualFiles = await readdir(join(root, 'lib'), { withFileTypes: true });
  const expectedNames = new Set([...artifacts.keys()].map(file => file.slice('lib/'.length)));
  for (const entry of actualFiles) {
    if (!entry.isFile() || !expectedNames.has(entry.name)) throw new Error(`Unexpected build output: lib/${entry.name}. Keep lib limited to release artifacts.`);
  }
  for (const [file, expected] of artifacts) {
    let actual;
    try { actual = await readFile(join(root, file)); }
    catch { throw new Error(`Missing ${file}. Run node scripts/build.mjs and include lib in the commit.`); }
    if (!actual.equals(expected)) throw new Error(`Stale ${file}. Run node scripts/build.mjs and commit the regenerated output.`);
  }
  for (const file of ['cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) await readFile(join(root, file));
  return { version: manifest.version, artifacts: artifacts.size, sourceMatchesBuild: true, installTimeBuildRequired: false };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(await checkRelease()));
