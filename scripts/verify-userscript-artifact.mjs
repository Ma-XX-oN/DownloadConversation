import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(message);
}

function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

async function main() {
  const artifactOverride = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const manifest = JSON.parse(await readFile(
    path.join(root, 'src/userscript-manifest.json'),
    'utf8'
  ));
  if (manifest?.format_version !== 2) fail('Manifest format_version must be 2.');
  if (typeof manifest.header !== 'string' || !manifest.header) {
    fail('Manifest header path is required.');
  }
  if (typeof manifest.generated_artifact !== 'string' || !manifest.generated_artifact) {
    fail('Manifest generated_artifact path is required.');
  }
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length === 0) {
    fail('Manifest must declare at least one dependency.');
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    fail('Manifest must declare at least one source module.');
  }

  const artifactPath = artifactOverride ?? path.join(root, manifest.generated_artifact);
  const artifact = await readFile(artifactPath);
  const header = await readFile(path.join(root, manifest.header));
  const headerText = header.toString('utf8');
  if (/^\/\/ @require\b/m.test(headerText)) {
    fail('Authoritative userscript header must not contain runtime @require directives.');
  }
  if (header.length === 0 || header.at(-1) !== 0x0a) {
    fail('Userscript header must end with a newline.');
  }

  let offset = 0;
  function consume(label, expected) {
    const actual = artifact.subarray(offset, offset + expected.length);
    if (actual.length !== expected.length || !actual.equals(expected)) {
      fail(`Generated userscript ${label} differs at byte offset ${offset}.`);
    }
    offset += expected.length;
  }

  consume('header', header);
  for (const dependency of manifest.dependencies) {
    if (typeof dependency?.name !== 'string' || !dependency.name) {
      fail('Every dependency requires a name.');
    }
    if (!/^[0-9a-f]{40}$/.test(dependency.commit ?? '')) {
      fail(`${dependency.name} commit must be an exact 40-character SHA.`);
    }
    if (!/^[0-9a-f]{40}$/.test(dependency.git_blob_sha1 ?? '')) {
      fail(`${dependency.name} git_blob_sha1 must be an exact SHA-1.`);
    }
    if (!Number.isSafeInteger(dependency.byte_length) || dependency.byte_length <= 0) {
      fail(`${dependency.name} byte_length must be a positive integer.`);
    }
    if (typeof dependency.url !== 'string' || !dependency.url.includes(dependency.commit)) {
      fail(`${dependency.name} URL must contain its pinned commit.`);
    }

    consume(
      `${dependency.name} provenance`,
      Buffer.from(`// source ${dependency.url}\n`, 'utf8')
    );
    consume(
      `${dependency.name} opening banner`,
      Buffer.from(
        `// BEGIN bundled ${dependency.name} commit=${dependency.commit} `
          + `blob=${dependency.git_blob_sha1}\n`,
        'utf8'
      )
    );

    const dependencyBytes = artifact.subarray(
      offset,
      offset + dependency.byte_length
    );
    if (dependencyBytes.length !== dependency.byte_length) {
      fail(`${dependency.name} content is truncated.`);
    }
    const actualSha = gitBlobSha1(dependencyBytes);
    if (actualSha !== dependency.git_blob_sha1) {
      fail(
        `${dependency.name} Git blob mismatch: expected `
          + `${dependency.git_blob_sha1}, got ${actualSha}.`
      );
    }
    offset += dependencyBytes.length;
    if (dependencyBytes.at(-1) !== 0x0a) consume(`${dependency.name} separator`, Buffer.from('\n'));
    consume(
      `${dependency.name} closing banner`,
      Buffer.from(`// END bundled ${dependency.name}\n`, 'utf8')
    );
  }

  const sourcePaths = new Set();
  const sourceParts = [];
  for (const module of manifest.modules) {
    if (typeof module?.name !== 'string' || !module.name) {
      fail('Every source module requires a name.');
    }
    if (!Array.isArray(module.files) || module.files.length === 0) {
      fail(`Source module ${module.name} must contain at least one file.`);
    }
    for (const relativePath of module.files) {
      if (typeof relativePath !== 'string' || !relativePath.startsWith('src/userscript/')) {
        fail(`Invalid source path in ${module.name}: ${relativePath}`);
      }
      if (sourcePaths.has(relativePath)) fail(`Duplicate source path: ${relativePath}`);
      sourcePaths.add(relativePath);
      sourceParts.push(await readFile(path.join(root, relativePath)));
    }
  }
  const source = Buffer.concat(sourceParts);
  const sourceText = source.toString('utf8');
  if (!sourceText.startsWith('\n(() => {')) {
    fail('DownloadConversation source does not preserve the userscript IIFE boundary.');
  }
  const artifactTail = artifact.subarray(offset).toString('utf8');
  const sourceBody = sourceText.slice('\n(() => {'.length);
  const archiveStart = artifactTail.indexOf('// BEGIN bundled archive codec upstream-liblzma=');
  if (!artifactTail.startsWith('\n(() => {\n')
      || archiveStart !== '\n(() => {\n'.length) {
    fail('Generated archive codec runtime is not scoped immediately inside the DC IIFE.');
  }
  const archiveEndMarker = '// END bundled archive codec\n';
  const archiveEnd = artifactTail.indexOf(archiveEndMarker, archiveStart);
  if (archiveEnd < 0) fail('Generated userscript archive codec closing banner is missing.');
  const archivePrelude = artifactTail.slice(
    archiveStart,
    archiveEnd + archiveEndMarker.length
  );
  if (!archivePrelude.includes('globalThis.__dcArchiveCodec = {')) {
    fail('Generated userscript archive codec runtime bridge is missing.');
  }
  if (!archivePrelude.includes('Encoder: ArchiveEncoder')
      || !archivePrelude.includes('decompress: __dcArchiveCodecDecompress')) {
    fail('Generated userscript archive codec contract is incomplete.');
  }
  if (/^export\s/m.test(archivePrelude) || /import\.meta/.test(archivePrelude)) {
    fail('Generated archive codec prelude retains ES-module-only syntax.');
  }
  const expectedTail = '\n(() => {\n' + archivePrelude + sourceBody;
  if (artifactTail !== expectedTail) {
    fail('Generated userscript scoped archive prelude/source assembly differs from repository source.');
  }
  offset = artifact.length;
  if (artifact.length >= 2 * 1024 * 1024) {
    fail(`Generated userscript unexpectedly exceeds 2 MiB: ${artifact.length} bytes.`);
  }
  const artifactText = artifact.toString('utf8');
  if (/import\.meta/.test(artifactText)) {
    fail('Generated userscript contains import.meta and is not Tampermonkey classic-script compatible.');
  }
  try {
    new vm.Script(artifactText, { filename: manifest.generated_artifact });
  } catch (error) {
    fail(`Generated userscript is not valid classic-script JavaScript: ${error.message}`);
  }
  console.log(`Verified ${artifactPath} (${artifact.length} bytes) as a classic script.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
