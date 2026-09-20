import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_PART_BYTES,
  assembleUserscript,
  gitBlobSha1,
  replaceUserscriptHeader,
  splitTextAtNewlines,
  splitUserscript
} from './userscript-build-lib.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const userscriptRelativePath = 'chatgpt-conversation-markdown-export.user.js';
const headerRelativePath = 'src/userscript-header.js';
const bodyDirectoryRelativePath = 'src/userscript-body';
const manifestRelativePath = 'src/userscript-manifest.json';

async function main() {
  const userscriptPath = path.resolve(rootDir, userscriptRelativePath);
  const headerPath = path.resolve(rootDir, headerRelativePath);
  const bodyDirectory = path.resolve(rootDir, bodyDirectoryRelativePath);
  const manifestPath = path.resolve(rootDir, manifestRelativePath);
  const [userscript, header] = await Promise.all([
    readFile(userscriptPath, 'utf8'),
    readFile(headerPath, 'utf8')
  ]);

  const headerParts = splitUserscript(header);
  if (headerParts.body.length !== 0) {
    throw new Error(`${headerRelativePath} must contain only the userscript metadata block.`);
  }

  const { body } = splitUserscript(userscript);
  const fragments = splitTextAtNewlines(body, DEFAULT_PART_BYTES);
  if (fragments.length < 2) {
    throw new Error('Migration did not split the monolithic runtime body.');
  }

  await rm(bodyDirectory, { recursive: true, force: true });
  await mkdir(bodyDirectory, { recursive: true });

  const partPaths = [];
  for (let index = 0; index < fragments.length; index += 1) {
    const name = `part-${String(index + 1).padStart(3, '0')}.js`;
    const relativePath = `${bodyDirectoryRelativePath}/${name}`;
    partPaths.push(relativePath);
    await writeFile(path.resolve(rootDir, relativePath), fragments[index], 'utf8');
  }

  const manifest = {
    format_version: 1,
    header: headerRelativePath,
    parts: partPaths,
    fragment_max_bytes: DEFAULT_PART_BYTES,
    migration_source: {
      path: userscriptRelativePath,
      git_blob_sha1: gitBlobSha1(userscript)
    }
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const rebuilt = await assembleUserscript(rootDir, manifest);
  const expected = replaceUserscriptHeader(userscript, header);
  if (rebuilt !== expected) {
    throw new Error('Generated modular source does not reproduce the original runtime body exactly.');
  }

  process.stdout.write(
    `Split ${userscriptRelativePath} into ${fragments.length} source fragments; `
      + `original blob ${manifest.migration_source.git_blob_sha1}.\n`
  );
}

await main();
