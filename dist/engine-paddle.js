/* PaddleOCR adapter (PP-OCRv5 mobile det + Latin-script rec through paddleocr.js and ONNX
   Runtime). Works in the browser and in Node: ONNX Runtime, the paddleocr library and
   model loading are passed in rather than read from globals. */
(function (root) {
  'use strict';

  const PADDLE_VERSION = '1.2.0 / PP-OCRv5 mobile (latin)';

  // PaddleX OCR pipeline defaults for PP-OCRv5: keep native resolution up to 4000 px.
  const DETECTION = { limitType: 'min', maxSideLength: 64, maxSideLimit: 4000 };

  /* A detected line gives one box and one score. Split its text on spaces and give each
     word a slice of the box proportional to its character count (spaces included). */
  function splitLine(text, box, confidence) {
    const parts = text.split(' ');
    const width = box.x1 - box.x0;
    const total = text.length || 1;
    const words = [];
    let offset = 0;
    for (const part of parts) {
      if (part)
        words.push({
          text: part,
          confidence,
          box: {
            x0: box.x0 + (width * offset) / total,
            y0: box.y0,
            x1: box.x0 + (width * (offset + part.length)) / total,
            y1: box.y1,
          },
        });
      offset += part.length + 1;
    }
    return words;
  }

  const toBox = (b) => ({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height });

  /* lines: paddleocr.js processRecognition(...).lines, an array of visual lines, each an
     array of { text, box: { x, y, width, height }, confidence } in reading order. */
  function mapPaddleLines(lines, groupLinesIntoParagraphs) {
    const mapped = [];
    for (const items of lines) {
      const kept = items.filter((item) => item.text.trim());
      if (!kept.length) continue;
      const boxes = kept.map((item) => toBox(item.box));
      mapped.push({
        words: kept.flatMap((item, i) => splitLine(item.text.trim(), boxes[i], item.confidence)),
        confidence: kept.reduce((sum, item) => sum + item.confidence, 0) / kept.length,
        box: {
          x0: Math.min(...boxes.map((b) => b.x0)),
          y0: Math.min(...boxes.map((b) => b.y0)),
          x1: Math.max(...boxes.map((b) => b.x1)),
          y1: Math.max(...boxes.map((b) => b.y1)),
        },
      });
    }
    const confidence = mapped.length
      ? mapped.reduce((sum, line) => sum + line.confidence, 0) / mapped.length
      : 0;
    return {
      paragraphs: groupLinesIntoParagraphs(mapped),
      engine: 'paddleocr',
      version: PADDLE_VERSION,
      confidence,
    };
  }

  // A canvas (browser or @napi-rs/canvas), RGBA pixels { width, height, data } or, in
  // Node, a PNG/JPEG Buffer -> RGBA pixels.
  async function toPixels(image) {
    let canvas = image;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(image)) {
      const { createCanvas, loadImage } = require('@napi-rs/canvas');
      const decoded = await loadImage(image);
      canvas = createCanvas(decoded.width, decoded.height);
      canvas.getContext('2d').drawImage(decoded, 0, 0);
    } else if (!image.getContext) return image;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return {
      width: data.width,
      height: data.height,
      data: new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength),
    };
  }

  // Reads a file in chunks, calling onChunk({ received, total }) after each one (total is 0
  // when the server sends no length), so a slow but moving download can be told from a
  // stalled one.
  const fetchBytes = async (url, onChunk = () => {}) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load ' + url);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body || !response.body.getReader) {
      const whole = await response.arrayBuffer();
      onChunk({ received: whole.byteLength, total });
      return whole;
    }
    const chunks = [];
    let received = 0;
    const reader = response.body.getReader();
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      chunks.push(part.value);
      received += part.value.byteLength;
      onChunk({ received, total });
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  };

  // Loading the runtime and 13 MB of models must not stall for this long: the limit restarts
  // with every downloaded chunk, and again when initialize() starts, which must then finish
  // within it. Otherwise the engine reports an error (so the app falls back to Tesseract)
  // instead of hanging.
  const PADDLE_LOAD_TIMEOUT_MS = 60000;

  // The page gives up on the PaddleOCR worker if it sends no message at all (progress
  // included) for this long while a job is waiting, so a hung or killed worker falls back.
  // Downloading, starting, finding text lines and recognising each send progress.
  const PADDLE_WORKER_WATCHDOG_MS = 90000;

  /* ort and paddle are the onnxruntime and paddleocr.js modules, or functions returning
     (promises of) them, so they are only loaded when first needed.
     modelUrls = { detection, recognition, dictionary, wasm? }; wasm is the ONNX Runtime WASM
     binary, downloaded here (with progress) instead of by the runtime inside initialize().
     readFile(url, onChunk) -> ArrayBuffer, calling onChunk({ received, total }) as the file
     arrives (optional). */
  function createPaddleEngine({
    ort,
    paddle,
    modelUrls,
    readFile = fetchBytes,
    onProgress,
    loadTimeoutMs = PADDLE_LOAD_TIMEOUT_MS,
    groupLinesIntoParagraphs = root.groupLinesIntoParagraphs ||
      require('./engine.js').groupLinesIntoParagraphs,
  }) {
    let service = null;
    const resolve = async (x) => (typeof x === 'function' ? x() : x);
    const report = (status, progress) => {
      if (onProgress) onProgress({ status, progress });
    };
    // restartLimit() restarts the load limit; called on every download chunk and before
    // initialize(). It returns false once loading has finished or timed out.
    async function start(restartLimit) {
      const files = {}; // url -> { received, total }
      const download = (url) =>
        readFile(url, (chunk) => {
          if (!restartLimit()) return;
          files[url] = chunk;
          const parts = Object.values(files);
          const total = parts.reduce((sum, f) => sum + f.total, 0);
          const received = parts.reduce((sum, f) => sum + f.received, 0);
          report('downloading PaddleOCR', total ? Math.min(1, received / total) : 0);
        });
      const [ortModule, library, detection, recognition, dictionary, wasm] = await Promise.all([
        resolve(ort),
        resolve(paddle),
        download(modelUrls.detection),
        download(modelUrls.recognition),
        download(modelUrls.dictionary),
        modelUrls.wasm ? download(modelUrls.wasm) : null,
      ]);
      if (ortModule.env && ortModule.env.wasm) {
        // One WASM thread: no SharedArrayBuffer, so no COOP/COEP headers are needed.
        ortModule.env.wasm.numThreads = 1;
        if (wasm) ortModule.env.wasm.wasmBinary = wasm;
      }
      if (ortModule.env) ortModule.env.logLevel = 'error'; // hide model-graph warnings
      // The dictionary file lists the characters; PP-OCR appends the space character.
      const characters = new TextDecoder().decode(dictionary).split(/\r?\n/).filter(Boolean);
      characters.push(' ');
      const ocr = new library.PaddleOcrService({
        ort: ortModule,
        modelPreset: 'PP-OCRv5_mobile',
        detection: { modelBuffer: detection, ...DETECTION },
        recognition: { modelBuffer: recognition, charactersDictionary: characters },
      });
      restartLimit();
      report('starting PaddleOCR', 0);
      try {
        await ocr.initialize();
      } catch (error) {
        await ocr.destroy().catch(() => {}); // release a session that did load
        throw error;
      }
      return ocr;
    }
    function load() {
      let timer, expire;
      let settled = false;
      const expired = new Promise((_, reject) => (expire = reject));
      const restartLimit = () => {
        if (settled) return false;
        clearTimeout(timer);
        timer = setTimeout(
          () => expire(new Error('PaddleOCR took too long to load')),
          loadTimeoutMs,
        );
        return true;
      };
      restartLimit();
      const starting = start(restartLimit);
      return Promise.race([starting, expired])
        .finally(() => {
          settled = true;
          clearTimeout(timer);
        })
        .then(
          (ocr) => {
            report('PaddleOCR ready', 1);
            return ocr;
          },
          (error) => {
            // If loading completes after the timeout, release what it created.
            starting.then((ocr) => ocr.destroy()).catch(() => {});
            throw error;
          },
        );
    }
    return {
      name: 'paddleocr',
      version: PADDLE_VERSION,
      async recognise(image) {
        if (!service) {
          report('loading PaddleOCR', 0);
          service = load();
        }
        let ocr;
        try {
          ocr = await service;
        } catch (error) {
          service = null;
          throw error;
        }
        const results = await ocr.recognize(await toPixels(image), {
          onProgress(event) {
            const { current, total } = event.progress || {};
            if (!total) return;
            // Detection runs first, then recognition line by line.
            if (event.type === 'det') report('finding text lines', current / total);
            else if (event.type === 'rec') report('recognizing text', current / total);
          },
        });
        const { lines } = ocr.processRecognition(results, { recognitionScoreThreshold: 0 });
        return mapPaddleLines(lines, groupLinesIntoParagraphs);
      },
      async terminate() {
        const pending = service;
        service = null;
        if (pending) await (await pending.catch(() => null))?.destroy();
      },
    };
  }

  /* Worker side: answers { id, type: 'recognise', pixels } messages from
     createPaddleWorkerEngine with progress, then a result or an error, one job at a time.
     createEngine(onProgress) returns a createPaddleEngine engine. */
  function servePaddleWorker(scope, createEngine) {
    let current = 0;
    const engine = createEngine((progress) =>
      scope.postMessage({ id: current, type: 'progress', progress }),
    );
    let queue = Promise.resolve();
    scope.onmessage = (event) => {
      const { id, type, pixels } = event.data || {};
      if (type !== 'recognise') return;
      queue = queue.then(async () => {
        current = id;
        try {
          scope.postMessage({ id, type: 'result', result: await engine.recognise(pixels) });
        } catch (error) {
          const message = String((error && error.message) || error);
          scope.postMessage({ id, type: 'error', message });
        }
      });
    };
  }

  /* Main-thread side with the same engine shape: loading, detection, recognition and all
     image work run in a dedicated worker (workerUrl), so the page keeps painting. Only
     reading the canvas pixels happens on the calling thread. terminate() ends the worker,
     which frees all of its memory. If the worker sends nothing (not even progress) for
     watchdogMs while a job is waiting, it is treated as hung or killed and stopped. */
  function createPaddleWorkerEngine({
    workerUrl,
    onProgress,
    createWorker = (url) => new Worker(url),
    watchdogMs = PADDLE_WORKER_WATCHDOG_MS,
  }) {
    let worker = null;
    let nextId = 0;
    let watchdog = null;
    const pending = new Map();
    function failAll(error) {
      clearTimeout(watchdog);
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    }
    // Stop the worker and reject every waiting call; the next call starts a new worker.
    function abandon(error) {
      const failed = worker;
      worker = null;
      if (failed) failed.terminate();
      failAll(error);
    }
    function armWatchdog() {
      clearTimeout(watchdog);
      if (pending.size)
        watchdog = setTimeout(
          () => abandon(new Error('PaddleOCR worker stopped responding')),
          watchdogMs,
        );
    }
    function ensureWorker() {
      if (worker) return worker;
      worker = createWorker(workerUrl);
      worker.onmessageerror = () =>
        abandon(new Error('A PaddleOCR worker reply could not be read'));
      worker.onmessage = (event) => {
        armWatchdog();
        const message = event.data;
        const entry = pending.get(message.id);
        if (!entry) return;
        if (message.type === 'progress') {
          if (onProgress) onProgress(message.progress);
          return;
        }
        pending.delete(message.id);
        armWatchdog(); // stops it when nothing is left waiting
        if (message.type === 'result') entry.resolve(message.result);
        else entry.reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        if (event && event.preventDefault) event.preventDefault();
        abandon(new Error('PaddleOCR worker failed: ' + ((event && event.message) || 'error')));
      };
      return worker;
    }
    return {
      name: 'paddleocr',
      version: PADDLE_VERSION,
      async recognise(image) {
        const pixels = await toPixels(image);
        return new Promise((resolve, reject) => {
          const id = ++nextId;
          pending.set(id, { resolve, reject });
          ensureWorker().postMessage({ id, type: 'recognise', pixels }, [pixels.data.buffer]);
          armWatchdog();
        });
      },
      async terminate() {
        abandon(new Error('PaddleOCR was stopped'));
      },
    };
  }

  const api = {
    createPaddleEngine,
    createPaddleWorkerEngine,
    servePaddleWorker,
    mapPaddleLines,
    splitLine,
    PADDLE_VERSION,
    PADDLE_LOAD_TIMEOUT_MS,
    PADDLE_WORKER_WATCHDOG_MS,
  };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
