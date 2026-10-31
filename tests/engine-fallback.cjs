'use strict';
const assert = require('node:assert/strict');
const { createEngineWithFallback } = require('../dist/engine.js');

(async () => {
  const fixed = { paragraphs: [], engine: 'fallback', version: '1', confidence: 0.5 };
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const notices = [];
  const primary = {
    name: 'primary',
    version: '2',
    async recognise() {
      primaryCalls++;
      throw new Error('OOM');
    },
    async terminate() {},
  };
  const fallback = {
    name: 'fallback',
    version: '1',
    async recognise(image, options) {
      fallbackCalls++;
      assert.equal(image, 'image');
      assert.deepEqual(options, { mode: 'photo' });
      return fixed;
    },
    async terminate() {},
  };
  const engine = createEngineWithFallback(primary, fallback, (error) => notices.push(error));
  assert.equal(engine.name, 'primary');

  // The first call fails over to the fallback and reports the error once.
  assert.equal(await engine.recognise('image', { mode: 'photo' }), fixed);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].message, 'OOM');
  assert.equal(engine.name, 'fallback');
  assert.equal(engine.version, '1');

  // Later calls go straight to the fallback.
  assert.equal(await engine.recognise('image', { mode: 'photo' }), fixed);
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 2);
  assert.equal(notices.length, 1);

  // Switching releases the primary (e.g. PaddleOCR's memory after an OOM), even when its
  // terminate fails.
  let released = 0;
  const leaky = createEngineWithFallback(
    {
      ...primary,
      terminate: async () => {
        released++;
        throw new Error('already gone');
      },
    },
    fallback,
    () => {},
  );
  assert.equal(await leaky.recognise('image', { mode: 'photo' }), fixed);
  assert.equal(released, 1);

  // terminate stops both engines.
  const stopped = [];
  const both = createEngineWithFallback(
    { ...primary, terminate: async () => stopped.push('primary') },
    { ...fallback, terminate: async () => stopped.push('fallback') },
    () => {},
  );
  await both.terminate();
  assert.deepEqual(stopped.sort(), ['fallback', 'primary']);

  // A primary that works is used and the fallback is never called.
  const ok = createEngineWithFallback(
    { ...primary, recognise: async () => ({ ...fixed, engine: 'primary' }) },
    { ...fallback, recognise: async () => assert.fail('fallback used') },
    () => assert.fail('onFallback called'),
  );
  assert.equal((await ok.recognise('image', { mode: 'photo' })).engine, 'primary');

  console.log('engine fallback tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
