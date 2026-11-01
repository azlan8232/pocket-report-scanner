'use strict';
// Scores OCR engines and pipeline variants against the fictional reports.
//   node scripts/accuracy/run.cjs --engine tesseract|paddle|all --variant raw|clean|straight|suggest|all [--limit N] [--thresholds 0.80,0.90]
// To add an engine or a variant, register it in ENGINES or VARIANTS below.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { pathToFileURL } = require('node:url');
const { composeText, createTesseractEngine } = require('../../dist/engine.js');
const {
  createSuggester,
  buildCheckList,
  applySuggestion,
  spansFromResult,
} = require('../../dist/suggest.js');
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
// Optional outputs(result, args) returns [{ name, text, reference? }] to score from one
// recognition; the default is the composed text under the variant's own name. A reference
// output is printed to the console but not written to the report.
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
  // Clean, then the top suggestion applied to every word the check list offers one for.
  // Scored at each confidence threshold from the same recognition, next to clean itself.
  suggest: {
    ...photoVariant({ background: true }),
    outputs: (result, args) => {
      const root = path.join(ROOT, 'dist/dict');
      const suggester = createSuggester({
        english: fs.readFileSync(path.join(root, 'en-30k.txt'), 'utf8'),
        medical: fs.readFileSync(path.join(root, 'medical-imaging.txt'), 'utf8'),
        learned: { lookup: () => [] },
      });
      const { text } = composeText(result);
      const spans = spansFromResult(result, text);
      return [
        { name: 'clean', text, reference: true },
        ...args.thresholds.map((threshold) => {
          let out = text;
          const items = buildCheckList(text, { spans, threshold, suggester });
          for (const item of items.filter((i) => i.kind === 'suggest').reverse())
            out = applySuggestion(out, item, item.suggestions[0]) ?? out;
          return { name: 'suggest@' + threshold.toFixed(2), text: out };
        }),
      ];
    },
  },
};

function parseArgs(argv) {
  const args = { engine: 'all', variant: 'all', limit: Infinity, thresholds: '0.80,0.90' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args) || argv[i + 1] === undefined) throw new Error('Unknown argument ' + argv[i]);
    args[key] = key === 'limit' ? Number(argv[i + 1]) : argv[i + 1];
  }
  args.thresholds = args.thresholds.split(',').map(Number);
  return args;
}

function select(registry, wanted, label) {
  if (wanted === 'all') return Object.keys(registry).filter((k) => registry[k].implemented);
  if (!registry[wanted]) throw new Error(`Unknown ${label} "${wanted}"`);
  if (!registry[wanted].implemented) throw new Error(`${label} ${wanted} is not implemented yet`);
  return [wanted];
}

// Test images as { id, condition, file }. img/ files are rNN-<condition>.ext; phone/ files
// are rNN.ext or rNN-anything.ext (.png, .jpg or .jpeg). Other images are counted and skipped.
function listImages(limit, root = REPORTS, log = console.log) {
  const found = [];
  let skipped = 0;
  for (const [dir, fixed, pattern] of [
    ['img', null, /^(r\d\d)-(.+)\.(png|jpe?g)$/i],
    ['phone', 'phone', /^(r\d\d)(-.+)?\.(png|jpe?g)$/i],
  ]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).sort()) {
      const m = pattern.exec(f);
      if (m) found.push({ id: m[1], condition: fixed || m[2], file: path.join(full, f) });
      else if (/\.(png|jpe?g|webp|heic)$/i.test(f)) skipped++;
    }
  }
  if (skipped) log(`Skipped ${skipped} images not named rNN-<condition> (img/) or rNN (phone/).`);
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
      const variant = VARIANTS[variantName];
      const scores = {}; // output name -> condition -> per-image scores
      for (const img of images) {
        const ref = fs.readFileSync(path.join(REPORTS, 'text', img.id + '.txt'), 'utf8');
        const started = Date.now();
        const { image, mode } = await variant.prepare(fs.readFileSync(img.file));
        const result = await engine.recognise(image, { mode });
        const seconds = (Date.now() - started) / 1000;
        const outputs = variant.outputs
          ? variant.outputs(result, args)
          : [{ name: variantName, text: composeText(result).text }];
        for (const out of outputs) {
          const byCondition = (scores[out.name] = scores[out.name] || { conditions: {} });
          byCondition.reference = out.reference;
          (byCondition.conditions[img.condition] =
            byCondition.conditions[img.condition] || []).push({
            cer: cer(ref, out.text),
            wer: wer(ref, out.text),
            num: numberAccuracy(ref, out.text),
            seconds,
          });
          console.log(
            `${engineName} ${out.name} ${img.id}-${img.condition} CER ${pct(cer(ref, out.text))} ${seconds.toFixed(1)}s`,
          );
        }
      }
      for (const [name, { conditions, reference }] of Object.entries(scores))
        for (const [condition, s] of Object.entries(conditions).sort(
          (x, y) => CONDITIONS.indexOf(x[0]) - CONDITIONS.indexOf(y[0]),
        ))
          rows.push({
            engineName,
            variantName: name,
            reference,
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
  const table = rows
    .filter((r) => !r.reference)
    .map((r) => [
      r.engineName,
      r.variantName,
      r.condition,
      r.n,
      pct(r.cer),
      pct(r.worst),
      pct(r.wer),
      pct(r.num),
      r.seconds.toFixed(1),
    ]);
  console.log(
    rows
      .map((r) =>
        [r.engineName, r.variantName, r.condition, pct(r.cer), pct(r.wer), pct(r.num)].join(' | '),
      )
      .join('\n'),
  );
  writeReport(table, versions, images);
}

const HEADER = [
  'Engine',
  'Variant',
  'Condition',
  'Images',
  'Mean CER',
  'Worst CER',
  'Mean WER',
  'Number accuracy',
  'Seconds/page',
];
const isRow = (line) => line.startsWith('| ') && !line.startsWith('| Engine');
const rowCells = (line) => line.slice(2, -2).split(' | ');
// Rows sort by engine, then variant (suggest@ thresholds last), then condition.
const rank = (list, value) => {
  const i = list.indexOf(value);
  return i < 0 ? list.length : i;
};
const rowOrder = (a, b) =>
  rank(['tesseract', 'paddle'], a[0]) - rank(['tesseract', 'paddle'], b[0]) ||
  rank(['raw', 'clean', 'straight'], a[1]) - rank(['raw', 'clean', 'straight'], b[1]) ||
  a[1].localeCompare(b[1]) ||
  rank(CONDITIONS, a[2]) - rank(CONDITIONS, b[2]);

// Writes the table. Rows of an earlier run for the same engine and variant are replaced and
// the rest are kept, so a partial run (one variant) updates the report instead of erasing it.
// An existing report keeps its heading and notes.
function writeReport(table, versions, images) {
  const old = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, 'utf8').split(/\r?\n/) : [];
  const first = old.findIndex(isRow);
  const last = old.length - 1 - [...old].reverse().findIndex(isRow);
  const replaced = new Set(table.map((c) => c[0] + '|' + c[1]));
  const kept =
    first < 0
      ? []
      : old
          .slice(first, last + 1)
          .filter(isRow)
          .map(rowCells);
  const merged = [...kept.filter((c) => !replaced.has(c[0] + '|' + c[1])), ...table].sort(rowOrder);
  const heading =
    first < 0
      ? [
          '# OCR accuracy report',
          '',
          `Generated ${new Date().toISOString().slice(0, 10)} with ${versions.join(', ')}. ${images.length} images from ${new Set(images.map((i) => i.id)).size} fictional reports. Lower CER and WER are better; number accuracy is higher-is-better.`,
          '',
        ]
      : old.slice(0, first - 2);
  const lines = [
    ...heading,
    '| ' + HEADER.join(' | ') + ' |',
    '|' + HEADER.map(() => '---').join('|') + '|',
    ...merged.map((c) => '| ' + c.join(' | ') + ' |'),
    ...(first < 0 ? [''] : old.slice(last + 1)),
  ];
  fs.writeFileSync(REPORT_FILE, lines.join('\n'));
}

if (require.main === module)
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );

module.exports = { listImages };
