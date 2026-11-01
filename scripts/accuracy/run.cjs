'use strict';
// Scores OCR engines and pipeline variants against the fictional reports.
//   node scripts/accuracy/run.cjs --engine tesseract|paddle|all --variant raw|clean|straight|suggest|all [--limit N]
// To add an engine or a variant, register it in ENGINES or VARIANTS below.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { pathToFileURL } = require('node:url');
const { composeText, createTesseractEngine } = require('../../dist/engine.js');
const { createPaddleEngine } = require('../../dist/engine-paddle.js');
const { preparePhoto } = require('../../dist/prepare.js');
const { findPageCorners, straighten } = require('../../dist/page.js');
const { cer, wer, numberAccuracy } = require('./metrics.cjs');

const ROOT = path.resolve(__dirname, '../..');
const REPORTS = path.join(ROOT, 'tests/fixtures/reports');
const REPORT_FILE = path.join(ROOT, 'tests/accuracy-report.md');

// An engine entry: create() returns { name, version, recognise(image, { mode }), terminate() }.
// Images are PNG or JPEG Buffers. Set `implemented: false` until the engine exists.
const ENGINES = {
  tesseract: {
    implemented: true,
    create: async () => {
      const dir = path.join(ROOT, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int');
      return createTesseractEngine({
        Tesseract: require('tesseract.js'),
        paths: { langPath: dir, gzip: true },
      });
    },
  },
  paddle: {
    implemented: true,
    // Loads the vendored browser files (npm run build), so this exercises the same
    // paddleocr.js module, single-threaded ONNX Runtime Web WASM and models as the page.
    create: async () => {
      const dir = path.join(ROOT, 'dist/vendor/paddle');
      if (!fs.existsSync(path.join(dir, 'rec.onnx'))) throw new Error('Run npm run build first.');
      const load = (file) => () => import(pathToFileURL(path.join(dir, file)).href);
      return createPaddleEngine({
        ort: load('ort.wasm.min.mjs'),
        paddle: load('paddleocr.mjs'),
        modelUrls: {
          detection: path.join(dir, 'det.onnx'),
          recognition: path.join(dir, 'rec.onnx'),
          dictionary: path.join(dir, 'dict.txt'),
        },
        readFile: async (file) => new Uint8Array(fs.readFileSync(file)).buffer,
      });
    },
  },
};

// A variant entry: prepare(buffer) returns { image: Buffer, mode } to hand to the engine.
const make = () => createCanvas(1, 1);
const photoVariant = (options) => ({
  implemented: true,
  prepare: async (buffer) => {
    const source = await loadImage(buffer);
    const canvas = preparePhoto(source, { mode: 'photo', ...options }, make);
    return { image: canvas.toBuffer('image/png'), mode: 'photo' };
  },
});

let openCv = null;
function loadOpenCv() {
  const cv = require('@techstark/opencv-js');
  // Never await cv itself: it is a thenable that never settles.
  return (openCv =
    openCv ||
    new Promise((resolve) => {
      if (cv.Mat) resolve({ cv });
      else cv.onRuntimeInitialized = () => resolve({ cv });
    }));
}

// As in the app: find the page and straighten it (the full photo when no page is found),
// then clean up with background normalisation.
const straightVariant = {
  implemented: true,
  prepare: async (buffer) => {
    const { cv } = await loadOpenCv();
    const image = await loadImage(buffer);
    let source = createCanvas(image.width, image.height);
    source.getContext('2d').drawImage(image, 0, 0);
    const corners = findPageCorners(cv, source, make);
    if (corners) source = straighten(cv, source, corners, make);
    const canvas = preparePhoto(source, { mode: 'photo', background: true }, make);
    return { image: canvas.toBuffer('image/png'), mode: 'photo' };
  },
};
const VARIANTS = {
  // preparePhoto in photo mode without shadow removal.
  raw: photoVariant({ background: false }),
  // The same with background normalisation (shadow removal) switched on.
  clean: photoVariant({ background: true }),
  // Page detection and perspective straightening, then the clean variant.
  straight: straightVariant,
  suggest: { implemented: false },
};

function parseArgs(argv) {
  const args = { engine: 'all', variant: 'all', limit: Infinity };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args) || argv[i + 1] === undefined) throw new Error('Unknown argument ' + argv[i]);
    args[key] = key === 'limit' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return args;
}

function select(registry, wanted, label) {
  if (wanted === 'all') return Object.keys(registry).filter((k) => registry[k].implemented);
  if (!registry[wanted]) throw new Error(`Unknown ${label} "${wanted}"`);
  if (!registry[wanted].implemented) throw new Error(`${label} ${wanted} is not implemented yet`);
  return [wanted];
}

// Test images as { id, condition, file }. img/ files are rNN-<condition>.ext; phone/ files are rNN-anything.ext.
function listImages(limit) {
  const found = [];
  for (const [dir, fixed] of [
    ['img', null],
    ['phone', 'phone'],
  ]) {
    const full = path.join(REPORTS, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).sort()) {
      const m = /^(r\d\d)-(.+)\.(png|jpe?g)$/i.exec(f);
      if (m) found.push({ id: m[1], condition: fixed || m[2], file: path.join(full, f) });
    }
  }
  const ids = [...new Set(found.map((i) => i.id))].sort().slice(0, limit);
  return found.filter((i) => ids.includes(i.id));
}

const CONDITIONS = ['good', 'average', 'fair', 'poor', 'phone'];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => (x * 100).toFixed(2) + '%';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const engines = select(ENGINES, args.engine, 'engine');
  const variants = select(VARIANTS, args.variant, 'variant');
  const images = listImages(args.limit);
  if (!images.length) throw new Error('No test images found. Run npm run fixtures first.');
  process.chdir(os.tmpdir()); // keep any engine cache files out of the repo
  const rows = [];
  const versions = [];
  for (const engineName of engines) {
    const engine = await ENGINES[engineName].create();
    versions.push(`${engine.name} ${engine.version}`);
    for (const variantName of variants) {
      const scores = {};
      for (const img of images) {
        const ref = fs.readFileSync(path.join(REPORTS, 'text', img.id + '.txt'), 'utf8');
        const started = Date.now();
        const { image, mode } = await VARIANTS[variantName].prepare(fs.readFileSync(img.file));
        const hyp = composeText(await engine.recognise(image, { mode })).text;
        const seconds = (Date.now() - started) / 1000;
        (scores[img.condition] = scores[img.condition] || []).push({
          cer: cer(ref, hyp),
          wer: wer(ref, hyp),
          num: numberAccuracy(ref, hyp),
          seconds,
        });
        console.log(
          `${engineName} ${variantName} ${img.id}-${img.condition} CER ${pct(cer(ref, hyp))} ${seconds.toFixed(1)}s`,
        );
      }
      for (const [condition, s] of Object.entries(scores).sort(
        (a, b) => CONDITIONS.indexOf(a[0]) - CONDITIONS.indexOf(b[0]),
      ))
        rows.push({
          engineName,
          variantName,
          condition,
          n: s.length,
          worst: Math.max(...s.map((x) => x.cer)),
          ...Object.fromEntries(
            ['cer', 'wer', 'num', 'seconds'].map((k) => [k, mean(s.map((x) => x[k]))]),
          ),
        });
    }
    await engine.terminate();
  }
  const lines = [
    '# OCR accuracy report',
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} with ${versions.join(', ')}. ${images.length} images from ${new Set(images.map((i) => i.id)).size} fictional reports. Lower CER and WER are better; number accuracy is higher-is-better.`,
    '',
    '| Engine | Variant | Condition | Images | Mean CER | Worst CER | Mean WER | Number accuracy | Seconds/page |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.engineName} | ${r.variantName} | ${r.condition} | ${r.n} | ${pct(r.cer)} | ${pct(r.worst)} | ${pct(r.wer)} | ${pct(r.num)} | ${r.seconds.toFixed(1)} |`,
    ),
    '',
  ];
  fs.writeFileSync(REPORT_FILE, lines.join('\n'));
  console.log(lines.join('\n'));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
