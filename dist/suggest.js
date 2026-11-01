/* Word suggestions for uncertain OCR words, and the check list of tokens the person should
   look at. Numbers, units, dates and laterality words are never guessed: they are only
   flagged. Works in the browser and in Node; needs symspell.js (a global in the browser). */
(function (root) {
  'use strict';

  const { createSymSpell, editDistance } =
    typeof require === 'function' && typeof module !== 'undefined'
      ? require('./symspell.js')
      : root;

  const UNITS = new Set('cm mm m ml l kg g mg mcg % hu bpm mmhg cc'.split(' '));
  const LATERALITY = new Set('left right bilateral lt rt l r'.split(' '));
  const MONTHS = new Set(
    'january february march april june july august september october november december'.split(' '),
  );
  // Short or ambiguous forms count as months only when written with a capital.
  const CAPITAL_MONTHS = new Set('may jan feb apr jun jul aug sep sept oct nov dec'.split(' '));
  const LATERALITY_WORDS = ['left', 'right', 'bilateral'];
  const KEPT = /[\p{L}\p{N}%]/u;
  const MEDICAL_COUNT = 1000000;
  const MAX_SUGGESTIONS = 3;

  /* [start, end) of a token without the punctuation around it. */
  function trimmedRange(token) {
    let start = 0;
    let end = token.length;
    while (start < end && !KEPT.test(token[start])) start++;
    while (end > start && !KEPT.test(token[end - 1])) end--;
    return [start, end];
  }

  function hasFourDigitGroup(core) {
    return core.split(/[/.-]/).some((part) => part.length === 4);
  }

  /* Units joined by a slash or squared, such as mcg/mL, mg/kg or cm². */
  function isUnitCompound(lower) {
    return lower.split('/').every((part) => UNITS.has(part.replace(/[²³]+$/, '')));
  }

  /* A word within two edits of left, right or bilateral (Ieft, Rlght) may be one of them
     misread, so it is only ever flagged, never guessed. */
  function nearLaterality(word) {
    return word
      .toLowerCase()
      .split(/[-'’]/)
      .some((part) => LATERALITY_WORDS.some((w) => editDistance(part, w, 2) <= 2));
  }

  function classifyToken(token) {
    const [start, end] = trimmedRange(token.trim());
    const core = token.trim().slice(start, end);
    if (!core) return 'other';
    if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(core) && hasFourDigitGroup(core)) return 'date';
    const lower = core.toLowerCase();
    // Before units: a lone L may be left or litre, so it is checked as a side.
    if (LATERALITY.has(lower)) return 'laterality';
    if (isUnitCompound(lower)) return 'unit';
    if (/\p{N}/u.test(core)) return 'number';
    if (MONTHS.has(lower) || (CAPITAL_MONTHS.has(lower) && core !== lower)) return 'date';
    if (
      lower
        .split(/[-'’]/)
        .some((part) => LATERALITY_WORDS.includes(part) || part === 'lt' || part === 'rt')
    )
      return 'laterality';
    if (/^\p{L}+(?:[-'’]\p{L}+)*$/u.test(core)) return 'word';
    return 'other';
  }

  /* Gives the replacement the case of the word it replaces: ALL CAPS, Title or lower. */
  function transferCase(input, term) {
    if (input.length > 1 && input === input.toUpperCase() && input !== input.toLowerCase())
      return term.toUpperCase();
    if (input[0] !== input[0].toLowerCase()) return term[0].toUpperCase() + term.slice(1);
    return term;
  }

  /* One "term count" per line; entries that are not plain words are left out. */
  function loadDictionary(text, forcedCount) {
    const symspell = createSymSpell(2);
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const [term, count] = line.trim().split(/\s+/);
      if (!term || classifyToken(term) !== 'word') continue;
      symspell.add(term.toLowerCase(), forcedCount || Number(count) || 1);
    }
    return symspell;
  }

  /* How many edits are allowed grows with the word: short words are too easy to mis-guess. */
  const allowedEdits = (word) => (word.length <= 2 ? 0 : word.length <= 4 ? 1 : 2);

  /* learned.lookup(lowerCaseWord) returns the corrections the person has typed for that word,
     best first, and they always rank first. The rest are ordered by edit distance, then
     candidates that keep the first letter, then the medical list before English. */
  function createSuggester({ english, medical, learned }) {
    const general = loadDictionary(english);
    const specialist = loadDictionary(medical, MEDICAL_COUNT);
    const inDictionary = (word) => specialist.has(word) || general.has(word);

    function isKnown(word) {
      const lower = word.toLowerCase();
      if (inDictionary(lower)) return true;
      const parts = lower.split(/[-'’]/);
      return parts.length > 1 && parts.every((part) => part && inDictionary(part));
    }

    function suggest(word) {
      const lower = word.toLowerCase();
      const edits = allowedEdits(lower);
      // Misreading the first letter is rare, so a candidate that keeps it ranks higher.
      const missesFirstLetter = (term) => (term[0] === lower[0] ? 0 : 1);
      const near = (symspell, layer) => symspell.lookup(lower, 10).map((r) => ({ ...r, layer }));
      const ranked = (edits ? [...near(specialist, 0), ...near(general, 1)] : [])
        .filter((r) => r.distance <= edits)
        .sort(
          (a, b) =>
            a.distance - b.distance ||
            missesFirstLetter(a.term) - missesFirstLetter(b.term) ||
            a.layer - b.layer ||
            b.count - a.count,
        )
        .map((r) => r.term);
      const own = (learned ? learned.lookup(lower) : []).map((t) => t.toLowerCase());
      const out = [];
      for (const term of [...own, ...ranked]) {
        if (term === lower) continue;
        // The filter runs on the case-transferred result: Mav must never become May.
        const cased = transferCase(word, term);
        if (out.includes(cased) || classifyToken(cased) !== 'word') continue;
        out.push(cased);
        if (out.length === MAX_SUGGESTIONS) break;
      }
      return out;
    }

    return { isKnown, suggest };
  }

  /* The lowest confidence among spans overlapping [start, end); spans are in text order.
     `from` is where to start looking, so a whole text is scanned once. */
  function confidenceAt(spans, state, start, end) {
    while (state.from < spans.length && spans[state.from].end <= start) state.from++;
    let lowest = null;
    for (let i = state.from; i < spans.length && spans[i].start < end; i++)
      lowest = lowest === null ? spans[i].confidence : Math.min(lowest, spans[i].confidence);
    return lowest;
  }

  const NEVER_GUESSED = new Set(['number', 'unit', 'date', 'laterality']);

  function buildCheckList(text, { spans, threshold = 0.8, suggester }) {
    const items = [];
    const state = { from: 0 };
    for (const match of text.matchAll(/\S+/g)) {
      let [start, end] = trimmedRange(match[0]);
      if (start === end) continue;
      start += match.index;
      end += match.index;
      // A sign directly before a number belongs to it.
      if (/\d/.test(text[start]) && /[-+−]/.test(text[start - 1] || '') && start > match.index)
        start--;
      const token = text.slice(start, end);
      const kind = classifyToken(token);
      if (NEVER_GUESSED.has(kind)) {
        items.push({ start, end, text: token, kind: 'verify', suggestions: [] });
      } else if (kind === 'word') {
        const confidence = spans ? confidenceAt(spans, state, start, end) : null;
        if (suggester.isKnown(token) && (confidence === null || confidence >= threshold)) continue;
        const suggestions = nearLaterality(token) ? [] : suggester.suggest(token);
        items.push({
          start,
          end,
          text: token,
          kind: suggestions.length ? 'suggest' : 'verify',
          suggestions,
        });
      }
    }
    return items;
  }

  /* The new text, or null when the text has changed since the item was made. */
  function applySuggestion(text, item, replacement) {
    if (text.slice(item.start, item.end) !== item.text) return null;
    return text.slice(0, item.start) + replacement + text.slice(item.end);
  }

  const trimToken = (token) => token.slice(...trimmedRange(token));

  /* The single word the person changed between two versions of the text, or null. */
  function detectWordCorrection(before, after) {
    const a = before.split(/\s+/).filter(Boolean);
    const b = after.split(/\s+/).filter(Boolean);
    if (a.length !== b.length) return null;
    const changed = a.map((token, i) => i).filter((i) => a[i] !== b[i]);
    if (changed.length !== 1) return null;
    const from = trimToken(a[changed[0]]);
    const to = trimToken(b[changed[0]]);
    if (from.toLowerCase() === to.toLowerCase()) return null;
    if (classifyToken(from) !== 'word' || classifyToken(to) !== 'word') return null;
    return { from, to };
  }

  /* Word confidences placed on `text`, which is the engine's text as shown, or an edited
     copy of it. Edited text is matched word by word in order; words that are gone are
     skipped. Returns [{ start, end, confidence }]. */
  function spansFromResult(result, text) {
    const words = result.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words));
    const tokens = [...text.matchAll(/\S+/g)];
    const spans = [];
    let next = 0;
    for (const word of words) {
      let i = next;
      while (i < tokens.length && tokens[i][0] !== word.text) i++;
      if (i === tokens.length) continue;
      const start = tokens[i].index;
      spans.push({ start, end: start + word.text.length, confidence: word.confidence });
      next = i + 1;
    }
    return spans;
  }

  const api = {
    classifyToken,
    createSuggester,
    buildCheckList,
    applySuggestion,
    detectWordCorrection,
    spansFromResult,
  };
  Object.assign(root, api);
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
