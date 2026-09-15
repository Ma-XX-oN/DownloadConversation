import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'chatgpt-conversation-markdown-export.user.js';
const designPath = 'DESIGN.md';
const testPath = 'tests/stream-tail-recovery.test.mjs';

let source = await readFile(sourcePath, 'utf8');
let design = await readFile(designPath, 'utf8');
let tests = await readFile(testPath, 'utf8');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous patch anchor: ${label}`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

source = replaceOnce(
  source,
  '// @version      1.0.1-issue.123.4',
  '// @version      1.0.1-issue.123.5',
  'issue version'
);

source = replaceOnce(
  source,
  `    const mergedMessages = history.slice(0, anchorIndex + 1);\n    let replacedCount = 0;\n    for (let index = 0; index < historyTail.length; index += 1) {\n      const replacement = expected[index];\n      if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;\n      mergedMessages.push(streamTailClone(replacement));\n    }`,
  `    // Only records actually observed in the completed response stream can supersede same-ID history.\n    const streamedMessageIds = new Set(\n      (capture.stream_messages ?? [])\n        .map(message => typeof message?.id === 'string' ? message.id : '')\n        .filter(Boolean)\n    );\n    const mergedMessages = history.slice(0, anchorIndex + 1);\n    let replacedCount = 0;\n    for (let index = 0; index < historyTail.length; index += 1) {\n      const replacement = expected[index];\n      if (streamedMessageIds.has(replacement.id)) {\n        if (JSON.stringify(historyTail[index]) !== JSON.stringify(replacement)) replacedCount += 1;\n        mergedMessages.push(streamTailClone(replacement));\n      } else {\n        mergedMessages.push(streamTailClone(historyTail[index]));\n      }\n    }`,
  'history replacement policy'
);

design = replaceOnce(
  design,
  `exact message-ID prefix of the captured turn. Matching same-ID tail records are\nreplaced by the completed streamed copies, which repairs stale partial history\nrecords; only the remaining contiguous captured suffix is appended. Any gap,`,
  `exact message-ID prefix of the captured turn. A request-body record fills only a\nmissing submitted suffix record; if history already contains that request-only ID,\nthe server history copy remains authoritative. Matching same-ID records actually\nobserved in the completed response stream are replaced by the streamed copies,\nwhich repairs stale partial Assistant/tool history records; only the remaining\ncontiguous captured suffix is appended. Any gap,`,
  'design replacement policy'
);

const testAnchor = "test('merge rejects incomplete streams, missing overlap, and non-suffix gaps', () => {";
const insertedTests = `test('existing request-only User history stays authoritative while a missing streamed Assistant is appended', () => {\n  const { api } = harness();\n  const a1 = message('a1', 'assistant', 'old answer');\n  const requestUser = message('u2', 'user', 'new prompt');\n  const historyUser = message('u2', 'user', 'new prompt', {\n    create_time: 12345,\n    metadata: { server_enriched: true }\n  });\n  const a2 = message('a2', 'assistant', 'new answer');\n  const capture = api.createStreamTailCapture('c1');\n  api.streamTailCaptureRequest(capture, {\n    conversation_id: 'c1',\n    parent_message_id: 'a1',\n    messages: [requestUser]\n  });\n  feed(api, capture, [{ message: a2, conversation_id: 'c1' }, '[DONE]']);\n  const result = api.mergeStreamTailCaptureIntoSpine(\n    baseSpine([a1, historyUser]),\n    api.streamTailCaptureSnapshot(capture)\n  );\n  assert.equal(result.merged, true);\n  assert.equal(result.appended_count, 1);\n  assert.equal(result.replaced_count, 0);\n  assert.equal(result.spine.messages[1].create_time, 12345);\n  assert.equal(result.spine.messages[1].metadata.server_enriched, true);\n  assert.equal(result.spine.messages[2].id, 'a2');\n});\n\ntest('same-ID records observed in the completed response stream replace stale history copies', () => {\n  const { api } = harness();\n  const a1 = message('a1', 'assistant', 'old answer');\n  const u2 = message('u2', 'user', 'new prompt', { create_time: 12345 });\n  const staleA2 = message('a2', 'assistant', 'partial', {\n    status: 'in_progress',\n    end_turn: false\n  });\n  const finalA2 = message('a2', 'assistant', 'complete', {\n    status: 'finished_successfully',\n    end_turn: true\n  });\n  const capture = api.createStreamTailCapture('c1');\n  api.streamTailCaptureRequest(capture, {\n    conversation_id: 'c1',\n    parent_message_id: 'a1',\n    messages: [message('u2', 'user', 'new prompt')]\n  });\n  feed(api, capture, [{ message: finalA2, conversation_id: 'c1' }, '[DONE]']);\n  const result = api.mergeStreamTailCaptureIntoSpine(\n    baseSpine([a1, u2, staleA2]),\n    api.streamTailCaptureSnapshot(capture)\n  );\n  assert.equal(result.merged, true);\n  assert.equal(result.appended_count, 0);\n  assert.equal(result.replaced_count, 1);\n  assert.equal(result.spine.messages[1].create_time, 12345);\n  assert.equal(result.spine.messages[2].content.parts[0], 'complete');\n  assert.equal(result.spine.messages[2].status, 'finished_successfully');\n});\n\n`;
tests = replaceOnce(tests, testAnchor, `${insertedTests}${testAnchor}`, 'stream merge regressions');

await writeFile(sourcePath, source);
await writeFile(designPath, design);
await writeFile(testPath, tests);
