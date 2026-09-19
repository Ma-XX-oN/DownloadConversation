import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { productionFunctionSource } from './helpers/userscript-source.mjs';

function harness() {
  const context = { structuredClone };
  vm.runInNewContext(`
    function streamTailClone(value) { return structuredClone(value); }
    function streamTailUpsertMessage(capture, message) {
      capture.stream_messages = [structuredClone(message)];
      return true;
    }
    ${productionFunctionSource('streamTailPointerSegment')}
    ${productionFunctionSource('streamTailApplyPathPatch')}
    this.apply = streamTailApplyPathPatch;
  `, context);
  return context.apply;
}

test('v1 object append to message metadata preserves existing exchange identity while adding completion fields', () => {
  const apply = harness();
  const exchangeId = 'd224d5a7-3ba9-4fd9-beb7-7d4c234e9b4d';
  const capture = {
    stream_messages: [],
    current_envelope: {
      message: {
        id: 'e30fde15-3d8c-4cb5-8275-502895162756',
        metadata: {
          request_id: '461ff2ed-8eea-424c-b858-a1c27fd09338',
          turn_exchange_id: exchangeId,
          working_turn_id: exchangeId,
          turn_id: '4f99570e-99fe-4a11-aef3-cbdea340a5b8'
        }
      }
    }
  };

  apply(capture, '/message/metadata', 'append', {
    is_complete: true,
    can_save: true,
    finish_details: { type: 'stop', stop_tokens: [200002] }
  });

  assert.equal(capture.current_envelope.message.metadata.turn_exchange_id, exchangeId,
    'Provider object append must not erase the existing exchange identity.');
  assert.equal(capture.current_envelope.message.metadata.request_id,
    '461ff2ed-8eea-424c-b858-a1c27fd09338');
  assert.equal(capture.current_envelope.message.metadata.is_complete, true);
  assert.equal(capture.current_envelope.message.metadata.can_save, true);
});
