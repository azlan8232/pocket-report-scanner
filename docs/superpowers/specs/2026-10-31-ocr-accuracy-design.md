# Pocket Report Scanner v5: OCR accuracy (stage 1, typed reports)

Date: 2026-10-31 · Status: draft for owner review

## 1. Goal

Make the scanner accurate enough on **typed imaging and other reports** (paragraph text: X-ray, CT, ultrasound, echo, clinic letters) photographed on a phone, so that a later version can be built into HDW Connect's Investigations section.

Stage 2 (handwriting, including handwritten lab results) is **out of scope** here and gets its own design once stage 1 passes.

### Success criteria

- Accuracy is measured, not judged by eye: character error rate (CER) and word error rate (WER) on a fixed fictional test set (section 6).
- The owner sets the pass mark before integration is considered. Suggested starting target: CER ≤ 2% on good photos, ≤ 5% on average photos.
- Every number, measurement, date and laterality word in the output is either correct or visibly highlighted for checking.
- The existing review gate still applies: nothing can be copied, shared or downloaded until the person ticks that they have checked the text.

## 2. Constraints (unchanged from AGENTS.md / HANDOVER.md)

- Standalone app. No HDW Connect code changes in this stage.
- All recognition stays on the device. No cloud OCR, analytics, uploads or report storage.
- No patient images, OCR output or identifiers committed; public tests use fictional fixtures only.
- Offline cache version is bumped whenever application files change.
- Licences stay permissive (Apache-2.0 / MIT / BSD). AGPL libraries such as Scribe.js are excluded.

### Deliberate rule change (owner approval required)

AGENTS.md says "never infer missing medical wording" and the v2 README says "no clinical spelling corrections". This design adds **word suggestions** (section 5). They stay within the spirit of the rule:

- A suggestion is only offered for a word the engine actually read but scored as uncertain. Words are never added for text that is missing.
- A suggestion is never applied without the person tapping it.
- Numbers, units, dates and laterality are never suggested.

When this spec is approved, the AGENTS.md line becomes: "Never insert or silently change medical wording; dictionary suggestions for uncertain words need an explicit tap, and numbers, units, dates and laterality are never suggested."

## 3. Output: getting text out

After the review tick, three exits:

1. **Copy**: writes two clipboard formats in one action (`ClipboardItem` with `text/html` and `text/plain`).
   - HTML keeps paragraphs, line breaks and section headings (lines like `FINDINGS:` / `IMPRESSION:` become bold paragraphs), so pasting into Word and PowerPoint keeps the layout.
   - Plain text is used by apps that only accept plain text, including HDW Connect's Investigation details box.
   - Falls back to `writeText` (plain only) where `ClipboardItem` is unavailable.
2. **Share**: `navigator.share({ text, title })` opens the phone's share menu (Word, PowerPoint, WhatsApp, email…). The button is hidden where Web Share is unavailable.
3. **Download .txt**: the existing export, unchanged.

The output carries no photo and adds nothing beyond the reviewed text.

## 4. Recognition pipeline

```
photo → [A] page detect + straighten → [B] clean-up → existing crop editor
      → [C] OCR engine (PaddleOCR, or Tesseract to compare)
      → [D] word suggestions + number highlighting → review → output
```

### A. Page detection and straightening

- Use [jscanify](https://github.com/puffinsoft/jscanify) (MIT) on OpenCV.js to find the four page corners and apply a perspective transform.
- Show the detected outline with draggable corners; the person can fix or skip it. If detection fails, the full photo is used unchanged.
- Runs before the existing crop editor, which keeps its current behaviour.
- OpenCV.js is large (~8–10 MB), so it is vendored and cached offline like Tesseract.

### B. Clean-up (extends `prepare.js`)

- Shadow and uneven-light removal: divide the image by a heavily blurred copy of itself (background normalisation) before the existing contrast step.
- Quality gate before recognition: warn when the selected region is under ~1500 px on its short side, or when a sharpness score (variance of the Laplacian) is low, with "retake" advice. A warning only, never a block.

### C. Engine

- Primary: **PaddleOCR PP-OCRv5 mobile** (Apache-2.0) via ONNX Runtime Web, detection + recognition models (~15–20 MB), vendored and cached offline.
- Library chosen by a **spike** that runs the test set (section 6) through these candidates and keeps the best by CER and phone speed:
  - [PaddleOCR.js (official)](https://github.com/PaddlePaddle/PaddleOCR)
  - [ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
  - [X3ZvaWQ/paddleocr.js](https://github.com/X3ZvaWQ/paddleocr.js)
- Tesseract 6.0.1 stays as a "Compare engine" option in settings and as a fallback if PaddleOCR fails to load.
- The engine sits behind one small interface so the rest of the app doesn't depend on which engine ran:

  ```
  recognise(canvas) → { lines: [{ words: [{ text, confidence, box }] }], engine, version }
  ```
- Engine work runs in a Web Worker; the existing "editor locked during extraction" behaviour stays.

### D. Word suggestions and highlighting

See section 5.

## 5. Word suggestions ("guessing unclear words")

### Which words get a suggestion

A word qualifies when **all** of these hold:

- its engine confidence is below a threshold (tuned on the test set; starting value 0.80)
- it contains no digits
- it isn't a unit, a date or a laterality word (left/right/bilateral, L/R)

### How the suggestion is found

- [SymSpell](https://github.com/wolfgarbe/symspell) (MIT) lookup at edit distance ≤ 2. JS port [node-symspell](https://github.com/MathieuLoutre/node-symspell) or a small in-repo port, chosen by testing against the reference results.
- Dictionary layers, highest priority first:
  1. **Personal corrections**: words this person has typed in as fixes (see below).
  2. **Medical/imaging list**: anatomy, radiology findings and common report phrases, curated in-repo as a plain word list with a source note. No licensed vocabularies such as RadLex or SNOMED unless the owner arranges a licence.
  3. **General English** frequency list (SymSpell's bundled English frequency dictionary, MIT).
- At most 3 candidates per word, shown as tappable chips under the text. "Keep as read" dismisses them.

### Learning from corrections

- When the person edits a word in the result box, or taps a chip, the pair (as read → corrected) is stored in the scanner's own browser storage on the device. It holds single words only, never whole reports, and no identifiers.
- Stored corrections go into the personal layer and are ranked first next time.
- Settings has "Clear my learned words" and shows how many are stored.
- This is adaptive dictionary ranking, not model retraining. Retraining needs a large labelled dataset and is out of scope.

### Highlighting (never guessed)

Any token with digits, units (`cm`, `mm`, `mL`, `%`, `HU`…), dates or laterality words, plus any uncertain word with no suggestion, is underlined in a warning colour, and a count is shown next to the review tick ("6 items to check").

The result box becomes an editable highlighted view (a `contenteditable` region or a textarea with an overlay, whichever the spike shows is more reliable on Android). Typed edits keep working as they do now.

## 6. Measuring accuracy

### Test set (fictional, committed)

- About 20 typed fictional reports (imaging, echo, clinic letters), each with an exact ground-truth `.txt` file.
- Each is printed and photographed on a phone in three conditions:
  - **good**: flat, daylight
  - **average**: angled, indoor light
  - **poor**: shadow, slight blur, low resolution
- Photos and ground truth go in `tests/fixtures/reports/`. All content is invented; no real names, MRNs or ICs.

### Measurement script

- `npm run accuracy` runs each photo through each engine and pipeline variant (raw / +straighten / +clean-up / +suggestions-accepted-top-1) in Node with the same code as the browser.
- Reports CER and WER per condition, plus **number accuracy**: the share of digit-containing tokens read exactly right, tracked separately because suggestions never touch them.
- Results are written to `tests/accuracy-report.md` (committed) so changes are compared over time.
- The existing `photo-regression.cjs` smoke test stays.

### Unit tests

- Engine adapter output shape.
- Suggestion eligibility (digits, units, dates, laterality never get suggestions).
- Personal-correction ranking.
- Clipboard HTML formatting (headings, paragraphs).
- Background normalisation on synthetic images.
- Existing crop and gesture tests unchanged.

## 7. Code clean-up first (behaviour-preserving)

`dist/app.js` is written as very long single lines. Before adding features:

1. Reformat `app.js`, `prepare.js`, `crop-editor.js` and `sw.js` to normal one-statement-per-line style with no logic changes, and confirm the existing tests still pass.
2. Move the Tesseract calls in `app.js` behind the `recognise()` interface (section 4C), still using Tesseract, and confirm OCR output is unchanged on the demo image.

Each is its own commit before any v5 feature work.

## 8. Error handling

- PaddleOCR or OpenCV fails to load (old phone, out of memory): fall back to Tesseract and no straightening, with a visible notice.
- Page detection finds no page: skip straightening and keep the full photo.
- Clipboard or Share refused: show the error and leave Download available.
- Corrupt learned-word storage: reset to empty with a notice. Never block scanning.

## 9. Delivery order

1. Clean-up commits (section 7).
2. Fictional test set and accuracy script, with a Tesseract baseline report.
3. Engine spike, then PaddleOCR adapter.
4. Page straightening and clean-up.
5. Word suggestions, highlighting and learning.
6. Copy (HTML + plain), Share and the review-tick count.
7. Offline cache bump to `pocket-ocr-v5`, README and HANDOVER update, then a phone hardware check.

Nothing is pushed to GitHub or deployed until the owner approves the design and the trial results.

## 10. Later (not in this stage)

- **Stage 2, handwriting**: [TrOCR handwritten](https://huggingface.co/Xenova/trocr-base-handwritten) via Transformers.js, reading one cropped line at a time. Optional download (hundreds of MB) marked experimental. Handwritten lab values get extra number checks.
- **HDW Connect integration**: a scan-result share into HDW Connect, where the person picks the patient and confirms before an Investigation entry is created. Designed after the trial passes.
