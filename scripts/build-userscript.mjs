import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleUserscript,
  readDownloadConversationSource,
  readUserscriptHeader,
  readUserscriptManifest,
  validatePinnedDependency
} from './userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv) {
  let check = false;
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      check = true;
      continue;
    }
    if (argument === '--output') {
      output = argv[index + 1] ?? null;
      if (!output) throw new Error('--output requires a path.');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { check, output };
}

async function fetchPinnedDependency(dependency) {
  const response = await fetch(dependency.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `Could not fetch pinned ${dependency.name} dependency: HTTP ${response.status} ${response.statusText}.`
    );
  }
  const content = await response.text();
  validatePinnedDependency(dependency, content);
  return { manifest: dependency, content };
}

const args = parseArguments(process.argv.slice(2));
const manifest = await readUserscriptManifest(root);
const outputPath = path.resolve(root, args.output ?? manifest.generated_artifact);
const header = await readUserscriptHeader(root, manifest);
const source = await readDownloadConversationSource(root, manifest);
const dependencies = [];
for (const dependency of manifest.dependencies) {
  dependencies.push(await fetchPinnedDependency(dependency));
}
const built = assembleUserscript(header, dependencies, source);

if (args.check) {
  let existing;
  try {
    existing = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Generated userscript is missing: ${path.relative(root, outputPath)}`);
    }
    throw error;
  }
  if (existing !== built) {
    throw new Error(
      `Generated userscript is stale: ${path.relative(root, outputPath)}. Run node scripts/build-userscript.mjs.`
    );
  }
  console.log(`Generated userscript is current: ${path.relative(root, outputPath)}`);
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, built, 'utf8');
  console.log(`Built ${path.relative(root, outputPath)} (${Buffer.byteLength(built, 'utf8')} bytes).`);
}
