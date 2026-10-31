'use strict';
// Scoring metrics for OCR accuracy. Case and punctuation are kept.

function normaliseForScoring(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// Levenshtein distance over two arrays or strings (two-row dynamic programme).
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function rate(ref, hyp) {
  return ref.length ? distance(ref, hyp) / ref.length : hyp.length ? 1 : 0;
}

const cer = (ref, hyp) => rate([...normaliseForScoring(ref)], [...normaliseForScoring(hyp)]);

const tokens = (s) => {
  const n = normaliseForScoring(s);
  return n ? n.split(' ') : [];
};
const wer = (ref, hyp) => rate(tokens(ref), tokens(hyp));

function numberAccuracy(ref, hyp) {
  const wanted = tokens(ref).filter((t) => /\d/.test(t));
  if (!wanted.length) return 1;
  const pool = new Map();
  for (const t of tokens(hyp)) pool.set(t, (pool.get(t) || 0) + 1);
  let found = 0;
  for (const t of wanted) {
    if (pool.get(t) > 0) {
      pool.set(t, pool.get(t) - 1);
      found++;
    }
  }
  return found / wanted.length;
}

module.exports = { normaliseForScoring, cer, wer, numberAccuracy };
