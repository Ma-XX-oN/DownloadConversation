import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
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

async function buildDirectXzPrelude() {
  const crate = path.join(root, 'vendor', 'direct-xz');
  const pkg = path.join(crate, 'pkg');
  let wasmPack = spawnSync('wasm-pack', ['--version'], { encoding: 'utf8' });
  if (wasmPack.status !== 0) {
    const install = spawnSync(
      'cargo',
      ['install', 'wasm-pack', '--version', '0.15.0', '--locked'],
      { cwd: root, encoding: 'utf8', stdio: 'inherit' }
    );
    if (install.status !== 0) {
      throw new Error('Could not install pinned wasm-pack 0.15.0 for direct XZ build.');
    }
  }
  const build = spawnSync(
    'wasm-pack',
    ['build', crate, '--target', 'web', '--release', '--out-dir', 'pkg'],
    { cwd: root, encoding: 'utf8', stdio: 'inherit' }
  );
  if (build.status !== 0) throw new Error('Direct XZ Wasm build failed.');
  let glue = await readFile(path.join(pkg, 'dc_direct_xz_wasm.js'), 'utf8');
  glue = glue.replace(/^export class XzEncoder/m, 'class XzEncoder');
  glue = glue.replace(/^export function decompress_xz/m, 'function decompress_xz');
  glue = glue.replace(/export \{ initSync, __wbg_init as default \};\s*$/, '');
  if (!glue.includes('function initSync(') || !glue.includes('class XzEncoder')) {
    throw new Error('Unexpected direct XZ browser glue shape.');
  }
  const wasm = await readFile(path.join(pkg, 'dc_direct_xz_wasm_bg.wasm'));
  const wasmGzip = gzipSync(wasm, { level: 9 });
  return '// BEGIN bundled direct XZ lzma-rust2=0.16.2\n'
    + glue + '\n'
    + 'const DIRECT_XZ_WASM_GZIP_BASE64 = \''
    + wasmGzip.toString('base64') + '\';\n'
    + '// END bundled direct XZ\n';
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
  const directXzPrelude = await buildDirectXzPrelude();
  const built = assembleUserscript(
    header,
    dependencies,
    source,
    directXzPrelude
  );

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
