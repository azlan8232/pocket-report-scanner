'use strict';
// Page detection and straightening (dist/page.js) and corner handle geometry (dist/corner-editor.js).
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
let page = {};
let cornerEditor = {};
try {
  page = require('../dist/page.js');
  cornerEditor = require('../dist/corner-editor.js');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}
const { orderCorners, moveCorner, findPageCorners, straighten, servePageWorker, createPageWorker } =
  page;
const make = () => createCanvas(1, 1);
const IMG = path.join(__dirname, 'fixtures/reports/img');
const known = require('./fixtures/reports/img/corners.json');

assert.equal(typeof orderCorners, 'function', 'orderCorners must exist');
assert.deepEqual(
  orderCorners([
    { x: 90, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 90 },
    { x: 90, y: 90 },
  ]),
  [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ],
);

const square = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 90 },
  { x: 10, y: 90 },
];
const moved = moveCorner(square, 3, { x: -5, y: 700 }, 800, 600);
assert.deepEqual(moved[3], { x: 0, y: 600 }, 'corners are clamped to the image');
assert.deepEqual(moved.slice(0, 3), square.slice(0, 3), 'other corners stay put');
assert.deepEqual(square[3], { x: 10, y: 90 }, 'the input corners are not changed');

// Handles: a pointer position over the shown preview maps to source pixels.
assert.deepEqual(
  cornerEditor.toImagePixels(150, 250, { left: 50, top: 50, width: 400, height: 800 }, 800, 1600),
  { x: 200, y: 400 },
);

function loadOpenCv() {
  const cv = require('@techstark/opencv-js');
  // Never await cv itself: it is a thenable that never settles.
  return new Promise((resolve) => {
    if (cv.Mat) resolve({ cv });
    else cv.onRuntimeInitialized = () => resolve({ cv });
  });
}

async function canvasOf(file) {
  const image = await loadImage(path.join(IMG, file));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function assertNear(found, expected, tolerance, label) {
  assert(found, label + ': page corners should be found');
  assert.equal(found.length, 4, label);
  found.forEach((p, i) => {
    const [x, y] = expected[i];
    const off = Math.hypot(p.x - x, p.y - y);
    assert(off <= tolerance, `${label} corner ${i} is ${off.toFixed(1)} px off (max ${tolerance})`);
  });
}

async function main() {
  const { cv } = await loadOpenCv();
  for (const condition of ['average', 'fair', 'poor']) {
    const canvas = await canvasOf(`r01-${condition}.jpg`);
    const expected = known.r01[condition];
    assert.equal(canvas.width, expected.width);
    assertNear(
      findPageCorners(cv, canvas, make),
      expected.corners,
      0.02 * canvas.width,
      'r01-' + condition,
    );
  }

  const grey = createCanvas(800, 600);
  const gctx = grey.getContext('2d');
  gctx.fillStyle = '#808080';
  gctx.fillRect(0, 0, 800, 600);
  assert.equal(findPageCorners(cv, grey, make), null, 'a plain canvas has no page');

  // The in-app sample is a white page of text with no background: no page edges.
  const sample = createCanvas(1500, 1600);
  const sctx = sample.getContext('2d');
  sctx.fillStyle = 'white';
  sctx.fillRect(0, 0, 1500, 1600);
  sctx.fillStyle = '#111';
  sctx.font = '30px Arial';
  for (let i = 0; i < 16; i++)
    sctx.fillText('No acute intracranial haemorrhage.', 90, 240 + i * 65);
  assert.equal(findPageCorners(cv, sample, make), null, 'the text-only sample has no page');

  // Straightening a white quad on a dark background gives a white page sized by its edges.
  const photo = createCanvas(600, 500);
  const pctx = photo.getContext('2d');
  pctx.fillStyle = '#202020';
  pctx.fillRect(0, 0, 600, 500);
  const quad = [
    { x: 100, y: 50 },
    { x: 500, y: 80 },
    { x: 520, y: 450 },
    { x: 60, y: 420 },
  ];
  pctx.fillStyle = 'white';
  pctx.beginPath();
  quad.forEach((p, i) => (i ? pctx.lineTo(p.x, p.y) : pctx.moveTo(p.x, p.y)));
  pctx.fill();
  const flat = straighten(cv, photo, quad, make);
  const top = Math.hypot(400, 30),
    bottom = Math.hypot(460, 30),
    left = Math.hypot(40, 370),
    right = Math.hypot(20, 370);
  assert.equal(flat.width, Math.round(Math.max(top, bottom)));
  assert.equal(flat.height, Math.round(Math.max(left, right)));
  const d = flat.getContext('2d').getImageData(0, 0, flat.width, flat.height).data;
  let light = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200) light++;
  assert(light / (d.length / 4) > 0.97, 'the straightened page is the white quad only');
  assert.deepEqual(
    findPageCorners(cv, photo, make).map((p) => [Math.round(p.x / 5), Math.round(p.y / 5)]),
    quad.map((p) => [Math.round(p.x / 5), Math.round(p.y / 5)]),
    'the drawn quad is found, in source pixels',
  );

  // Worker protocol, wired in-process: the page asks, the worker answers with OpenCV.
  function fakeWorker(loadCv) {
    const scope = { postMessage: (data) => setImmediate(() => worker.onmessage({ data })) };
    const worker = {
      postMessage: (data) => setImmediate(() => scope.onmessage({ data })),
      terminate() {
        worker.terminated = true;
      },
    };
    servePageWorker(scope, loadCv);
    return worker;
  }
  let created = 0;
  const tools = createPageWorker({
    workerUrl: 'page-worker.js',
    createWorker: () => (created++, fakeWorker(async () => ({ cv }))),
    make,
  });
  await tools.load();
  const average = await canvasOf('r01-average.jpg');
  const corners = await tools.detect(average);
  assertNear(corners, known.r01.average.corners, 0.02 * average.width, 'worker r01-average');
  assert.equal(await tools.detect(grey), null, 'worker: a plain canvas has no page');
  const viaWorker = await tools.straighten(photo, quad);
  assert.deepEqual([viaWorker.width, viaWorker.height], [flat.width, flat.height]);
  assert.equal(created, 1, 'one worker serves every request');
  await tools.terminate();

  // OpenCV that cannot load rejects every request, so the page can keep the full photo.
  // A failed worker is stopped, and the next request starts a fresh one.
  const brokenWorkers = [];
  const broken = createPageWorker({
    workerUrl: 'page-worker.js',
    createWorker: () => {
      const w = fakeWorker(async () => Promise.reject(new Error('out of memory')));
      brokenWorkers.push(w);
      return w;
    },
    make,
  });
  await assert.rejects(broken.detect(grey), /out of memory/);
  assert.equal(brokenWorkers[0].terminated, true, 'the failed worker is stopped');
  await assert.rejects(broken.load(), /out of memory/);
  assert.equal(brokenWorkers.length, 2, 'the next request starts a fresh worker');

  // A worker that never answers is stopped after the timeout.
  const silent = { postMessage() {}, terminate: () => (silent.terminated = true) };
  const hung = createPageWorker({
    workerUrl: 'x',
    createWorker: () => silent,
    make,
    timeoutMs: 20,
  });
  await assert.rejects(hung.load(), /stopped responding/);
  assert.equal(silent.terminated, true);
  console.log('page tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
