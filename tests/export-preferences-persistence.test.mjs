import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../src/userscript/' + path,
  import.meta.url), 'utf8');
const bootstrap = read('07-panel-launcher/05-bootstrap.js');
const panelBindings = read('07-panel-launcher/04-launcher-removal-part2.js');

const begin = bootstrap.indexOf('    for (const [role, key, fallback] of [');
const finish = bootstrap.indexOf("    panel.addEventListener('mouseleave'", begin);
assert.ok(begin >= 0 && finish > begin);
const formatBinding = bootstrap.slice(begin, finish);

const compressionStart = panelBindings.indexOf(
  "    const exportCompression = panel.querySelector('[data-role=\"export-compression\"]');");
const compressionEnd = panelBindings.indexOf('    const soundControl = ', compressionStart);
assert.ok(compressionStart >= 0 && compressionEnd > compressionStart);
const compressionBinding = panelBindings.slice(compressionStart, compressionEnd);

class Input {
  constructor() { this.checked = false; this.handlers = new Map(); }
  addEventListener(type, listener) { this.handlers.set(type, listener); }
  change(value) { this.checked = value; this.handlers.get('change')(); }
}
class Button {
  constructor() { this.handlers = new Map(); this.innerHTML = ''; }
  addEventListener(type, listener) { this.handlers.set(type, listener); }
  click() { this.handlers.get('click')(); }
}

function newDocument(data) {
  const jsonl = new Input();
  const md = new Input();
  const compression = new Button();
  const controls = new Map([
    ['format-jsonl', jsonl], ['format-md', md],
    ['export-compression', compression]
  ]);
  const localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value)
  };
  let updates = 0;
  const context = {
    HTMLInputElement: Input,
    panel: {
      querySelector: selector => controls.get(
        selector.match(/data-role="([^"]+)"/)?.[1]) ?? null
    },
    localStorage,
    EXPORT_JSONL_STORAGE_KEY: 'tm-conversation-recorder-export-jsonl',
    EXPORT_MD_STORAGE_KEY: 'tm-conversation-recorder-export-md',
    EXPORT_COMPRESSION_STORAGE_KEY: 'tm-conversation-recorder-export-compressed',
    exportCompressionEnabled: data.get(
      'tm-conversation-recorder-export-compressed') === 'true',
    exportCompressionIconMarkup: compressed => compressed ? 'small' : 'large',
    updateUi: () => { updates += 1; }
  };
  vm.createContext(context);
  vm.runInContext(formatBinding + compressionBinding, context);
  return { jsonl, md, compression, context, updates: () => updates };
}

test('defaults, changes, reloads and changed selections all persist', () => {
  const data = new Map();
  const first = newDocument(data);
  assert.equal(first.jsonl.checked, false);
  assert.equal(first.md.checked, true);
  assert.equal(first.context.exportCompressionEnabled, false);
  first.jsonl.change(true);
  first.md.change(false);
  first.compression.click();
  assert.equal(first.context.exportCompressionEnabled, true);
  assert.equal(first.updates(), 3);

  const second = newDocument(data);
  assert.equal(second.jsonl.checked, true);
  assert.equal(second.md.checked, false);
  assert.equal(second.context.exportCompressionEnabled, true);
  assert.equal(second.compression.innerHTML, 'small');
  second.jsonl.change(false);
  second.md.change(true);
  second.compression.click();

  const third = newDocument(data);
  assert.equal(third.jsonl.checked, false);
  assert.equal(third.md.checked, true);
  assert.equal(third.context.exportCompressionEnabled, false);
  assert.equal(third.compression.innerHTML, 'large');
});

test('explicit false preferences never fall back to HTML defaults', () => {
  const data = new Map([
    ['tm-conversation-recorder-export-jsonl', 'false'],
    ['tm-conversation-recorder-export-md', 'false'],
    ['tm-conversation-recorder-export-compressed', 'false']
  ]);
  const state = newDocument(data);
  assert.equal(state.jsonl.checked, false);
  assert.equal(state.md.checked, false);
  assert.equal(state.context.exportCompressionEnabled, false);
});
