import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  assembleUserscript,
  gitBlobSha1,
  readUserscriptManifest
} from './userscript-build-lib.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const defaultOutput = 'dist/chatgpt-conversation-markdown-export.user.js';

function parseArgs(argv) {
  const options = { check: false, output: defaultOutput };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output requires a path.');
      options.output = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await readUserscriptManifest(rootDir);
  const output = await assembleUserscript(rootDir, manifest);
  const outputPath = path.resolve(rootDir, options.output);

  if (options.check) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== output) {
      throw new Error(`${options.output} is stale; run node scripts/build-userscript.mjs.`);
    }
    process.stdout.write(
      `Userscript build is current: ${options.output} (${gitBlobSha1(output)}).\n`
    );
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  process.stdout.write(
    `Built ${options.output} from ${manifest.parts.length} source fragments (${gitBlobSha1(output)}).\n`
  );
}

await main();
