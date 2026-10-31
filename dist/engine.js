/* OCR engine interface and the Tesseract adapter. Works in the browser and in Node:
   Tesseract and file paths are passed in rather than read from globals. */
(function (root) {
  'use strict';

  /* Word = { text, confidence 0..1, box }, Line = { words, confidence 0..1 },
     Paragraph = { lines }, RecognitionResult = { paragraphs, engine, version,
     confidence? 0..1 overall, when the engine reports one } */

  function composeText(result) {
    let text = '';
    const spans = [];
    result.paragraphs.forEach((paragraph, p) => {
      if (p) text += '\n\n';
      paragraph.lines.forEach((line, l) => {
        if (l) text += '\n';
        line.words.forEach((word, w) => {
          if (w) text += ' ';
          const start = text.length;
          text += word.text;
          spans.push({ start, end: text.length, text: word.text, confidence: word.confidence });
        });
      });
    });
    return { text, spans };
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* Lines arrive in reading order, each with a box. A large vertical gap starts a paragraph. */
  function groupLinesIntoParagraphs(lines) {
    if (!lines.length) return [];
    const limit = 1.5 * median(lines.map((l) => l.box.y1 - l.box.y0));
    const paragraphs = [{ lines: [lines[0]] }];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i].box.y0 - lines[i - 1].box.y1;
      if (gap > limit) paragraphs.push({ lines: [] });
      paragraphs[paragraphs.length - 1].lines.push(lines[i]);
    }
    return paragraphs;
  }

  const TESSERACT_VERSION = '6.0.1';
  const unit = (percent) => Math.min(1, Math.max(0, (percent || 0) / 100));

  function mapTesseractData(data) {
    const paragraphs = [];
    for (const block of data.blocks || [])
      for (const paragraph of block.paragraphs || []) {
        const lines = (paragraph.lines || [])
          .map((line) => ({
            confidence: unit(line.confidence),
            words: (line.words || [])
              .filter((w) => w.text.trim())
              .map((w) => ({
                text: w.text,
                confidence: unit(w.confidence),
                box: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
              })),
          }))
          .filter((line) => line.words.length);
        if (lines.length) paragraphs.push({ lines });
      }
    return {
      paragraphs,
      engine: 'tesseract',
      version: TESSERACT_VERSION,
      confidence: unit(data.confidence),
    };
  }

  function createTesseractEngine({ Tesseract, paths = {}, onProgress }) {
    let worker = null;
    return {
      name: 'tesseract',
      version: TESSERACT_VERSION,
      async recognise(canvas, { mode }) {
        if (!worker)
          worker = await Tesseract.createWorker('eng', 1, {
            ...paths,
            workerBlobURL: false,
            cacheMethod: 'none',
            logger: (m) => {
              if (onProgress) onProgress(m);
            },
          });
        await worker.setParameters({
          tessedit_pageseg_mode: mode === 'photo' ? '3' : '6',
          user_defined_dpi: '300',
        });
        const { data } = await worker.recognize(
          canvas,
          { rotateAuto: mode !== 'original' },
          { text: true, blocks: true },
        );
        return mapTesseractData(data);
      },
      async terminate() {
        const w = worker;
        worker = null;
        if (w) await w.terminate();
      },
    };
  }

  /* Uses primary until its recognise throws once; then reports the error through
     onFallback and uses fallback for the rest of this tab's life. */
  function createEngineWithFallback(primary, fallback, onFallback) {
    let active = primary;
    return {
      get name() {
        return active.name;
      },
      get version() {
        return active.version;
      },
      async recognise(image, options) {
        if (active === primary)
          try {
            return await primary.recognise(image, options);
          } catch (error) {
            active = fallback;
            onFallback(error);
          }
        return fallback.recognise(image, options);
      },
      async terminate() {
        await Promise.all([primary.terminate(), fallback.terminate()]);
      },
    };
  }

  const api = {
    composeText,
    groupLinesIntoParagraphs,
    mapTesseractData,
    createTesseractEngine,
    createEngineWithFallback,
  };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
