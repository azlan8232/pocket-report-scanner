'use strict';
const assert = require('node:assert/strict');
const { createLearnedStore } = require('../dist/learned.js');

const memoryStorage = (initial) => {
  const data = new Map(initial ? [['pocket-ocr-learned-v1', initial]] : []);
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
};

// Corrections are ranked by how often they were made; lookup ignores case.
{
  const store = createLearnedStore(memoryStorage());
  store.record('efusion', 'effusion');
  store.record('efusion', 'infusion');
  store.record('Efusion', 'Effusion');
  assert.deepEqual(store.lookup('Efusion'), ['effusion', 'infusion']);
  assert.deepEqual(store.lookup('unknown'), []);
  assert.equal(store.size(), 2);
}

// Words with names like Object properties are ordinary words.
{
  const store = createLearnedStore(memoryStorage());
  assert.deepEqual(store.lookup('constructor'), []);
  store.record('constructor', 'construction');
  assert.deepEqual(store.lookup('constructor'), ['construction']);
}

// Corrections survive a reload, and Clear removes them.
{
  const storage = memoryStorage();
  createLearnedStore(storage).record('efusion', 'effusion');
  const again = createLearnedStore(storage);
  assert.deepEqual(again.lookup('efusion'), ['effusion']);
  again.clear();
  assert.equal(again.size(), 0);
  assert.equal(createLearnedStore(storage).size(), 0);
}

// Storage that throws never breaks scanning, and nothing is remembered.
{
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const store = createLearnedStore(broken);
  assert.doesNotThrow(() => store.record('efusion', 'effusion'));
  assert.deepEqual(store.lookup('efusion'), []);
  assert.equal(store.size(), 0);
  assert.doesNotThrow(() => store.clear());
  assert.equal(createLearnedStore(null).size(), 0);
}

// Corrupt or unexpected data starts empty and says so once.
for (const bad of ['{bad', '[1,2]', '"text"', '{"a":"b"}', '{"a":{"b":"x"}}']) {
  let resets = 0;
  const store = createLearnedStore(memoryStorage(bad), undefined, undefined, () => resets++);
  assert.equal(store.size(), 0, bad);
  assert.equal(resets, 1, bad);
  store.record('efusion', 'effusion');
  assert.deepEqual(store.lookup('efusion'), ['effusion'], 'usable after a reset');
  assert.equal(resets, 1);
}

// Over the limit, the lowest-count pair goes (the oldest of equals).
{
  const store = createLearnedStore(memoryStorage(), undefined, 2);
  store.record('aaa', 'aab');
  store.record('aaa', 'aab');
  store.record('ccc', 'ccd');
  store.record('eee', 'eef');
  assert.equal(store.size(), 2);
  assert.deepEqual(store.lookup('aaa'), ['aab']);
  assert.deepEqual(store.lookup('ccc'), []);
  assert.deepEqual(store.lookup('eee'), ['eef']);
}

// Same word, empty words and blanks are not corrections.
{
  const store = createLearnedStore(memoryStorage());
  store.record('same', 'Same');
  store.record('', 'x');
  store.record('x', ' ');
  assert.equal(store.size(), 0);
}

console.log('learned store tests passed');
