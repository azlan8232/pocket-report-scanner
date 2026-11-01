'use strict';
/* Dedicated worker that runs OpenCV.js page detection and straightening for the page
   (createPageWorker in page.js). OpenCV.js builds its bindings with Function at start-up,
   which the page's script-src policy forbids; the page's meta CSP does not apply here. */
importScripts('page.js');

servePageWorker(self, () => {
  importScripts('vendor/opencv.js');
  const cv = self.cv;
  // Never await or resolve with cv itself: it is a thenable that never settles.
  return new Promise((resolve) => {
    if (cv.Mat) resolve({ cv });
    else cv.onRuntimeInitialized = () => resolve({ cv });
  });
});
