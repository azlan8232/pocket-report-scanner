# PaddleOCR library choice

Spike for v5 OCR accuracy, Task 4 (design spec section 4C), run on 2026-10-31.

## Decision

**paddleocr.js 1.2.0** (npm `paddleocr`, github.com/x3zvawq/paddleocr.js, MIT), running
**PP-OCRv5 mobile det** with the **Latin PP-OCRv5 mobile rec** model on **single-threaded
ONNX Runtime Web** (WASM, `numThreads = 1`, no COOP/COEP).

Why:

- It is the only candidate that passes every gate. It runs unchanged in Node and in the
  browser, and fetches nothing at runtime: the app passes in the model bytes and ONNX Runtime.
  It ships one ES module with no imports, so the buildless page can load it with `import()` and
  needs no bundler.
- Licence: MIT, with no npm dependencies. The built file also contains a TypeScript port of
  Clipper2's polygon-offset code (Angus Johnson), which is under the Boost Software License 1.0
  (BSL-1.0). The library's build strips that notice, so `scripts/vendor-ocr.cjs` puts it back at
  the top of `paddleocr.mjs` and writes `LICENSE-clipper2-BSL-1.0.txt` beside it. BSL-1.0 is
  OSI-approved and permissive, with no copyleft; the controller accepts it (Ruling I).
- The official PaddleOCR.js SDK was **more accurate**: fair CER 0.15% against 0.28%, and poor
  41.1% against 45.7%. It is disqualified **only** because its browser build imports four
  packages by bare name (`onnxruntime-web`, `@techstark/opencv-js`, `clipper-lib`, `js-yaml`),
  so it needs a bundler, which the buildless `dist/` app cannot take. Its `clipper-lib`
  dependency is also BSL-1.0, which is acceptable under Ruling I, so the licence is not a
  reason. If the app ever gains a build step, the owner may want to revisit this choice; it
  would also add 10.4 MB of OpenCV.js.
- `ppu-paddle-ocr` is disqualified under the Node and browser gate: its `/web` entry imports
  `onnxruntime-web` and `ppu-ocv` by bare name, so the browser needs a bundler. It was also far
  less accurate on the same models with its default pipeline (fair CER 44%).
- ONNX Runtime Web is MIT. Its WASM statically links third-party code, including Eigen
  (MPL-2.0, accepted under Ruling J). `ThirdPartyNotices-onnxruntime-web.txt` is vendored next
  to its LICENSE.
- Rec dictionary: the Latin rec beat the English rec on fair (0.28% against 1.06%) and on poor
  (45.7% against 47.2%), for 0.2 MB more. The multilingual (Chinese) PP-OCRv5 mobile rec was
  worse than both and twice the size.

The deciding condition is **fair** (controller ruling: average is saturated near 0% for every
engine). For comparison, Tesseract 6.0.1 on the same raw variant scores good 0.01%, average
0.01%, fair 1.97%, poor 82.36%.

## Results

Task 3 test set: 20 fictional reports × good, average, fair and poor, raw variant
(`preparePhoto` in photo mode). The spike harness groups lines into paragraphs with
`groupLinesIntoParagraphs` and scores with `scripts/accuracy/metrics.cjs`, the same way as
`npm run accuracy`. Detection used the PaddleX PP-OCRv5 pipeline defaults (`limit_type: min`,
`limit_side_len: 64`, `max_side_limit: 4000`, thresh 0.3, box_thresh 0.6, unclip 1.5) for
paddleocr.js and the official SDK. The library's 960 px `max` default lost most small print
(average CER 71% on r01). ppu-paddle-ocr ran with its own defaults; its 4000 px setting was
worse on r01.

Mean CER / mean WER:

| Candidate | Rec model | Runtime | Good | Average | Fair | Poor | s/page |
|---|---|---|---|---|---|---|---|
| paddleocr.js 1.2.0 | latin_PP-OCRv5_mobile_rec | onnxruntime-node 1.31.1 | 0.04% / 0.26% | 0.07% / 0.52% | **0.28% / 1.54%** | 45.73% / 77.34% | 4.9 |
| paddleocr.js 1.2.0 | en_PP-OCRv5_mobile_rec | onnxruntime-node 1.31.1 | 0.01% / 0.06% | 0.03% / 0.19% | 1.06% / 4.72% | 47.15% / 76.89% | 4.2 |
| paddleocr.js 1.2.0 | en_PP-OCRv5_mobile_rec | onnxruntime-web 1.31.1, 1 thread WASM | 0.01% / 0.06% | 0.03% / 0.19% | 1.06% / 4.72% | 47.15% / 76.89% | 14.3 |
| paddleocr.js 1.2.0 | PP-OCRv5_mobile_rec (multilingual) | onnxruntime-node 1.31.1 | 0.18% / 1.68% | 0.21% / 1.56% | 1.12% / 8.59% | 73.12% / 96.62% | 5.4 |
| @paddleocr/paddleocr-js 0.4.2 (official) | latin_PP-OCRv5_mobile_rec | bundled onnxruntime-web, 1 thread WASM | 0.03% / 0.15% | 0.04% / 0.25% | 0.15% / 0.91% | 41.13% / 71.99% | 11.1 |
| ppu-paddle-ocr 6.6.1 | en_PP-OCRv5_mobile_rec | onnxruntime-node 1.31.1, opencv engine | 32.58% / 35.17% | 62.38% / 66.75% | 44.06% / 51.54% | 55.04% / 84.08% | 13.3 |

Seconds per page are Node wall-clock times on a Windows laptop, measured while other spike runs
and an unrelated CPU-heavy process were running. Treat them as rough and relative only. The
WASM backend gave exactly the same text as onnxruntime-node and was about 3× slower.

## Candidates

| Candidate | Licence | Node | Browser | Runtime network | Verdict |
|---|---|---|---|---|---|
| paddleocr.js 1.2.0 (`paddleocr`) | MIT (declared in package.json and README; no LICENSE file upstream). The built file contains Clipper2 offset code under BSL-1.0 | yes, CJS build | yes, a dependency-free ESM file loaded with `import()` | none: ort and model bytes are passed in | **chosen** |
| Official PaddleOCR.js (`@paddleocr/paddleocr-js` 0.4.2) | Apache-2.0, but needs `clipper-lib` (Boost Software License 1.0), `js-yaml` (MIT) and `@techstark/opencv-js` (Apache-2.0) | browser SDK only. It ran in Node after stubbing `globalThis.location`, injecting `fetch` and passing a `cv.Mat` | needs a bundler (bare imports of 4 packages). The worker mode falls back to a jsDelivr CDN for the WASM unless `wasmPaths` is set | default models come from Baidu BOS. Custom tar URLs and an injected `fetch` avoid that | **disqualified**: the browser build needs a bundler. It also needs Node shims and +10.4 MB OpenCV. Most accurate (fair 0.15%), so worth revisiting if a build step is ever added |
| ppu-paddle-ocr 6.6.1 | MIT; `ppu-ocv` MIT, `@techstark/opencv-js` 5 Apache-2.0, `@napi-rs/canvas` MIT | yes | needs a bundler (`/web` entry imports `onnxruntime-web` and `ppu-ocv` by bare name) | default models come from Hugging Face or GitHub; ArrayBuffers can be passed in | **disqualified**: the browser build needs a bundler. Also least accurate (its own detection resize and grouping) |

## Models

All from the official PaddleX ONNX inference archives. They are fetched at build time by
`scripts/vendor-ocr.cjs`, checked against sha256, unpacked into `dist/vendor/paddle/`
(gitignored) and never requested from a CDN at runtime. The model cards are Apache-2.0
(`license: apache-2.0`); the PaddleOCR LICENSE (Apache-2.0, tag v3.0.0) is copied next to
them.

| Model | Archive URL | sha256 (tar) | Vendored file | Bytes |
|---|---|---|---|---|
| PP-OCRv5_mobile_det | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar | 781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30 | det.onnx | 4,826,518 |
| latin_PP-OCRv5_mobile_rec (chosen) | …/latin_PP-OCRv5_mobile_rec_onnx_infer.tar | 0fd8634124d871d25492311da077517ba3b4277ea67a0dec9e46ce537978c7cb | rec.onnx, dict.txt (836 characters from inference.yml) | 8,042,023 |
| en_PP-OCRv5_mobile_rec (spike only) | …/en_PP-OCRv5_mobile_rec_onnx_infer.tar | 4424e851309b291b00aab8191cd4314cefbd2d1b2381ff8994019d262fa95e28 | — | 7,848,423 |
| PP-OCRv5_mobile_rec, multilingual (spike only) | …/PP-OCRv5_mobile_rec_onnx_infer.tar | f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c | — | 16,534,782 |

## What is vendored (dist/vendor/paddle, 27.7 MB)

| File | Source | Licence | Bytes |
|---|---|---|---|
| paddleocr.mjs | `paddleocr@1.2.0` dist/index.mjs, with the Clipper2 BSL-1.0 notice from its source restored at the top | MIT, with BSL-1.0 Clipper2 code | 202,340 |
| ort.wasm.min.mjs, ort-wasm-simd-threaded.mjs, ort-wasm-simd-threaded.wasm | `onnxruntime-web@1.30.0` dist | MIT | 14,314,404 |
| det.onnx, rec.onnx, dict.txt | PaddleX archives above | Apache-2.0 | 12,871,157 |
| LICENSE-paddleocr.js.txt, LICENSE-clipper2-BSL-1.0.txt, LICENSE-onnxruntime-web.txt, ThirdPartyNotices-onnxruntime-web.txt, LICENSE-PaddleOCR-models.txt | standard MIT text (no upstream file); AngusJohnson/Clipper2 tag Clipper2_1.4.0 LICENSE (sha256 c9bff757…); microsoft/onnxruntime v1.30.0 LICENSE and ThirdPartyNotices.txt (sha256 143764b9…); PaddlePaddle/PaddleOCR v3.0.0 LICENSE | — | 353,370 |

The spike used onnxruntime-web/node 1.31.1. The app pins onnxruntime-web 1.30.0, which was
released six weeks before the spike rather than five days. `npm run accuracy` reruns the chosen
setup on the vendored 1.30.0 files.
