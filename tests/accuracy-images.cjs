'use strict';
// Which files the accuracy runner scores: rNN-<condition> renders in img/, and phone photos
// in phone/ named rNN or rNN-anything.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listImages } = require('../scripts/accuracy/run.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accuracy-images-'));
try {
  fs.mkdirSync(path.join(root, 'img'));
  fs.mkdirSync(path.join(root, 'phone'));
  for (const f of ['r01-good.png', 'r01-poor.jpg', 'r02.png', 'notes.txt'])
    fs.writeFileSync(path.join(root, 'img', f), '');
  for (const f of ['r01.jpg', 'r02-kitchen-table.JPG', 'r03.jpeg', 'r04.png', 'IMG_2041.jpg'])
    fs.writeFileSync(path.join(root, 'phone', f), '');
  const logged = [];
  const found = listImages(Infinity, root, (m) => logged.push(m));
  assert.deepEqual(
    found.map((i) => [i.id, i.condition, path.basename(i.file)]),
    [
      ['r01', 'good', 'r01-good.png'],
      ['r01', 'poor', 'r01-poor.jpg'],
      ['r01', 'phone', 'r01.jpg'],
      ['r02', 'phone', 'r02-kitchen-table.JPG'],
      ['r03', 'phone', 'r03.jpeg'],
      ['r04', 'phone', 'r04.png'],
    ],
  );
  // Images that do not fit the naming are reported, not skipped silently.
  assert.deepEqual(logged, ['Skipped 2 images not named rNN-<condition> (img/) or rNN (phone/).']);
  assert.deepEqual(
    listImages(1, root, () => {}).map((i) => i.id),
    ['r01', 'r01', 'r01'],
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('accuracy image naming tests passed');
