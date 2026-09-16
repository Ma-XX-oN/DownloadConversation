import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const path = 'chatgpt-conversation-markdown-export.user.js';
let source = await readFile(path, 'utf8');

const oldVersion = '// @version      1.2.0\n';
const newVersion = '// @version      1.2.0-issue.116.1\n';
assert.equal((source.match(/^\/\/ @version\s+1\.2\.0$/gm) ?? []).length, 1);
source = source.replace(oldVersion, newVersion);

const oldBlock = `    const historyTail = history.slice(anchorIndex + 1);
    const expected = sequence.slice(sequenceStart);
    if (historyTail.length > expected.length) {
      return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
    }
    for (let index = 0; index < historyTail.length; index += 1) {
      if (historyTail[index]?.id !== expected[index]?.id) {
        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
      }
    }
    if (historyTail.length) anchorId = historyTail.at(-1)?.id ?? anchorId;
    // Only records actually observed in the completed response stream can supersede same-ID history.
    const streamedMessageIds = new Set(
      (capture.stream_messages ?? [])
        .map(message => typeof message?.id === 'string' ? message.id : '')
        .filter(Boolean)
    );
    const mergedMessages = history.slice(0, anchorIndex + 1);
    let replacedCount = 0;
    for (let index = 0; index < historyTail.length; index += 1) {
      const replacement = expected[index];
      if (streamedMessageIds.has(replacement.id)) {
        if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;
        mergedMessages.push(streamTailClone(replacement));
      } else {
        mergedMessages.push(streamTailClone(historyTail[index]));
      }
    }
    const appended = expected.slice(historyTail.length);
`;

const newBlock = `    const historyTail = history.slice(anchorIndex + 1);
    const expected = sequence.slice(sequenceStart);
    const matchedExpected = [];
    let expectedIndex = 0;
    for (const historyMessage of historyTail) {
      while (expectedIndex < expected.length &&
          expected[expectedIndex]?.id !== historyMessage?.id &&
          expected[expectedIndex]?.metadata?.is_visually_hidden_from_conversation === true) {
        expectedIndex += 1;
      }
      if (expectedIndex >= expected.length || expected[expectedIndex]?.id !== historyMessage?.id) {
        return { merged: false, reason: 'non-suffix-gap', spine, appended_count: 0, replaced_count: 0 };
      }
      matchedExpected.push(expected[expectedIndex]);
      expectedIndex += 1;
    }
    if (historyTail.length) anchorId = historyTail.at(-1)?.id ?? anchorId;
    // Only records actually observed in the completed response stream can supersede same-ID history.
    const streamedMessageIds = new Set(
      (capture.stream_messages ?? [])
        .map(message => typeof message?.id === 'string' ? message.id : '')
        .filter(Boolean)
    );
    const mergedMessages = history.slice(0, anchorIndex + 1);
    let replacedCount = 0;
    for (let index = 0; index < historyTail.length; index += 1) {
      const replacement = matchedExpected[index];
      if (streamedMessageIds.has(replacement.id)) {
        if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;
        mergedMessages.push(streamTailClone(replacement));
      } else {
        mergedMessages.push(streamTailClone(historyTail[index]));
      }
    }
    const appended = expected
      .slice(expectedIndex)
      .filter(message => message?.metadata?.is_visually_hidden_from_conversation !== true);
`;

assert.equal(source.includes(oldBlock), true, 'Expected merge block is not present exactly once.');
assert.equal(source.indexOf(oldBlock), source.lastIndexOf(oldBlock), 'Expected merge block is duplicated.');
source = source.replace(oldBlock, newBlock);

await writeFile(path, source);
