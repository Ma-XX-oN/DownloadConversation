import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function auditHarness() {
  const links = [
    { rel: 'icon', href: 'data:image/png;render=1' },
    { rel: 'icon', href: 'data:image/png;render=2' }
  ];
  const expectedEntries = links.map(link => [link, link.href]);
  const context = {
    diagnostics: [],
    expectedEntries,
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, 'link[rel~="icon"]');
        return links;
      }
    }
  };
  vm.runInNewContext(`
    let agentFaviconDesiredState = 'processing';
    const agentFaviconProjectedSources = new WeakMap();
    for (const [link, href] of this.expectedEntries) {
      agentFaviconProjectedSources.set(link, href);
    }
    function logDiagnostic(level, name, details) {
      this.diagnostics.push({ level, name, details });
    }
    ${productionFunctionSource('agentFaviconAuditProjection')}
    this.audit = agentFaviconAuditProjection;
    this.setState = state => { agentFaviconDesiredState = state; };
  `, context);
  return { context, links };
}

test('favicon projection audit is quiet while every candidate retains its exact generated href', () => {
  const harness = auditHarness();
  assert.equal(harness.context.audit('mutation'), true);
  assert.deepEqual(harness.context.diagnostics, []);
});

test('favicon projection audit reports a stock candidate restored after colored state', () => {
  const harness = auditHarness();
  harness.links[1].href = 'https://chatgpt.com/favicon-48x48.png';

  assert.equal(harness.context.audit('mutation'), false);
  assert.equal(harness.context.diagnostics.length, 1);
  assert.equal(harness.context.diagnostics[0].level, 'warnings');
  assert.equal(harness.context.diagnostics[0].name, 'agent-favicon-projection-overwritten');
  assert.deepEqual(harness.context.diagnostics[0].details, {
    state: 'processing',
    reason: 'mutation',
    candidate_count: 2,
    unprojected_candidate_count: 1
  });
});

test('favicon projection audit reports replacement icon candidates with no projected identity', () => {
  const harness = auditHarness();
  harness.links.push({ rel: 'icon', href: 'https://chatgpt.com/new-hydrated-icon.svg' });

  assert.equal(harness.context.audit('mutation'), false);
  assert.equal(harness.context.diagnostics.length, 1);
  assert.equal(harness.context.diagnostics[0].details.candidate_count, 3);
  assert.equal(harness.context.diagnostics[0].details.unprojected_candidate_count, 1);
});

test('favicon projection audit ignores stock links while desired state is original', () => {
  const harness = auditHarness();
  harness.context.setState('original');
  harness.links[0].href = 'https://chatgpt.com/favicon-32x32.png';
  harness.links[1].href = 'https://chatgpt.com/favicon-48x48.png';

  assert.equal(harness.context.audit('mutation'), true);
  assert.deepEqual(harness.context.diagnostics, []);
});
