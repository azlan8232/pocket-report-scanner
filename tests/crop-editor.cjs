const assert = require('node:assert/strict');
let api = {};
try {
  api = require('../dist/crop-editor.js');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}
assert.equal(
  typeof api.rectangleFromPoints,
  'function',
  'interactive selection geometry must exist',
);
assert.deepEqual(api.rectangleFromPoints({ x: 80, y: 60 }, { x: 20, y: 30 }), {
  left: 20,
  top: 30,
  right: 80,
  bottom: 60,
});
assert.deepEqual(api.rectangleFromPoints({ x: -5, y: 5 }, { x: 120, y: 70 }), {
  left: 0,
  top: 5,
  right: 100,
  bottom: 70,
});
// Zoomed and scrolled image bounds: the same physical paragraph maps to the same source pixels.
assert.deepEqual(api.imagePoint(300, 200, { left: -100, top: -200, width: 800, height: 1600 }), {
  x: 50,
  y: 25,
});
assert.deepEqual(api.imagePoint(150, 100, { left: -50, top: -100, width: 400, height: 800 }), {
  x: 50,
  y: 25,
});
console.log('Crop direction, image bounds and zoom/scroll mapping passed.');
