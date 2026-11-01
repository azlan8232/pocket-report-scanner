'use strict';
// Page-detection flow in dist/app.js, run in a vm with a minimal fake DOM. Page detection,
// straightening and OCR are stubs the test settles by hand; the canvases are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');
const prepare = require('../dist/prepare.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => ([resolve, reject] = [a, b]));
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

function element(id) {
  const classes = new Set();
  return {
    id,
    disabled: false,
    hidden: id === 'pageActions' || id === 'imageArea',
    textContent: '',
    value: { engine: 'paddle', scanMode: 'photo' }[id] || '',
    checked: false,
    style: {},
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    focus() {},
    select() {},
    click() {},
  };
}

function startApp() {
  const elements = new Map();
  const $ = (id) => elements.get(id) || elements.set(id, element(id)).get(id);
  const page = { detects: [], straightens: [] };
  const ocr = { runs: [] };
  const cornerEditor = { shown: false };
  const context = {
    console: { warn() {}, log: console.log, error: console.error },
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    Promise,
    location: { href: 'http://localhost/' },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (f) => setTimeout(f, 0),
    addEventListener() {},
    document: {
      getElementById: $,
      createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : element(tag)),
    },
    ParagraphCropEditor: class {
      setImage() {}
      setCrop() {}
    },
    CornerEditor: class {
      show(corners) {
        cornerEditor.shown = true;
        cornerEditor.corners = corners;
      }
      hide() {
        cornerEditor.shown = false;
      }
      get shown() {
        return cornerEditor.shown;
      }
    },
    createPageWorker: () => ({
      load: async () => {},
      detect: (canvas) => {
        const d = deferred();
        page.detects.push({ canvas, ...d });
        return d.promise;
      },
      straighten: (canvas, corners) => {
        const d = deferred();
        page.straightens.push({ canvas, corners, ...d });
        return d.promise;
      },
    }),
    preparePhoto: (c, o) => prepare.preparePhoto(c, o, () => createCanvas(1, 1)),
    sharpnessScore: (c) => prepare.sharpnessScore(c, () => createCanvas(1, 1)),
    qualityWarnings: prepare.qualityWarnings,
    Tesseract: {},
    createTesseractEngine: () => ({}),
    createPaddleWorkerEngine: () => ({}),
    createEngineWithFallback: () => ({
      recognise: () => {
        const d = deferred();
        ocr.runs.push(d);
        return d.promise;
      },
      terminate: async () => {},
    }),
    composeText: () => ({ text: 'No acute abnormality.', spans: [] }),
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  const click = async (id) => {
    await $(id).onclick();
    await tick();
  };
  return { $, page, ocr, cornerEditor, click };
}

const NOT_FOUND = 'Page edges not found; using the full photo.';
const corners = [
  { x: 100, y: 100 },
  { x: 1400, y: 100 },
  { x: 1400, y: 1500 },
  { x: 100, y: 1500 },
];
const pageCanvas = () => createCanvas(1200, 1300);

async function main() {
  // Found corners are offered; a straighten that fails (here: its time limit) keeps the photo,
  // says so and unlocks everything. Skip and Clear stay usable while it runs.
  {
    const app = startApp();
    await app.click('demo');
    assert.equal(app.page.detects.length, 1, 'the sample is checked for page edges');
    app.page.detects[0].resolve(corners);
    await tick();
    assert.equal(app.cornerEditor.shown, true);
    assert.equal(app.$('pageActions').hidden, false);
    const info = app.$('fileInfo').textContent;
    app.click('straighten');
    await tick();
    assert.equal(app.$('extract').disabled, true, 'straightening locks extraction');
    assert.equal(app.$('skipStraighten').disabled, false, 'Skip stays usable');
    assert.equal(app.$('clear').disabled, false, 'Clear stays usable');
    app.page.straightens[0].reject(new Error('Page worker took too long'));
    await tick();
    assert.equal(app.$('status').textContent, NOT_FOUND);
    assert.equal(app.$('extract').disabled, false, 'everything is unlocked again');
    assert.equal(app.$('rotate').disabled, false);
    assert.equal(app.$('fileInfo').textContent, info, 'the photo is kept');
    assert.equal(app.cornerEditor.shown, false);
  }
  // Skip during a straighten unlocks at once; the late result is ignored.
  {
    const app = startApp();
    await app.click('demo');
    app.page.detects[0].resolve(corners);
    await tick();
    const info = app.$('fileInfo').textContent;
    app.click('straighten');
    await tick();
    await app.click('skipStraighten');
    assert.equal(app.$('extract').disabled, false, 'Skip unlocks at once');
    assert.equal(app.$('pageActions').hidden, true);
    app.page.straightens[0].resolve(pageCanvas());
    await tick();
    assert.equal(app.$('fileInfo').textContent, info, 'a late straighten is ignored');
  }
  // A straighten that succeeds replaces the photo and unlocks.
  {
    const app = startApp();
    await app.click('demo');
    app.page.detects[0].resolve(corners);
    await tick();
    app.click('straighten');
    await tick();
    app.page.straightens[0].resolve(pageCanvas());
    await tick();
    assert.match(app.$('fileInfo').textContent, /^1200 × 1300 pixels · straightened page/);
    assert.equal(app.$('extract').disabled, false);
    assert.equal(app.cornerEditor.shown, false);
  }
  // Rotating while detection runs cancels it and runs it again on the rotated photo.
  {
    const app = startApp();
    await app.click('demo');
    await app.click('rotate');
    assert.equal(app.page.detects.length, 2, 'detection runs again after rotating');
    const rotated = app.page.detects[1].canvas;
    assert.deepEqual([rotated.width, rotated.height], [1600, 1500], 'on the rotated photo');
    app.page.detects[0].resolve(corners); // the stale result for the unrotated photo
    await tick();
    assert.equal(app.cornerEditor.shown, false, 'a stale result is ignored');
    app.page.detects[1].resolve(null);
    await tick();
    assert.equal(app.$('status').textContent, NOT_FOUND);
  }
  // Rotating after detection has finished does not run it again.
  {
    const app = startApp();
    await app.click('demo');
    app.page.detects[0].resolve(null);
    await tick();
    await app.click('rotate');
    assert.equal(app.page.detects.length, 1);
  }
  // Corners found during an extraction are held, then offered when it ends, without
  // replacing the extraction's status.
  {
    const app = startApp();
    await app.click('demo');
    app.click('extract');
    await tick();
    app.page.detects[0].resolve(corners);
    await tick();
    assert.equal(app.cornerEditor.shown, false, 'held while extracting');
    app.ocr.runs[0].resolve({ confidence: 0.9 });
    await tick();
    assert.equal(app.cornerEditor.shown, true, 'offered after the extraction');
    assert.equal(app.$('pageActions').hidden, false);
    assert.match(app.$('status').textContent, /^Extraction complete/);
  }
  // "Not found" during an extraction is dropped: that extraction used the full photo.
  {
    const app = startApp();
    await app.click('demo');
    app.click('extract');
    await tick();
    app.page.detects[0].resolve(null);
    await tick();
    app.ocr.runs[0].resolve({ confidence: 0.9 });
    await tick();
    assert.equal(app.cornerEditor.shown, false);
    assert.match(app.$('status').textContent, /^Extraction complete/);
  }
  console.log('app page-flow tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
