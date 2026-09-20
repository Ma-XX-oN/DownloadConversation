import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readDownloadConversationSource,
  readUserscriptManifest
} from '../../scripts/userscript-build-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = await readUserscriptManifest(root);

export const userscript = await readFile(
  new URL('../../chatgpt-conversation-markdown-export.user.js', import.meta.url),
  'utf8'
);

export const downloadConversationSource = await readDownloadConversationSource(root, manifest);

export function markedBlock(startMarker, endMarker) {
  const start = userscript.indexOf(startMarker);
  const end = userscript.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Production block ${startMarker} is missing.`);
  return userscript.slice(start, end + endMarker.length);
}

export function diskBlock() {
  return markedBlock(
    '  // BEGIN Issue #123 disk communication recorder',
    '  // END Issue #123 disk communication recorder'
  );
}

function functionSourceFrom(source, name) {
  const starts = [
    source.indexOf(`  async function ${name}(`),
    source.indexOf(`  function ${name}(`)
  ].filter(index => index >= 0);
  assert.ok(starts.length > 0, `Production function ${name} is missing.`);
  const start = Math.min(...starts);
  const boundaries = [
    source.indexOf('\n\n  /**', start + 3),
    source.indexOf('\n  // END ', start + 3)
  ].filter(index => index >= 0);
  assert.ok(boundaries.length > 0, `Production function ${name} boundary is missing.`);
  return source.slice(start, Math.min(...boundaries)).trimStart();
}

export function productionFunctionSource(name) {
  return functionSourceFrom(userscript, name);
}

export function diskFunctionSource(name) {
  return functionSourceFrom(diskBlock(), name);
}

export function diskHarnessSource() {
  return [
    productionFunctionSource('errorMessage'),
    productionFunctionSource('cloneSafely'),
    productionFunctionSource('releaseReaderLockQuietly'),
    productionFunctionSource('abortWritableQuietly'),
    productionFunctionSource('cancelReadableBodyQuietly'),
    diskBlock()
  ].join('\n');
}
