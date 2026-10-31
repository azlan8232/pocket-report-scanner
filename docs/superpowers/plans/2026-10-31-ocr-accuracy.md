# Pocket Report Scanner v5 OCR Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise on-device OCR accuracy for phone photos of typed imaging/other reports, measured by CER/WER on a fictional test set, and add tap-to-accept word suggestions plus rich copy and share.

**Architecture:** The app stays buildless: plain scripts in `dist/`, each an IIFE that attaches to `window` and also `module.exports` for Node tests (same pattern as `prepare.js` and `crop-editor.js`). Recognition goes through one engine interface (`recognise()`), with PaddleOCR as primary and Tesseract as fallback/compare. Pure logic (metrics, geometry, suggestions, formatting) lives in small modules tested with `node:assert`. The same modules drive a Node accuracy runner.

**Tech Stack:**
- Vanilla JS (ES2020, no bundler).
- Tesseract.js 6.0.1 (existing).
- PaddleOCR PP-OCRv5 mobile on ONNX Runtime; the library is chosen in Task 4.
- OpenCV.js via `@techstark/opencv-js`.
- `@napi-rs/canvas` for Node tests.
- Prettier for the one-off reformat.

**Spec:** `docs/superpowers/specs/2026-10-31-ocr-accuracy-design.md`

## Global Constraints

- Standalone app. No HDW Connect code changes.
- All recognition on the device. No cloud OCR, analytics, uploads or report storage. No runtime CDN requests: every dependency is vendored into `dist/vendor/` by `scripts/vendor-ocr.cjs`.
- No patient images, OCR output or identifiers committed; fixtures are fictional only.
- Licences: Apache-2.0 / MIT / BSD only. No AGPL (Scribe.js excluded).
- Bump the offline cache whenever application files change; final name `pocket-ocr-v5`.
- Suggestions: confidence threshold starts at `0.80`; SymSpell edit distance ≤ `2`; at most `3` candidates; never for tokens with digits, units, dates or laterality.
- Copy writes `text/html` + `text/plain` via `ClipboardItem`, falling back to `writeText`.
- Copy, Share and Download stay disabled until the review tick is checked (existing `count()` gate).
- Quality warning thresholds: short side < `1500` px, or low sharpness (variance of Laplacian; starting threshold set in Task 5). These are warnings, never blocks.
- Work on local branch `v5-ocr-accuracy`. Do not push or deploy.

## Decisions beyond the spec (owner, please confirm in review)

1. **Page detection uses OpenCV.js directly** (the same contour → quad → warp method as jscanify), not the jscanify package. Reason: the same code then also runs in the Node accuracy runner; jscanify's Node build needs `jsdom` + `canvas`.
2. **Unknown words also get suggestions.** A word that matches no dictionary qualifies even when the engine is confident. PaddleOCR reports confidence per line, not per word, so confidence alone would miss most misreads.
3. **The result stays a `<textarea>`.** Items to check appear in a "Check" panel below it; tapping an item selects its range in the textarea. This avoids a fragile `contenteditable` overlay on Android.
4. **Test photos are generated** from the fictional reports (good / average / poor degradations rendered in Node). Real phone photos of printed copies can be dropped into `tests/fixtures/reports/phone/` by the owner and are scored when present.
5. **SymSpell is a small in-repo implementation** (`dist/symspell.js`), not node-symspell. Reason: it must run buildless in the browser.
6. **ONNX Runtime runs single-threaded WASM**, so the app needs no cross-origin-isolation headers on either host.

## Review Focus

1. **Low-memory phone or very large photo makes PaddleOCR throw** → the app must fall back to Tesseract with a visible notice, not show a dead end. Pinned in Task 4, `engine-fallback` test.
2. **Text edited after the Check panel was built** → tapping a stale suggestion must not overwrite the wrong characters. Pinned in Task 7, `applySuggestion` stale-range test.
3. **Mixed tokens** such as `3.2cm,`, `L4/L5`, `T2-weighted`, `(R)`, `12/10/2026`, `x2` → must never receive a suggestion. Pinned in Task 7, `classifyToken` table test.
4. **Report text containing `<`, `>` or `&`** (for example `<5 mm`) → rich copy must escape it, not drop it or inject markup. Pinned in Task 9, `reportToHtml` escape test.
5. **Browser storage throws or holds corrupt learned words** (private mode, cleared site data) → scanning and suggestions keep working with an empty personal list. Pinned in Task 8, `learned-store` throwing-storage test.

---

### Task 1: Behaviour-preserving reformat and test wiring

**Files:**
- Modify: `package.json`, `dist/app.js`, `dist/prepare.js`, `dist/crop-editor.js`, `dist/sw.js`, `tests/*.cjs`
- Create: `.prettierrc.json`

**Interfaces:**
- Produces: `npm test` runs `crop-editor.cjs`, `two-finger.cjs` and `prepare.cjs`; `npm run format`.

- [ ] **Step 1:** `git switch -c v5-ocr-accuracy`.
- [ ] **Step 2:** Add exact-pinned devDependencies `prettier` and `@napi-rs/canvas` (the versions `npm install -E` resolves). Add `"format": "prettier --write dist/*.js tests/*.cjs scripts/*.cjs"`. Extend `"test"` to also run `node tests/prepare.cjs`.
- [ ] **Step 3:** `.prettierrc.json`: `{ "printWidth": 100, "singleQuote": true }`.
- [ ] **Step 4:** Run `npm test` **before** formatting. Expected: three "passed" lines.
- [ ] **Step 5:** Run `npm run format`, then `npm test`. Expected: the same three lines. `git diff --stat` shows only the formatted files.
- [ ] **Step 6:** Browser check: serve `dist`, tap **Sample** → **Transcribe**, and confirm the extracted text equals the pre-format run (record it before Step 5).
- [ ] **Step 7:** Commit `Reformat scanner sources, no behaviour change`.

### Task 2: Engine interface with Tesseract adapter

**Files:**
- Create: `dist/engine.js`, `tests/engine.cjs`
- Modify: `dist/app.js` (extract handler, uncertain-word list), `dist/index.html` (script tag before `app.js`), `package.json` (test script)

**Interfaces:**
- Produces (on `window` and `module.exports`):
  - `Word = { text: string, confidence: number /* 0..1 */, box: { x0, y0, x1, y1 } }`
  - `Line = { words: Word[], confidence: number /* 0..1 */ }`; `Paragraph = { lines: Line[] }`
  - `RecognitionResult = { paragraphs: Paragraph[], engine: string, version: string }`
  - `composeText(result: RecognitionResult) → { text: string, spans: Array<{ start, end, text, confidence }> }`: words joined by `' '`, lines by `'\n'`, paragraphs by `'\n\n'`; one span per word with offsets into `text`.
  - `groupLinesIntoParagraphs(lines: Array<Line & { box }>) → Paragraph[]`: a new paragraph starts when the vertical gap to the previous line exceeds `1.5 ×` the median line height.
  - `createTesseractEngine({ Tesseract, paths, onProgress }) → { name: 'tesseract', version: '6.0.1', recognise(canvas, { mode }) → Promise<RecognitionResult>, terminate() → Promise<void> }`: moves today's `createWorker` / `setParameters` / `recognize` calls verbatim, maps blocks→paragraphs→lines→words, and divides confidence by 100.

- [ ] **Step 1: Write failing tests** in `tests/engine.cjs`:
  - `composeText` on 2 paragraphs (`[['No','acute'],['haemorrhage.']]`, `[['IMPRESSION:']]`) gives `text === 'No acute\nhaemorrhage.\n\nIMPRESSION:'`, and `spans[2]` is `{ start: 9, end: 21, text: 'haemorrhage.' }` plus its confidence.
  - `groupLinesIntoParagraphs` with line boxes at y0 = 0, 30, 60, 150 (height 25) returns paragraphs of sizes `[3, 1]`.
  - The Tesseract mapper, fed a recorded Tesseract `data` fixture (`tests/fixtures/tesseract-data.json`, generated from the Sample image), yields confidence values in `0..1`.
- [ ] **Step 2:** `node tests/engine.cjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `dist/engine.js`. In `app.js`, replace the inline worker code with `engine.recognise()` + `composeText()`. The uncertain-word list uses `span.confidence < 0.70` to keep today's behaviour.
- [ ] **Step 4:** `npm test` → PASS. Browser: Sample → Transcribe gives text identical to Task 1 Step 6.
- [ ] **Step 5:** Commit `Move Tesseract behind engine interface`.

### Task 3: Fictional test set, metrics and Tesseract baseline

**Files:**
- Create:
  - `tests/fixtures/reports/text/r01.txt` … `r20.txt`
  - `scripts/accuracy/metrics.cjs`, `scripts/accuracy/render-fixtures.cjs`, `scripts/accuracy/run.cjs`
  - `tests/metrics.cjs`, `tests/accuracy-report.md`
- Modify: `package.json` (`"fixtures"`, `"accuracy"` scripts; `@techstark/opencv-js` exact-pinned devDependency)

**Interfaces:**
- Produces:
  - `normaliseForScoring(s) → string`: collapse all whitespace to single spaces, trim; case and punctuation kept.
  - `cer(ref, hyp) → number`: character Levenshtein ÷ ref length.
  - `wer(ref, hyp) → number`: the same over space-split tokens.
  - `numberAccuracy(ref, hyp) → number`: share of ref tokens containing a digit that appear in hyp (multiset match); `1` when ref has none.
  - `run.cjs` CLI: `node scripts/accuracy/run.cjs --engine tesseract|paddle|all --variant raw|clean|straight|suggest|all`. It writes a markdown table (engine × variant × condition → mean CER, WER, number accuracy, seconds/page) to `tests/accuracy-report.md`, with date and engine versions in a header line.

- [ ] **Step 1: Write failing tests** in `tests/metrics.cjs`:
  - `cer('abc', 'abd') === 1/3`
  - `wer('a b c', 'a x c') === 1/3`
  - `numberAccuracy('3.2 cm and 4 mm', '3.2 cm and 1 mm') === 0.5`
  - `numberAccuracy('no numbers', 'x') === 1`
  - `normaliseForScoring(' a\n\n b ') === 'a b'`
- [ ] **Step 2:** `node tests/metrics.cjs` → FAIL.
- [ ] **Step 3:** Implement `metrics.cjs`.
- [ ] **Step 4:** `node tests/metrics.cjs` → PASS; add it to `npm test`.
- [ ] **Step 5:** Author 20 fictional reports, 120–350 words each:
  - 8 CT/MRI, 5 X-ray, 4 ultrasound, 2 echo, 1 clinic letter
  - include headings (`FINDINGS:` / `IMPRESSION:`), measurements, laterality and dates
  - first line `FICTIONAL TEST REPORT`
  - no real names, MRNs or ICs
- [ ] **Step 6:** Implement `render-fixtures.cjs`. It renders each text in Arial 28 px on a 2480×3508 white page and writes `tests/fixtures/reports/img/rNN-{good,average,poor}.{png,jpg}`:
  - **good:** as rendered (PNG)
  - **average:** perspective warp (corners moved 4–7% of width) onto a grey background, linear shadow 0→25% darkening, JPEG quality 80
  - **poor:** average + downscale to 900 px wide + Gaussian blur σ = 1.2 + shadow 0→40%, JPEG quality 70

  Use a fixed seed so images are reproducible. Commit the images (fictional).
- [ ] **Step 7:** Implement `run.cjs` using `engine.js` + `prepare.js` with `@napi-rs/canvas`, and score `tests/fixtures/reports/phone/*` when present (filename `rNN-anything.jpg` maps to `rNN.txt`).
- [ ] **Step 8:** `npm run accuracy -- --engine tesseract --variant raw` → the report table exists with 3 condition rows. Commit `Add fictional test set and Tesseract baseline`.

### Task 4: PaddleOCR engine (spike, adapter, fallback)

**Files:**
- Create: `docs/engine-choice.md`, `dist/engine-paddle.js`, `tests/engine-fallback.cjs`
- Modify: `scripts/vendor-ocr.cjs`, `package.json`, `dist/engine.js`, `dist/app.js`, `dist/index.html` (Settings: "Engine: PaddleOCR (default) / Tesseract (compare)")

**Interfaces:**
- Consumes: `RecognitionResult`, `groupLinesIntoParagraphs` (Task 2); `run.cjs` (Task 3).
- Produces:
  - `createPaddleEngine({ ort, modelUrls, onProgress }) → { name: 'paddleocr', version, recognise, terminate }`. Word confidence = its line's score unless the chosen library exposes character probabilities (then the mean over the word's characters).
  - `createEngineWithFallback(primary, fallback, onFallback: (error) => void)`: same shape. If `primary.recognise` throws, call `onFallback` once, switch permanently for this tab, and return `fallback.recognise(...)`.

- [ ] **Step 1: Spike.** Run the Task 3 set through each candidate that loads in both Node and browser:
  - official PaddleOCR.js
  - `ppu-paddle-ocr`
  - `X3ZvaWQ/paddleocr.js`

  Use PP-OCRv5 **mobile** models with single-threaded WASM. Record CER/WER per condition, model bytes, Node seconds per page and licence in `docs/engine-choice.md`. Pick the lowest average-condition CER; break ties by smaller size. Commit `Record PaddleOCR library choice`.
- [ ] **Step 2: Write failing test** `tests/engine-fallback.cjs`: a primary whose `recognise` rejects with `new Error('OOM')` and a fallback returning a fixed result. The first call returns the fallback result and calls `onFallback` once; a second call skips the primary (call count stays 1).
- [ ] **Step 3:** `node tests/engine-fallback.cjs` → FAIL.
- [ ] **Step 4:** Implement `createEngineWithFallback` in `engine.js` and `createPaddleEngine` in `engine-paddle.js`. Vendor the library, ORT wasm and models through `vendor-ocr.cjs` into `dist/vendor/paddle/`, with their LICENSE files. In `app.js`, the default engine is Paddle-with-Tesseract-fallback. The notice reads: "PaddleOCR could not run on this device, so Tesseract was used." The engine setting persists via try/catch `localStorage`.
- [ ] **Step 5:** `npm test` → PASS. `npm run accuracy -- --engine all --variant raw` → the report includes both engines. Browser: Sample → Transcribe with each engine works.
- [ ] **Step 6:** Commit `Add PaddleOCR engine with Tesseract fallback`.

### Task 5: Shadow removal and quality warnings

**Files:**
- Modify: `dist/prepare.js`, `tests/prepare.cjs`, `dist/app.js` (`showCanvas` / pre-extract warning), `scripts/accuracy/run.cjs` (`clean` variant)

**Interfaces:**
- Produces:
  - `normaliseBackground(canvas, make) → canvas`: background = the image drawn to 1/16 scale and back with smoothing. Each pixel becomes `min(255, gray × 255 ÷ background)`.
  - `sharpnessScore(canvas) → number`: variance of the 3×3 Laplacian on grayscale, computed on a ≤ 1000 px-wide downscale.
  - `qualityWarnings({ width, height, sharpness }) → string[]`:
    - short side < 1500 → `'Small image: retake closer or at full resolution.'`
    - sharpness < `SHARPNESS_MIN` → `'Photo looks blurred: hold steady and retake.'`
  - `preparePhoto` option `background` (default `true` when `mode === 'photo'`), applied before the contrast step.

- [ ] **Step 1: Write failing tests**:
  - A 400×400 canvas with a left→right gradient (255→120) and black 20 px text bars: after `normaliseBackground`, background pixels at x = 10 and x = 390 differ by ≤ 10, and bar pixels stay ≤ 60.
  - `sharpnessScore` of the rendered good fixture `r01` is greater than that of the same image blurred σ = 2.
  - `qualityWarnings({ width: 900, height: 1200, sharpness: 1e9 })` has length 1.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Set `SHARPNESS_MIN` to the midpoint between the median good-fixture and median poor-fixture scores, and record the value in a comment.
- [ ] **Step 4:** `npm test` → PASS. Run `npm run accuracy -- --variant clean` and keep background normalisation only if average-condition CER does not rise; note the result in the commit message.
- [ ] **Step 5:** Commit `Add shadow removal and photo quality warnings`.

### Task 6: Page detection and straightening

**Files:**
- Create: `dist/page.js`, `dist/corner-editor.js`, `tests/page.cjs`
- Modify: `scripts/vendor-ocr.cjs` (opencv.js), `dist/index.html` (corner overlay, "Straighten page" / "Skip" buttons), `dist/style.css`, `dist/app.js`, `scripts/accuracy/run.cjs` (`straight` variant)

**Interfaces:**
- Produces:
  - `orderCorners(points: {x,y}[4]) → [tl, tr, br, bl]` (by x+y and y−x).
  - `findPageCorners(cv, canvas) → {x,y}[4] | null`:
    - downscale to ≤ 1000 px, gray, blur 5×5, Canny 50/150, dilate
    - take the largest contour and `approxPolyDP` at 2% of its perimeter
    - return `null` unless it is a 4-point convex quad covering ≥ 25% of the image
    - corners are returned in source pixels
  - `straighten(cv, canvas, corners) → canvas`: output width = max(top, bottom edge), height = max(left, right edge); `warpPerspective`.
  - `moveCorner(corners, index, point, width, height) → corners`: clamps to the image.
  - `CornerEditor` (DOM): four draggable handles over the preview, emitting `onChange(corners)`.
- Flow: after `loadFile`, if OpenCV is loaded, run `findPageCorners`.
  - **Found:** show handles; **Straighten page** replaces `canvas` with `straighten(...)` and resets the crop.
  - **Not found or OpenCV failed:** keep the photo unchanged, with status "Page edges not found; using the full photo."

- [ ] **Step 1: Write failing tests** with OpenCV in Node:
  - `orderCorners` on shuffled `[{x:90,y:10},{x:10,y:10},{x:10,y:90},{x:90,y:90}]` gives TL `{10,10}`, TR `{90,10}`, BR `{90,90}`, BL `{10,90}`.
  - On `r01-average.jpg`, `findPageCorners` returns 4 corners, each within 2% of the image width of the known warp corners (export them from `render-fixtures.cjs` into `tests/fixtures/reports/img/corners.json`).
  - A plain grey 800×600 canvas returns `null`.
  - `moveCorner` clamps `{x:-5,y:700}` to `{x:0,y:600}` on an 800×600 image.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Load OpenCV lazily after first paint so start-up stays fast.
- [ ] **Step 4:** `npm test` → PASS. Run `npm run accuracy -- --variant straight`. Browser: the Sample image (no page edges) shows the "not found" status; a photo of the screen with `r01` shows handles.
- [ ] **Step 5:** Commit `Add page detection and perspective straightening`.

### Task 7: Dictionaries, SymSpell and the check list

**Files:**
- Create:
  - `dist/symspell.js`, `dist/suggest.js`
  - `dist/dict/medical-imaging.txt`, `dist/dict/en-30k.txt`, `dist/dict/SOURCE.md`
  - `scripts/make-english-dict.cjs`, `tests/suggest.cjs`

**Interfaces:**
- Produces:
  - `createSymSpell(maxDistance = 2) → { add(term, count), lookup(word, max = 3) → Array<{ term, distance, count }> }`: symmetric delete with Damerau–OSA distance; results sorted by distance, then count descending.
  - `classifyToken(token) → 'number' | 'unit' | 'date' | 'laterality' | 'word' | 'other'`:
    - any digit → `'number'`
    - unit list `cm mm m mL ml L kg g mg mcg % HU bpm mmHg cc` → `'unit'`
    - month names, or forms like `12/10/2026` / `2026-10-12` → `'date'`
    - `left right bilateral lt rt L R` (case-insensitive, punctuation stripped) → `'laterality'`
    - alphabetic with optional internal `-` or `'` → `'word'`
    - anything else → `'other'`
  - `createSuggester({ english: string, medical: string, learned }) → { isKnown(word), suggest(word) → string[] }`:
    - priority: learned (from `learned.lookup`), then medical, then English
    - at most 3 suggestions, deduplicated, case transferred from the input (ALL CAPS / Title / lower)
  - `buildCheckList(text, { spans?, threshold = 0.80, suggester }) → CheckItem[]`
    - `CheckItem = { start, end, text, kind: 'suggest' | 'verify', suggestions: string[] }`
    - tokens are split on whitespace, with leading/trailing punctuation trimmed from the range
    - `number` / `unit` / `date` / `laterality` → `verify`, no suggestions
    - `word` that is unknown, or whose span confidence < threshold → `suggest` if suggestions exist, else `verify`
    - known and confident → no item
    - confidence comes from `spans` only when `spans` is given
  - `applySuggestion(text, item, replacement) → string | null`: returns `null` when `text.slice(item.start, item.end) !== item.text`.
  - `detectWordCorrection(before, after) → { from, to } | null`: non-null only when the token lists have equal length, exactly one token differs, and both versions classify as `'word'`.
- Dictionary files are one `term count` per line.
  - `medical-imaging.txt`: at least 1,500 self-authored terms (anatomy, imaging findings, modality words, common report phrases split into words), each with count `1000000` so they outrank English homographs.
  - `en-30k.txt`: the top 30,000 lines of SymSpell's `frequency_dictionary_en_82_765.txt` (MIT), produced by `make-english-dict.cjs` from a commit-pinned raw URL.
  - `SOURCE.md` records the commit hash, licence text and how the medical list was authored.

- [ ] **Step 1: Write failing tests** in `tests/suggest.cjs`:
  - **classifyToken table:**
    - `3.2cm,`, `L4/L5`, `T2-weighted`, `x2` → `number`
    - `(R)`, `Left`, `bilateral` → `laterality`
    - `12/10/2026`, `October` → `date`
    - `mm`, `HU` → `unit`
    - `effusion` → `word`
  - **symspell:** with `effusion 1000000` and `infusion 50000` added, `lookup('efusion')[0].term === 'effusion'`, and `lookup('xyzzyq')` is empty.
  - **suggester:** `suggest('HAEMORRHAGF')` returns `'HAEMORRHAGE'` first (case transfer); learned `{efusion → effusion}` ranks first even if the medical list lacked `effusion`.
  - **check list:** `buildCheckList('Small efusion 3.2 cm on left.', { suggester })` yields:
    - `efusion` → suggest `['effusion', …]`
    - `3.2` → verify
    - `cm` → verify
    - `left` → verify (range excludes the `.`)
    - `Small` and `on` → no items
  - **stale range:** `applySuggestion` on text where the item's range now reads `effusion` returns `null`.
  - **corrections:** `detectWordCorrection('a efusion b', 'a effusion b')` → `{ from: 'efusion', to: 'effusion' }`; `('a 3 b', 'a 8 b')` → `null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the modules, dictionary script and lists.
- [ ] **Step 4:** `npm test` → PASS. `npm run accuracy -- --variant suggest` (applies the top-1 suggestion to every `suggest` item) → table updated. Commit `Add SymSpell suggestions and check list`.

### Task 8: Learned words and the Check panel

**Files:**
- Create: `dist/learned.js`, `tests/learned-store.cjs`
- Modify: `dist/index.html` (Check panel replaces `#uncertain`; Settings: "Learned words: N · Clear"), `dist/style.css`, `dist/app.js`

**Interfaces:**
- Consumes: `buildCheckList`, `applySuggestion`, `detectWordCorrection`, `createSuggester` (Task 7); `composeText` spans (Task 2).
- Produces: `createLearnedStore(storage, key = 'pocket-ocr-learned-v1', limit = 2000) → { record(from, to), lookup(from) → string[], size() → number, clear() }`
  - The data is `{ [from]: { [to]: count } }`, keyed by lowercased `from`.
  - Over `limit` total pairs, drop the lowest-count pairs.
  - Every storage read/write is in try/catch. Corrupt JSON → start empty and call the optional `onReset()` once.
- UI behaviour:
  - After extraction, render the check list. Each item shows the word, its kind ("Check number" / "Check side" / "Unclear word") and up to 3 chips plus **Keep**.
  - Tapping the word calls `textarea.setSelectionRange(start, end)` and focuses the textarea.
  - Tapping a chip calls `applySuggestion`. On `null`, rebuild the list and show "Text changed; list refreshed". On success, `learned.record(from, to)`, rebuild without `spans`, and uncheck review.
  - `textarea` input: run `detectWordCorrection(previous, current)` and record any result, then rebuild the list without `spans` (debounced 300 ms).
  - Next to the review tick: "N items to check" (0 hides the text). The tick stays required regardless of N.

- [ ] **Step 1: Write failing tests** in `tests/learned-store.cjs`:
  - Record `efusion→effusion` twice and `efusion→infusion` once → `lookup('Efusion')` gives `['effusion', 'infusion']`.
  - A storage whose `getItem` / `setItem` throw: `record` doesn't throw, `lookup` gives `[]`, `size()` is `0`.
  - Storage holding `'{bad'` → `size()` is `0` and `onReset` was called once.
  - With limit 2, a third pair evicts the lowest-count pair.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the store and wire up the panel.
- [ ] **Step 4:** `npm test` → PASS. Browser:
  1. Edit the Sample text so `haemorrhage` reads `haemorhage`; the Check panel offers `haemorrhage`.
  2. Tap it; the text is fixed and the review tick is cleared.
  3. Type `haemorhage` again; the learned suggestion ranks first.
  4. **Clear** sets the count to 0.
- [ ] **Step 5:** Commit `Add Check panel with learned corrections`.

### Task 9: Rich copy and Share

**Files:**
- Create: `dist/output.js`, `tests/output.cjs`
- Modify: `dist/index.html` (Share button), `dist/app.js` (`copy` handler, `count()` gate includes `share`)

**Interfaces:**
- Produces:
  - `reportToHtml(text) → string`:
    - HTML-escape `& < > " '`
    - split paragraphs on blank lines → `<p>`, with single newlines → `<br>`
    - a line matching `/^([A-Z][A-Z0-9 \/&()-]{1,40}:)(.*)$/` gets its label wrapped in `<strong>`
  - `copyReport(text, clipboard, ClipboardItemCtor) → Promise<'rich' | 'plain'>`: writes both types via `clipboard.write`. If that or the constructor is missing or throws, use `writeText` and return `'plain'`. Rethrows only when `writeText` fails too, so the existing "select text" fallback in `app.js` still runs.
  - `shareReport(text, nav) → Promise<'shared' | 'cancelled' | 'unavailable'>`: `nav.share({ title: 'Scanned report text', text })`; `AbortError` → `'cancelled'`; no `nav.share` → `'unavailable'`. The Share button is hidden when `navigator.share` is absent.

- [ ] **Step 1: Write failing tests** in `tests/output.cjs`:
  - `reportToHtml('FINDINGS: Lesion <5 mm & stable.\n\nIMPRESSION:')` returns exactly `'<p><strong>FINDINGS:</strong> Lesion &lt;5 mm &amp; stable.</p><p><strong>IMPRESSION:</strong></p>'`.
  - `copyReport` with a fake clipboard lacking `write` returns `'plain'` and `writeText` received the raw text.
  - `shareReport` with `share` rejecting `{ name: 'AbortError' }` → `'cancelled'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire up.
- [ ] **Step 4:** `npm test` → PASS. Browser (Chrome desktop): copy, then paste into Word shows bold headings and paragraphs; paste into Notepad shows plain text.
- [ ] **Step 5:** Commit `Add rich copy and Share`.

### Task 10: Offline cache, rules, docs and final report

**Files:**
- Modify: `dist/sw.js`, `dist/app.js`, `AGENTS.md`, `README.md`, `HANDOVER.md`, `package.json` (`"version": "5.0.0"`), `tests/accuracy-report.md`
- Create: `tests/offline-cache.cjs`, `docs/phone-test-checklist.md`

**Interfaces:**
- Consumes: every new `dist/` file and vendored asset from Tasks 2–9.

- [ ] **Step 1: Write failing test** `tests/offline-cache.cjs`:
  - the `CACHE` constant in `sw.js` equals `'pocket-ocr-v5'`, and every cache name string in `app.js` equals it
  - every `<script src>` in `index.html` and every `dist/dict/*` and `dist/vendor/paddle/*` file appears in the `sw.js` assets list
- [ ] **Step 2:** Run → FAIL. **Step 3:** Update `sw.js` (name + assets) and `app.js` (read the cache name from one `const OFFLINE_CACHE`).
- [ ] **Step 4:** Update the AGENTS.md rule to the spec's exact wording: "Never insert or silently change medical wording; dictionary suggestions for uncertain words need an explicit tap, and numbers, units, dates and laterality are never suggested." Add a README "v5" section (engine, straightening, suggestions, learned words, rich copy/share, offline size) and a HANDOVER v5 paragraph.
- [ ] **Step 5:** Run `npm test` → all PASS, then `npm run accuracy -- --engine all --variant all`, and commit the final report.
- [ ] **Step 6:** Write `docs/phone-test-checklist.md` for the owner:
  - install on an Android phone
  - offline in airplane mode
  - camera photo of printed `r01`–`r05`
  - straighten handles by touch
  - Check panel chips
  - Share to Word/WhatsApp
  - memory on an older phone (expect the Tesseract fallback notice)
- [ ] **Step 7:** Commit `v5: offline cache, rules and docs`. Stop. No push or deploy until the owner reviews the accuracy report and phone checklist.
