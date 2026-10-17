import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../src/userscript/' + name,
  import.meta.url), 'utf8');
test('#127 live test matrix includes actionable three-stage capture and export', () => {
  const ui = read('06-image-export-tests/04-tests-modal-transition.js');
  const modal = read('06-image-export-tests/05-modal-contract.js');
  for (const label of ['AICC #127 staged artifact', 'AICC #127 live project identity',
    'AICC #127 live standalone', ]) {
    assert.ok(ui.includes(label), label + ' missing');
  }
  assert.ok(modal.includes('Export #127 evidence'));
  assert.ok(modal.includes("name.startsWith('AICC #127') ? 'Live'"));
  assert.match(ui, /result\?\.status === 'INCOMPLETE'/);
  assert.match(modal, /aicc127ExportEvidence\(\)/);
});
test('#127 uses existing fetch and XHR events, never initiates identity traffic', () => {
  const live = read('06-image-export-tests/07-issue127-live-test.js');
  const fetchStart = read('02-network-communication/01-stock-network-identities.js');
  const xhr = read('02-network-communication/02-stock-network-responses.js');
  assert.match(fetchStart, /aicc127LiveOnRequest\(trace\)/);
  assert.match(fetchStart, /aicc127LiveOnFetchResponse\(trace, response.status, bounded\)/);
  assert.match(xhr, /aicc127LiveOnXhrResponse\(xhr, trace\)/);
  assert.doesNotMatch(live, /\bfetch\s*\(|XMLHttpRequest\s*\(|GM_xmlhttpRequest\s*\(/);
  assert.match(live, /Object\.hasOwn\(body, 'gizmo_id'\) && body\.gizmo_id === null/);
  assert.match(live, /sessionStorage\.setItem/);
  assert.doesNotMatch(live, /JSON\.stringify\(body\)|JSON\.stringify\(snapshot\)/);
});
