# Dictionary sources

The app never downloads these at run time. Both files are committed and are served from the
same site as the app (and cached for offline use). Each line is `term count`.

## en-30k.txt: general English

The first 30,000 lines of `frequency_dictionary_en_82_765.txt` from
[wolfgarbe/SymSpell](https://github.com/wolfgarbe/SymSpell), pinned to commit
`91fe939e9c1259813ee817e95239629c5badf8ec`:

https://raw.githubusercontent.com/wolfgarbe/SymSpell/91fe939e9c1259813ee817e95239629c5badf8ec/SymSpell/frequency_dictionary_en_82_765.txt

(sha256 of the full download `c604e1121e398ae7c7fbf777f11e0a0f2fa66eda932cb9fba1321466cf3acd7b`.)
Rebuild it with `node scripts/make-english-dict.cjs`; the script checks the checksum.

Licence of that repository (MIT):

```
MIT License

Copyright (c) 2018 Wolf Garbe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`symspell.js` is an original in-repo implementation of the same symmetric-delete idea, not a
copy of that code.

## medical-imaging.txt: medical and imaging words

Written by hand for this project from general medical and radiology knowledge: anatomy,
imaging modalities and techniques, common findings and diagnoses, procedures, devices and
everyday report wording, including British and American spellings (haemorrhage and
hemorrhage). Multi-word phrases are split into single words. It was not copied from, or
checked against, any licensed or copyrighted vocabulary (no RadLex, SNOMED, UMLS or similar
lists) and holds no patient data.

Every term has the count `1000000` so that these words outrank English words that look alike.
The file holds only plain words. Numbers, units, dates and laterality words (left, right,
bilateral) are deliberately absent, and `dist/suggest.js` also refuses to load or suggest them.
