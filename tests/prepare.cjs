const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  preparePhoto,
  normaliseBackground,
  sharpnessScore,
  qualityWarnings,
} = require('../dist/prepare.js');
const assert = require('node:assert/strict');
const make = () => createCanvas(1, 1);
const source = createCanvas(200, 100);
const ctx = source.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 100, 100);
ctx.fillStyle = 'blue';
ctx.fillRect(100, 0, 100, 100);
const crop = preparePhoto(
  source,
  { mode: 'original', crop: { left: 50, top: 0, right: 100, bottom: 100 } },
  make,
);
assert.equal(crop.width, 100);
assert.equal(crop.height, 100);
assert.deepEqual([...crop.getContext('2d').getImageData(50, 50, 1, 1).data], [0, 0, 255, 255]);
const tall = createCanvas(1200, 7000);
const bounded = preparePhoto(tall, {}, make);
assert(
  bounded.width * bounded.height <= 12010000,
  'processing must stay near the 12MP phone memory limit',
);

// Shadow removal: a left-to-right lighting gradient is flattened, dark text stays dark.
const shaded = createCanvas(400, 400);
const sctx = shaded.getContext('2d');
const gradient = sctx.createLinearGradient(0, 0, 400, 0);
gradient.addColorStop(0, 'rgb(255,255,255)');
gradient.addColorStop(1, 'rgb(120,120,120)');
sctx.fillStyle = gradient;
sctx.fillRect(0, 0, 400, 400);
sctx.fillStyle = 'black';
for (let y = 40; y < 400; y += 80) sctx.fillRect(0, y, 400, 20);
const flat = normaliseBackground(shaded, make);
const gray = (c, x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data[0];
assert(
  Math.abs(gray(flat, 10, 10) - gray(flat, 390, 10)) <= 10,
  'background should be even after normalising',
);
assert(gray(flat, 200, 50) <= 60, 'text bars must stay dark');

// Sharpness: a sharp render scores higher than a blurred copy.
async function sharpnessCheck() {
  const sharp = await loadImage(path.join(__dirname, 'fixtures/reports/img/r01-good.png'));
  const a = createCanvas(sharp.width, sharp.height);
  a.getContext('2d').drawImage(sharp, 0, 0);
  const b = createCanvas(sharp.width, sharp.height);
  const bctx = b.getContext('2d');
  bctx.filter = 'blur(2px)';
  bctx.drawImage(sharp, 0, 0);
  const sa = sharpnessScore(a, make),
    sb = sharpnessScore(b, make);
  assert(sa > sb, `sharp ${sa} should beat blurred ${sb}`);
}

assert.equal(qualityWarnings({ width: 900, height: 1200, sharpness: 1e9 }).length, 1);
assert.equal(qualityWarnings({ width: 2000, height: 3000, sharpness: 1e9 }).length, 0);
assert.equal(qualityWarnings({ width: 2000, height: 3000, sharpness: 0 }).length, 1);
sharpnessCheck().then(() =>
  console.log(
    'Crop excludes outside pixels; memory bound, shadow removal and quality checks passed.',
  ),
);
