import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL(
  '../src/userscript/06-image-export-tests/05-modal-contract.js', import.meta.url
), 'utf8');
const begin = source.indexOf('  function resolveGenVersionAtBoundary(');
assert.ok(begin >= 0, 'Resolver must exist in production source');
const end = source.indexOf('\n  }', begin);
assert.ok(end > begin, 'Resolver boundary must exist');
const context = {};
vm.runInNewContext(source.slice(begin, end + 4) +
  '\nthis.resolve = resolveGenVersionAtBoundary;', context);
const resolve = context.resolve;
const version = v => ({ level: 'lifecycle',
  message: 'dc-version-transition', data: { version: v } });
const ordinary = { level: 'debug', message: 'ordinary', data: null };

test('boundary inclusive and retained pre-window baseline', () => {
  const rows = [ordinary, version('v2'), ordinary, version('v3'), ordinary];
  assert.equal(resolve(rows, 0, 'v1'), 'v1');
  assert.equal(resolve(rows, 1, 'v1'), 'v2');
  assert.equal(resolve(rows, 2, 'v1'), 'v2');
  assert.equal(resolve(rows, 3, 'v1'), 'v3');
  assert.equal(resolve(rows, 4, 'v1'), 'v3');
});
test('legacy unknown history does not invent current version', () => {
  const rows = [ordinary, ordinary, version('v4')];
  assert.equal(resolve(rows, 1, null), null);
  assert.equal(resolve(rows, 2, null), 'v4');
});
test('null transitions reset provenance; invalid transition is ignored', () => {
  const rows = [version(null), version(9), {
    level: 'debug', message: 'dc-version-transition', data: { version: 'false' }
  }, ordinary];
  assert.equal(resolve(rows, 3, 'v1'), null);
});
test('read-only resolver retains input ordering and transitions', () => {
  const rows = [ordinary, version('v2'), version('v3')];
  const before = JSON.stringify(rows);
  assert.equal(resolve(rows, 1, 'v1'), 'v2');
  assert.equal(JSON.stringify(rows), before);
});
test('invalid boundary and baseline fail explicitly', () => {
  assert.throws(() => resolve([], 0, null), { name: 'TypeError' });
  assert.throws(() => resolve([ordinary], -1, null), { name: 'TypeError' });
  assert.throws(() => resolve([ordinary], 1, null), { name: 'TypeError' });
  assert.throws(() => resolve([ordinary], 0, undefined), { name: 'TypeError' });
});
