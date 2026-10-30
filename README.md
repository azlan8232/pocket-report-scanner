# Pocket Report Scanner
Standalone prototype: browser-only Tesseract.js 6.0.1 OCR, vendored core 6.0.0 and English best_int language. No report uploads, analytics, database, or persistent report storage. Camera/photo selection, rotate, real OCR, editing, review gate, copy and text export. Capture resolution retained up to 4200px / 16MP. Offline download explicitly caches scanner files only. Browser eviction, private hosted authentication and device compatibility can limit offline re-opening. No clinical interpretation; OCR requires human checking. Not clinically validated.

Serve dist over HTTPS or localhost. Camera capture is handled by the OS file picker. Android hardware and installed PWA behaviour require user-device testing. Source dependencies: https://github.com/naptha/tesseract.js (Apache-2.0), https://github.com/naptha/tesseract.js-core (Apache-2.0), English trained data from @tesseract.js-data/eng 1.0.0. Demo image is fictional and generated locally.

## Photo accuracy update (v2)
Preserve capture resolution up to 4200px / 16MP; adjustable non-destructive rectangle crop; photo contrast normalization and upscaling up to 3x / 12MP; Tesseract auto page segmentation and deskew; cropped section and original comparison modes; low-resolution warning and uncertain-word list. No clinical spelling corrections or generated missing text. Processing remains on-device. Offline cache version bumped: refresh offline download after updating.

Validation: syntax checks, real browser OCR of fictional sample, local OCR experiment on user-supplied low-resolution photo. The photo remains substantially error-prone despite improvement; no clinical accuracy guarantee. Private inputs, outputs and derived images are outside this repository and deployment. The regression test checks 15 generic phrases and is a limited smoke test, not validation of the whole report. Local experiments used installed Node Tesseract 7; browser continues to use vendored 6.0.1. Tests require the development environment's @napi-rs/canvas; no runtime dependencies added.

## Zoom and paragraph crop (v3)
Image zoom 100–500%, pinch zoom, pan mode, direct rectangle drawing, draggable corner handles, fine crop sliders and a selected-region preview. Crop coordinates stay relative to the source image when zooming or scrolling; OCR reads only those coordinates. Editor is locked during extraction. Zoom does not add detail to the source photo. Run `node tests/crop-editor.cjs` and `node tests/prepare.cjs` for geometry and pixel-crop checks. Browser-tested drawing a three-line paragraph, zooming, and transcribing the selected region. Multi-touch and phone hardware still require device testing.

## Mobile gestures (v4)
Two-finger translation pans, pinching zooms 100–500%, and both can run together in either selection or move mode. Gesture coordinates are anchored to the initial midpoint, preserving crop coordinates. After a finger lifts, the remaining finger cannot accidentally start a crop until lifted and placed again. Tests use the real pointer handlers with a minimal DOM boundary; physical Android touch testing remains outstanding.

## Run locally
Serve the `dist` directory over HTTPS or localhost, for example `python -m http.server 8080 --directory dist`, then open http://localhost:8080. Install test dependencies with `npm install` and run `npm test`. Camera and clipboard permissions depend on browser and secure-origin support.

Current hosted app: https://pocket-report-scanner.azlan8232.chatgpt.site
