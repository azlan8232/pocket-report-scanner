'use strict';
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { groupLinesIntoParagraphs, composeText } = require('../dist/engine.js');
const {
  splitLine,
  mapPaddleLines,
  createPaddleEngine,
  createPaddleWorkerEngine,
  servePaddleWorker,
  PADDLE_LOAD_TIMEOUT_MS,
} = require('../dist/engine-paddle.js');

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
  let failInitialize = false;
  class PaddleOcrService {
    constructor(options) {
      calls.create++;
      calls.options = options;
    }
    async initialize() {
      if (failInitialize) throw new Error('rec model failed');
    }
    async recognize(pixels, { onProgress }) {
      calls.recognize.push([pixels.width, pixels.height, pixels.data.length]);
      onProgress({ type: 'rec', stage: 'item', progress: { current: 1, total: 2 } });
      return ['raw'];
    }
    processRecognition(results, options) {
      assert.deepEqual(results, ['raw']);
      assert.equal(options.recognitionScoreThreshold, 0);
      return { lines: [[item('Hello world', 0, 0, 0.75)]] };
    }
    async destroy() {
      calls.destroy++;
    }
  }
  const library = { PaddleOcrService };
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

  // A start that fails part-way releases the sessions that did load.
  failInitialize = true;
  calls.destroy = 0;
  const partial = createPaddleEngine({
    ort,
    paddle: library,
    modelUrls: { detection: 'det', recognition: 'rec', dictionary: 'dict' },
    readFile: async (name) => new TextEncoder().encode(files[name]).buffer,
  });
  await assert.rejects(partial.recognise(canvas, {}), /rec model failed/);
  assert.equal(calls.destroy, 1);
  failInitialize = false;

  // A load that never settles times out, so the app can fall back.
  assert.equal(PADDLE_LOAD_TIMEOUT_MS, 60000);
  const stalled = createPaddleEngine({
    ort,
    paddle: () => new Promise(() => {}),
    modelUrls: { detection: 'det', recognition: 'rec', dictionary: 'dict' },
    readFile: async (name) => new TextEncoder().encode(files[name]).buffer,
    loadTimeoutMs: 20,
  });
  await assert.rejects(stalled.recognise(canvas, {}), /took too long to load/);

  // Worker split: the page-side engine posts pixels to a worker running servePaddleWorker
  // and relays progress, results and errors. The fake worker passes messages in-process.
  function fakeWorkerPair(createEngine) {
    const page = { terminated: false };
    const scope = {
      postMessage: (data) => setImmediate(() => page.onmessage({ data: structuredClone(data) })),
    };
    servePaddleWorker(scope, createEngine);
    page.postMessage = (data, transfer) => {
      assert.ok(transfer[0] instanceof ArrayBuffer);
      const copy = structuredClone(data);
      setImmediate(() => scope.onmessage({ data: copy }));
    };
    page.terminate = () => (page.terminated = true);
    return page;
  }
  const workerProgress = [];
  let created = 0;
  let worker;
  const proxied = createPaddleWorkerEngine({
    workerUrl: 'paddle-worker.js',
    onProgress: (m) => workerProgress.push(m),
    createWorker: (url) => {
      assert.equal(url, 'paddle-worker.js');
      created++;
      worker = fakeWorkerPair((onProgress) => ({
        async recognise(pixels) {
          assert.equal(pixels.width, 30);
          onProgress({ status: 'recognizing text', progress: 1 });
          if (pixels.data[0] === 0) throw new Error('OOM');
          return { paragraphs: [], engine: 'paddleocr', version: 'x', confidence: 0.9 };
        },
      }));
      return worker;
    },
  });
  const white = createCanvas(30, 20);
  const ctx = white.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 30, 20);
  assert.equal((await proxied.recognise(white)).confidence, 0.9);
  assert.deepEqual(workerProgress, [{ status: 'recognizing text', progress: 1 }]);
  await assert.rejects(proxied.recognise(createCanvas(30, 20)), /OOM/);
  assert.equal(created, 1);
  await proxied.terminate();
  assert.equal(worker.terminated, true);
  // A worker that fails to start rejects the pending call.
  const broken = createPaddleWorkerEngine({
    workerUrl: 'paddle-worker.js',
    createWorker: () => {
      const w = { terminate: () => (w.terminated = true) };
      w.postMessage = () => setImmediate(() => w.onerror({ message: 'importScripts failed' }));
      return w;
    },
  });
  await assert.rejects(broken.recognise(white), /worker failed: importScripts failed/);

  console.log('paddle engine tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
