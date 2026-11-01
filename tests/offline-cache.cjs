'use strict';
// The offline cache must name the current version and list every file the page needs.
// Needs the vendored files, so run npm run build first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '../dist');
const read = (file) => fs.readFileSync(path.join(dist, file), 'utf8');
if (!fs.existsSync(path.join(dist, 'vendor')) || !fs.existsSync(path.join(dist, 'vendor/paddle'))) {
  console.error('run npm run build first');
  process.exit(1);
}

const CACHE_NAME = 'pocket-ocr-v5';
const sw = read('sw.js');
const app = read('app.js');
const html = read('index.html');

assert.equal(/const CACHE = '([^']+)'/.exec(sw)?.[1], CACHE_NAME);
// app.js reads the name from one constant and holds no other cache name.
assert.equal(/const OFFLINE_CACHE = '([^']+)'/.exec(app)?.[1], CACHE_NAME);
assert.deepEqual(
  [...new Set(app.match(/pocket-ocr-v\d+/g))],
  [CACHE_NAME],
  'app.js names another cache version',
);

const assets = new Function(
  sw.slice(sw.indexOf('const assets'), sw.indexOf("self.addEventListener('install'")) +
    '; return assets;',
)();
const listed = new Set(assets);
const missing = [];
const need = (file) => {
  if (!listed.has(file)) missing.push(file);
};

for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) need(src);
for (const dir of ['dict', 'vendor/paddle'])
  for (const file of fs.readdirSync(path.join(dist, dir)))
    // Licence and notice texts are not fetched at run time; they are only shipped.
    if (!/^(LICENSE|ThirdPartyNotices|SOURCE\.md)/.test(file)) need(dir + '/' + file);
for (const file of [
  'page-worker.js',
  'paddle-worker.js',
  'output.js',
  'learned.js',
  'vendor/opencv.js',
])
  need(file);
assert.deepEqual(missing, [], 'missing from the sw.js assets: ' + missing.join(', '));

// Every listed file exists, so the offline download cannot fail on a typo.
for (const file of assets)
  if (file !== './') assert.ok(fs.existsSync(path.join(dist, file)), 'not found: ' + file);

// The vendored OpenCV.js and its licence files ship with the site.
for (const file of ['vendor/LICENSE-opencv.txt', 'vendor/ThirdPartyNotices-opencv.txt'])
  assert.ok(fs.existsSync(path.join(dist, file)), 'not found: ' + file);

console.log('offline cache ok: ' + assets.length + ' files');
