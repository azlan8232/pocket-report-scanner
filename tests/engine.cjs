'use strict';
const assert = require('node:assert/strict');
const {
  composeText,
  groupLinesIntoParagraphs,
  mapTesseractData,
  createTesseractEngine,
} = require('../dist/engine.js');

const word = (text, confidence = 0.9) => ({
  text,
  confidence,
  box: { x0: 0, y0: 0, x1: 1, y1: 1 },
});
const line = (...texts) => ({ words: texts.map((t) => word(t)), confidence: 0.9 });

// composeText joins words, lines and paragraphs and records word spans.
const composed = composeText({
  paragraphs: [
    { lines: [line('No', 'acute'), line('haemorrhage.')] },
    { lines: [line('IMPRESSION:')] },
  ],
  engine: 'test',
  version: '0',
});
assert.equal(composed.text, 'No acute\nhaemorrhage.\n\nIMPRESSION:');
assert.deepEqual(composed.spans[2], { start: 9, end: 21, text: 'haemorrhage.', confidence: 0.9 });
for (const s of composed.spans) assert.equal(composed.text.slice(s.start, s.end), s.text);

// groupLinesIntoParagraphs splits on a gap over 1.5 x median line height.
const box = (y0) => ({ x0: 0, y0, x1: 100, y1: y0 + 25 });
const grouped = groupLinesIntoParagraphs(
  [0, 30, 60, 150].map((y0) => ({ ...line('x'), box: box(y0) })),
);
assert.deepEqual(
  grouped.map((p) => p.lines.length),
  [3, 1],
);
assert.deepEqual(groupLinesIntoParagraphs([]), []);

// The Tesseract mapper turns recorded data into 0..1 confidences.
const data = require('./fixtures/tesseract-data.json');
const mapped = mapTesseractData(data);
assert.equal(mapped.engine, 'tesseract');
assert.ok(mapped.paragraphs.length > 0);
let words = 0;
for (const p of mapped.paragraphs)
  for (const l of p.lines) {
    assert.ok(l.confidence >= 0 && l.confidence <= 1);
    for (const w of l.words) {
      words++;
      assert.ok(w.confidence >= 0 && w.confidence <= 1, 'word confidence ' + w.confidence);
      assert.ok(w.box && w.box.x1 >= w.box.x0);
    }
  }
assert.ok(words > 10);

// The engine drives Tesseract with today's parameters and maps the result.
(async () => {
  const calls = [];
  const fake = {
    createWorker: async (lang, oem, opts) => {
      calls.push(['createWorker', lang, oem, opts]);
      return {
        setParameters: async (p) => calls.push(['setParameters', p]),
        recognize: async (img, o, out) => (calls.push(['recognize', o, out]), { data }),
        terminate: async () => calls.push(['terminate']),
      };
    },
  };
  const paths = { workerPath: 'w', corePath: 'c', langPath: 'l' };
  const engine = createTesseractEngine({ Tesseract: fake, paths });
  assert.equal(engine.name, 'tesseract');
  const result = await engine.recognise({}, { mode: 'photo' });
  assert.equal(result.engine, 'tesseract');
  assert.equal(calls[0][3].workerPath, 'w');
  assert.deepEqual(calls[1][1], { tessedit_pageseg_mode: '3', user_defined_dpi: '300' });
  assert.deepEqual(calls[2][1], { rotateAuto: true });
  await engine.recognise({}, { mode: 'original' });
  assert.equal(calls.filter((c) => c[0] === 'createWorker').length, 1);
  assert.equal(calls[3][1].tessedit_pageseg_mode, '6');
  assert.deepEqual(calls[4][1], { rotateAuto: false });
  await engine.terminate();
  assert.equal(calls.at(-1)[0], 'terminate');
  console.log('engine tests passed');
})();
