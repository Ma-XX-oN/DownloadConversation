'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const file = path => fs.readFileSync(path, 'utf8');
const fixture = file('tests/fixtures/issue220-merged-log-extraction.js');
const hash = crypto.createHash('sha1').update(
  'blob ' + Buffer.byteLength(fixture) + '\0' + fixture
).digest('hex');
assert.equal(hash, 'd9fd8293d2d9595f03712ce870eb351c143c119b',
  'must consume the verified #220 merge source');
const genSource = file('src/userscript/06-image-export-tests/05-modal-contract.js');
const genStart = genSource.indexOf('  function resolveGenVersionAtBoundary(');
assert.ok(genStart >= 0, 'GEN resolver must exist');
const genEnd = genSource.indexOf('\n  }', genStart);
assert.ok(genEnd > genStart, 'GEN resolver boundary must exist');
const source = [
  file('src/userscript/02-network-communication/06-comm-version-boundary.js'),
  genSource.slice(genStart, genEnd + 4),
  fixture,
  file('src/userscript/07-panel-launcher/01-merged-version-adapter.js')
].join('\n');
const ctx = {
  TextDecoder, TextEncoder,
  sessionStorage: { getItem: () => null, setItem: () => {} },
  recordingGroupInstanceId: 'test-instance',
  recordingGroupState: () => ({ uuid: null })
};
vm.runInNewContext(source + `
  this.boundary = mergedLogBoundaryVersionRecord;
  this.exported = mergedLogJsonlWithVersions;
  this.interleave = mergedLogInterleave;`, ctx);
const line = value => JSON.stringify(value) + '\n';
const stamp = n => `2026-10-12T00:00:0${n}.000Z`;
const general = [
  {timestamp:stamp(1),level:'debug',message:'g'},
  {timestamp:stamp(2),level:'lifecycle',message:'dc-version-transition',
    data:{version:'gen-v2'}}
];
const comm = [
  {timestamp:stamp(1),message:'c'}
];
const fragments = [
  new TextEncoder().encode(line({version:{gen:'gen-v1',comm:'comm-v1'}})
    + line({timestamp:stamp(1),message:'c'})
    + line({timestamp:stamp(2),type:'communication_session_start',
      script_version:'comm-v2'}))
];
const selection = {
  general:true, communication:true,
  start_timestamp:stamp(2), end_timestamp:stamp(3)
};

test('real #220 grouped serializer receives exactly one initial version record', () => {
  const versions = ctx.boundary(general, 'gen-v1', fragments, selection);
  assert.equal(versions.version.gen, 'gen-v2');
  assert.equal(versions.version.comm, 'comm-v2');
  const merged = ctx.interleave([general[1]], [comm[0]]);
  const text = ctx.exported(merged, selection, versions);
  const lines = text.trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(lines[0])),
    {version:{gen:'gen-v2',comm:'comm-v2'}});
  assert.equal(lines[1].kind, 'downloadconversation-merged-log');
  assert.equal(lines[2].source, 'gen');
  assert.equal(lines[3].source, 'comm');
  assert.equal(lines[2].records.length + lines[3].records.length, 2);
});
test('legacy and disabled source versions remain null', () => {
  const result = ctx.boundary(
    [{timestamp:stamp(1),message:'plain'}], null,
    [new TextEncoder().encode(line({timestamp:stamp(1),message:'old'}))],
    {...selection,start_timestamp:stamp(1)}
  );
  assert.equal(result.version.gen, null);
  assert.equal(result.version.comm, null);
  const disabled = ctx.boundary(general, 'gen-v1', fragments,
    {...selection,general:false,communication:false});
  assert.equal(disabled.version.gen, null);
  assert.equal(disabled.version.comm, null);
});
test('physical COMM header is excluded from ordinary merged records', () => {
  const header = {version:{comm:'comm-v1'}};
  const merge = {entries:[
    {source:'comm',record:header},{source:'comm',record:comm[0]}
  ],ordering:'legacy-source-ranges'};
  const text = ctx.exported(merge, selection,
    {version:{gen:null,comm:'comm-v1'}});
  const lines = text.trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].records.length, 1);
  assert.equal(lines[2].records[0].message, 'c');
});
test('invalid range and invalid provenance fail without rewriting events', () => {
  const snapshot = JSON.stringify(general);
  assert.throws(() => ctx.boundary(general, null, fragments,
    {...selection,end_timestamp:stamp(1)}), /Invalid combined/);
  assert.throws(() => ctx.exported({entries:[]},selection,
    {version:{gen:undefined,comm:null}}), /Invalid combined/);
  assert.equal(JSON.stringify(general), snapshot);
});

test('GEN provenance is evaluated at range start, not the first later selected event', () => {
  const prior = [
    { timestamp: stamp(1), level: 'lifecycle',
      message: 'dc-version-transition', data: { version: 'gen-v1' } },
    { timestamp: stamp(3), level: 'lifecycle',
      message: 'dc-version-transition', data: { version: 'gen-v2' } }
  ];
  const chosen = { ...selection, start_timestamp: stamp(2),
    end_timestamp: stamp(4), communication: false };
  const actual = ctx.boundary(prior, null, [], chosen);
  assert.equal(actual.version.gen, 'gen-v1');
});
