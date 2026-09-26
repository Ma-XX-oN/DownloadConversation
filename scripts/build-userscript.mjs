import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleUserscript,
  readDownloadConversationSource,
  readUserscriptHeader,
  readUserscriptManifest,
  validatePinnedDependency
} from './userscript-build-lib.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class InfrastructureError extends Error {}

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
  let response;
  try {
    response = await fetch(dependency.url, { redirect: 'follow' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InfrastructureError(
      `Could not reach pinned ${dependency.name} dependency: ${detail}`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not fetch pinned ${dependency.name} dependency: HTTP ${response.status} ${response.statusText}.`
    );
  }
  const content = await response.text();
  validatePinnedDependency(dependency, content);
  return { manifest: dependency, content };
}

async function buildStream7zPrelude() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dc-stream7z-build-'));
  const source = path.join(root, '7z-js-benchmark', 'prototype', '7zip-direct');
  const work = path.join(temporary, '7zip-direct');
  try {
    await cp(source, work, { recursive: true, filter: item => !/[\\/](?:build|\.build)(?:[\\/]|$)/.test(item) });
    await execFileAsync('bash', [path.join(work, 'build.sh')], { cwd: root });
    const gluePath = path.join(work, 'build', 'stream7z.mjs');
    const wasmPath = path.join(work, 'build', 'stream7z.wasm');
    let glue = await readFile(gluePath, 'utf8');
    if (!/export default Stream7zModule;\s*$/.test(glue)) {
      throw new Error('Unexpected stream7z.mjs export shape.');
    }
    glue = glue.replace(/export default Stream7zModule;\s*$/, '');
    const wasm = await readFile(wasmPath);
    return '// BEGIN bundled stream7z 26.03 direct API\n'
      + glue + '\n'
      + `const STREAM7Z_WASM_BASE64 = '${wasm.toString('base64')}';\n`
      + '// END bundled stream7z 26.03 direct API\n';
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const manifest = await readUserscriptManifest(root);
  const outputPath = path.resolve(root, args.output ?? manifest.generated_artifact);
  const header = await readUserscriptHeader(root, manifest);
  const source = await readDownloadConversationSource(root, manifest);
  const dependencies = [];
  for (const dependency of manifest.dependencies) {
    dependencies.push(await fetchPinnedDependency(dependency));
  }
  const stream7zPrelude = await buildStream7zPrelude();
  const built = assembleUserscript(header, dependencies, source, stream7zPrelude);

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
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof InfrastructureError ? 2 : 1;
}
