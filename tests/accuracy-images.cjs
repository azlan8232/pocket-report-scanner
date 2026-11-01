'use strict';
// Which files the accuracy runner scores: rNN-<condition> renders in img/, and phone photos
// in phone/ named rNN or rNN-anything.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listImages, writeReport } = require('../scripts/accuracy/run.cjs');

// writeReport replaces only the results rows of the engine and variant it ran; a summary
// table above them, and the notes, stay where they are.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accuracy-report-'));
  const file = path.join(dir, 'report.md');
  const head =
    '| Engine | Variant | Condition | Images | Mean CER | Worst CER | Mean WER | Number accuracy | Seconds/page |';
  const row = (variant, cer) =>
    `| paddle | ${variant} | good | 20 | ${cer} | 0.32% | 0.20% | 100.00% | 11.7 |`;
  const before = [
    '# OCR accuracy report',
    '',
    '| Condition | paddle + clean CER | Target | Result |',
    '|---|---|---|---|',
    '| good | 0.04% | 2% or less | within |',
    '',
    'Notes above.',
    '',
    head,
    '|---|---|---|---|---|---|---|---|---|',
    row('raw', '0.04%'),
    row('clean', '0.04%'),
    'Notes below.',
  ];
  fs.writeFileSync(file, before.join('\n'));
  writeReport([row('clean', '0.05%').slice(2, -2).split(' | ')], [], [], file);
  const after = fs.readFileSync(file, 'utf8').split('\n');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(after, [...before.slice(0, 11), row('clean', '0.05%'), 'Notes below.']);
}

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
