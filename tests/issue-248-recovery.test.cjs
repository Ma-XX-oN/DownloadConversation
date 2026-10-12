'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
  '../src/userscript/02-network-communication/06-segment-recovery.js'), 'utf8');

async function recover(input) {
  const files = new Map(Object.entries(input).map(([name, value]) =>
    [name, { ...value }]));
  let selected = null;
  const directory = {
    async getFileHandle(name, { create }) {
      if (!files.has(name)) {
        if (!create) {
          const error = new Error('Missing file');
          error.name = 'NotFoundError';
          throw error;
        }
        files.set(name, { text: '', modified: 0 });
      }
      return {
        async getFile() {
          const file = files.get(name);
          return {
            size: Buffer.byteLength(file.text),
            lastModified: file.modified,
            async text() { return file.text; }
          };
        }
      };
    }
  };
  const context = {
    COMMUNICATION_LOG_ACTIVE_FILE_NAMES: ['active-a.jsonl', 'active-b.jsonl'],
    communicationLogSegmentDirectoryHandle: directory
  };
  vm.runInNewContext(source + '\n'
    + 'globalThis.__recover = async () => { '
    + 'await communicationLogRecoverAlternatingActiveFiles(); '
    + 'return communicationLogActiveFileName; };', context);
  selected = await context.__recover();
  return { selected, files };
}

const historical = '{"timestamp":"2026-10-12T12:00:00Z"}\n';
const header = '{"version":{"gen":"1.0","comm":"1.0"}}\n';
const nullHeader = '{"version":{"gen":null,"comm":null}}\n';
const file = (text, modified) => ({ text, modified });

test('resumes header-only active without rewriting immutable provenance', async () => {
  const result = await recover({
    'active-a.jsonl': file(header, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, header);
  assert.equal(result.files.get('active-b.jsonl').text, historical);
});

test('preserves null legacy provenance in a header-only fragment', async () => {
  const result = await recover({
    'active-a.jsonl': file(nullHeader, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, nullHeader);
});

test('preserves standard selection for two timestamped fragments', async () => {
  const result = await recover({
    'active-a.jsonl': file(historical, 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('prefers an empty append target over a sealed source', async () => {
  const result = await recover({
    'active-a.jsonl': file(historical, 2),
    'active-b.jsonl': file('', 1)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('malformed metadata is not mistaken for a provenance header', async () => {
  const result = await recover({
    'active-a.jsonl': file('{bad}\n', 1),
    'active-b.jsonl': file(historical, 2)
  });
  assert.equal(result.selected, 'active-b.jsonl');
});

test('creates a new active file when no previous fragment exists', async () => {
  const result = await recover({});
  assert.equal(result.selected, 'active-a.jsonl');
  assert.equal(result.files.get('active-a.jsonl').text, '');
});
