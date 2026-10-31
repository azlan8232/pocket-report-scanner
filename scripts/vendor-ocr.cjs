'use strict';
// Copy pinned OCR dependencies into the published site. No runtime CDN requests.
// Tesseract, paddleocr.js and ONNX Runtime Web come from node_modules. The PaddleOCR
// models and the licence texts the npm packages leave out are downloaded from pinned
// URLs, checked against sha256 and cached in .cache/vendor-ocr for later offline builds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'dist/vendor');
const modules = path.join(root, 'node_modules');
const cache = path.join(root, '.cache/vendor-ocr');
for (const dir of ['', 'core', 'lang', 'paddle'])
  fs.mkdirSync(path.join(vendor, dir), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(modules, from), path.join(vendor, to));

for (const file of [
  'tesseract.min.js',
  'worker.min.js',
  'tesseract.min.js.LICENSE.txt',
  'worker.min.js.LICENSE.txt',
])
  copy('tesseract.js/dist/' + file, file);
copy('tesseract.js/LICENSE.md', 'LICENSE-tesseract.md');
for (const name of [
  'tesseract-core',
  'tesseract-core-simd',
  'tesseract-core-lstm',
  'tesseract-core-simd-lstm',
]) {
  for (const ext of ['.wasm', '.wasm.js'])
    copy('tesseract.js-core/' + name + ext, 'core/' + name + ext);
}
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
copy('tesseract.js-core/LICENSE', 'LICENSE-core');

// PaddleOCR: paddleocr.js on single-threaded ONNX Runtime Web (WASM, no WebGPU).
copy('paddleocr/dist/index.mjs', 'paddle/paddleocr.mjs');
for (const file of [
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
])
  copy('onnxruntime-web/dist/' + file, 'paddle/' + file);

const MODELS =
  'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
const DOWNLOADS = {
  det: {
    url: MODELS + 'PP-OCRv5_mobile_det_onnx_infer.tar',
    sha256: '781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30',
  },
  rec: {
    url: MODELS + 'latin_PP-OCRv5_mobile_rec_onnx_infer.tar',
    sha256: '0fd8634124d871d25492311da077517ba3b4277ea67a0dec9e46ce537978c7cb',
  },
  paddleLicence: {
    url: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/v3.0.0/LICENSE',
    sha256: '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e',
  },
  ortLicence: {
    url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE',
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  },
};

async function download({ url, sha256 }) {
  const file = path.join(cache, sha256);
  const matches = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex') === sha256;
  if (fs.existsSync(file) && matches(fs.readFileSync(file))) return fs.readFileSync(file);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matches(bytes)) throw new Error('sha256 mismatch for ' + url);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes;
}

// The model archives are plain tar files; return the entry whose name ends with `suffix`.
function tarEntry(tar, suffix) {
  for (let at = 0; at + 512 <= tar.length;) {
    const field = (start, length) =>
      tar.toString('utf8', at + start, at + start + length).replace(/\0[\s\S]*$/, '');
    const prefix = field(345, 155);
    const name = prefix ? prefix + '/' + field(0, 100) : field(0, 100);
    if (!name) break;
    const size = parseInt(field(124, 12).trim() || '0', 8);
    if (name.endsWith(suffix)) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Missing ' + suffix + ' in model archive');
}

async function vendorPaddle() {
  const [det, rec, paddleLicence, ortLicence] = await Promise.all(
    Object.values(DOWNLOADS).map(download),
  );
  const out = (name) => path.join(vendor, 'paddle', name);
  fs.writeFileSync(out('det.onnx'), tarEntry(det, '_onnx_infer/inference.onnx'));
  fs.writeFileSync(out('rec.onnx'), tarEntry(rec, '_onnx_infer/inference.onnx'));
  // The recogniser's character list lives in its inference.yml; write one per line.
  const config = yaml.load(tarEntry(rec, '_onnx_infer/inference.yml').toString('utf8'));
  const characters = config.PostProcess.character_dict.map(String);
  if (characters.some((c) => [...c].length !== 1))
    throw new Error('Unexpected entry in the recognition dictionary');
  fs.writeFileSync(out('dict.txt'), characters.join('\n') + '\n');
  fs.writeFileSync(out('LICENSE-PaddleOCR-models.txt'), paddleLicence);
  fs.writeFileSync(out('LICENSE-onnxruntime-web.txt'), ortLicence);
  fs.writeFileSync(out('LICENSE-paddleocr.js.txt'), PADDLEOCR_JS_LICENCE);
}

// paddleocr.js declares MIT in package.json and README but ships no licence file.
const PADDLEOCR_JS_LICENCE = `paddleocr.js 1.2.0 (https://github.com/x3zvawq/paddleocr.js)
Licensed MIT, as declared in its package.json and README. The project ships no
licence file, so the standard MIT text is reproduced here.

MIT License

Copyright (c) x3zvawq

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

vendorPaddle().then(
  () => console.log('Pinned OCR engines, models and language files ready in dist/vendor.'),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
