import assert from 'node:assert/strict';
import test from 'node:test';
import { productionFunctionSource, userscript } from './helpers/userscript-source.mjs';

const retiredTerminalHelpers = Object.freeze([
  'agentSoundTerminalKey',
  'agentSoundClassifyTerminal',
  'agentSoundObserveTerminal',
  'agentStopwatchSuccessfulFinal',
  'agentStopwatchObserveTerminal'
]);

test('retired #140 terminal helpers have no production call sites', () => {
  for (const name of retiredTerminalHelpers) {
    assert.doesNotMatch(userscript, new RegExp(`\\b${name}\\s*\\(`),
      `Retired terminal helper ${name} must not remain callable in production.`);
  }
});

test('shared terminal normalizer exclusively derives the terminal key', () => {
  const references = userscript.match(/\bagentTerminalKey\s*\(/g) ?? [];
  assert.equal(references.length, 2,
    'agentTerminalKey must appear only in its declaration and the shared normalizer.');
  assert.match(productionFunctionSource('agentTerminalNormalize'),
    /terminal_key:\s*agentTerminalKey\(capture, exchangeId, finalMessage\)/);
  assert.doesNotMatch(productionFunctionSource('agentTerminalObserveStatsRequest'),
    /TerminalKey\s*\(/,
    'Provider observers must dispatch evidence without deriving terminal identity themselves.');
});
