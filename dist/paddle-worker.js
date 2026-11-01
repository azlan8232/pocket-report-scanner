'use strict';
/* Dedicated worker that runs the PaddleOCR engine off the page's main thread.
   The page talks to it through createPaddleWorkerEngine (engine-paddle.js). Every stage
   (downloading, starting, finding text lines, recognising) reports progress, which keeps
   the page's watchdog from stopping a slow but working job. */
importScripts('engine.js', 'engine-paddle.js');

const vendor = (file) => new URL('vendor/paddle/' + file, self.location.href).href;

servePaddleWorker(self, (onProgress) =>
  createPaddleEngine({
    ort: async () => {
      const ort = await import(vendor('ort.wasm.min.mjs'));
      ort.env.wasm.wasmPaths = vendor('');
      return ort;
    },
    paddle: () => import(vendor('paddleocr.mjs')),
    modelUrls: {
      detection: vendor('det.onnx'),
      recognition: vendor('rec.onnx'),
      dictionary: vendor('dict.txt'),
      // Downloaded with progress by the engine, so the runtime does not fetch it silently.
      wasm: vendor('ort-wasm-simd-threaded.wasm'),
    },
    onProgress,
  }),
);
