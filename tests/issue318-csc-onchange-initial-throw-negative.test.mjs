import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const schema = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-schema.js',
  import.meta.url), 'utf8');
const control = readFileSync(new URL(
  '../src/userscript/07-panel-launcher/03-csc-control-plane.js',
  import.meta.url), 'utf8');

test('initial UI observer exception does not escape onChange or poison later observers',
  async () => {
    const context = vm.createContext({});
    vm.runInContext(schema + control +
      '\nthis.create=cscCaptureControlPlane;', context);
    const store = {
      read: async () => null,
      subscribe: () => () => {},
      dispose: () => {}
    };
    const controls = context.create({store, origin:'https://chatgpt.com',
      version:'1.11.15-issue.318.34'});
    let healthyNotifications = 0;
    assert.doesNotThrow(() => controls.onChange(() => {
      throw Error('injected-initial-render-failure');
    }));
    assert.doesNotThrow(() => controls.onChange(() => {
      healthyNotifications += 1;
    }));
    assert.equal(healthyNotifications, 1);
    await assert.doesNotReject(controls.init());
    assert.ok(healthyNotifications >= 2,
      'healthy observer still receives model refresh after failed UI render');
    controls.dispose();
  });
