import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const userscript = await readFile(new URL('../chatgpt-conversation-markdown-export.user.js', import.meta.url), 'utf8');

function extractTopLevelFunction(name) {
  const start = userscript.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing production function ${name}.`);
  const end = userscript.indexOf('\n  /**', start + 1);
  assert.ok(end > start, `Could not isolate production function ${name}.`);
  return userscript.slice(start, end);
}

class FakeHTMLElement {
  constructor(parent = null) {
    this.parent = parent;
    this.hidden = false;
    this.offsetParent = {};
    this.isConnected = true;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  focus() {
    fakeDocument.activeElement = this;
    this.parent?.emit('focusin', { target: this });
  }

  contains(element) {
    for (let current = element; current; current = current.parent) {
      if (current === this) return true;
    }
    return false;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }
}

class FakeButtonElement extends FakeHTMLElement {
  click() {}
}

class FakeTextAreaElement extends FakeHTMLElement {}

const fakeDocument = {
  activeElement: null,
  body: new FakeHTMLElement()
};

function productionModalContract() {
  const modalFocusableSource = extractTopLevelFunction('modalFocusableElements');
  const installSource = extractTopLevelFunction('installModalContract');
  const factory = new Function(
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLTextAreaElement',
    'document',
    `${modalFocusableSource}\n${installSource}\nreturn installModalContract;`
  );
  return factory(FakeHTMLElement, FakeButtonElement, FakeTextAreaElement, fakeDocument);
}

test('clicking non-control modal content preserves the focused control', () => {
  const dialog = new FakeHTMLElement();
  const overlay = new FakeHTMLElement();
  const runAll = new FakeButtonElement(dialog);
  const close = new FakeButtonElement(dialog);
  const staticContent = new FakeHTMLElement(dialog);
  const opener = new FakeButtonElement();

  overlay.querySelector = selector => selector === '[role="dialog"]' ? dialog : null;
  dialog.querySelectorAll = () => [runAll, close];
  staticContent.closest = () => null;

  const installModalContract = productionModalContract();
  installModalContract(overlay, { defaultButton: runAll, opener });
  assert.equal(fakeDocument.activeElement, runAll, 'The configured initial/default control should receive focus.');

  close.focus();
  assert.equal(fakeDocument.activeElement, close, 'The user should be able to move focus to another modal control.');

  // Chromium blurs a focused button when ordinary non-focusable dialog content is clicked.
  fakeDocument.activeElement = fakeDocument.body;
  dialog.emit('click', { target: staticContent });

  assert.equal(
    fakeDocument.activeElement,
    close,
    'Clicking non-control content must restore the modal control that was focused before the click.'
  );
});

test('clicking another control is not overridden by focus preservation', () => {
  const dialog = new FakeHTMLElement();
  const overlay = new FakeHTMLElement();
  const runAll = new FakeButtonElement(dialog);
  const close = new FakeButtonElement(dialog);

  overlay.querySelector = selector => selector === '[role="dialog"]' ? dialog : null;
  dialog.querySelectorAll = () => [runAll, close];
  runAll.closest = () => runAll;
  close.closest = () => close;

  const installModalContract = productionModalContract();
  installModalContract(overlay, { defaultButton: runAll });
  close.focus();
  dialog.emit('click', { target: close });

  assert.equal(fakeDocument.activeElement, close, 'Normal control focus must remain untouched.');
});
