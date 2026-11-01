'use strict';
// Page-detection flow in dist/app.js, run in a vm with a minimal fake DOM. Page detection,
// straightening and OCR are stubs the test settles by hand; the canvases are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');
const prepare = require('../dist/prepare.js');
const suggest = require('../dist/suggest.js');
const { createLearnedStore } = require('../dist/learned.js');

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
    hidden: ['pageActions', 'imageArea', 'learnedNotice', 'check', 'checkNote'].includes(id),
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
    children: [],
    focused: 0,
    selection: null,
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    focus() {
      this.focused++;
    },
    setSelectionRange(start, end) {
      this.selection = [start, end];
    },
    select() {},
    click() {},
  };
}

function startApp({ stored = null, fetchDictionaries = false, compose } = {}) {
  const elements = new Map();
  const $ = (id) => elements.get(id) || elements.set(id, element(id)).get(id);
  const page = { detects: [], straightens: [] };
  const ocr = { runs: [] };
  const cornerEditor = { shown: false };
  const storage = new Map(stored === null ? [] : [['pocket-ocr-learned-v1', stored]]);
  const context = {
    ...suggest,
    createLearnedStore,
    fetch: async (url) => {
      if (!fetchDictionaries) throw new Error('offline');
      const file = path.join(__dirname, '../dist', url);
      return { ok: true, text: async () => fs.readFileSync(file, 'utf8') };
    },
    console: { warn() {}, log: console.log, error: console.error },
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    Promise,
    location: { href: 'http://localhost/' },
    navigator: {},
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
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
    composeText: compose || (() => ({ text: 'No acute abnormality.', spans: [] })),
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'app.js' });
  const click = async (id) => {
    await $(id).onclick();
    await tick();
  };
  return { $, page, ocr, cornerEditor, click, storage };
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

  // The Check panel, learned words and the review gate.
  const { composeText } = require('../dist/engine.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reportOf = (line, confidence = 0.95) => ({
    confidence: 0.9,
    paragraphs: [
      {
        lines: [
          {
            words: line.split(' ').map((text) => ({
              text,
              confidence: typeof confidence === 'function' ? confidence(text) : confidence,
            })),
          },
        ],
      },
    ],
  });
  const scan = async (app, result) => {
    await app.click('demo');
    app.click('extract');
    await sleep(40);
    app.ocr.runs[0].resolve(result);
    await sleep(60);
  };
  // Each row of the list: its word, kind label and chip labels.
  const rows = (app) =>
    app.$('checkList').children.map((li) => {
      const [word, kind, ...rest] = li.children;
      return {
        word,
        text: word.textContent,
        kind: kind.textContent,
        chips: rest.filter((c) => c.className.includes('chip') && !c.className.includes('keep')),
        keep: rest.find((c) => c.className.includes('keep')),
      };
    });
  const type = async (app, value) => {
    app.$('text').value = value;
    app.$('text').oninput();
    await sleep(380);
  };
  const lowIf = (prefix) => (t) => (t.startsWith(prefix) ? 0.5 : 0.95);
  const STORE = 'pocket-ocr-learned-v1';

  // A misread word gets chips; numbers are only flagged; the tick stays required; a chip
  // changes the text, clears the tick and teaches the scanner.
  {
    const app = startApp({ fetchDictionaries: true, compose: composeText });
    await scan(app, reportOf('No acute intracranial haemorhage. Size 3.2 cm.', lowIf('haemor')));
    const list = rows(app);
    const word = list.find((r) => r.text === 'haemorhage');
    assert.equal(word.kind, 'Unclear word');
    assert.deepEqual(
      word.chips.map((c) => c.textContent),
      ['haemorrhage', 'hemorrhage'],
    );
    assert.ok(word.keep, 'Keep is offered');
    assert.equal(list.find((r) => r.text === '3.2').kind, 'Check number');
    assert.equal(list.find((r) => r.text === '3.2').chips.length, 0, 'numbers are never guessed');
    assert.equal(app.$('checkCount').textContent, '3 items to check');
    assert.equal(app.$('copy').disabled, true, 'the review tick is still required');
    app.$('verified').checked = true;
    app.$('verified').onchange();
    assert.equal(app.$('copy').disabled, false);
    // Tapping the word selects it in the text.
    const value = app.$('text').value;
    const at = value.indexOf('haemorhage');
    word.word.onclick();
    assert.deepEqual(app.$('text').selection, [at, at + 10]);
    assert.ok(app.$('text').focused > 0);
    // Tapping the chip applies it; before that nothing changed.
    assert.equal(app.$('text').value, value, 'nothing is applied without a tap');
    word.chips[0].onclick();
    assert.equal(app.$('text').value, value.replace('haemorhage', 'haemorrhage'));
    assert.equal(app.$('verified').checked, false, 'review is unticked');
    assert.equal(app.$('copy').disabled, true);
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 1');
    assert.equal(
      rows(app).some((r) => r.text === 'haemorrhage'),
      false,
    );
    assert.equal(app.$('checkCount').textContent, '2 items to check');
    // Typing the misspelling again: the learned word is offered.
    await type(app, value);
    assert.deepEqual(
      rows(app)
        .find((r) => r.text === 'haemorhage')
        .chips.map((c) => c.textContent),
      ['haemorrhage', 'hemorrhage'],
    );
    assert.equal(JSON.parse(app.storage.get(STORE)).haemorhage.haemorrhage, 1);
    // Clear empties the store and the count.
    await app.click('learnedClear');
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 0');
    assert.equal(app.storage.has(STORE), false);
  }

  // Learned corrections rank ahead of the dictionary.
  {
    const app = startApp({
      fetchDictionaries: true,
      compose: composeText,
      stored: JSON.stringify({ efusion: { infusion: 3 } }),
    });
    await scan(app, reportOf('small pleural efusion', lowIf('efusion')));
    const chips = rows(app)
      .find((r) => r.text === 'efusion')
      .chips.map((c) => c.textContent);
    assert.equal(chips[0], 'infusion');
    assert.ok(chips.includes('effusion'));
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 1');
  }

  // A correction to a word the dictionaries do not know (a surname) is never stored.
  {
    const app = startApp({ fetchDictionaries: true, compose: composeText });
    await scan(app, reportOf('Seen by Zxqvlorp today'));
    await type(app, 'Seen by Hartwellmoor today');
    assert.equal(app.storage.has(STORE), false, 'unknown target is not recorded');
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 0');
    // A known word typed in as the fix is recorded (single word only).
    await type(app, 'Seen by Zxqvlorp today');
    await type(app, 'Seen by doctor today');
    assert.deepEqual(JSON.parse(app.storage.get(STORE)), { zxqvlorp: { doctor: 1 } });
    // Changing two words at once is not a single-word correction.
    await type(app, 'Seen by nurse yesterday');
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 1');
  }

  // A stale list is refreshed instead of applying a chip to the wrong place.
  {
    const app = startApp({ fetchDictionaries: true, compose: composeText });
    await scan(app, reportOf('No haemorhage seen', lowIf('haemor')));
    const row = rows(app).find((r) => r.text === 'haemorhage');
    app.$('text').value = 'XX No haemorhage seen';
    row.chips[0].onclick();
    assert.equal(app.$('text').value, 'XX No haemorhage seen', 'text untouched');
    assert.equal(app.$('status').textContent, 'Text changed; list refreshed');
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 0');
    assert.equal(
      rows(app).find((r) => r.text === 'haemorhage').chips.length > 0,
      true,
      'list rebuilt',
    );
  }

  // Keep dismisses an item for this report.
  {
    const app = startApp({ fetchDictionaries: true, compose: composeText });
    await scan(app, reportOf('Size 3.2 cm'));
    assert.equal(rows(app).length, 2);
    rows(app)[0].keep.onclick();
    assert.equal(rows(app).length, 1);
    assert.equal(app.$('checkCount').textContent, '1 item to check');
  }

  // Dictionaries that cannot load: items still listed, no chips, a note; review not blocked.
  {
    const app = startApp({ compose: composeText });
    await scan(app, reportOf('No haemorhage 5 mm', lowIf('haemor')));
    const list = rows(app);
    assert.deepEqual(
      list.map((r) => r.text),
      ['haemorhage', '5', 'mm'],
    );
    assert.equal(
      list.every((r) => r.chips.length === 0),
      true,
    );
    assert.equal(app.$('checkNote').hidden, false);
    assert.match(app.$('checkNote').textContent, /unavailable/i);
    assert.match(app.$('status').textContent, /^Extraction complete/);
    app.$('verified').checked = true;
    app.$('verified').onchange();
    assert.equal(app.$('copy').disabled, false);
    // Corrections are never learned without a dictionary to vouch for them.
    await type(app, 'No haemorrhage 5 mm');
    assert.equal(app.storage.has(STORE), false);
  }

  // Corrupt stored words reset with a visible notice and do not stop scanning.
  {
    const app = startApp({ stored: '{bad', compose: composeText });
    assert.equal(app.$('learnedNotice').hidden, false);
    assert.equal(app.$('learnedCount').textContent, 'Learned words: 0');
    await scan(app, reportOf('Plain text'));
    assert.match(app.$('status').textContent, /^Extraction complete/);
  }

  // Clearing the result hides the panel and the count.
  {
    const app = startApp({ fetchDictionaries: true, compose: composeText });
    await scan(app, reportOf('Size 3.2 cm'));
    assert.equal(app.$('check').hidden, false);
    await app.click('clear');
    assert.equal(app.$('check').hidden, true);
    assert.equal(app.$('checkCount').textContent, '');
  }

  console.log('app page-flow tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
