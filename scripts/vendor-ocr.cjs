'use strict';
// Copy pinned OCR dependencies into the published site. No runtime CDN requests.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'dist/vendor');
const modules = path.join(root, 'node_modules');
for (const dir of ['', 'core', 'lang']) fs.mkdirSync(path.join(vendor, dir), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(modules, from), path.join(vendor, to));
for (const file of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) copy('tesseract.js/dist/' + file, file);
copy('tesseract.js/LICENSE.md', 'LICENSE-tesseract.md');
for (const name of ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm']) {
  for (const ext of ['.wasm', '.wasm.js']) copy('tesseract.js-core/' + name + ext, 'core/' + name + ext);
}
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
copy('tesseract.js-core/LICENSE', 'LICENSE-core');
console.log('Pinned OCR engine and English language files ready in dist/vendor.');
