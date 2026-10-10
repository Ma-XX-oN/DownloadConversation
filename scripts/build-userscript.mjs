import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleUserscript,
  buildAgentPluginPrelude,
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

function artifactLabel(artifact) {
  return artifact.name ?? artifact.id ?? 'artifact';
}

async function fetchPinnedDependency(dependency) {
  let response;
  const label = artifactLabel(dependency);
  try {
    response = await fetch(dependency.url, { redirect: 'follow' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InfrastructureError(
      `Could not reach pinned ${label} dependency: ${detail}`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not fetch pinned ${label} dependency: HTTP ${response.status} ${response.statusText}.`
    );
  }
  const content = await response.text();
  validatePinnedDependency(dependency, content);
  return { manifest: dependency, content };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readAgentPluginPrelude() {
  const broker = await readFile(
    path.join(root, 'src', 'userscript', '01-runtime', '02-github-agent-plugin-broker.js'),
    'utf8'
  );
  const bridge = await readFile(
    path.join(root, 'src', 'userscript', '04-conversation-rendering', '08-agent-plugin-bridge.js'),
    'utf8'
  );
  return buildAgentPluginPrelude(broker, bridge);
}

async function buildCompressorPrelude() {
  const vendor = path.join(root, 'vendor', 'compressor');
  const manifest = JSON.parse(await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
  let bridge = await readFile(path.join(vendor, manifest.bridge), 'utf8');
  const bridgeBytes = Buffer.from(bridge, 'utf8');
  if (bridgeBytes.byteLength !== manifest.bridge_bytes
      || sha256(bridgeBytes) !== manifest.bridge_sha256) {
    throw new Error('Vendored compressor bridge does not match its manifest.');
  }

  const chunkDirectory = path.join(vendor, manifest.wasm_gzip_base64_directory);
  const chunkNames = (await readdir(chunkDirectory))
    .filter(name => /^\d\d\.txt$/.test(name))
    .sort();
  if (!chunkNames.length) throw new Error('Vendored compressor WASM payload is missing.');
  const base64 = (await Promise.all(
    chunkNames.map(name => readFile(path.join(chunkDirectory, name), 'utf8'))
  )).join('').replace(/\s+/g, '');
  const wasmGzip = Buffer.from(base64, 'base64');
  if (wasmGzip.byteLength !== manifest.wasm_gzip_bytes
      || sha256(wasmGzip) !== manifest.wasm_gzip_sha256) {
    throw new Error('Vendored compressed compressor WASM does not match its manifest.');
  }
  let wasm;
  try {
    wasm = gunzipSync(wasmGzip);
  } catch (error) {
    throw new Error(
      `Vendored compressor WASM payload is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (wasm.byteLength !== manifest.wasm_raw_bytes
      || sha256(wasm) !== manifest.wasm_raw_sha256) {
    throw new Error('Vendored compressor WASM does not match its manifest.');
  }

  bridge = bridge
    .replace('__DC_COMPRESSOR_WASM_GZIP_BASE64__', base64)
    .replace('__DC_COMPRESSOR_EXTENSION__', manifest.extension)
    .replace('__DC_COMPRESSOR_MIME_TYPE__', manifest.mime_type)
    .replace('__DC_COMPRESSOR_LEVEL__', String(manifest.compression_level));
  if (/__DC_COMPRESSOR_[A-Z_]+__/.test(bridge)) {
    throw new Error('Vendored compressor bridge contains unresolved package placeholders.');
  }
  if (/\bimport\.meta\b/.test(bridge) || /^\s*(?:import|export)\s/m.test(bridge)) {
    throw new Error('Vendored compressor bridge contains module-only syntax.');
  }

  return `// BEGIN bundled compressor name=${manifest.name} source=${manifest.source_commit}\n`
    + bridge
    + '// END bundled compressor\n';
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
  const agentPluginPrelude = await readAgentPluginPrelude();
  const compressorPrelude = await buildCompressorPrelude();
  const built = assembleUserscript(
    header,
    dependencies,
    source,
    agentPluginPrelude + compressorPrelude
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
