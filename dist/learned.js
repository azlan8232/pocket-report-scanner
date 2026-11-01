/* Words this person has corrected, kept in the browser's own storage on this device: single
   lowercased words only, as { from: { to: count } }. Corrections rank first in suggestions.
   Every storage call is guarded, so a blocked or corrupt store never stops scanning.
   Works in the browser and in Node. */
(function (root) {
  'use strict';

  const DEFAULT_KEY = 'pocket-ocr-learned-v1';
  const DEFAULT_LIMIT = 2000;

  const isCount = (n) => Number.isFinite(n) && n > 0;

  /* Map of from -> Map of to -> count, or null when the stored text is not that shape. */
  function parse(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const pairs = new Map();
    for (const [from, targets] of Object.entries(data)) {
      if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return null;
      const inner = new Map();
      for (const [to, n] of Object.entries(targets)) {
        if (!isCount(n)) return null;
        inner.set(to, n);
      }
      if (inner.size) pairs.set(from, inner);
    }
    return pairs;
  }

  const serialise = (pairs) =>
    JSON.stringify(
      Object.fromEntries([...pairs].map(([from, targets]) => [from, Object.fromEntries(targets)])),
    );

  const total = (pairs) => [...pairs.values()].reduce((sum, targets) => sum + targets.size, 0);

  /* Drops the lowest-count pairs (the oldest of equals) until at most `limit` remain. */
  function trim(pairs, limit) {
    let excess = total(pairs) - limit;
    if (excess <= 0) return;
    const all = [];
    for (const [from, targets] of pairs)
      for (const [to, n] of targets) all.push({ from, to, n, order: all.length });
    all.sort((a, b) => a.n - b.n || a.order - b.order);
    for (const { from, to } of all.slice(0, excess)) {
      pairs.get(from).delete(to);
      if (!pairs.get(from).size) pairs.delete(from);
    }
  }

  function createLearnedStore(
    storage,
    key = DEFAULT_KEY,
    limit = DEFAULT_LIMIT,
    onReset = undefined,
  ) {
    function load() {
      let raw = null;
      try {
        raw = storage ? storage.getItem(key) : null;
      } catch (_) {
        return new Map();
      }
      if (raw === null || raw === undefined) return new Map();
      const pairs = parse(raw);
      if (pairs) return pairs;
      if (onReset) onReset();
      return new Map();
    }

    let pairs = load();

    /* Keeps the change only when it was saved, so what is shown matches what is stored. */
    function save(next) {
      try {
        if (!storage) return false;
        storage.setItem(key, serialise(next));
        pairs = next;
        return true;
      } catch (_) {
        return false;
      }
    }

    const copy = () => new Map([...pairs].map(([from, targets]) => [from, new Map(targets)]));

    return {
      record(from, to) {
        const a = String(from).trim().toLowerCase();
        const b = String(to).trim().toLowerCase();
        if (!a || !b || a === b) return;
        const next = copy();
        const targets = next.get(a) || new Map();
        targets.set(b, (targets.get(b) || 0) + 1);
        next.set(a, targets);
        trim(next, limit);
        save(next);
      },
      lookup(from) {
        const targets = pairs.get(String(from).trim().toLowerCase());
        if (!targets) return [];
        return [...targets]
          .map(([to, n], order) => ({ to, n, order }))
          .sort((x, y) => y.n - x.n || x.order - y.order)
          .map((x) => x.to);
      },
      size: () => total(pairs),
      clear() {
        try {
          if (storage) storage.removeItem(key);
        } catch (_) {}
        pairs = new Map();
      },
    };
  }

  const api = { createLearnedStore };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
