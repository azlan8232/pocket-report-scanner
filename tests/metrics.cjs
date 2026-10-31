'use strict';
const assert = require('node:assert/strict');
const {
  normaliseForScoring,
  cer,
  wer,
  numberAccuracy,
} = require('../scripts/accuracy/metrics.cjs');

assert.equal(cer('abc', 'abd'), 1 / 3);
assert.equal(cer('abc', 'abc'), 0);
assert.equal(wer('a b c', 'a x c'), 1 / 3);
assert.equal(numberAccuracy('3.2 cm and 4 mm', '3.2 cm and 1 mm'), 0.5);
assert.equal(numberAccuracy('no numbers', 'x'), 1);
assert.equal(numberAccuracy('4 and 4', '4'), 0.5);
assert.equal(normaliseForScoring(' a\n\n b '), 'a b');
console.log('metrics tests passed');
