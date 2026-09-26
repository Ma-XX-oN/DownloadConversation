import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST_PATH = 'src/userscript-manifest.json';

function assertManifest(condition, message) {
  if (!condition) throw new Error(`Invalid userscript manifest: ${message}`);
}

export function gitBlobSha1(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

export async function readUserscriptManifest(root) {
  const manifestPath = path.join(root, MANIFEST_PATH);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assertManifest(manifest?.format_version === 2, 'format_version must be 2');
  assertManifest(typeof manifest.header === 'string' && manifest.header, 'header path is required');
  assertManifest(typeof manifest.generated_artifact === 'string' && manifest.generated_artifact,
    'generated_artifact path is required');
  assertManifest(Array.isArray(manifest.dependencies) && manifest.dependencies.length > 0,
    'at least one pinned dependency is required');
  assertManifest(Array.isArray(manifest.modules) && manifest.modules.length > 0,
    'at least one source module is required');

  const moduleNames = new Set();
  const sourcePaths = new Set();
  for (const module of manifest.modules) {
    assertManifest(typeof module?.name === 'string' && module.name, 'every module needs a name');
    assertManifest(!moduleNames.has(module.name), `duplicate module name ${module.name}`);
    moduleNames.add(module.name);
    assertManifest(Array.isArray(module.files) && module.files.length > 0,
      `module ${module.name} needs at least one file`);
    for (const file of module.files) {
      assertManifest(typeof file === 'string' && file.startsWith('src/userscript/'),
        `module ${module.name} contains invalid source path ${file}`);
      assertManifest(!sourcePaths.has(file), `duplicate source path ${file}`);
      sourcePaths.add(file);
    }
  }

  for (const dependency of manifest.dependencies) {
    assertManifest(typeof dependency?.name === 'string' && dependency.name, 'dependency name is required');
    assertManifest(/^[0-9a-f]{40}$/.test(dependency.commit ?? ''),
      `${dependency.name} commit must be an exact 40-character SHA`);
    assertManifest(/^[0-9a-f]{40}$/.test(dependency.git_blob_sha1 ?? ''),
      `${dependency.name} git_blob_sha1 must be an exact SHA-1`);
    assertManifest(Number.isSafeInteger(dependency.byte_length) && dependency.byte_length > 0,
      `${dependency.name} byte_length must be a positive integer`);
    assertManifest(typeof dependency.url === 'string' && dependency.url.includes(dependency.commit),
      `${dependency.name} URL must contain its pinned commit`);
  }
  return manifest;
}

export function orderedSourcePaths(manifest) {
  return manifest.modules.flatMap(module => module.files);
}

export async function readUserscriptHeader(root, manifest) {
  return readFile(path.join(root, manifest.header), 'utf8');
}

export async function readDownloadConversationSource(root, manifest) {
  let result = '';
  for (const relativePath of orderedSourcePaths(manifest)) {
    result += await readFile(path.join(root, relativePath), 'utf8');
  }
  return result;
}

export function validatePinnedDependency(dependency, content) {
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length !== dependency.byte_length) {
    throw new Error(
      `${dependency.name} byte length mismatch: expected ${dependency.byte_length}, got ${bytes.length}.`
    );
  }
  const actualSha = gitBlobSha1(bytes);
  if (actualSha !== dependency.git_blob_sha1) {
    throw new Error(
      `${dependency.name} Git blob mismatch: expected ${dependency.git_blob_sha1}, got ${actualSha}.`
    );
  }
}

function dependencyBanner(dependency, content) {
  const provenance = `// source ${dependency.url}\n`;
  const prefix =
    `// BEGIN bundled ${dependency.name} commit=${dependency.commit} blob=${dependency.git_blob_sha1}\n`;
  const suffix = `// END bundled ${dependency.name}\n`;
  return `${provenance}${prefix}${content}${content.endsWith('\n') ? '' : '\n'}${suffix}`;
}

export function assembleUserscript(header, dependencies, source, prelude = '') {
  if (/^\/\/ @require\b/m.test(header)) {
    throw new Error('Authoritative userscript header must not contain runtime @require directives.');
  }
  if (!header.endsWith('\n')) throw new Error('Userscript header must end with a newline.');
  if (!source.startsWith('\n(() => {')) {
    throw new Error('DownloadConversation source must begin with the preserved userscript IIFE boundary.');
  }
  let result = header;
  for (const { manifest: dependency, content } of dependencies) {
    validatePinnedDependency(dependency, content);
    result += dependencyBanner(dependency, content);
  }
  result += prelude;
  result += source;
  return result;
}
