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

  // A canvas (browser or @napi-rs/canvas) or, in Node, a PNG/JPEG Buffer -> RGBA pixels.
  async function toPixels(image) {
    let canvas = image;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(image)) {
      const { createCanvas, loadImage } = require('@napi-rs/canvas');
      const decoded = await loadImage(image);
      canvas = createCanvas(decoded.width, decoded.height);
      canvas.getContext('2d').drawImage(decoded, 0, 0);
    }
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return {
      width: data.width,
      height: data.height,
      data: new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength),
    };
  }

  const fetchBytes = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load ' + url);
    return response.arrayBuffer();
  };

  /* ort and paddle are the onnxruntime and paddleocr.js modules, or functions returning
     (promises of) them, so the browser only loads them when first needed.
     modelUrls = { detection, recognition, dictionary }; readFile(url) -> ArrayBuffer. */
  function createPaddleEngine({
    ort,
    paddle,
    modelUrls,
    readFile = fetchBytes,
    onProgress,
    groupLinesIntoParagraphs = root.groupLinesIntoParagraphs ||
      require('./engine.js').groupLinesIntoParagraphs,
  }) {
    let service = null;
    const resolve = async (x) => (typeof x === 'function' ? x() : x);
    async function start() {
      const [ortModule, library, detection, recognition, dictionary] = await Promise.all([
        resolve(ort),
        resolve(paddle),
        readFile(modelUrls.detection),
        readFile(modelUrls.recognition),
        readFile(modelUrls.dictionary),
      ]);
      // One WASM thread: no SharedArrayBuffer, so no COOP/COEP headers are needed.
      if (ortModule.env && ortModule.env.wasm) ortModule.env.wasm.numThreads = 1;
      if (ortModule.env) ortModule.env.logLevel = 'error'; // hide model-graph warnings
      // The dictionary file lists the characters; PP-OCR appends the space character.
      const characters = new TextDecoder().decode(dictionary).split(/\r?\n/).filter(Boolean);
      characters.push(' ');
      return library.PaddleOcrService.createInstance({
        ort: ortModule,
        modelPreset: 'PP-OCRv5_mobile',
        detection: { modelBuffer: detection, ...DETECTION },
        recognition: { modelBuffer: recognition, charactersDictionary: characters },
      });
    }
    return {
      name: 'paddleocr',
      version: PADDLE_VERSION,
      async recognise(image) {
        if (!service) {
          if (onProgress) onProgress({ status: 'loading PaddleOCR', progress: 0 });
          service = start();
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
            if (onProgress && event.type === 'rec' && event.progress.total)
              onProgress({
                status: 'recognizing text',
                progress: event.progress.current / event.progress.total,
              });
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

  const api = { createPaddleEngine, mapPaddleLines, splitLine, PADDLE_VERSION };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
