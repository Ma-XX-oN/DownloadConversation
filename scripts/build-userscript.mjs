import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function buildArchiveCodecPrelude() {
  const vendor = path.join(root, 'vendor', 'direct-xz');
  const manifest = JSON.parse(await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
  let glue = await readFile(path.join(vendor, 'liblzma.mjs'), 'utf8');
  const glueBytes = Buffer.from(glue, 'utf8');
  if (glueBytes.byteLength !== manifest.glue_bytes
      || sha256(glueBytes) !== manifest.glue_sha256) {
    throw new Error('Vendored archive codec browser glue does not match its manifest.');
  }

  const chunkDirectory = path.join(vendor, 'wasm-gzip-base64');
  const chunkNames = (await readdir(chunkDirectory))
    .filter(name => /^\d\d\.txt$/.test(name))
    .sort();
  if (!chunkNames.length) throw new Error('Vendored archive codec WASM payload is missing.');
  const base64 = (await Promise.all(
    chunkNames.map(name => readFile(path.join(chunkDirectory, name), 'utf8'))
  )).join('').replace(/\s+/g, '');
  const wasmGzip = Buffer.from(base64, 'base64');
  if (wasmGzip.byteLength !== manifest.wasm_gzip_bytes
      || sha256(wasmGzip) !== manifest.wasm_gzip_sha256) {
    throw new Error('Vendored archive codec compressed WASM does not match its manifest.');
  }
  const wasm = gunzipSync(wasmGzip);
  if (wasm.byteLength !== manifest.wasm_raw_bytes
      || sha256(wasm) !== manifest.wasm_raw_sha256) {
    throw new Error('Vendored archive codec WASM does not match its manifest.');
  }

  glue = glue.replaceAll('import.meta.url', 'globalThis.location.href');
  glue = glue.replace(/export default Module;?\s*$/m, '');
  if (/\bimport\.meta\b/.test(glue) || /^\s*export\s/m.test(glue)) {
    throw new Error('Archive codec browser glue still contains module-only syntax.');
  }

  const bridge = `
let __dcArchiveCodecModule = null;

async function __dcArchiveCodecInit(wasmBytes) {
  __dcArchiveCodecModule = await Module({ wasmBinary: wasmBytes });
}

class ArchiveEncoder {
  constructor(level) {
    const module = __dcArchiveCodecModule;
    if (!module) throw new Error('Archive codec is not initialized.');
    this.module = module;
    this.handle = module._dc_xz_encoder_new(level);
    this.finished = false;
    if (!this.handle) throw new Error('Archive encoder initialization failed.');
  }

  write(bytes) {
    if (this.finished) throw new Error('Archive encoder is already finished.');
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
    if (!bytes.byteLength) return new Uint8Array();
    const module = this.module;
    const input = module._malloc(bytes.byteLength);
    const outputPointer = module._malloc(4);
    const outputLength = module._malloc(4);
    try {
      module.HEAPU8.set(bytes, input);
      if (module._dc_xz_encoder_write(
        this.handle,
        input,
        bytes.byteLength,
        outputPointer,
        outputLength
      ) !== 1) throw new Error('Archive encoder write failed.');
      const pointer = module.HEAPU32[outputPointer >>> 2] >>> 0;
      const length = module.HEAPU32[outputLength >>> 2] >>> 0;
      return module.HEAPU8.slice(pointer, pointer + length);
    } finally {
      module._free(input);
      module._free(outputPointer);
      module._free(outputLength);
    }
  }

  finish() {
    if (this.finished) throw new Error('Archive encoder is already finished.');
    this.finished = true;
    const module = this.module;
    const outputPointer = module._malloc(4);
    const outputLength = module._malloc(4);
    try {
      if (module._dc_xz_encoder_finish(
        this.handle,
        outputPointer,
        outputLength
      ) !== 1) throw new Error('Archive encoder finish failed.');
      const pointer = module.HEAPU32[outputPointer >>> 2] >>> 0;
      const length = module.HEAPU32[outputLength >>> 2] >>> 0;
      return module.HEAPU8.slice(pointer, pointer + length);
    } finally {
      module._free(outputPointer);
      module._free(outputLength);
    }
  }

  free() {
    if (!this.handle) return;
    this.module._dc_xz_encoder_free(this.handle);
    this.handle = 0;
  }
}

function __dcArchiveCodecDecompress(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Archive input must be Uint8Array.');
  const module = __dcArchiveCodecModule;
  if (!module) throw new Error('Archive codec is not initialized.');
  const input = module._malloc(Math.max(bytes.byteLength, 1));
  const outputPointer = module._malloc(4);
  const outputLength = module._malloc(4);
  let decodedPointer = 0;
  try {
    if (bytes.byteLength) module.HEAPU8.set(bytes, input);
    if (module._dc_xz_decode(
      input,
      bytes.byteLength,
      outputPointer,
      outputLength
    ) !== 1) throw new Error('Archive decompression failed.');
    decodedPointer = module.HEAPU32[outputPointer >>> 2] >>> 0;
    const length = module.HEAPU32[outputLength >>> 2] >>> 0;
    return module.HEAPU8.slice(decodedPointer, decodedPointer + length);
  } finally {
    if (decodedPointer) module._dc_xz_buffer_free(decodedPointer);
    module._free(input);
    module._free(outputPointer);
    module._free(outputLength);
  }
}

globalThis.__dcArchiveCodec = {
  init: __dcArchiveCodecInit,
  Encoder: ArchiveEncoder,
  decompress: __dcArchiveCodecDecompress,
  wasmGzipBase64: '${base64}'
};
`;

  return `// BEGIN bundled archive codec upstream-liblzma=${manifest.upstream_version}\n`
    + glue + bridge
    + '// END bundled archive codec\n';
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
  const archiveCodecPrelude = await buildArchiveCodecPrelude();
  const built = assembleUserscript(
    header,
    dependencies,
    source,
    archiveCodecPrelude
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
