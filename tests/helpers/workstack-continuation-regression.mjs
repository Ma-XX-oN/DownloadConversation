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

function text(value) {
  return { nodeType: 3, nodeValue: value, textContent: value, childNodes: [] };
}

function element(tag, attrs = {}, children = []) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    childNodes: children,
    textContent: children.map(child => child.textContent ?? child.nodeValue ?? '').join(''),
    getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
    hasAttribute(name) { return Object.hasOwn(attrs, name); }
  };
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
      { role: 'user', message: { content: { parts: [{ text: 'Continue WS:RW-001' }] } } },
      { role: 'assistant', message: { content: { parts: ['WS:OTHER-002'] } } }
    ] }),
    { status: 'bound', lane: 'RW-001' }
  );
});

test('WorkStack continuation selects actual missing Assistant markers, not the newest turn', () => {
  const { workStackMissingAssistantMarkers } = productionApi(['workStackMissingAssistantMarkers']);
  const markers = [
    { role: 'user', message_id: 'u1', dom_turn_id: 'tu1', comparison_text: 'user one' },
    { role: 'assistant', message_id: 'a-missing-old', dom_turn_id: 'ta1', comparison_text: 'missing old reply' },
    { role: 'user', message_id: 'u2', dom_turn_id: 'tu2', comparison_text: 'user two' },
    { role: 'assistant', message_id: 'a-present-new', dom_turn_id: 'ta2', comparison_text: 'present newest reply' }
  ];
  const spine = { records: [
    { role: 'user', message_id: 'u1', message: { content: { parts: ['user one'] } } },
    { role: 'user', message_id: 'u2', message: { content: { parts: ['user two'] } } },
    { role: 'assistant', message_id: 'a-present-new', message: { content: { parts: ['present newest reply'] } } }
  ] };
  assert.deepEqual(
    Array.from(workStackMissingAssistantMarkers(markers, spine), marker => marker.message_id),
    ['a-missing-old']
  );

  const multiple = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: 'a-old', dom_turn_id: 't-old', comparison_text: 'old' },
    { role: 'assistant', message_id: 'a-middle', dom_turn_id: 't-middle', comparison_text: 'middle' },
    { role: 'assistant', message_id: 'a-new', dom_turn_id: 't-new', comparison_text: 'new' }
  ], { records: [{ role: 'assistant', message_id: 'a-middle', message: { content: { parts: ['middle'] } } }] });
  assert.deepEqual(Array.from(multiple, marker => marker.message_id), ['a-old', 'a-new']);
});

test('WorkStack continuation also selects same-ID Assistant content that is materially stale', () => {
  const { workStackMissingAssistantMarkers } = productionApi(['workStackMissingAssistantMarkers']);
  const live = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
  const result = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: 'same', dom_turn_id: 'turn-same', comparison_text: live }
  ], {
    records: [{
      role: 'assistant',
      message_id: 'same',
      message: { content: { parts: ['alpha beta gamma delta epsilon'] } }
    }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].message_id, 'same');
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

test('restored shared DOM Markdown extractor preserves representative #64 structures', () => {
  const { extractTurnChildrenMarkdown, extractTurnNodeMarkdown } = productionApi([
    'extractTurnNodeMarkdown',
    'extractTurnChildrenMarkdown'
  ]);
  const root = element('div', {}, [
    element('p', {}, [text('Plain '), element('strong', {}, [text('bold')]), text(' and '), element('em', {}, [text('emphasis')]), text(' with '), element('code', {}, [text('x < y')]), text('.')]),
    element('h3', {}, [text('Heading')]),
    element('ul', {}, [element('li', {}, [text('one')]), element('li', {}, [text('two')])]),
    element('blockquote', {}, [element('p', {}, [text('quoted')])]),
    element('p', {}, [element('a', { href: 'https://example.test/source' }, [text('source link')])]),
    element('pre', {}, [element('code', { class: 'language-js' }, [text('const x = 1;\nconsole.log(x);')])]),
    element('p', {}, [element('img', { alt: 'diagram', src: 'https://example.test/image.png' }, [])]),
    element('p', {}, [element('a', { href: 'https://example.test/file.zip', download: '' }, [text('attachment.zip')])])
  ]);
  const markdown = extractTurnChildrenMarkdown(root);
  assert.match(markdown, /Plain \*\*bold\*\* and \*emphasis\* with `x < y`\./);
  assert.match(markdown, /### Heading/);
  assert.match(markdown, /- one[\s\S]*- two/);
  assert.match(markdown, /> quoted/);
  assert.match(markdown, /\[source link\]\(https:\/\/example\.test\/source\)/);
  assert.match(markdown, /```js\nconst x = 1;\nconsole\.log\(x\);\n```/);
  assert.match(markdown, /!\[diagram\]\(https:\/\/example\.test\/image\.png\)/);
  assert.match(markdown, /\[attachment\.zip\]\(https:\/\/example\.test\/file\.zip\)/);
  assert.equal(extractTurnNodeMarkdown(text('literal text')), 'literal text');
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
  assert.match(extractor, /extractTurnChildrenMarkdown/,
    'extractTurn must delegate to the shared DOM Markdown extraction implementation.');
});
