'use strict';
/* Dedicated worker that runs the PaddleOCR engine off the page's main thread.
   The page talks to it through createPaddleWorkerEngine (engine-paddle.js). */
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
    },
    onProgress,
  }),
);
