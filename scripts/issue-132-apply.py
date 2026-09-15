from pathlib import Path
import re
import subprocess
import sys

TEST_PATH = Path('tests/disk-communication-recorder.test.mjs')
SOURCE_PATH = Path('chatgpt-conversation-markdown-export.user.js')
MARKER = '// Issue #132 regression coverage.'

regression = r'''

// Issue #132 regression coverage.
function issue132StreamBodyHarness() {
  const context = {
    COMMUNICATION_LOG_BODY_CHUNK_CHARS: 256 * 1024,
    TextDecoder
  };
  vm.runInNewContext(
    `${diskBlock()}
this.__issue132Records = [];
communicationLogRecord = async (type, data) => {
  this.__issue132Records.push({ type, data });
};
this.__issue132StreamBody = communicationLogStreamBody;`,
    context
  );
  return {
    communicationLogStreamBody: context.__issue132StreamBody,
    records: context.__issue132Records
  };
}

function issue132Body(steps) {
  let index = 0;
  return {
    getReader() {
      return {
        async read() {
          const step = steps[index++];
          if (step?.error) throw new Error(step.error);
          if (step?.done) return { done: true };
          return { done: false, value: step.value };
        },
        releaseLock() {}
      };
    }
  };
}

test('aborted cloned response stream persists sub-chunk partial body and reports the abort', async () => {
  const api = issue132StreamBodyHarness();
  const text = 'event: delta\ndata: {"v":"partial streamed text"}\n\n';
  const bytes = new TextEncoder().encode(text);
  const summary = await api.communicationLogStreamBody(
    issue132Body([
      { value: bytes },
      { error: 'BodyStreamBuffer was aborted' }
    ]),
    'communication_response_chunk',
    { transport: 'fetch', network_sequence: 17 }
  );

  assert.equal(summary.body_incomplete, true);
  assert.equal(summary.error_message, 'BodyStreamBuffer was aborted');
  assert.equal(summary.byte_count, bytes.byteLength);
  assert.equal(summary.chunk_count, 1);
  assert.equal(api.records.length, 1);
  assert.equal(api.records[0].type, 'communication_response_chunk');
  assert.equal(api.records[0].data.chunk_ordinal, 1);
  assert.equal(api.records[0].data.data, text);
});

test('aborted cloned response stream flushes final remainder after full persisted chunks', async () => {
  const api = issue132StreamBodyHarness();
  const text = 'x'.repeat((256 * 1024) + 4096);
  const bytes = new TextEncoder().encode(text);
  const summary = await api.communicationLogStreamBody(
    issue132Body([
      { value: bytes },
      { error: 'BodyStreamBuffer was aborted' }
    ]),
    'communication_response_chunk',
    { transport: 'fetch', network_sequence: 18 }
  );

  assert.equal(summary.body_incomplete, true);
  assert.equal(summary.error_message, 'BodyStreamBuffer was aborted');
  assert.equal(summary.byte_count, bytes.byteLength);
  assert.equal(summary.chunk_count, 2);
  assert.deepEqual(Array.from(api.records, record => record.data.chunk_ordinal), [1, 2]);
  assert.equal(Array.from(api.records, record => record.data.data).join(''), text);
});

test('aborted cloned response stream before any bytes reports zero counts without fabricating a chunk', async () => {
  const api = issue132StreamBodyHarness();
  const summary = await api.communicationLogStreamBody(
    issue132Body([{ error: 'BodyStreamBuffer was aborted' }]),
    'communication_response_chunk',
    { transport: 'fetch', network_sequence: 19 }
  );

  assert.equal(summary.body_incomplete, true);
  assert.equal(summary.error_message, 'BodyStreamBuffer was aborted');
  assert.equal(summary.byte_count, 0);
  assert.equal(summary.chunk_count, 0);
  assert.equal(api.records.length, 0);
});

test('fetch response reports incomplete body warning and leaves generation checkpoint reachable', () => {
  const fetchResponse = functionBlock('communicationLogFetchResponse');
  assert.match(fetchResponse, /summary\.body_incomplete/);
  assert.match(fetchResponse, /communication-log-response-body-incomplete/);
  assert.match(fetchResponse, /message:\s*summary\.error_message/);
  const bodyEndIndex = fetchResponse.indexOf('communication_fetch_response_body_end');
  const checkpointIndex = fetchResponse.indexOf("communicationLogCheckpoint('generation-response-complete')");
  assert.ok(bodyEndIndex >= 0 && checkpointIndex > bodyEndIndex,
    'Generation checkpoint must remain after incomplete-body recording/reporting.');
});
'''

test_source = TEST_PATH.read_text(encoding='utf-8')
if MARKER in test_source:
  raise SystemExit('Issue #132 regression coverage already exists before patch script runs.')
TEST_PATH.write_text(test_source + regression, encoding='utf-8')

red = subprocess.run(
  ['node', '--test', str(TEST_PATH)],
  text=True,
  capture_output=True
)
print(red.stdout)
print(red.stderr, file=sys.stderr)
if red.returncode == 0:
  raise SystemExit('Issue #132 regression unexpectedly passed before the production correction.')
red_output = red.stdout + red.stderr
if not any(token in red_output for token in (
  'BodyStreamBuffer was aborted',
  'communication-log-response-body-incomplete',
  'body_incomplete'
)):
  raise SystemExit('Issue #132 regression failed for an unrelated reason.')

source = SOURCE_PATH.read_text(encoding='utf-8')

old_version = '// @version      1.2.0'
new_version = '// @version      1.2.0-issue.132.1'
if source.count(old_version) != 1:
  raise SystemExit('Expected exactly one 1.2.0 userscript version line.')
source = source.replace(old_version, new_version, 1)

old_returns = '   * @returns {Promise<Object>} Persisted byte/chunk counts.\n'
new_returns = (
  '   * @returns {Promise<Object>} Persisted byte/chunk counts, plus '
  'incomplete-stream metadata when reading aborts.\n'
)
if source.count(old_returns) != 1:
  raise SystemExit('communicationLogStreamBody JSDoc return line did not match exactly once.')
source = source.replace(old_returns, new_returns, 1)

function_pattern = re.compile(
  r"  async function communicationLogStreamBody\(body, recordType, context\) \{.*?\n  \}\n\n  /\*\*",
  re.S
)
replacement = r'''  async function communicationLogStreamBody(body, recordType, context) {
    if (!body) return { byte_count: 0, chunk_count: 0 };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const redactionState = communicationLogCreateRedactionState();
    let safePending = '';
    let byteCount = 0;
    let chunkCount = 0;
    // Terminal cloned-body read error; null means the reader reached clean EOF.
    let streamErrorMessage = null;
    try {
      for (;;) {
        let result = null;
        try {
          result = await reader.read();
        } catch (error) {
          streamErrorMessage = String(error?.message ?? error);
          break;
        }
        if (result.done) break;
        byteCount += result.value?.byteLength ?? 0;
        safePending += communicationLogRedactStreamFeed(
          redactionState,
          decoder.decode(result.value, { stream: true }),
          false
        );
        while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
          const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
          chunkCount += 1;
          await communicationLogRecord(recordType, {
            ...context,
            chunk_ordinal: chunkCount,
            data: chunk
          });
        }
      }
      safePending += communicationLogRedactStreamFeed(redactionState, decoder.decode(), true);
      while (safePending.length >= COMMUNICATION_LOG_BODY_CHUNK_CHARS) {
        const chunk = safePending.slice(0, COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        safePending = safePending.slice(COMMUNICATION_LOG_BODY_CHUNK_CHARS);
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: chunk
        });
      }
      if (safePending) {
        chunkCount += 1;
        await communicationLogRecord(recordType, {
          ...context,
          chunk_ordinal: chunkCount,
          data: safePending
        });
      }
      const summary = { byte_count: byteCount, chunk_count: chunkCount };
      if (streamErrorMessage !== null) {
        summary.body_incomplete = true;
        summary.error_message = streamErrorMessage;
      }
      return summary;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  /**'''
source, replacement_count = function_pattern.subn(replacement, source, count=1)
if replacement_count != 1:
  raise SystemExit(f'Expected one communicationLogStreamBody replacement, got {replacement_count}.')

old_body_end = '''      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
'''
new_body_end = '''      await communicationLogRecord('communication_fetch_response_body_end', {
        network_sequence: trace?.sequence ?? null,
        ...summary
      });
      if (summary.body_incomplete) {
        logDiagnostic('warnings', 'communication-log-response-body-incomplete', {
          network_sequence: trace?.sequence ?? null,
          response_url: stockNetworkSafeUrl(responseUrl),
          byte_count: summary.byte_count,
          chunk_count: summary.chunk_count,
          message: summary.error_message
        });
      }
'''
if source.count(old_body_end) != 1:
  raise SystemExit('Expected exactly one fetch response body-end summary block.')
source = source.replace(old_body_end, new_body_end, 1)

SOURCE_PATH.write_text(source, encoding='utf-8')
