/* Getting the reviewed text out: rich copy (HTML plus plain text) and the phone's share menu.
   Only the text goes out: no photo and nothing added. Works in the browser and in Node. */
(function (root) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const HEADING = /^([A-Z][A-Z0-9 /&()-]{1,40}:)(.*)$/;

  function lineToHtml(line) {
    const m = HEADING.exec(line);
    return m ? '<strong>' + escapeHtml(m[1]) + '</strong>' + escapeHtml(m[2]) : escapeHtml(line);
  }

  /* Paragraphs from blank lines, <br> for single newlines, section labels in bold. */
  function reportToHtml(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => '<p>' + p.split('\n').map(lineToHtml).join('<br>') + '</p>')
      .join('');
  }

  /* Writes HTML and plain text together; plain text only where that is not possible.
     Rethrows only when plain text fails too, so the caller can offer "select the text". */
  async function copyReport(text, clipboard, ClipboardItemCtor) {
    try {
      await clipboard.write([
        new ClipboardItemCtor({
          'text/html': new Blob([reportToHtml(text)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    } catch (_) {
      await clipboard.writeText(text);
      return 'plain';
    }
  }

  async function shareReport(text, nav) {
    if (!nav || typeof nav.share !== 'function') return 'unavailable';
    try {
      await nav.share({ title: 'Scanned report text', text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }

  const api = { reportToHtml, copyReport, shareReport };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
