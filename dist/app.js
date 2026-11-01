'use strict';
const $ = (id) => document.getElementById(id);
let canvas = null,
  engine = null,
  busy = false,
  run = 0;
const crop = { left: 0, top: 0, right: 100, bottom: 100 };
let previewTimer;
const editor = new ParagraphCropEditor((value, commit) => {
  Object.assign(crop, value);
  drawCrop();
  resetResult();
  status('Selection changed. Tap Transcribe selected section when ready.');
  clearTimeout(previewTimer);
  if (commit) updateSelectionPreview();
  else previewTimer = setTimeout(updateSelectionPreview, 180);
});
// Page detection and straightening: OpenCV.js runs in page-worker.js, loaded after first paint.
const PAGE_NOT_FOUND = 'Page edges not found; using the full photo.';
const pageTools = createPageWorker({ workerUrl: new URL('page-worker.js', location.href).href });
let pageCorners = null,
  pageRun = 0, // detection results only apply to the photo they were run on
  detecting = false, // a detection is running for the current photo
  heldCorners = null, // corners found during an extraction, offered once it ends
  straightenRun = 0, // the straighten request in flight (0: none)
  straightenCount = 0;
const cornerEditor = new CornerEditor($('cropStage'), (corners) => (pageCorners = corners));
function updateSelectionPreview() {
  if (!canvas) return;
  const selected = preparePhoto(canvas, { mode: 'original', crop });
  const thumb = document.createElement('canvas');
  const scale = Math.min(1, 800 / selected.width, 500 / selected.height);
  thumb.width = Math.max(1, Math.round(selected.width * scale));
  thumb.height = Math.max(1, Math.round(selected.height * scale));
  thumb.getContext('2d').drawImage(selected, 0, 0, thumb.width, thumb.height);
  $('selectionPreview').src = thumb.toDataURL('image/png');
  $('selectionInfo').textContent =
    `${selected.width} × ${selected.height} source pixels · outside text is excluded`;
  // A warning only, never a block: it describes the selected region and extraction stays available.
  const warnings = qualityWarnings({
    width: selected.width,
    height: selected.height,
    sharpness: sharpnessScore(selected),
  });
  $('photoWarning').textContent = warnings.join(' ');
  $('photoWarning').hidden = !warnings.length;
}
const status = (msg, error = false) => {
  $('status').textContent = msg;
  $('status').classList.toggle('error', error);
};
function count() {
  const n = $('text').value.trim();
  $('wordCount').textContent = (n ? n.split(/\s+/).length : 0) + ' words';
  const ready = !!n && $('verified').checked && !busy;
  for (const id of ['copy', 'share', 'download']) $(id).disabled = !ready;
}
function lock(value) {
  busy = value;
  for (const id of ['camera', 'choose', 'replace', 'rotate', 'extract', 'demo', 'clear'])
    $(id).disabled = value;
  for (const id of [
    'cropTop',
    'cropBottom',
    'cropLeft',
    'cropRight',
    'cropReset',
    'scanMode',
    'engine',
  ])
    $(id).disabled = value;
  for (const id of ['zoom', 'zoomIn', 'zoomOut', 'zoomFit', 'selectMode', 'panMode'])
    $(id).disabled = value;
  // The crop editor waits while page corners are being placed.
  editor.disabled = value || cornerEditor.shown;
  cornerEditor.disabled = value;
  $('straighten').disabled = value;
  $('skipStraighten').disabled = value;
  $('text').readOnly = value;
  $('verified').disabled = value;
  count();
  if (!value && heldCorners) {
    // Shown without replacing the extraction's status; the page actions box explains them.
    const corners = heldCorners;
    heldCorners = null;
    offerCorners(corners);
  }
}
function hidePageCorners() {
  cornerEditor.hide();
  pageCorners = null;
  $('pageActions').hidden = true;
  editor.disabled = busy;
}
function offerCorners(corners) {
  pageCorners = corners;
  cornerEditor.show(corners, canvas.width, canvas.height);
  editor.disabled = true;
  $('pageActions').hidden = false;
}
// Finds the page in the current photo and offers its corners; never blocks scanning.
// A result that arrives during an extraction is held: found corners are offered when the
// extraction ends; "not found" is dropped, as that extraction already used the full photo.
async function detectPage() {
  const token = ++pageRun;
  detecting = true;
  let found = null;
  try {
    found = await pageTools.detect(canvas);
  } catch (e) {
    console.warn('Page detection failed', e);
  }
  if (token !== pageRun) return; // the photo changed; whatever changed it decides what next
  detecting = false;
  if (busy) {
    heldCorners = found;
    return;
  }
  if (!found) {
    status(PAGE_NOT_FOUND);
    return;
  }
  offerCorners(found);
  status('Page edges found. Adjust the corners, then tap Straighten page or Skip.');
}
// Lets Skip and Clear end a straighten that is still running; its result is then ignored.
function cancelStraighten() {
  if (!straightenRun) return;
  straightenRun = 0;
  lock(false);
}
$('straighten').onclick = async () => {
  if (!canvas || busy || !pageCorners) return;
  const source = canvas;
  const token = (straightenRun = ++straightenCount);
  lock(true);
  // Skip and Clear stay usable, so a slow straighten never traps the person.
  $('skipStraighten').disabled = false;
  $('clear').disabled = false;
  status('Straightening the page on your device…');
  try {
    const flat = await pageTools.straighten(source, pageCorners);
    if (token !== straightenRun) return;
    canvas = flat;
    source.width = source.height = 1; // free the unstraightened photo now
    resetResult();
    showCanvas(); // resets the crop and recomputes the photo warnings
    $('fileInfo').textContent =
      `${canvas.width} × ${canvas.height} pixels · straightened page · image held in this tab only`;
    status('Page straightened. Select a paragraph, then tap Transcribe selected section.');
  } catch (e) {
    if (token !== straightenRun) return;
    console.warn('Straightening failed', e);
    hidePageCorners();
    status(PAGE_NOT_FOUND);
  } finally {
    if (token === straightenRun) {
      straightenRun = 0;
      lock(false);
    }
  }
};
$('skipStraighten').onclick = () => {
  cancelStraighten();
  hidePageCorners();
  status('Using the full photo. Select a paragraph, then tap Transcribe selected section.');
};
function showCanvas() {
  ++pageRun; // a new or changed photo cancels any page detection still running
  heldCorners = null;
  hidePageCorners();
  $('preview').src = canvas.toDataURL('image/jpeg', 0.9);
  $('empty').hidden = true;
  $('imageArea').hidden = false;
  editor.setImage(canvas.width, canvas.height);
  resetCrop();
  $('quality').textContent =
    'Use a flat, sharp photo. Read one section at a time if the report has very small print.';
}
function resetResult() {
  resetCheck();
  $('text').value = '';
  $('verified').checked = false;
  count();
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    status('This image is over 20 MB. Choose a smaller photo.', true);
    return;
  }
  if (!file.type.startsWith('image/')) {
    status('Choose an image file. PDF files are not supported in this prototype.', true);
    return;
  }
  lock(true);
  const url = URL.createObjectURL(file);
  let loaded = false;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(
      1,
      Math.min(
        1,
        4200 / Math.max(img.naturalWidth, img.naturalHeight),
        Math.sqrt(16000000 / (img.naturalWidth * img.naturalHeight)),
      ),
    );
    canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    resetResult();
    showCanvas();
    $('fileInfo').textContent =
      `${canvas.width} × ${canvas.height} pixels · image held in this tab only`;
    status('Image ready. Check orientation, then extract text.');
    loaded = true;
  } catch (e) {
    status('This image could not be opened. Try a JPG or PNG photo.', true);
  } finally {
    URL.revokeObjectURL(url);
    lock(false);
  }
  if (loaded) detectPage();
}
$('camera').onclick = () => $('cameraInput').click();
$('choose').onclick = $('replace').onclick = () => $('fileInput').click();
for (const id of ['cameraInput', 'fileInput'])
  $(id).onchange = (e) => {
    loadFile(e.target.files[0]);
    e.target.value = '';
  };
$('rotate').onclick = () => {
  if (!canvas) return;
  // Corners being placed turn with the photo: (x, y) → (old height − y, x).
  const turned = pageCorners && pageCorners.map((p) => ({ x: canvas.height - p.y, y: p.x }));
  const redetect = detecting; // rotating cancels a running detection, so run it again
  const rotated = document.createElement('canvas');
  rotated.width = canvas.height;
  rotated.height = canvas.width;
  const ctx = rotated.getContext('2d');
  ctx.translate(rotated.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  canvas = rotated;
  resetResult();
  showCanvas();
  status('Image rotated. Extract again when ready.');
  if (turned) offerCorners(turned);
  else if (redetect) detectPage();
};
function resetCrop() {
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    crop[edge] = edge === 'left' || edge === 'top' ? 0 : 100;
    const id = 'crop' + edge[0].toUpperCase() + edge.slice(1);
    $(id).value = crop[edge];
  }
  drawCrop();
  updateSelectionPreview();
}
function drawCrop() {
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    const id = 'crop' + edge[0].toUpperCase() + edge.slice(1);
    $(id).value = crop[edge];
    $(id + 'Value').textContent = Number(crop[edge].toFixed(1)) + '%';
  }
  editor.setCrop(crop);
}
for (const edge of ['left', 'top', 'right', 'bottom'])
  $('crop' + edge[0].toUpperCase() + edge.slice(1)).oninput = (e) => {
    crop[edge] = +e.target.value;
    if (crop.right - crop.left < 0.5) {
      crop[edge] = edge === 'left' ? crop.right - 0.5 : crop.left + 0.5;
      e.target.value = crop[edge];
    }
    if (crop.bottom - crop.top < 0.5) {
      crop[edge] = edge === 'top' ? crop.bottom - 0.5 : crop.top + 0.5;
      e.target.value = crop[edge];
    }
    drawCrop();
    updateSelectionPreview();
    resetResult();
    status('Crop changed. Extract again to read the selected region.');
  };
$('cropReset').onclick = () => {
  resetCrop();
  resetResult();
  status('Full image selected. Extract again when ready.');
};
$('scanMode').onchange = () => {
  resetResult();
  status('Reading mode changed. Extract again when ready.');
};
// Engine choice: PaddleOCR by default, falling back to Tesseract if it cannot run here.
const ENGINE_KEY = 'pocket-ocr-engine';
const FALLBACK_NOTICE = 'PaddleOCR could not run on this device, so Tesseract was used.';
let paddleFailed = false; // once PaddleOCR fails, this tab keeps using Tesseract
try {
  if (localStorage.getItem(ENGINE_KEY) === 'tesseract') $('engine').value = 'tesseract';
} catch (_) {}
$('engine').onchange = () => {
  try {
    localStorage.setItem(ENGINE_KEY, $('engine').value);
  } catch (_) {}
  const old = engine;
  engine = null;
  if (old) old.terminate().catch(() => {});
  $('engineNotice').hidden = !(paddleFailed && $('engine').value === 'paddle');
  resetResult();
  status('Engine changed. Extract again when ready.');
};
let progressRun = 0; // progress messages only show for the extraction in flight
function showProgress(m) {
  if (progressRun !== run) return;
  const p = Number.isFinite(m.progress) ? Math.round(m.progress * 100) : 0;
  $('progress').value = m.progress || 0;
  status(
    (m.status === 'recognizing text'
      ? 'Reading your report'
      : m.status.replace(/^./, (x) => x.toUpperCase())) + ` · ${p}%`,
  );
}
function createEngine(choice) {
  const tesseract = createTesseractEngine({
    Tesseract,
    paths: {
      workerPath: new URL('vendor/worker.min.js', location.href).href,
      corePath: new URL('vendor/core/', location.href).href,
      langPath: new URL('vendor/lang/', location.href).href.replace(/\/$/, ''),
    },
    onProgress: showProgress,
  });
  if (choice === 'tesseract' || paddleFailed) return tesseract;
  // PaddleOCR loads and runs inside paddle-worker.js, off the main thread.
  const paddleEngine = createPaddleWorkerEngine({
    workerUrl: new URL('paddle-worker.js', location.href).href,
    onProgress: showProgress,
  });
  return createEngineWithFallback(paddleEngine, tesseract, (error) => {
    console.warn('PaddleOCR failed', error);
    paddleFailed = true;
    $('engineNotice').textContent = FALLBACK_NOTICE;
    $('engineNotice').hidden = false;
  });
}
/* Learned words and the Check panel. The dictionaries load after the first extraction, never at
   page start; if they cannot load, the panel still lists what to verify, just without chips. */
let learnedStorage = null;
try {
  learnedStorage = localStorage;
} catch (_) {} // blocked storage: nothing is remembered
const learned = createLearnedStore(learnedStorage, undefined, undefined, () => {
  $('learnedNotice').hidden = false;
});
const NO_SUGGESTIONS = { isKnown: () => true, suggest: () => [] };
let suggester = null, // null until the dictionaries have loaded
  suggesterLoad = null,
  checkRun = 0, // bumped when the result is cleared, so a late check is dropped
  checkItems = [],
  keptItems = new Set(),
  settledText = '', // the text as it was when edits last settled
  editTimer;
function updateLearnedCount() {
  $('learnedCount').textContent = String(learned.size());
}
updateLearnedCount();
async function loadSuggester() {
  const read = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(url + ' ' + response.status);
    return response.text();
  };
  const [english, medical] = await Promise.all([
    read('dict/en-30k.txt'),
    read('dict/medical-imaging.txt'),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the page paint before the build
  return createSuggester({ english, medical, learned });
}
/* Builds the suggester once; after a failure the next extraction tries again. */
function ensureSuggester() {
  suggesterLoad ||= loadSuggester()
    .then((built) => (suggester = built))
    .catch((e) => {
      console.warn('Suggestions unavailable', e);
      suggesterLoad = null;
      return null;
    });
  return suggesterLoad;
}
function kindLabel(item) {
  const kind = item.kind === 'suggest' ? 'word' : classifyToken(item.text);
  if (kind === 'laterality') return 'Check side';
  if (kind === 'date') return 'Check date';
  if (kind === 'unit') return 'Check unit';
  return kind === 'number' ? 'Check number' : 'Unclear word';
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function textChanged() {
  status('Text changed; list refreshed');
  rebuildCheck();
}
function selectItem(item) {
  const box = $('text');
  if (box.value.slice(item.start, item.end) !== item.text) return textChanged();
  box.focus();
  box.setSelectionRange(item.start, item.end);
}
function chooseSuggestion(item, replacement) {
  const next = applySuggestion($('text').value, item, replacement);
  if (next === null) return textChanged();
  recordCorrection(item.text, replacement, next, item.start);
  $('text').value = next;
  settledText = next;
  $('verified').checked = false;
  count();
  rebuildCheck();
}
/* Only a word fixed to a word the dictionaries know is kept: a corrected name or other
   identifier must never be stored. */
const isTitleCase = (word) => word.length > 1 && /^\p{Lu}[^\p{Lu}]*$/u.test(word);
const startsSentence = (text, index) => /(?:^|[.!?:\n])\s*$/.test(text.slice(0, index));
/* `text` and `index` place the corrected word in the report. A Title Case word in mid-sentence
   may be a surname that happens to be in the dictionary, so it is not kept. */
function recordCorrection(from, to, text, index) {
  if (!suggester || classifyToken(from) !== 'word' || classifyToken(to) !== 'word') return;
  if (!suggester.isKnown(to)) return;
  if (isTitleCase(to) && !startsSentence(text, index)) return;
  learned.record(from, to);
  updateLearnedCount();
}
function renderCheck() {
  const seen = new Map();
  const shown = checkItems.filter((item) => {
    const n = (seen.get(item.text) || 0) + 1;
    seen.set(item.text, n);
    item.key = item.text + '#' + n; // the n-th time this exact text appears
    return !keptItems.has(item.key);
  });
  const rows = shown.map((item) => {
    const row = element('li', 'check-row');
    const word = element('button', 'check-word', item.text);
    word.type = 'button';
    word.onclick = () => selectItem(item);
    row.append(word, element('span', 'check-kind', kindLabel(item)));
    for (const suggestion of item.suggestions.slice(0, 3)) {
      const chip = element('button', 'chip', suggestion);
      chip.type = 'button';
      chip.onclick = () => chooseSuggestion(item, suggestion);
      row.append(chip);
    }
    const keep = element('button', 'chip keep', 'Keep');
    keep.type = 'button';
    keep.onclick = () => {
      keptItems.add(item.key);
      renderCheck();
    };
    row.append(keep);
    return row;
  });
  const label = shown.length + (shown.length === 1 ? ' item' : ' items') + ' to check';
  $('checkList').replaceChildren(...rows);
  $('check').hidden = !shown.length;
  $('checkSummary').textContent = label;
  $('checkCount').textContent = shown.length ? label : '';
  $('checkNote').hidden = !!suggester || !shown.length;
  $('checkNote').textContent =
    'Suggestions are unavailable, so unclear words are listed without them.';
}
function rebuildCheck(spans) {
  try {
    checkItems = buildCheckList($('text').value, { spans, suggester: suggester || NO_SUGGESTIONS });
  } catch (e) {
    console.warn('Check list failed', e);
    checkItems = [];
  }
  renderCheck();
}
function resetCheck() {
  checkRun++;
  clearTimeout(editTimer);
  checkItems = [];
  keptItems = new Set();
  settledText = '';
  renderCheck();
}
async function showCheckAfterExtraction(result) {
  const id = checkRun;
  const text = $('text').value;
  settledText = text;
  let spans;
  try {
    spans = spansFromResult(result, text);
  } catch (_) {} // no word confidences: only numbers, sides and units are listed
  await ensureSuggester();
  if (id !== checkRun) return;
  // Spans fit the extracted text only; if it was edited while loading, they would misplace.
  rebuildCheck($('text').value === text ? spans : undefined);
}
/* A pause in typing: learn a single fixed word, then refresh the list. */
function afterEdit() {
  const now = $('text').value;
  const fix = detectWordCorrection(settledText, now);
  if (fix) {
    // detectWordCorrection guarantees the same word count, so the first difference is it.
    const before = settledText.split(/\s+/).filter(Boolean);
    const tokens = [...now.matchAll(/\S+/g)];
    const changed = tokens.findIndex((t, i) => t[0] !== before[i]);
    recordCorrection(fix.from, fix.to, now, tokens[changed].index);
  }
  settledText = now;
  rebuildCheck();
}
$('learnedClear').onclick = () => {
  learned.clear();
  $('learnedNotice').hidden = true;
  updateLearnedCount();
  rebuildCheck();
};
const meanConfidence = (spans) =>
  spans.length ? spans.reduce((sum, s) => sum + s.confidence, 0) / spans.length : 0;
$('extract').onclick = async () => {
  if (!canvas || busy) return;
  const token = ++run;
  progressRun = token;
  lock(true);
  resetResult();
  $('progress').hidden = false;
  $('progress').value = 0;
  status('Preparing selected image on your device…');
  let prepared;
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const mode = $('scanMode').value;
    prepared = preparePhoto(canvas, { mode, crop });
    if (!engine) engine = createEngine($('engine').value);
    const result = await engine.recognise(prepared, { mode });
    if (token !== run) return;
    const { text, spans } = composeText(result);
    $('text').value = text.trim();
    showCheckAfterExtraction(result);
    // Engines may omit an overall confidence; then use the mean word confidence.
    const confidence = Math.round(
      100 * (Number.isFinite(result.confidence) ? result.confidence : meanConfidence(spans)),
    );
    status(
      text.trim()
        ? `Extraction complete · OCR confidence ${confidence}% (not accuracy). ${confidence < 80 ? 'Low confidence: retake a closer photo or crop to one section. ' : ''}Check every line against the original.`
        : 'No text detected. Try a closer, sharper photograph or a different reading mode.',
      !text.trim(),
    );
  } catch (e) {
    if (engine) {
      try {
        await engine.terminate();
      } catch (_) {}
      engine = null;
    }
    status(
      'Could not complete OCR. Try a smaller crop. If offline, reconnect and refresh offline files first.',
      true,
    );
  } finally {
    if (prepared) {
      prepared.width = 1;
      prepared.height = 1;
    }
    $('progress').hidden = true;
    lock(false);
  }
};
$('text').oninput = () => {
  $('verified').checked = false;
  count();
  clearTimeout(editTimer);
  editTimer = setTimeout(afterEdit, 300);
};
$('verified').onchange = count;
$('share').hidden = typeof navigator.share !== 'function';
$('copy').onclick = async () => {
  try {
    const how = await copyReport($('text').value, navigator.clipboard, window.ClipboardItem);
    status(
      how === 'rich'
        ? 'Reviewed text copied, with headings and paragraphs for Word and PowerPoint.'
        : 'Reviewed text copied to your clipboard as plain text.',
    );
  } catch (e) {
    $('text').focus();
    $('text').select();
    status('Clipboard access unavailable here. Text is selected: long-press it and choose Copy.');
  }
};
$('share').onclick = async () => {
  try {
    const how = await shareReport($('text').value, navigator);
    if (how === 'shared') status('Reviewed text sent to the share menu.');
    else if (how === 'unavailable')
      status('Sharing is not available here. Use Copy or Save .txt.', true);
  } catch (e) {
    status('Sharing was refused. Use Save .txt instead.', true);
  }
};
$('download').onclick = () => {
  const blob = new Blob([$('text').value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'extracted-report-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status('Text file created. Your browser handles saving it.');
};
$('clear').onclick = () => {
  cancelStraighten();
  ++run;
  ++pageRun;
  detecting = false;
  heldCorners = null;
  hidePageCorners();
  canvas = null;
  $('preview').removeAttribute('src');
  $('selectionPreview').removeAttribute('src');
  clearTimeout(previewTimer);
  $('imageArea').hidden = true;
  $('empty').hidden = false;
  $('quality').textContent = '';
  $('photoWarning').hidden = true;
  $('fileInfo').textContent = '';
  resetResult();
  status('Image and text cleared from this tab. Copies you exported remain on your device.');
};
$('demo').onclick = () => {
  canvas = document.createElement('canvas');
  canvas.width = 1500;
  canvas.height = 1600;
  const c = canvas.getContext('2d');
  c.fillStyle = 'white';
  c.fillRect(0, 0, 1500, 1600);
  c.fillStyle = '#111';
  c.font = 'bold 48px Arial';
  c.fillText('SAMPLE CT BRAIN REPORT', 90, 140);
  c.font = '30px Arial';
  const lines = [
    'FICTIONAL DEMO - NOT A PATIENT REPORT',
    '',
    'Examination: CT brain without contrast',
    'Date: 30 October 2026',
    '',
    'Clinical indication: Headache',
    '',
    'FINDINGS:',
    'No acute intracranial haemorrhage.',
    'No midline shift or hydrocephalus.',
    'Grey-white matter differentiation is preserved.',
    '',
    'IMPRESSION:',
    'No acute intracranial abnormality.',
    '',
    'For testing text extraction only.',
  ];
  lines.forEach((line, i) => c.fillText(line, 90, 240 + i * 65));
  resetResult();
  showCanvas();
  $('fileInfo').textContent = 'Fictional sample generated on your device';
  status('Sample ready. Zoom, select a paragraph, then tap Transcribe selected section.');
  detectPage();
};
// Start loading OpenCV once the page has painted, so start-up stays fast.
addEventListener('load', () =>
  requestAnimationFrame(() =>
    setTimeout(() => pageTools.load().catch((e) => console.warn('OpenCV unavailable', e)), 0),
  ),
);
let registration;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('sw.js')
    .then(async (r) => {
      registration = r;
      await navigator.serviceWorker.ready;
      const ready = await caches.has('pocket-ocr-v4');
      if (ready) {
        const c = await caches.open('pocket-ocr-v4');
        if (await c.match(new URL('offline-ready', location.href).href))
          $('offlineStatus').textContent =
            'Scanner files are cached. Test a fresh extraction in airplane mode.';
      }
    })
    .catch(
      () =>
        ($('offlineStatus').textContent =
          'Offline setup is unavailable in this browser. Scanning can still work online.'),
    );
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data.type === 'ready') {
      $('offlineStatus').textContent =
        'Scanner files downloaded. Test a fresh extraction in airplane mode; browser storage can be cleared or evicted.';
      $('offlineButton').disabled = false;
      $('offlineButton').textContent = 'Refresh offline files';
    }
    if (e.data.type === 'failed') {
      $('offlineStatus').textContent = 'Download incomplete. Reconnect and try preparing again.';
      $('offlineButton').disabled = false;
    }
    if (e.data.type === 'progress')
      $('offlineStatus').textContent = `Downloading scanner files · ${e.data.done}/${e.data.total}`;
  });
}
$('offlineButton').onclick = async () => {
  if (!('serviceWorker' in navigator)) {
    $('offlineStatus').textContent = 'This browser does not support offline setup. Open in Chrome.';
    return;
  }
  try {
    $('offlineButton').disabled = true;
    const r = registration || (await navigator.serviceWorker.ready);
    (r.active || r.waiting).postMessage({ type: 'prepare' });
  } catch (e) {
    $('offlineButton').disabled = false;
    $('offlineStatus').textContent = 'Offline setup failed. Open in Chrome and try again.';
  }
};
