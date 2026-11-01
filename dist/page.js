/* Page detection and perspective straightening with OpenCV.js, run before the crop editor.
   OpenCV.js needs eval (Function) at start-up, which the page's CSP forbids, so in the browser
   it runs in page-worker.js; createPageWorker is the page's side of that worker. */
(function (root) {
  'use strict';
  const DETECT_MAX_SIDE = 1000; // detection runs on at most this many pixels on the long side
  const MIN_PAGE_AREA = 0.25; // a page must cover at least this share of the image
  const PAGE_WORKER_TIMEOUT_MS = 120000; // loading 10 MB of OpenCV on a slow phone, then the job

  // [tl, tr, br, bl]: top-left has the smallest x+y, bottom-right the largest; top-right has
  // the smallest y−x, bottom-left the largest.
  function orderCorners(points) {
    const by = (f) => [...points].sort((a, b) => f(a) - f(b));
    const sum = by((p) => p.x + p.y),
      diff = by((p) => p.y - p.x);
    return [sum[0], diff[0], sum[3], diff[3]].map((p) => ({ x: p.x, y: p.y }));
  }

  const clamp = (n, max) => Math.max(0, Math.min(max, n));
  function moveCorner(corners, index, point, width, height) {
    return corners.map((c, i) =>
      i === index ? { x: clamp(point.x, width), y: clamp(point.y, height) } : { ...c },
    );
  }

  // Source canvas → { pixels, scale } with the long side at most DETECT_MAX_SIDE.
  function detectionPixels(canvas, make) {
    const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(canvas.width, canvas.height));
    const small = make();
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = small.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, small.width, small.height);
    return { pixels: ctx.getImageData(0, 0, small.width, small.height), scale };
  }

  // Four page corners in the pixels' own coordinates, or null. pixels: { width, height, data }.
  function detectCornersInPixels(cv, pixels) {
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const src = keep(cv.matFromImageData(pixels));
      const gray = keep(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const edges = keep(new cv.Mat());
      cv.Canny(gray, edges, 50, 150);
      const kernel = keep(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.dilate(edges, edges, kernel);
      const contours = keep(new cv.MatVector());
      const hierarchy = keep(new cv.Mat());
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let largest = null,
        largestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const contour = keep(contours.get(i));
        const area = cv.contourArea(contour);
        if (area > largestArea) [largest, largestArea] = [contour, area];
      }
      if (!largest) return null;
      const approx = keep(new cv.Mat());
      cv.approxPolyDP(largest, approx, 0.02 * cv.arcLength(largest, true), true);
      if (approx.rows !== 4 || !cv.isContourConvex(approx)) return null;
      if (Math.abs(cv.contourArea(approx)) < MIN_PAGE_AREA * pixels.width * pixels.height)
        return null;
      const p = approx.data32S;
      return orderCorners([0, 1, 2, 3].map((i) => ({ x: p[2 * i], y: p[2 * i + 1] })));
    } finally {
      for (const m of mats) m.delete();
    }
  }

  function findPageCorners(cv, canvas, make = () => document.createElement('canvas')) {
    const { pixels, scale } = detectionPixels(canvas, make);
    const corners = detectCornersInPixels(cv, pixels);
    return corners && corners.map((p) => ({ x: p.x / scale, y: p.y / scale }));
  }

  // Output size: width = longer of top and bottom edges, height = longer of left and right.
  function straightSize(corners) {
    const [tl, tr, br, bl] = orderCorners(corners);
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    return {
      width: Math.max(1, Math.round(Math.max(d(tl, tr), d(bl, br)))),
      height: Math.max(1, Math.round(Math.max(d(tl, bl), d(tr, br)))),
    };
  }

  // Warps the quad inside pixels to a flat { width, height, data } page.
  function warpPixels(cv, pixels, corners) {
    const { width, height } = straightSize(corners);
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const src = keep(cv.matFromImageData(pixels));
      const from = keep(
        cv.matFromArray(
          4,
          1,
          cv.CV_32FC2,
          orderCorners(corners).flatMap((p) => [p.x, p.y]),
        ),
      );
      const to = keep(
        cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]),
      );
      const transform = keep(cv.getPerspectiveTransform(from, to));
      const dst = keep(new cv.Mat());
      cv.warpPerspective(
        src,
        dst,
        transform,
        new cv.Size(width, height),
        // Cubic: linear resampling softened small print (r06-fair Tesseract CER 38.8% -> 4.9%).
        cv.INTER_CUBIC,
        cv.BORDER_REPLICATE,
      );
      return { width, height, data: new Uint8ClampedArray(dst.data) };
    } finally {
      for (const m of mats) m.delete();
    }
  }

  function toCanvas({ width, height, data }, make) {
    const out = make();
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    const image = ctx.createImageData(width, height);
    image.data.set(data);
    ctx.putImageData(image, 0, 0);
    return out;
  }

  const sourcePixels = (canvas) =>
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

  function straighten(cv, canvas, corners, make = () => document.createElement('canvas')) {
    return toCanvas(warpPixels(cv, sourcePixels(canvas), corners), make);
  }

  /* Worker side: answers { id, type: 'load' | 'detect' | 'straighten', pixels, corners }
     one job at a time. loadCv() resolves to { cv } (never to cv itself: it is a thenable
     that never settles) once the OpenCV runtime is ready. */
  function servePageWorker(scope, loadCv) {
    let ready = null;
    let queue = Promise.resolve();
    scope.onmessage = (event) => {
      const { id, type, pixels, corners } = event.data || {};
      queue = queue.then(async () => {
        try {
          const { cv } = await (ready = ready || loadCv());
          if (type === 'load') scope.postMessage({ id, type: 'result' });
          if (type === 'detect')
            scope.postMessage({ id, type: 'result', corners: detectCornersInPixels(cv, pixels) });
          if (type === 'straighten') {
            const page = warpPixels(cv, pixels, corners);
            scope.postMessage({ id, type: 'result', page }, [page.data.buffer]);
          }
        } catch (error) {
          scope.postMessage({
            id,
            type: 'error',
            message: String((error && error.message) || error),
          });
        }
      });
    };
  }

  /* Page side. load() starts OpenCV early; detect(canvas) → corners in source pixels or null;
     straighten(canvas, corners) → a new canvas. Each rejects if OpenCV cannot load or run
     (old phone, out of memory); the worker is then stopped and the next call starts afresh. */
  function createPageWorker({
    workerUrl,
    createWorker = (url) => new Worker(url),
    make = () => document.createElement('canvas'),
    timeoutMs = PAGE_WORKER_TIMEOUT_MS,
  }) {
    let worker = null;
    let nextId = 0;
    const pending = new Map();
    function abandon(error) {
      const failed = worker;
      worker = null;
      if (failed) failed.terminate();
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      pending.clear();
    }
    function ensureWorker() {
      if (worker) return worker;
      worker = createWorker(workerUrl);
      worker.onmessage = ({ data }) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        // After a failure (often out of memory) OpenCV may be unusable: stop this worker.
        if (data.type !== 'result') return abandon(new Error(data.message));
        pending.delete(data.id);
        clearTimeout(entry.timer);
        entry.resolve(data);
      };
      worker.onmessageerror = () => abandon(new Error('A page worker reply could not be read'));
      worker.onerror = (event) => {
        if (event && event.preventDefault) event.preventDefault();
        abandon(new Error('Page worker failed: ' + ((event && event.message) || 'error')));
      };
      return worker;
    }
    function ask(message, transfer = []) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(
          () => abandon(new Error('Page worker stopped responding')),
          timeoutMs,
        );
        pending.set(id, { resolve, reject, timer });
        ensureWorker().postMessage({ id, ...message }, transfer);
      });
    }
    return {
      async load() {
        await ask({ type: 'load' });
      },
      async detect(canvas) {
        const { pixels, scale } = detectionPixels(canvas, make);
        const { corners } = await ask({ type: 'detect', pixels }, [pixels.data.buffer]);
        return corners && corners.map((p) => ({ x: p.x / scale, y: p.y / scale }));
      },
      async straighten(canvas, corners) {
        const pixels = sourcePixels(canvas);
        const { page } = await ask({ type: 'straighten', pixels, corners }, [pixels.data.buffer]);
        return toCanvas(page, make);
      },
      async terminate() {
        abandon(new Error('Page worker was stopped'));
      },
    };
  }

  const api = {
    orderCorners,
    moveCorner,
    findPageCorners,
    straighten,
    servePageWorker,
    createPageWorker,
  };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
