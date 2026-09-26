import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource, userscript } from './userscript-source.mjs';

function productionApi(names, globals = {}) {
  const context = { URL, ...globals };
  const exports = names.join(',');
  vm.runInNewContext(`${names.map(productionFunctionSource).join('\n')}\nthis.api={${exports}};`, context);
  return context.api;
}

test('WorkStack lane binding reads only the first User turn and keeps recovery explicit', () => {
  const { workStackLaneFromFirstUserText, workStackResolveLaneFromSpine } = productionApi([
    'workStackLaneFromFirstUserText',
    'workStackResolveLaneFromSpine'
  ]);

  assert.equal(workStackLaneFromFirstUserText('Continue WS:RW-001\ncontext'), 'RW-001');
  assert.equal(workStackLaneFromFirstUserText('prefix WS:CORE_12.alpha-3 suffix'), 'CORE_12.alpha-3');
  assert.equal(workStackLaneFromFirstUserText('no lane here'), null);

  assert.deepEqual(
    workStackResolveLaneFromSpine({ records: [{ role: 'assistant', message: { content: { parts: ['not first user'] } } }] }),
    { status: 'fetching', lane: null }
  );
  assert.deepEqual(
    workStackResolveLaneFromSpine({ records: [
      { role: 'system', message: { content: { parts: ['system'] } } },
      { role: 'user', message: { content: { parts: ['first prompt has no token'] } } },
      { role: 'user', message: { content: { parts: ['later WS:WRONG-999'] } } }
    ] }),
    { status: 'unbound', lane: null }
  );
  assert.deepEqual(
    workStackResolveLaneFromSpine({ records: [
      { role: 'user', message: { content: { parts: ['Continue WS:RW-001'] } } },
      { role: 'assistant', message: { content: { parts: ['WS:OTHER-002'] } } }
    ] }),
    { status: 'bound', lane: 'RW-001' }
  );
});

test('WorkStack continuation selects actual missing Assistant markers, not the newest turn', () => {
  const { workStackMissingAssistantMarkers } = productionApi(['workStackMissingAssistantMarkers']);
  const markers = [
    { role: 'user', message_id: 'u1', dom_turn_id: 'tu1' },
    { role: 'assistant', message_id: 'a-missing-old', dom_turn_id: 'ta1' },
    { role: 'user', message_id: 'u2', dom_turn_id: 'tu2' },
    { role: 'assistant', message_id: 'a-present-new', dom_turn_id: 'ta2' }
  ];
  const spine = { records: [
    { role: 'user', message_id: 'u1' },
    { role: 'user', message_id: 'u2' },
    { role: 'assistant', message_id: 'a-present-new' }
  ] };
  assert.deepEqual(
    Array.from(workStackMissingAssistantMarkers(markers, spine), marker => marker.message_id),
    ['a-missing-old']
  );

  const multiple = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: 'a-old', dom_turn_id: 't-old' },
    { role: 'assistant', message_id: 'a-middle', dom_turn_id: 't-middle' },
    { role: 'assistant', message_id: 'a-new', dom_turn_id: 't-new' }
  ], { records: [{ role: 'assistant', message_id: 'a-middle' }] });
  assert.deepEqual(Array.from(multiple, marker => marker.message_id), ['a-old', 'a-new']);
});

test('WorkStack DOM correlation prefers exact identity, preserves chronology, and rejects ambiguity', () => {
  const { workStackCorrelateTailCandidates } = productionApi(['workStackCorrelateTailCandidates']);
  const missing = [
    { role: 'assistant', message_id: 'a-old', dom_turn_id: 'turn-old', container_id: 'container-old', content_fingerprint: 'fp-old' },
    { role: 'assistant', message_id: 'a-new', dom_turn_id: 'turn-new', container_id: 'container-new', content_fingerprint: 'fp-new' }
  ];
  const candidates = [
    { message_id: 'a-new', dom_turn_id: 'turn-new', container_id: 'container-new', content_fingerprint: 'fp-new', section: 'NEW' },
    { message_id: 'a-old', dom_turn_id: 'turn-old', container_id: 'container-old', content_fingerprint: 'fp-old', section: 'OLD' }
  ];
  const correlated = workStackCorrelateTailCandidates(missing, candidates);
  assert.deepEqual(Array.from(correlated, item => item.section), ['OLD', 'NEW']);

  assert.throws(() => workStackCorrelateTailCandidates(
    [{ role: 'assistant', message_id: 'same', dom_turn_id: null, container_id: null }],
    [
      { message_id: 'same', section: 'A' },
      { message_id: 'same', section: 'B' }
    ]
  ), /ambiguous/i);

  assert.throws(() => workStackCorrelateTailCandidates(
    [{ role: 'assistant', message_id: 'expected', dom_turn_id: 'turn-1', container_id: null }],
    [{ message_id: 'different', dom_turn_id: 'turn-1', section: 'WRONG' }]
  ), /correlation/i, 'Exact message identity disagreement must not fall back to DOM position/turn id.');
});

test('WorkStack clipboard packet and URLs are deterministic', () => {
  const { workStackContinuationPacket, workStackLaneContinueUrl, workStackProjectNewChatUrl } = productionApi([
    'workStackContinuationPacket',
    'workStackLaneContinueUrl',
    'workStackProjectNewChatUrl'
  ]);
  const recovered = ['## Assistant\n\nOlder missing reply.', '## Assistant\n\nNewest missing reply.'];
  assert.equal(
    workStackContinuationPacket('RW-001', recovered),
    'Continue WS:RW-001\n\n---\n\n## Assistant\n\nOlder missing reply.\n\n## Assistant\n\nNewest missing reply.\n\n---\n\n'
  );
  assert.equal(
    workStackLaneContinueUrl('RW-001'),
    'https://github.com/Ma-XX-oN/WorkStack/blob/main/parallel/lanes/RW-001/CONTINUE.md'
  );
  assert.equal(
    workStackProjectNewChatUrl('https://chatgpt.com/g/g-p-abc123-download-conversation/c/conv-123'),
    'https://chatgpt.com/g/g-p-abc123-download-conversation/project'
  );
  assert.equal(
    workStackProjectNewChatUrl('https://chatgpt.com/g/g-p-abc123-download-conversation/project'),
    'https://chatgpt.com/g/g-p-abc123-download-conversation/project'
  );
  assert.equal(workStackProjectNewChatUrl('https://chatgpt.com/c/conv-123'), null);
});

test('WorkStack control and transaction preserve the superseding #163 contracts', () => {
  for (const name of [
    'ensureWorkStackControl',
    'recoverWorkStackLane',
    'extractTurn',
    'handleWorkStackContinue'
  ]) {
    assert.doesNotThrow(() => productionFunctionSource(name), `Production ${name}() is required.`);
  }

  const control = productionFunctionSource('ensureWorkStackControl');
  assert.match(control, /WS: FETCHING\.\.\./);
  assert.match(control, /WS: UNBOUND/);
  assert.match(control, /CONTINUE/);
  assert.match(control, /workStackState\.lane/);
  assert.match(control, /disabled/);

  const transaction = productionFunctionSource('handleWorkStackContinue');
  assert.match(transaction, /workStackState\.lane/,
    'CONTINUE must consume the already-bound lane state.');
  assert.doesNotMatch(transaction, /workStackLaneFromFirstUserText|workStackResolveLaneFromSpine/,
    'CONTINUE must not reparse the first User turn.');
  assert.match(transaction, /snapshotLiveTailMarkers\(\)/);
  assert.match(transaction, /workStackMissingAssistantMarkers/);
  assert.match(transaction, /workStackCorrelateTailCandidates/);
  assert.match(transaction, /extractTurn\(/,
    'Correlated DOM turns must pass through the shared historical extraction seam.');
  assert.match(transaction, /navigator\.clipboard\.writeText/);
  assert.match(transaction, /runExport\(\['md'\]/);
  assert.match(transaction, /forceTimestamps:\s*true/);
  assert.match(transaction, /window\.open\(/,
    'Required browsing contexts must be reserved from the user gesture.');

  const extractor = productionFunctionSource('extractTurn');
  assert.match(extractor, /extractTurnNodeMarkdown|extractTurnChildrenMarkdown/,
    'extractTurn must delegate to the shared DOM Markdown extraction implementation.');
  assert.match(userscript, /(?:H1|h1|heading)/i);
  assert.match(userscript, /(?:UL|OL|LI|list)/i);
  assert.match(userscript, /(?:BLOCKQUOTE|blockquote)/i);
  assert.match(userscript, /(?:PRE|fenced)/i);
  assert.match(userscript, /(?:CODE|inline code)/i);
  assert.match(userscript, /(?:IMG|image)/i);
  assert.match(userscript, /(?:attachment|download)/i);
});
