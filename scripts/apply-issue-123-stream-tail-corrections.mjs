import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'chatgpt-conversation-markdown-export.user.js';
let source = await readFile(sourcePath, 'utf8');

const startMarker = '  // BEGIN Issue #123 streamed-tail recovery';
const endMarker = '  // END Issue #123 streamed-tail recovery';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end <= start) throw new Error('Streamed-tail production block is unavailable.');

let block = source.slice(start, end + endMarker.length);

const oldUrl = 'const parsed = new URL(url, location.href);';
const firstUrl = block.indexOf(oldUrl);
if (firstUrl < 0 || block.indexOf(oldUrl, firstUrl + oldUrl.length) >= 0) {
  throw new Error('Expected exactly one streamed-tail URL-base expression.');
}
block = block.replace(oldUrl, "const parsed = new URL(url, `${location.origin}/`);");

const validation = `    for (let index = 0; index < historyTail.length; index += 1) {\n      if (historyTail[index]?.id !== expected[index]?.id) {\n        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };\n      }\n    }\n    const mergedMessages = history.slice(0, anchorIndex + 1);`;
const corrected = `    for (let index = 0; index < historyTail.length; index += 1) {\n      if (historyTail[index]?.id !== expected[index]?.id) {\n        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };\n      }\n    }\n    if (historyTail.length) anchorId = historyTail.at(-1)?.id ?? anchorId;\n    const mergedMessages = history.slice(0, anchorIndex + 1);`;
const firstValidation = block.indexOf(validation);
if (firstValidation < 0 || block.indexOf(validation, firstValidation + validation.length) >= 0) {
  throw new Error('Expected exactly one streamed-tail suffix-validation anchor.');
}
block = block.replace(validation, corrected);

source = `${source.slice(0, start)}${block}${source.slice(end + endMarker.length)}`;
await writeFile(sourcePath, source);
