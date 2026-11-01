'use strict';
const assert = require('node:assert/strict');
const { reportToHtml, copyReport, shareReport } = require('../dist/output.js');

async function main() {
  assert.equal(
    reportToHtml('FINDINGS: Lesion <5 mm & stable.\n\nIMPRESSION:'),
    '<p><strong>FINDINGS:</strong> Lesion &lt;5 mm &amp; stable.</p><p><strong>IMPRESSION:</strong></p>',
  );
  assert.equal(
    reportToHtml('He said "no" & it\'s fine'),
    '<p>He said &quot;no&quot; &amp; it&#39;s fine</p>',
  );
  assert.equal(reportToHtml('Line one\nLine two'), '<p>Line one<br>Line two</p>');
  assert.equal(
    reportToHtml('CT HEAD:\nNo bleed.'),
    '<p><strong>CT HEAD:</strong><br>No bleed.</p>',
  );
  assert.equal(
    reportToHtml('Findings: lower case is not a heading'),
    '<p>Findings: lower case is not a heading</p>',
  );
  assert.equal(reportToHtml('  \n\n'), '');

  // Rich copy writes both formats.
  {
    const written = [];
    class Item {
      constructor(parts) {
        this.parts = parts;
      }
    }
    const clipboard = {
      write: async (items) => written.push(...items),
      writeText: async () => assert.fail(),
    };
    assert.equal(await copyReport('A & B', clipboard, Item), 'rich');
    const types = Object.keys(written[0].parts);
    assert.deepEqual(types.sort(), ['text/html', 'text/plain']);
    assert.equal(await written[0].parts['text/plain'].text(), 'A & B');
    assert.equal(await written[0].parts['text/html'].text(), '<p>A &amp; B</p>');
  }

  // No write: plain text with the raw text.
  {
    const got = [];
    const clipboard = { writeText: async (t) => got.push(t) };
    assert.equal(await copyReport('raw <text>', clipboard, class {}), 'plain');
    assert.deepEqual(got, ['raw <text>']);
  }
  // No constructor, or write rejecting, also falls back.
  {
    const got = [];
    const clipboard = {
      write: async () => {
        throw new Error('denied');
      },
      writeText: async (t) => got.push(t),
    };
    assert.equal(await copyReport('x', clipboard, class {}), 'plain');
    assert.equal(
      await copyReport(
        'y',
        { write: async () => {}, writeText: async (t) => got.push(t) },
        undefined,
      ),
      'plain',
    );
    assert.deepEqual(got, ['x', 'y']);
  }
  // Both fail: rethrows.
  await assert.rejects(
    copyReport('x', { writeText: async () => Promise.reject(new Error('no')) }, undefined),
    /no/,
  );
  await assert.rejects(copyReport('x', undefined, undefined));

  // Share.
  {
    const calls = [];
    const nav = { share: async (d) => calls.push(d) };
    assert.equal(await shareReport('hello', nav), 'shared');
    assert.deepEqual(calls, [{ title: 'Scanned report text', text: 'hello' }]);
  }
  assert.equal(
    await shareReport('x', {
      share: async () => {
        throw { name: 'AbortError' };
      },
    }),
    'cancelled',
  );
  assert.equal(await shareReport('x', {}), 'unavailable');
  assert.equal(await shareReport('x', undefined), 'unavailable');
  await assert.rejects(
    shareReport('x', {
      share: async () => {
        throw new Error('NotAllowed');
      },
    }),
    /NotAllowed/,
  );

  console.log('output tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
