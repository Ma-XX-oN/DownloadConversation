import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './userscript-source.mjs';

function productionApi(names) {
  const context = { URL };
  vm.runInNewContext(`${names.map(productionFunctionSource).join('\n')}\nthis.api={${names.join(',')}};`, context);
  return context.api;
}

test('WorkStack control distinguishes a brand-new chat from existing-chat recovery', () => {
  for (const name of ['workStackIsBrandNewChatLocation', 'workStackControlMode', 'workStackRepoUrl']) {
    assert.doesNotThrow(() => productionFunctionSource(name), `Production ${name}() is required.`);
  }

  const { workStackIsBrandNewChatLocation, workStackControlMode, workStackRepoUrl } = productionApi([
    'workStackIsBrandNewChatLocation',
    'workStackControlMode',
    'workStackRepoUrl'
  ]);

  assert.equal(workStackIsBrandNewChatLocation('https://chatgpt.com/'), true);
  assert.equal(
    workStackIsBrandNewChatLocation('https://chatgpt.com/g/g-p-example/project'),
    true
  );
  assert.equal(
    workStackIsBrandNewChatLocation('https://chatgpt.com/g/g-p-example/c/conversation-1'),
    false
  );
  assert.equal(workStackIsBrandNewChatLocation('https://chatgpt.com/settings'), false);

  assert.equal(workStackControlMode(null, 'fetching', 'https://chatgpt.com/'), 'picker');
  assert.equal(
    workStackControlMode(null, 'fetching', 'https://chatgpt.com/g/g-p-example/project'),
    'picker'
  );
  assert.equal(
    workStackControlMode('conversation-1', 'fetching', 'https://chatgpt.com/c/conversation-1'),
    'fetching',
    'Existing-chat recovery must not be confused with pre-first-message lane selection.'
  );
  assert.equal(
    workStackControlMode('conversation-1', 'unbound', 'https://chatgpt.com/c/conversation-1'),
    'unbound',
    'A recovered first User turn without WS: remains genuinely unbound.'
  );
  assert.equal(
    workStackControlMode('conversation-1', 'bound', 'https://chatgpt.com/c/conversation-1'),
    'bound'
  );
  assert.equal(workStackControlMode(null, 'fetching', 'https://chatgpt.com/settings'), 'hidden');

  assert.equal(workStackRepoUrl(), 'https://github.com/Ma-XX-oN/WorkStack');
});

test('bound WorkStack UI reveals CONTINUE only on hover/focus and expands from the right anchor', () => {
  const ensureControl = productionFunctionSource('ensureWorkStackControl');
  const ensureStyles = productionFunctionSource('ensureWorkStackStyles');
  const position = productionFunctionSource('workStackPositionControl');

  assert.match(ensureControl, /data-role.*workstack-continue|dataset\.role\s*=\s*['"]workstack-continue['"]/);
  assert.match(ensureControl, /title\s*=\s*['"][^'"]*WorkStack[^'"]*handoff/i,
    'CONTINUE must expose an explanatory tooltip.');
  assert.match(ensureStyles, /workstack-continue/);
  assert.match(ensureStyles, /max-width:\s*0/,
    'CONTINUE must consume no permanent width at rest.');
  assert.match(ensureStyles, /opacity:\s*0/);
  assert.match(ensureStyles, /:hover[\s\S]*workstack-continue/,
    'Pointer hover must reveal CONTINUE.');
  assert.match(ensureStyles, /:focus-within[\s\S]*workstack-continue/,
    'Keyboard focus must reveal CONTINUE.');
  assert.match(ensureStyles, /transition:/,
    'Reveal/collapse must animate rather than jump.');
  assert.match(position, /right\s*=\s*['"]16px['"]/,
    'A right-anchored control grows leftward when its width increases.');
});

test('brand-new WorkStack picker opens the repository without cross-site fetching', () => {
  for (const name of ['workStackOpenLanePicker', 'workStackRepoUrl']) {
    assert.doesNotThrow(() => productionFunctionSource(name), `Production ${name}() is required.`);
  }
  const opener = productionFunctionSource('workStackOpenLanePicker');
  const control = productionFunctionSource('ensureWorkStackControl');

  assert.match(opener, /window\.open\(/);
  assert.match(opener, /workStackRepoUrl\(\)/);
  assert.doesNotMatch(opener, /\bfetch\s*\(/,
    'The userscript must rely on the browser/GitHub session instead of fetching private WorkStack data.');
  assert.match(control, /WS:\s*PICK LANE/,
    'Pre-first-message state must provide a compact lane-selection action.');
  assert.match(control, /workstack-picker/);
  assert.match(control, /review available lanes|available lane/i,
    'The lane picker needs an explanatory tooltip.');
});
