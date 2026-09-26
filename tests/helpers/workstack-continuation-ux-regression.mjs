import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './userscript-source.mjs';

function productionApi(names) {
  const context = { URL };
  const source = names.map(productionFunctionSource).join('\n');
  const exports = names.join(',');
  vm.runInNewContext(`${source}\nthis.api={${exports}};`, context);
  return context.api;
}

test('WorkStack lane token is anchored at the first User message start', () => {
  const { workStackLaneFromFirstUserText } = productionApi([
    'workStackLaneFromFirstUserText'
  ]);

  assert.equal(workStackLaneFromFirstUserText('WS:DC-166\ncontext'), 'DC-166');
  assert.equal(
    workStackLaneFromFirstUserText('  \nContinue WS:CORE-034\ncontext'),
    'CORE-034'
  );
  assert.equal(
    workStackLaneFromFirstUserText('prefix WS:DC-157'),
    null,
    'A later WS token in prose must not bind the chat.'
  );
  assert.equal(
    workStackLaneFromFirstUserText('prefix Continue WS:DC-157'),
    null,
    'Continue WS must also be at the beginning after whitespace.'
  );
});

test('WorkStack distinguishes new chat from existing recovery', () => {
  const names = [
    'workStackIsBrandNewChatLocation',
    'workStackControlMode',
    'workStackRepoUrl'
  ];
  for (const name of names) {
    assert.doesNotThrow(
      () => productionFunctionSource(name),
      `Production ${name}() is required.`
    );
  }

  const {
    workStackIsBrandNewChatLocation,
    workStackControlMode,
    workStackRepoUrl
  } = productionApi(names);

  assert.equal(
    workStackIsBrandNewChatLocation('https://chatgpt.com/'),
    true
  );
  assert.equal(
    workStackIsBrandNewChatLocation(
      'https://chatgpt.com/g/g-p-example/project'
    ),
    true
  );
  assert.equal(
    workStackIsBrandNewChatLocation(
      'https://chatgpt.com/g/g-p-example/c/conversation-1'
    ),
    false
  );
  assert.equal(
    workStackIsBrandNewChatLocation('https://chatgpt.com/settings'),
    false
  );

  assert.equal(
    workStackControlMode(null, 'fetching', 'https://chatgpt.com/'),
    'picker'
  );
  assert.equal(
    workStackControlMode(
      null,
      'fetching',
      'https://chatgpt.com/g/g-p-example/project'
    ),
    'picker'
  );
  assert.equal(
    workStackControlMode(
      'conversation-1',
      'fetching',
      'https://chatgpt.com/c/conversation-1'
    ),
    'fetching'
  );
  assert.equal(
    workStackControlMode(
      'conversation-1',
      'unbound',
      'https://chatgpt.com/c/conversation-1'
    ),
    'unbound'
  );
  assert.equal(
    workStackControlMode(
      'conversation-1',
      'bound',
      'https://chatgpt.com/c/conversation-1'
    ),
    'bound'
  );
  assert.equal(
    workStackControlMode(null, 'fetching', 'https://chatgpt.com/settings'),
    'hidden'
  );

  assert.equal(
    workStackRepoUrl(),
    'https://github.com/Ma-XX-oN/WorkStack/blob/main/parallel/BOARD.md'
  );
});

test('bound WorkStack UI reveals CONTINUE on hover or focus', () => {
  const control = productionFunctionSource('ensureWorkStackControl');
  const styles = productionFunctionSource('ensureWorkStackStyles');
  const position = productionFunctionSource('workStackPositionControl');

  assert.match(control, /workstack-continue/);
  assert.match(
    control,
    /title\s*=\s*['"][^'"]*WorkStack[^'"]*handoff/i,
    'CONTINUE must expose an explanatory tooltip.'
  );
  assert.match(styles, /workstack-continue/);
  assert.match(
    styles,
    /max-width:\s*0/,
    'CONTINUE must consume no permanent width at rest.'
  );
  assert.match(styles, /opacity:\s*0/);
  assert.match(
    styles,
    /:hover[\s\S]*workstack-continue/,
    'Pointer hover must reveal CONTINUE.'
  );
  assert.match(
    styles,
    /:focus-within[\s\S]*workstack-continue/,
    'Keyboard focus must reveal CONTINUE.'
  );
  assert.match(
    styles,
    /transition:/,
    'Reveal and collapse must animate.'
  );
  assert.match(
    position,
    /right\s*=\s*['"]16px['"]/,
    'A right anchor makes increasing width grow leftward.'
  );
});

test('brand-new picker opens WorkStack lane board without cross-site fetch', () => {
  const names = ['workStackOpenLanePicker', 'workStackRepoUrl'];
  for (const name of names) {
    assert.doesNotThrow(
      () => productionFunctionSource(name),
      `Production ${name}() is required.`
    );
  }
  const opener = productionFunctionSource('workStackOpenLanePicker');
  const control = productionFunctionSource('ensureWorkStackControl');

  assert.match(opener, /window\.open\(/);
  assert.match(opener, /workStackRepoUrl\(\)/);
  assert.doesNotMatch(
    opener,
    /\bfetch\s*\(/,
    'The userscript must use the browser GitHub session.'
  );
  assert.match(control, /WS:\s*PICK LANE/);
  assert.match(
    control,
    /workStackOpenLanePicker/,
    'The picker button must invoke the WorkStack browser opener.'
  );
  assert.match(
    productionFunctionSource('workStackRender'),
    /review available lanes|available lanes/i,
    'The lane picker needs an explanatory tooltip.'
  );
});

test('bound lane label opens only its WorkStack description page', () => {
  const names = [
    'workStackLaneDescriptionUrl',
    'workStackOpenLaneDescription'
  ];
  for (const name of names) {
    assert.doesNotThrow(
      () => productionFunctionSource(name),
      `Production ${name}() is required.`
    );
  }

  const { workStackLaneDescriptionUrl } = productionApi([
    'workStackLaneDescriptionUrl'
  ]);
  assert.equal(
    workStackLaneDescriptionUrl('RW-001'),
    [
      'https://github.com/Ma-XX-oN/WorkStack/tree/main/parallel/lanes/',
      'RW-001'
    ].join('')
  );

  const opener = productionFunctionSource('workStackOpenLaneDescription');
  assert.match(opener, /window\.open\(/);
  assert.match(opener, /workStackLaneDescriptionUrl\(/);
  assert.doesNotMatch(opener, /\bfetch\s*\(/);
  assert.doesNotMatch(opener, /handleWorkStackContinue/);

  const control = productionFunctionSource('ensureWorkStackControl');
  assert.match(control, /workstack-lane-link/);
  assert.match(control, /workStackOpenLaneDescription/);
});
