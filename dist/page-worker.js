'use strict';
/* Dedicated worker that runs OpenCV.js page detection and straightening for the page
   (createPageWorker in page.js). OpenCV.js builds its bindings with Function at start-up,
   which the page's script-src policy forbids; the page's meta CSP does not apply here. */
importScripts('page.js');

// Downloads opencv.js in chunks, reporting each one, so a slow but moving download is not
// mistaken for a stalled one; then runs it from a blob URL.
async function loadOpenCv(onProgress) {
  const response = await fetch('vendor/opencv.js');
  if (!response.ok) throw new Error('OpenCV download failed (' + response.status + ')');
  const chunks = [];
  const reader = response.body.getReader();
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    chunks.push(part.value);
    onProgress();
  }
  const url = URL.createObjectURL(new Blob(chunks, { type: 'text/javascript' }));
  try {
    importScripts(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const cv = self.cv;
  // Never await or resolve with cv itself: it is a thenable that never settles.
  return new Promise((resolve) => {
    if (cv.Mat) resolve({ cv });
    else cv.onRuntimeInitialized = () => resolve({ cv });
  });
}

servePageWorker(self, loadOpenCv);
