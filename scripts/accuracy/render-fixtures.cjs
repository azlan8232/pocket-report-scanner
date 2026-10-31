'use strict';
// Renders the fictional report texts into good / average / poor test images.
// Deterministic: a fixed seed per report drives the warp and the shadow.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, GlobalFonts, ImageData } = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '../../tests/fixtures/reports');
const PAGE = { w: 2480, h: 3508, margin: 160, font: 28, lineHeight: 40, paragraphGap: 24 };
const WARP_RANGE = [0.04, 0.07]; // corner movement as a share of page width
const SHADOW = { average: 0.25, poor: 0.4 }; // darkening at the far side
const POOR_WIDTH = 900;
const BLUR_SIGMA = 1.2;
const BACKGROUND = 90;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function registerFont() {
  const candidates = [
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Arial not found. Install it or add its path to registerFont().');
  GlobalFonts.registerFromPath(found, 'Arial');
}

function loadOpenCv() {
  const cv = require('@techstark/opencv-js');
  // Do not await cv itself: it is a thenable that resolves to itself and never settles.
  return new Promise((resolve) => {
    if (cv.Mat) resolve({ cv });
    else cv.onRuntimeInitialized = () => resolve({ cv });
  });
}

function renderPage(text) {
  const canvas = createCanvas(PAGE.w, PAGE.h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  ctx.fillStyle = '#000000';
  ctx.font = `${PAGE.font}px Arial`;
  ctx.textBaseline = 'top';
  const maxWidth = PAGE.w - 2 * PAGE.margin;
  let y = PAGE.margin;
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        ctx.fillText(line, PAGE.margin, y);
        y += PAGE.lineHeight;
        line = word;
      } else line = next;
    }
    if (line) ctx.fillText(line, PAGE.margin, y);
    y += PAGE.lineHeight + PAGE.paragraphGap;
  }
  if (y > PAGE.h - PAGE.margin) throw new Error('Report text does not fit on the page.');
  return canvas;
}

// Warp the page onto a grey background. Returns the new canvas and the page corners (TL, TR, BR, BL).
function warp(cv, source, rand) {
  const { width: w, height: h } = source;
  const inset = () => (WARP_RANGE[0] + rand() * (WARP_RANGE[1] - WARP_RANGE[0])) * w;
  const corners = [
    [inset(), inset()],
    [w - inset(), inset()],
    [w - inset(), h - inset()],
    [inset(), h - inset()],
  ];
  const src = cv.matFromImageData(source.getContext('2d').getImageData(0, 0, w, h));
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
  const m = cv.getPerspectiveTransform(from, to);
  cv.warpPerspective(
    src,
    dst,
    m,
    new cv.Size(w, h),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(BACKGROUND, BACKGROUND, BACKGROUND, 255),
  );
  const out = matToCanvas(cv, dst);
  for (const mat of [src, dst, from, to, m]) mat.delete();
  return { canvas: out, corners };
}

function matToCanvas(cv, mat) {
  const canvas = createCanvas(mat.cols, mat.rows);
  const pixels = new Uint8ClampedArray(mat.data.length);
  pixels.set(mat.data);
  canvas.getContext('2d').putImageData(new ImageData(pixels, mat.cols, mat.rows), 0, 0);
  return canvas;
}

// Linear shadow: no darkening on one side, `strength` darkening on the far side.
function addShadow(canvas, strength, angle) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const projections = [0, w * dx, h * dy, w * dx + h * dy];
  const lo = Math.min(...projections),
    span = Math.max(...projections) - lo;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = (x * dx + y * dy - lo) / span;
      const k = 1 - strength * t;
      const i = (y * w + x) * 4;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
    }
  ctx.putImageData(image, 0, 0);
}

function downscaleAndBlur(cv, canvas) {
  const scale = POOR_WIDTH / canvas.width;
  const src = cv.matFromImageData(
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
  );
  const small = new cv.Mat();
  cv.resize(
    src,
    small,
    new cv.Size(POOR_WIDTH, Math.round(canvas.height * scale)),
    0,
    0,
    cv.INTER_AREA,
  );
  const blurred = new cv.Mat();
  cv.GaussianBlur(small, blurred, new cv.Size(0, 0), BLUR_SIGMA, BLUR_SIGMA, cv.BORDER_DEFAULT);
  const out = matToCanvas(cv, blurred);
  for (const mat of [src, small, blurred]) mat.delete();
  return { canvas: out, scale };
}

async function main() {
  registerFont();
  const { cv } = await loadOpenCv();
  const textDir = path.join(ROOT, 'text');
  const imgDir = path.join(ROOT, 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  const names = fs
    .readdirSync(textDir)
    .filter((f) => /^r\d\d\.txt$/.test(f))
    .map((f) => f.slice(0, 3))
    .sort();
  const corners = {};
  for (const name of names) {
    const rand = mulberry32(1000 + Number(name.slice(1)));
    const page = renderPage(fs.readFileSync(path.join(textDir, name + '.txt'), 'utf8'));
    fs.writeFileSync(path.join(imgDir, `${name}-good.png`), page.toBuffer('image/png'));

    const warped = warp(cv, page, rand);
    const angle = rand() * Math.PI * 2;
    const average = createCanvas(warped.canvas.width, warped.canvas.height);
    average.getContext('2d').drawImage(warped.canvas, 0, 0);
    addShadow(average, SHADOW.average, angle);
    fs.writeFileSync(path.join(imgDir, `${name}-average.jpg`), average.toBuffer('image/jpeg', 80));

    const poorShadow = createCanvas(warped.canvas.width, warped.canvas.height);
    poorShadow.getContext('2d').drawImage(warped.canvas, 0, 0);
    addShadow(poorShadow, SHADOW.poor, angle);
    const poor = downscaleAndBlur(cv, poorShadow);
    fs.writeFileSync(path.join(imgDir, `${name}-poor.jpg`), poor.canvas.toBuffer('image/jpeg', 70));

    const round = (c) => c.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    corners[name] = {
      average: { width: average.width, height: average.height, corners: round(warped.corners) },
      poor: {
        width: poor.canvas.width,
        height: poor.canvas.height,
        corners: round(warped.corners.map(([x, y]) => [x * poor.scale, y * poor.scale])),
      },
    };
    console.log('rendered', name);
  }
  fs.writeFileSync(path.join(imgDir, 'corners.json'), JSON.stringify(corners, null, 2) + '\n');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
