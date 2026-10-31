'use strict';
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { groupLinesIntoParagraphs, composeText } = require('../dist/engine.js');
const { splitLine, mapPaddleLines, createPaddleEngine } = require('../dist/engine-paddle.js');

// Words get a slice of the line box proportional to their character count.
const words = splitLine('No acute  bleed', { x0: 0, y0: 10, x1: 150, y1: 30 }, 0.8);
assert.deepEqual(
  words.map((w) => [w.text, w.box.x0, w.box.x1, w.confidence]),
  [
    ['No', 0, 20, 0.8],
    ['acute', 30, 80, 0.8],
    ['bleed', 100, 150, 0.8],
  ],
);
for (const w of words) assert.deepEqual([w.box.y0, w.box.y1], [10, 30]);

// Visual lines become Lines; overall confidence is the mean line score.
const item = (text, x, y, confidence) => ({
  text,
  confidence,
  box: { x, y, width: 10 * text.length, height: 20 },
});
const mapped = mapPaddleLines(
  [
    [item('FINDINGS:', 0, 0, 0.9)],
    [item('No acute', 0, 25, 0.8), item('bleed.', 100, 25, 0.6)],
    [item('   ', 0, 50, 0.1)],
    [item('IMPRESSION:', 0, 200, 0.5)],
  ],
  groupLinesIntoParagraphs,
);
assert.equal(mapped.engine, 'paddleocr');
assert.equal(composeText(mapped).text, 'FINDINGS:\nNo acute bleed.\n\nIMPRESSION:');
assert.equal(mapped.paragraphs[0].lines[1].confidence, 0.7);
assert.ok(Math.abs(mapped.confidence - (0.9 + 0.7 + 0.5) / 3) < 1e-9);
assert.deepEqual(mapped.paragraphs[0].lines[1].box, { x0: 0, y0: 25, x1: 160, y1: 45 });
assert.equal(mapPaddleLines([], groupLinesIntoParagraphs).confidence, 0);

// The engine loads its parts once, forces one WASM thread, adds the space character
// and accepts both a canvas and a PNG Buffer.
(async () => {
  const calls = { create: 0, recognize: [], destroy: 0 };
  const ort = { env: { wasm: { numThreads: 4 } } };
  const library = {
    PaddleOcrService: {
      async createInstance(options) {
        calls.create++;
        calls.options = options;
        return {
          async recognize(pixels, { onProgress }) {
            calls.recognize.push([pixels.width, pixels.height, pixels.data.length]);
            onProgress({ type: 'rec', stage: 'item', progress: { current: 1, total: 2 } });
            return ['raw'];
          },
          processRecognition(results, options) {
            assert.deepEqual(results, ['raw']);
            assert.equal(options.recognitionScoreThreshold, 0);
            return { lines: [[item('Hello world', 0, 0, 0.75)]] };
          },
          async destroy() {
            calls.destroy++;
          },
        };
      },
    },
  };
  const files = { det: 'D', rec: 'R', dict: 'a\nb\n' };
  const progress = [];
  const engine = createPaddleEngine({
    ort: () => ort,
    paddle: library,
    modelUrls: { detection: 'det', recognition: 'rec', dictionary: 'dict' },
    readFile: async (name) => new TextEncoder().encode(files[name]).buffer,
    onProgress: (m) => progress.push(m),
  });
  assert.equal(engine.name, 'paddleocr');
  const canvas = createCanvas(30, 20);
  const result = await engine.recognise(canvas, { mode: 'photo' });
  assert.equal(composeText(result).text, 'Hello world');
  assert.equal(result.confidence, 0.75);
  await engine.recognise(canvas.toBuffer('image/png'), { mode: 'photo' });
  assert.equal(calls.create, 1);
  assert.equal(ort.env.wasm.numThreads, 1);
  assert.deepEqual(calls.options.recognition.charactersDictionary, ['a', 'b', ' ']);
  assert.equal(calls.options.modelPreset, 'PP-OCRv5_mobile');
  assert.equal(calls.options.detection.limitType, 'min');
  assert.deepEqual(calls.recognize, [
    [30, 20, 30 * 20 * 4],
    [30, 20, 30 * 20 * 4],
  ]);
  assert.deepEqual(progress[0], { status: 'loading PaddleOCR', progress: 0 });
  assert.deepEqual(progress[1], { status: 'recognizing text', progress: 0.5 });
  await engine.terminate();
  assert.equal(calls.destroy, 1);

  // A failed start is reported and retried on the next call.
  let attempts = 0;
  const failing = createPaddleEngine({
    ort,
    paddle: async () => {
      if (++attempts === 1) throw new Error('no wasm');
      return library;
    },
    modelUrls: { detection: 'det', recognition: 'rec', dictionary: 'dict' },
    readFile: async (name) => new TextEncoder().encode(files[name]).buffer,
  });
  await assert.rejects(failing.recognise(canvas, {}), /no wasm/);
  assert.equal(composeText(await failing.recognise(canvas, {})).text, 'Hello world');
  await failing.terminate();

  console.log('paddle engine tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
