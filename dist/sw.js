'use strict';
const CACHE = 'pocket-ocr-v5';
const assets = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'prepare.js',
  'engine.js',
  'engine-paddle.js',
  'symspell.js',
  'suggest.js',
  'learned.js',
  'output.js',
  'dict/medical-imaging.txt',
  'dict/en-30k.txt',
  'paddle-worker.js',
  'crop-editor.js',
  'page.js',
  'page-worker.js',
  'corner-editor.js',
  'icon.svg',
  'manifest.json',
  'vendor/tesseract.min.js',
  'vendor/worker.min.js',
  'vendor/lang/eng.traineddata.gz',
  'vendor/opencv.js',
  ...[
    'paddleocr.mjs',
    'ort.wasm.min.mjs',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'det.onnx',
    'rec.onnx',
    'dict.txt',
  ].map((f) => 'vendor/paddle/' + f),
  ...[
    'tesseract-core',
    'tesseract-core-simd',
    'tesseract-core-lstm',
    'tesseract-core-simd-lstm',
  ].flatMap((n) => ['.wasm', '.wasm.js'].map((e) => 'vendor/core/' + n + e)),
];
self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const key of await caches.keys())
        if (key.startsWith('pocket-ocr-') && key !== CACHE) await caches.delete(key);
    })(),
  ),
);
self.addEventListener('message', (e) => {
  if (e.data.type !== 'prepare') return;
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        let done = 0;
        for (const path of assets) {
          const url = new URL(path, self.registration.scope);
          const r = await fetch(url, { cache: 'reload' });
          if (!r.ok || r.redirected) throw Error('Asset unavailable');
          await cache.put(url, r);
          e.source?.postMessage({ type: 'progress', done: ++done, total: assets.length });
        }
        await cache.put(new URL('offline-ready', self.registration.scope), new Response('ready'));
        e.source?.postMessage({ type: 'ready' });
      } catch (err) {
        e.source?.postMessage({ type: 'failed' });
      }
    })(),
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      try {
        return await fetch(e.request);
      } catch (err) {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          const home = await caches.match(new URL('./', self.registration.scope));
          if (home) return home;
        }
        throw err;
      }
    })(),
  );
});
