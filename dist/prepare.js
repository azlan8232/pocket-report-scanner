/* Local photo preparation. No recognition or medical-word substitutions here. */
(function (root) {
  'use strict';
  // The background estimate is the image at 1/8 size, scaled back up. 1/16 and 1/64 scored worse
  // on the poor fixtures (see tests/accuracy-report.md and the task 5 report).
  const BACKGROUND_SCALE = 8;
  const SHARPNESS_WIDTH = 1000; // sharpness is measured on at most this many pixels across
  const MIN_SHORT_SIDE = 1500;
  // Midpoint of the median Laplacian-variance scores of the fair (162.5) and poor (10.6) fixtures.
  // Fair photos read well (0.28% CER on PaddleOCR), so only poorer ones are warned about.
  const SHARPNESS_MIN = 87;
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Divides out uneven lighting: each pixel becomes gray / background, where the background
  // is a heavily smoothed copy of the image. Text stays dark; shadowed paper becomes even.
  function normaliseBackground(source, make, scale = BACKGROUND_SCALE) {
    const w = source.width,
      h = source.height;
    const small = make();
    small.width = Math.max(1, Math.round(w / scale));
    small.height = Math.max(1, Math.round(h / scale));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, 0, 0, small.width, small.height);
    const back = make();
    back.width = w;
    back.height = h;
    const bctx = back.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, w, h);
    const out = make();
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const pixels = octx.createImageData(w, h),
      d = pixels.data;
    octx.drawImage(source, 0, 0);
    const src = octx.getImageData(0, 0, w, h).data,
      bg = bctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.min(255, (luma(src, i) * 255) / Math.max(1, luma(bg, i)));
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    octx.putImageData(pixels, 0, 0);
    return out;
  }

  // Variance of the 3x3 Laplacian on grayscale: higher means sharper.
  function sharpnessScore(canvas, make = () => document.createElement('canvas')) {
    const scale = Math.min(1, SHARPNESS_WIDTH / canvas.width);
    const w = Math.max(3, Math.round(canvas.width * scale)),
      h = Math.max(3, Math.round(canvas.height * scale));
    const small = make();
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = luma(d, i * 4);
    let sum = 0,
      sumSq = 0,
      n = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  function qualityWarnings({ width, height, sharpness }) {
    const warnings = [];
    if (Math.min(width, height) < MIN_SHORT_SIDE)
      warnings.push('Small image: retake closer or at full resolution.');
    if (sharpness < SHARPNESS_MIN) warnings.push('Photo looks blurred: hold steady and retake.');
    return warnings;
  }

  function preparePhoto(
    source,
    {
      mode = 'photo',
      crop = { left: 0, top: 0, right: 100, bottom: 100 },
      background = mode === 'photo',
    } = {},
    make = () => document.createElement('canvas'),
  ) {
    const x = Math.round((source.width * crop.left) / 100),
      y = Math.round((source.height * crop.top) / 100);
    const w = Math.max(1, Math.round((source.width * crop.right) / 100) - x),
      h = Math.max(1, Math.round((source.height * crop.bottom) / 100) - y);
    const input = make();
    input.width = w;
    input.height = h;
    const ctx = input.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
    if (mode === 'original') return input;
    if (background) ctx.drawImage(normaliseBackground(input, make), 0, 0);
    // Luminance contrast: suppress grey paper without hard thresholding faint characters.
    // Skipped after background normalisation, which already sets the white point; stretching
    // again thickened blurred strokes (poor CER 45.7% -> 63.0% on PaddleOCR).
    const pixels = ctx.getImageData(0, 0, w, h),
      d = pixels.data,
      hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4)
      hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    const total = w * h;
    let acc = 0,
      low = 0,
      high = 255;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= total * 0.005) {
        low = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= total * 0.005) {
        high = i;
        break;
      }
    }
    if (!background && high - low > 30) {
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.max(
          0,
          Math.min(
            255,
            ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - low) * 255) / (high - low),
          ),
        );
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    // Aim for legible glyph sizes, bounded by 12MP to limit phone memory use.
    const scale = Math.min(3, Math.max(1, 2400 / w), Math.sqrt(12000000 / (w * h)));
    const out = make();
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const oc = out.getContext('2d');
    oc.fillStyle = 'white';
    oc.fillRect(0, 0, out.width, out.height);
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(input, 0, 0, out.width, out.height);
    return out;
  }
  root.preparePhoto = preparePhoto;
  root.sharpnessScore = sharpnessScore;
  root.qualityWarnings = qualityWarnings;
  if (typeof module !== 'undefined')
    module.exports = { preparePhoto, normaliseBackground, sharpnessScore, qualityWarnings };
})(typeof window === 'undefined' ? globalThis : window);
