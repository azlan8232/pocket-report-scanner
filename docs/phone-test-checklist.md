# Phone test checklist (v5)

For the owner, on an Android phone in Chrome, with the deployed site. Use the printed fictional reports r01 to r05 from tests/fixtures. Tick each step and note anything that differs from "Expected".

1. **Install.** Open the site, tap Prepare offline use, then Chrome menu, Add to Home screen.
   Expected: the download finishes and the app opens from the home screen icon.
2. **First download over mobile data.** Do step 1 on mobile data, not Wi-Fi, and note how long it takes (about 72 MB).
   Expected: it completes; write down the time.
3. **Offline.** Switch on airplane mode, close the app, reopen it, and scan a photo.
   Expected: the app opens and extracts text with no network.
4. **Camera photo of r01 to r05.** Take a photo of each printed page with Take a photo.
   Expected: text is close to the printed page. Note any misread words, and PaddleOCR seconds per page.
   To score the photos on a computer, copy them to tests/fixtures/reports/phone/ named after their report, such as r01.jpg or r01-desk.jpg, then run `npm run accuracy -- --variant clean`; they appear as the "phone" condition in tests/accuracy-report.md.
5. **Blur warning.** Take a few sharp, well-lit photos, then one deliberately blurred photo.
   Expected: no blur warning on the sharp ones, a warning on the blurred one. (The threshold, 87, was set from test photos, so report any false alarm.)
6. **Straighten by touch.** Photograph a page on a desk so its edges are clear, then drag the corner handles with a finger and tap Straighten page.
   Expected: the handles appear on the page corners, can be dragged, and the page comes out squared up. This also shows OpenCV starting on Android Chrome.
7. **Steeply angled photo.** Photograph a page from a steep angle, then compare the text with and without Straighten page.
   Expected: note which is better; it was worse on mildly tilted photos.
8. **Check panel.** Extract a poor photo and tap suggestion chips.
   Expected: a chip changes the text only when tapped; no chip is offered for numbers, units, dates or left/right.
9. **Copy into Word and PowerPoint.** Tick the review box, tap Copy text, paste into Word, then PowerPoint.
   Expected: headings are bold and paragraphs are separate.
10. **Paste into HDW Connect.** Paste into the Investigation details box.
    Expected: plain text with the same words and line breaks.
11. **Share.** Tap Share and send to WhatsApp.
    Expected: the share sheet opens with the text.
12. **Older phone.** On a phone with little memory, extract a photo.
    Expected: either PaddleOCR works, or you see "PaddleOCR could not start or stopped responding, so Tesseract was used." and the text still appears.
    Note: both workers (OCR and page detection) can be loaded at once, for example when a new photo is checked for page edges while text is being read, so this is the step most likely to run out of memory. Note any pause after the text appears.
13. **Netlify file types.** On a computer, open the deployed site, DevTools, Network, reload, and check the Content-Type of the .mjs, .wasm and .onnx files.
    Expected: .mjs is JavaScript, .wasm is application/wasm, .onnx is a binary type (not text/html), and no request fails.
14. **Reload after a deploy.** After the next deploy, open the installed app online, reload twice, then tap Prepare offline use again.
    Expected: the new version loads (footer shows v5), and offline use still works after the refresh.
