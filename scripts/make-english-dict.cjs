'use strict';
// Build time only: downloads SymSpell's English frequency list from a pinned commit and keeps
// the top 30,000 lines as dist/dict/en-30k.txt (committed). The app never fetches it.
//   node scripts/make-english-dict.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COMMIT = '91fe939e9c1259813ee817e95239629c5badf8ec';
const URL = `https://raw.githubusercontent.com/wolfgarbe/SymSpell/${COMMIT}/SymSpell/frequency_dictionary_en_82_765.txt`;
const SHA256 = 'c604e1121e398ae7c7fbf777f11e0a0f2fa66eda932cb9fba1321466cf3acd7b';
const LINES = 30000;
const OUT = path.resolve(__dirname, '../dist/dict/en-30k.txt');

async function main() {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${URL}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== SHA256) throw new Error(`Unexpected checksum ${sha}`);
  const lines = bytes
    .toString('utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, LINES);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`Wrote ${lines.length} lines to ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
