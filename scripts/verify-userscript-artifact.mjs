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
  if (manifest?.format_version !== 3) fail('Manifest format_version must be 3.');
  if (typeof manifest.header !== 'string' || !manifest.header) {
    fail('Manifest header path is required.');
  }
  if (typeof manifest.generated_artifact !== 'string' || !manifest.generated_artifact) {
    fail('Manifest generated_artifact path is required.');
  }
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length === 0) {
    fail('Manifest must declare at least one dependency.');
  }
  if (!Array.isArray(manifest.agent_plugins) || manifest.agent_plugins.length === 0) {
    fail('Manifest must declare at least one agent plugin.');
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

    const dependencyBytes = artifact.subarray(offset, offset + dependency.byte_length);
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
  const iifePrefix = '\n(() => {\n';
  if (!artifactTail.startsWith(iifePrefix)) {
    fail('Generated userscript does not preserve the DC IIFE boundary.');
  }

  const pluginStartMarker = '// BEGIN embedded agent plugin artifacts\n';
  const pluginEndMarker = '// END embedded agent plugin artifacts\n';
  const pluginStart = artifactTail.indexOf(pluginStartMarker, iifePrefix.length);
  if (pluginStart !== iifePrefix.length) {
    fail('Generated agent plugin artifact table is not scoped first inside the DC IIFE.');
  }
  const pluginEnd = artifactTail.indexOf(pluginEndMarker, pluginStart);
  if (pluginEnd < 0) fail('Generated agent plugin artifact table closing banner is missing.');
  const pluginPrelude = artifactTail.slice(
    pluginStart,
    pluginEnd + pluginEndMarker.length
  );
  const pluginSandbox = {};
  const evaluablePluginPrelude = pluginPrelude.replace(
    '  const DC_AGENT_PLUGIN_ARTIFACTS =',
    'globalThis.DC_AGENT_PLUGIN_ARTIFACTS ='
  );
  vm.runInNewContext(evaluablePluginPrelude, pluginSandbox, { filename: 'embedded-agent-plugins.js' });
  const embeddedPlugins = pluginSandbox.DC_AGENT_PLUGIN_ARTIFACTS;
  if (!embeddedPlugins || typeof embeddedPlugins !== 'object') {
    fail('Generated agent plugin artifact table is not evaluable.');
  }
  for (const plugin of manifest.agent_plugins) {
    const embedded = embeddedPlugins[plugin.id];
    if (!embedded) fail(`Embedded agent plugin ${plugin.id} is missing.`);
    for (const field of [
      'id', 'repository', 'ref', 'commit', 'version', 'api_version', 'path',
      'git_blob_sha1', 'byte_length'
    ]) {
      if (embedded[field] !== plugin[field]) {
        fail(`Embedded agent plugin ${plugin.id} ${field} differs from manifest.`);
      }
    }
    if (typeof embedded.source_base64 !== 'string' || !embedded.source_base64) {
      fail(`Embedded agent plugin ${plugin.id} source bytes are missing.`);
    }
    const pluginBytes = Buffer.from(embedded.source_base64, 'base64');
    if (pluginBytes.length !== plugin.byte_length) {
      fail(`Embedded agent plugin ${plugin.id} byte length differs from manifest.`);
    }
    const pluginSha = gitBlobSha1(pluginBytes);
    if (pluginSha !== plugin.git_blob_sha1) {
      fail(
        `Embedded agent plugin ${plugin.id} Git blob mismatch: expected `
          + `${plugin.git_blob_sha1}, got ${pluginSha}.`
      );
    }
  }

  const compressorStartMarker = '// BEGIN bundled compressor name=';
  const compressorStart = artifactTail.indexOf(
    compressorStartMarker,
    pluginEnd + pluginEndMarker.length
  );
  if (compressorStart !== pluginEnd + pluginEndMarker.length) {
    fail('Generated compressor runtime does not immediately follow the agent plugin table.');
  }
  const compressorEndMarker = '// END bundled compressor\n';
  const compressorEnd = artifactTail.indexOf(compressorEndMarker, compressorStart);
  if (compressorEnd < 0) fail('Generated userscript compressor closing banner is missing.');
  const compressorPrelude = artifactTail.slice(
    compressorStart,
    compressorEnd + compressorEndMarker.length
  );
  if (!compressorPrelude.includes('globalThis.__dcCompressor = {')) {
    fail('Generated userscript compressor runtime bridge is missing.');
  }
  if (!compressorPrelude.includes('Encoder: CompressorEncoder')
      || !compressorPrelude.includes('decompress: __dcCompressorDecompress')
      || !compressorPrelude.includes('_extension:')
      || !compressorPrelude.includes('_mime_type:')
      || !compressorPrelude.includes('_compression_level:')) {
    fail('Generated userscript compressor contract is incomplete.');
  }
  if (/^export\s/m.test(compressorPrelude) || /import\.meta/.test(compressorPrelude)) {
    fail('Generated compressor prelude retains ES-module-only syntax.');
  }
  const expectedTail = iifePrefix + pluginPrelude + compressorPrelude + sourceBody;
  if (artifactTail !== expectedTail) {
    fail('Generated userscript plugin/compressor/source assembly differs from repository source.');
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
