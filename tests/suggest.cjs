'use strict';
const assert = require('node:assert/strict');
const { createSymSpell } = require('../dist/symspell.js');
const {
  classifyToken,
  createSuggester,
  buildCheckList,
  applySuggestion,
  detectWordCorrection,
  spansFromResult,
} = require('../dist/suggest.js');
const { composeText } = require('../dist/engine.js');

// classifyToken
for (const [token, kind] of [
  ['3.2cm,', 'number'],
  ['L4/L5', 'number'],
  ['T2-weighted', 'number'],
  ['x2', 'number'],
  ['(R)', 'laterality'],
  // A lone L may be left or litre: it is checked as a side, never guessed either way.
  ['L', 'laterality'],
  ['(L)', 'laterality'],
  ['l', 'laterality'],
  ['R', 'laterality'],
  ['mg/L', 'unit'],
  ['Left', 'laterality'],
  ['bilateral', 'laterality'],
  ['12/10/2026', 'date'],
  ['2026-10-12', 'date'],
  ['October', 'date'],
  ['May', 'date'],
  ['may', 'word'],
  ['mm', 'unit'],
  ['HU', 'unit'],
  ['mL', 'unit'],
  ['%', 'unit'],
  ['(cm)', 'unit'],
  ['effusion', 'word'],
  ['T-shaped', 'word'],
  ["patient's", 'word'],
  ['½', 'number'],
  ['cm²', 'unit'],
  ['mcg/mL', 'unit'],
  ['mg/kg', 'unit'],
  ['left-sided', 'laterality'],
  ['right-sided', 'laterality'],
  ['mid-left', 'laterality'],
  ['bilateral-', 'laterality'],
  ['&', 'other'],
  ['a/b', 'other'],
  ['', 'other'],
])
  assert.equal(classifyToken(token), kind, token);

// symspell
const sym = createSymSpell(2);
sym.add('effusion', 1000000);
sym.add('infusion', 50000);
const hit = sym.lookup('efusion');
assert.equal(hit[0].term, 'effusion');
assert.equal(hit[0].distance, 1);
assert.deepEqual(
  hit.map((r) => r.term),
  ['effusion', 'infusion'],
);
assert.deepEqual(sym.lookup('xyzzyq'), []);
assert.equal(sym.lookup('effusion')[0].distance, 0);
assert.equal(sym.lookup('efusion', 1).length, 1);
// Sorted by distance, then by count (highest first).
const ties = createSymSpell(2);
ties.add('hat', 10);
ties.add('bat', 30);
ties.add('cat', 20);
ties.add('mat', 5);
assert.deepEqual(
  ties.lookup('rat', 5).map((r) => r.term),
  ['bat', 'cat', 'hat', 'mat'],
);
// A transposition counts as one edit.
sym.add('haemorrhage', 5);
assert.equal(sym.lookup('haemorrhgae')[0].distance, 1);
assert.equal(sym.lookup('haemorrhgaee')[0].distance, 2);
assert.equal(sym.lookup('haemoxxxhage').length, 0);
// Adding a term twice keeps one entry.
sym.add('effusion', 3);
assert.equal(sym.lookup('effusion').filter((r) => r.term === 'effusion').length, 1);

// suggester
const english =
  'the 1000000\non 900000\nsmall 800000\ninfusion 50000\nright 700000\nrich 600000\nrice 500000\nrise 400000';
const medical = 'haemorrhage 1000000\neffusion 1000000\nleft 1000000\n3cm 1000000';
const none = { lookup: () => [] };
const suggester = createSuggester({ english, medical, learned: none });
assert.equal(suggester.suggest('HAEMORRHAGF')[0], 'HAEMORRHAGE');
assert.equal(suggester.suggest('Efusion')[0], 'Effusion');
assert.equal(suggester.suggest('efusion')[0], 'effusion');
assert.ok(suggester.isKnown('Effusion'));
assert.ok(!suggester.isKnown('efusion'));
assert.ok(suggester.suggest('efusion').length <= 3);
// A candidate that would become a date once cased is dropped (Mav must not become May).
const dated = createSuggester({ english: 'may 900000\nmat 800000', medical: '', learned: none });
assert.ok(!dated.suggest('Mav').includes('May'));
assert.ok(dated.suggest('Mav').includes('Mat'));
// A word is never suggested to itself.
assert.ok(!suggester.suggest('small').includes('small'));
// Laterality words and numbers never come out as replacements.
assert.ok(!suggester.suggest('rigth').includes('right'));
assert.ok(!suggester.suggest('lefl').includes('left'));
assert.ok(!suggester.suggest('3cn').includes('3cm'));
// Very short words get no guesses.
assert.deepEqual(suggester.suggest('te'), []);
// Learned corrections rank first, even when the medical list lacks the word.
const learned = { lookup: (w) => (w === 'efusion' ? ['effusion'] : []) };
const noMedical = createSuggester({ english, medical: 'haemorrhage 1000000', learned });
assert.equal(noMedical.suggest('efusion')[0], 'effusion');
assert.equal(noMedical.suggest('EFUSION')[0], 'EFFUSION');

// buildCheckList
const text = 'Small efusion 3.2 cm on left.';
const items = buildCheckList(text, { suggester });
assert.deepEqual(
  items.map((i) => [i.text, i.kind]),
  [
    ['efusion', 'suggest'],
    ['3.2', 'verify'],
    ['cm', 'verify'],
    ['left', 'verify'],
  ],
);
assert.equal(items[0].suggestions[0], 'effusion');
assert.deepEqual(items[1].suggestions, []);
for (const i of items) assert.equal(text.slice(i.start, i.end), i.text);
assert.equal(text.slice(items[3].start, items[3].end + 1), 'left.');
// An unknown word with no suggestion must be verified.
assert.deepEqual(
  buildCheckList('Small xyzzyq', { suggester }).map((i) => [i.text, i.kind, i.suggestions]),
  [['xyzzyq', 'verify', []]],
);
// A signed number keeps its sign in the range.
assert.equal(buildCheckList('Small -3.2 mm', { suggester })[0].text, '-3.2');
// Confidence is read from spans, and only when spans are given.
const spans = [
  { start: 0, end: 5, confidence: 0.99 },
  { start: 6, end: 8, confidence: 0.5 },
  { start: 9, end: 11, confidence: 0.1 },
];
assert.deepEqual(
  buildCheckList('Small on me', { spans, suggester }).map((i) => [i.text, i.kind]),
  [
    ['on', 'verify'],
    ['me', 'verify'],
  ],
);
assert.deepEqual(buildCheckList('Small on', { suggester }), []);
assert.deepEqual(buildCheckList('Small on', { spans, threshold: 0.4, suggester }), []);
const lowSuggest = buildCheckList('Small rise', {
  spans: [
    { start: 0, end: 5, confidence: 0.99 },
    { start: 6, end: 10, confidence: 0.3 },
  ],
  suggester,
});
assert.equal(lowSuggest[0].kind, 'suggest');
assert.deepEqual(lowSuggest[0].suggestions, ['rice']);

// Misread laterality words are flagged with no suggestions.
for (const misread of ['Ieft', 'Rlght', 'bilaterl'])
  assert.deepEqual(
    buildCheckList('Small ' + misread, { suggester }).map((i) => [i.text, i.kind, i.suggestions]),
    [[misread, 'verify', []]],
  );
// Hyphenated laterality compounds, fractions and compound units are flagged too.
assert.deepEqual(
  buildCheckList('Small left-sided ½ mcg/mL', { suggester }).map((i) => [i.text, i.kind]),
  [
    ['left-sided', 'verify'],
    ['½', 'verify'],
    ['mcg/mL', 'verify'],
  ],
);

// applySuggestion
assert.equal(applySuggestion(text, items[0], 'effusion'), 'Small effusion 3.2 cm on left.');
assert.equal(applySuggestion('Small effusion 3.2 cm on left.', items[0], 'x'), null);
assert.equal(applySuggestion('Big efusion 3.2 cm on left.', items[0], 'effusion'), null);

// detectWordCorrection
const fix = { from: 'efusion', to: 'effusion' };
assert.deepEqual(detectWordCorrection('a efusion b', 'a effusion b'), fix);
assert.deepEqual(detectWordCorrection('a efusion, b', 'a effusion, b'), fix);
assert.equal(detectWordCorrection('a 3 b', 'a 8 b'), null);
assert.equal(detectWordCorrection('a efusion b', 'a effusion c b'), null);
assert.equal(detectWordCorrection('a efusion b', 'x effusion y'), null);
assert.equal(detectWordCorrection('a efusion b', 'a efusion b'), null);
assert.equal(detectWordCorrection('a efusion b', 'a Efusion b'), null);
assert.equal(detectWordCorrection('a efusion b', 'a efusion. b'), null);

// spansFromResult maps composed text back to word confidences
const word = (t, c) => ({ text: t, confidence: c, box: { x0: 0, y0: 0, x1: 1, y1: 1 } });
const result = {
  paragraphs: [
    { lines: [{ words: [word('Small', 0.9), word('efusion', 0.4)], confidence: 0.6 }] },
    { lines: [{ words: [word('3.2', 0.95)], confidence: 0.95 }] },
  ],
  engine: 'test',
  version: '0',
};
const composed = composeText(result).text;
assert.deepEqual(spansFromResult(result, composed), [
  { start: 0, end: 5, confidence: 0.9 },
  { start: 6, end: 13, confidence: 0.4 },
  { start: 15, end: 18, confidence: 0.95 },
]);
// Text that has since been edited is re-aligned word by word; words that are gone are skipped.
assert.deepEqual(spansFromResult(result, 'Small effusion\n\nnote 3.2'), [
  { start: 0, end: 5, confidence: 0.9 },
  { start: 21, end: 24, confidence: 0.95 },
]);

console.log('suggest tests passed');
