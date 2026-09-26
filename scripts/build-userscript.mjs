import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
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
  const dist = path.join(root, '7z-js-benchmark', 'dist');
  const manifest = JSON.parse(await readFile(path.join(dist, 'stream7z-26.03.json'), 'utf8'));
  if (manifest?.schema !== 1 || manifest.version !== '26.03') {
    throw new Error('Invalid pinned stream7z distribution manifest.');
  }
  const readVerified = async name => {
    const expected = manifest.files?.[name];
    if (!expected) throw new Error(`Missing stream7z manifest entry: ${name}`);
    const bytes = gunzipSync(await readFile(path.join(dist, expected.compressed)));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== expected.bytes || digest !== expected.sha256) {
      throw new Error(`Pinned stream7z payload mismatch: ${name}`);
    }
    return bytes;
  };
  let glue = (await readVerified('stream7z.mjs')).toString('utf8');
  if (!/export default Stream7zModule;\s*$/.test(glue)) {
    throw new Error('Unexpected stream7z.mjs export shape.');
  }
  glue = glue.replace(/export default Stream7zModule;\s*$/, '');
  const importMetaMatches = glue.match(/import\.meta\.url/g) ?? [];
  if (importMetaMatches.length !== 4) {
    throw new Error(
      `Expected exactly four import.meta.url occurrences in stream7z glue; found ${importMetaMatches.length}.`
    );
  }
  // Emscripten uses import.meta.url to establish its script location. DC
  // supplies wasmBinary directly, so no module-relative Wasm fetch is needed.
  glue = glue.replaceAll('import.meta.url', 'globalThis.location.href');
  await readVerified('stream7z.wasm');
  const wasmGzip = await readFile(path.join(
    dist,
    manifest.files['stream7z.wasm'].compressed
  ));
  return `// BEGIN bundled stream7z 26.03 direct API source=${manifest.source_commit}\\n`
    + glue + '\n'
    + `const STREAM7Z_WASM_GZIP_BASE64 = '${wasmGzip.toString('base64')}';\\n`
    + '// END bundled stream7z 26.03 direct API\n';
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
