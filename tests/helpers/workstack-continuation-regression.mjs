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

function laneApi() {
  return productionApi([
    'workStackLaneFromFirstUserText',
    'workStackVisibleMessageText',
    'workStackResolveLaneFromSpine'
  ]);
}

function missingApi(includeRecovery = false) {
  const names = [
    'workStackVisibleMessageText',
    'workStackLifecycleOnlyMarker',
    'workStackAssistantRecordFailed',
    'workStackMissingAssistantMarkers'
  ];
  if (includeRecovery) names.push('workStackRecoveryAssistantMarkers');
  return productionApi(names);
}

test('WorkStack lane binding reads only the first visible User turn and keeps recovery explicit', () => {
  const { workStackLaneFromFirstUserText, workStackResolveLaneFromSpine } = laneApi();

  assert.equal(workStackLaneFromFirstUserText('Continue WS:RW-001\ncontext'), 'RW-001');
  assert.equal(workStackLaneFromFirstUserText('prefix (WS:CORE_12.alpha-3), suffix'), 'CORE_12.alpha-3');
  assert.equal(workStackLaneFromFirstUserText('prefixXWS:WRONG'), null);
  assert.equal(workStackLaneFromFirstUserText('no lane here'), null);

  const fetching = workStackResolveLaneFromSpine({
    records: [{ role: 'assistant', message: { content: { parts: ['not first user'] } } }]
  });
  assert.equal(fetching.status, 'fetching');
  assert.equal(fetching.lane, null);

  const unbound = workStackResolveLaneFromSpine({ records: [
    { role: 'system', message: { content: { parts: ['system'] } } },
    { role: 'user', message: { content: { parts: ['first prompt has no token'] }, metadata: {} } },
    { role: 'user', message: { content: { parts: ['later WS:WRONG-999'] }, metadata: {} } }
  ] });
  assert.equal(unbound.status, 'unbound');
  assert.equal(unbound.lane, null);

  const bound = workStackResolveLaneFromSpine({ records: [
    {
      role: 'user',
      message: {
        content: { parts: ['internal'] },
        metadata: { is_visually_hidden_from_conversation: true }
      }
    },
    {
      role: 'user',
      message: { content: { parts: [{ text: 'Continue WS:RW-001' }] }, metadata: {} }
    },
    { role: 'assistant', message: { content: { parts: ['WS:OTHER-002'] }, metadata: {} } }
  ] });
  assert.equal(bound.status, 'bound');
  assert.equal(bound.lane, 'RW-001');
});

test('WorkStack continuation selects actual missing or failed Assistant markers, not the newest turn', () => {
  const { workStackMissingAssistantMarkers } = missingApi();
  const markers = [
    { role: 'user', message_id: 'u1', dom_turn_id: 'tu1', comparison_text: 'user one' },
    { role: 'assistant', message_id: 'a-missing-old', dom_turn_id: 'ta1', comparison_text: 'missing old reply' },
    { role: 'user', message_id: 'u2', dom_turn_id: 'tu2', comparison_text: 'user two' },
    { role: 'assistant', message_id: 'a-present-new', dom_turn_id: 'ta2', comparison_text: 'present newest reply' }
  ];
  const spine = { records: [
    { role: 'user', message_id: 'u1', message: { content: { parts: ['user one'] } } },
    { role: 'user', message_id: 'u2', message: { content: { parts: ['user two'] } } },
    {
      role: 'assistant',
      message_id: 'a-present-new',
      message: { status: 'finished_successfully', content: { parts: ['present newest reply'] }, metadata: {} }
    }
  ] };
  assert.deepEqual(
    Array.from(workStackMissingAssistantMarkers(markers, spine), marker => marker.message_id),
    ['a-missing-old']
  );

  const failed = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: 'a-failed', dom_turn_id: 't-failed', comparison_text: 'rendered answer' }
  ], { records: [{
    role: 'assistant',
    message_id: 'a-failed',
    message: { status: 'finished_error', content: { parts: ['rendered answer'] }, metadata: {} }
  }] });
  assert.deepEqual(Array.from(failed, marker => marker.message_id), ['a-failed']);

  const lifecycleOnly = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: null, dom_turn_id: 'error-banner', comparison_text: 'Message delivery timed out. Please try again.' }
  ], { records: [] });
  assert.equal(lifecycleOnly.length, 0);
});

test('WorkStack continuation also selects same-ID Assistant content that is materially stale', () => {
  const { workStackMissingAssistantMarkers } = missingApi();
  const live = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
  const result = workStackMissingAssistantMarkers([
    { role: 'assistant', message_id: 'same', dom_turn_id: 'turn-same', comparison_text: live }
  ], {
    records: [{
      role: 'assistant',
      message_id: 'same',
      message: {
        status: 'finished_successfully',
        content: { parts: ['alpha beta gamma delta epsilon'] },
        metadata: {}
      }
    }]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].message_id, 'same');
});

test('WorkStack recovery uses failures when present and otherwise falls back to the newest usable Assistant', () => {
  const { workStackRecoveryAssistantMarkers } = missingApi(true);
  const markers = [
    { role: 'assistant', message_id: 'a-old', dom_turn_id: 'old', comparison_text: 'old missing' },
    { role: 'assistant', message_id: 'a-new', dom_turn_id: 'new', comparison_text: 'new persisted' }
  ];
  const withFailure = workStackRecoveryAssistantMarkers(markers, { records: [{
    role: 'assistant',
    message_id: 'a-new',
    message: { status: 'finished_successfully', content: { parts: ['new persisted'] }, metadata: {} }
  }] });
  assert.deepEqual(Array.from(withFailure, marker => marker.message_id), ['a-old']);

  const complete = workStackRecoveryAssistantMarkers(markers, { records: markers.map(marker => ({
    role: 'assistant',
    message_id: marker.message_id,
    message: {
      status: 'finished_successfully',
      content: { parts: [marker.comparison_text] },
      metadata: {}
    }
  })) });
  assert.deepEqual(Array.from(complete, marker => marker.message_id), ['a-new']);
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
    element('p', {}, [
      text('Plain '),
      element('strong', {}, [text('bold')]),
      text(' and '),
      element('em', {}, [text('emphasis')]),
      text(' with '),
      element('code', {}, [text('x ` y')]),
      text('.')
    ]),
    element('h3', {}, [text('Heading')]),
    element('ul', {}, [element('li', {}, [text('one')]), element('li', {}, [text('two')])]),
    element('blockquote', {}, [element('p', {}, [text('quoted')])]),
    element('p', {}, [element('a', { href: 'https://example.test/source' }, [text('source link')])]),
    element('pre', {}, [element('code', { class: 'language-js' }, [text('const x = 1;\nconsole.log(x);')])]),
    element('p', {}, [element('img', { alt: 'diagram', src: 'https://example.test/image.png' }, [])]),
    element('p', {}, [element('a', { href: 'https://example.test/file.zip', download: '' }, [text('attachment.zip')])])
  ]);
  const markdown = extractTurnChildrenMarkdown(root);
  assert.match(markdown, /Plain \*\*bold\*\* and \*emphasis\* with ``x ` y``\./);
  assert.match(markdown, /### Heading/);
  assert.match(markdown, /- one[\s\S]*- two/);
  assert.match(markdown, /> quoted/);
  assert.match(markdown, /\[source link\]\(https:\/\/example\.test\/source\)/);
  assert.match(markdown, /```js\nconst x = 1;\nconsole\.log\(x\);\n```/);
  assert.match(markdown, /!\[diagram\]\(https:\/\/example\.test\/image\.png\)/);
  assert.match(markdown, /\[attachment\.zip\]\(https:\/\/example\.test\/file\.zip\)/);
  assert.equal(extractTurnNodeMarkdown(text('literal text')), 'literal text');
});

test('extractTurn uses the shared extractor and rejects unusable Assistant DOM turns', () => {
  const { extractTurnChildrenMarkdown, extractTurnNodeMarkdown, extractTurn } = productionApi([
    'extractTurnNodeMarkdown',
    'extractTurnChildrenMarkdown',
    'extractTurn'
  ]);
  void extractTurnChildrenMarkdown;
  void extractTurnNodeMarkdown;
  const message = element('div', {
    'data-message-author-role': 'assistant',
    'data-message-id': 'a1'
  }, [element('p', {}, [text('Recovered reply.')])]);
  const section = element('section', { 'data-turn': 'assistant', 'data-turn-id': 'turn-a1' }, [message]);
  section.querySelector = selector => selector.includes('[data-message') ? message : null;
  assert.equal(extractTurn(section), '## Assistant\n\nRecovered reply.');

  const empty = element('section', { 'data-turn': 'assistant', 'data-turn-id': 'turn-empty' }, []);
  empty.querySelector = () => null;
  assert.throws(() => extractTurn(empty), /no usable Markdown content/i);
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
  assert.match(transaction, /workStackRecoveryAssistantMarkers/);
  assert.match(transaction, /workStackCorrelateTailCandidates/);
  assert.match(transaction, /extractTurn\(/,
    'Correlated DOM turns must pass through the shared historical extraction seam.');
  assert.match(transaction, /navigator\.clipboard\.writeText/);
  assert.match(transaction, /exportInProgress \|\| testInProgress \|\| jumpInProgress/,
    'CONTINUE must not claim success when the authoritative exporter cannot start.');
  assert.match(transaction, /runExport\(\['md'\]/);
  assert.match(transaction, /forceTimestamps:\s*true/);
  assert.match(transaction, /showTimestamps = exportOptions\.forceTimestamps/);
  assert.match(transaction, /Markdown extraction failed:/);
  assert.match(transaction, /window\.open\(/,
    'Required browsing contexts must be reserved from the user gesture.');

  const settle = productionFunctionSource('workStackAwaitTailSettled');
  assert.match(settle, /still active/,
    'A handoff must fail visibly instead of freezing an Assistant turn that is still active.');

  const extractor = productionFunctionSource('extractTurn');
  assert.match(extractor, /extractTurnChildrenMarkdown/,
    'extractTurn must delegate to the shared DOM Markdown extraction implementation.');
});

test('WorkStack production remains a separate subsystem from stopwatch lifecycle source', () => {
  assert.match(userscript, /BEGIN Issue #163 WorkStack continuation state/);
  assert.match(userscript, /BEGIN Issue #163 shared DOM Markdown extraction/);
  assert.match(userscript, /BEGIN Issue #163 WorkStack continuation UI\/transaction/);
  assert.doesNotMatch(
    productionFunctionSource('agentStopwatchRender'),
    /workStackState|WorkStack|CONTINUE/,
    'Stopwatch rendering must remain independent from WorkStack lane/handoff state.'
  );
});
