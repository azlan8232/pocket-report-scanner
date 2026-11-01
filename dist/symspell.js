/* Symmetric-delete spelling lookup (the SymSpell idea, MIT, Wolf Garbe) with
   Damerau-OSA edit distance. A small in-repo port: the dictionary is indexed by all
   deletions of each term's first PREFIX_LENGTH letters, so a lookup only compares words that
   share a deletion with the input. Works in the browser and in Node. */
(function (root) {
  'use strict';

  const PREFIX_LENGTH = 7;

  /* Edit distance with transpositions (optimal string alignment), or max + 1 when it is more
     than max. */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        let d = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          d = Math.min(d, prev2[j - 2] + 1);
        cur[j] = d;
        if (d < best) best = d;
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return Math.min(prev[b.length], max + 1);
  }

  /* All strings reachable by deleting up to `depth` letters, the string itself included. */
  function deletions(word, depth, into = new Set()) {
    into.add(word);
    if (depth > 0 && word.length > 1)
      for (let i = 0; i < word.length; i++)
        deletions(word.slice(0, i) + word.slice(i + 1), depth - 1, into);
    return into;
  }

  function createSymSpell(maxDistance = 2) {
    const entries = []; // { term, count }
    const indexOf = new Map(); // term -> position in entries
    const byDeletion = new Map(); // deletion -> positions in entries

    function add(term, count) {
      if (indexOf.has(term)) {
        const entry = entries[indexOf.get(term)];
        entry.count = Math.max(entry.count, count);
        return;
      }
      const position = entries.length;
      entries.push({ term, count });
      indexOf.set(term, position);
      for (const key of deletions(term.slice(0, PREFIX_LENGTH), maxDistance)) {
        const list = byDeletion.get(key);
        if (list) list.push(position);
        else byDeletion.set(key, [position]);
      }
    }

    /* Up to `max` terms within maxDistance edits, nearest first, then most frequent. */
    function lookup(word, max = 3) {
      const candidates = new Set();
      for (const key of deletions(word.slice(0, PREFIX_LENGTH), maxDistance))
        for (const position of byDeletion.get(key) || []) candidates.add(position);
      const found = [];
      for (const position of candidates) {
        const { term, count } = entries[position];
        const distance = editDistance(word, term, maxDistance);
        if (distance <= maxDistance) found.push({ term, distance, count });
      }
      found.sort((x, y) => x.distance - y.distance || y.count - x.count);
      return found.slice(0, max);
    }

    const has = (term) => indexOf.has(term);

    return { add, lookup, has };
  }

  const api = { createSymSpell, editDistance };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
