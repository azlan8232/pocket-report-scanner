// Private regression inputs and OCR output stay outside the repository.
// Usage: node tests/photo-regression.cjs /absolute/path/to/ocr-output.json
const fs = require('fs'),
  assert = require('node:assert/strict');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const phrases = [
  'No hydrocephalus',
  'No midline shift',
  'No suspicious skull lesion',
  'NG tube with tip in the stomach',
  'No cavitation or consolidation',
  'No enlarged mediastinal or hilar lymph nodes',
  'No retrosternal extension',
  'Bilateral renal cysts',
  'No proximal bowel dilatation',
  'No enlarged abdominopelvic lymph node',
  'Portal and hepatic veins are patent',
  'No intrahepatic duct dilatation',
  'Urinary bladder is partially distended',
  'Diffuse subcutaneous fat streakiness',
  'No brain metastasis',
];
const hits = phrases.filter((p) => normalize(data.text).includes(normalize(p))).length;
console.log('Check phrases matched:', hits, 'of', phrases.length, '(not whole-report accuracy)');
assert(hits >= 2, 'Photo regression: should recover at least 2 checked phrases intact');
