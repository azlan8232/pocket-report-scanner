# OCR accuracy report

Generated 2026-11-01 with tesseract 6.0.1, paddleocr 1.2.0 / PP-OCRv5 mobile (latin). 80 images from 20 fictional reports. Lower CER and WER are better; number accuracy is higher-is-better.

| Engine | Variant | Condition | Images | Mean CER | Worst CER | Mean WER | Number accuracy | Seconds/page |
|---|---|---|---|---|---|---|---|---|
| tesseract | raw | good | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 5.8 |
| tesseract | raw | average | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 7.4 |
| tesseract | raw | fair | 20 | 1.97% | 11.06% | 6.20% | 97.66% | 10.7 |
| tesseract | raw | poor | 20 | 82.36% | 100.00% | 98.22% | 4.77% | 7.6 |
| tesseract | clean | good | 20 | 0.02% | 0.11% | 0.13% | 99.47% | 6.0 |
| tesseract | clean | average | 20 | 0.02% | 0.22% | 0.19% | 98.62% | 7.5 |
| tesseract | clean | fair | 20 | 1.04% | 4.42% | 3.91% | 96.07% | 8.7 |
| tesseract | clean | poor | 20 | 68.69% | 73.22% | 98.56% | 6.09% | 9.0 |
| tesseract | straight | good | 20 | 0.02% | 0.11% | 0.13% | 99.47% | 1.9 |
| tesseract | straight | average | 20 | 0.04% | 0.67% | 0.20% | 99.47% | 2.3 |
| tesseract | straight | fair | 20 | 1.12% | 4.92% | 5.11% | 94.51% | 2.4 |
| tesseract | straight | poor | 20 | 69.09% | 73.62% | 98.16% | 6.86% | 2.5 |
| tesseract | suggest@0.50 | good | 20 | 0.03% | 0.21% | 0.20% | 99.47% | 2.0 |
| tesseract | suggest@0.50 | average | 20 | 0.02% | 0.22% | 0.19% | 98.62% | 2.5 |
| tesseract | suggest@0.50 | fair | 20 | 1.01% | 4.65% | 3.94% | 96.07% | 2.8 |
| tesseract | suggest@0.50 | poor | 20 | 69.82% | 73.65% | 98.62% | 6.09% | 2.9 |
| tesseract | suggest@0.80 | good | 20 | 0.03% | 0.21% | 0.20% | 99.47% | 2.0 |
| tesseract | suggest@0.80 | average | 20 | 0.03% | 0.22% | 0.22% | 98.62% | 2.5 |
| tesseract | suggest@0.80 | fair | 20 | 1.42% | 5.42% | 5.84% | 96.07% | 2.8 |
| tesseract | suggest@0.80 | poor | 20 | 69.99% | 74.07% | 99.14% | 6.09% | 2.9 |
| paddle | raw | good | 20 | 0.04% | 0.32% | 0.26% | 100.00% | 30.2 |
| paddle | raw | average | 20 | 0.07% | 0.43% | 0.52% | 100.00% | 29.0 |
| paddle | raw | fair | 20 | 0.28% | 1.93% | 1.54% | 97.94% | 30.1 |
| paddle | raw | poor | 20 | 45.73% | 74.60% | 77.34% | 22.57% | 24.4 |
| paddle | clean | good | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.7 |
| paddle | clean | average | 20 | 0.04% | 0.32% | 0.23% | 100.00% | 11.1 |
| paddle | clean | fair | 20 | 0.15% | 0.76% | 0.96% | 99.44% | 11.0 |
| paddle | clean | poor | 20 | 42.81% | 59.09% | 84.29% | 24.39% | 11.5 |
| paddle | straight | good | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.9 |
| paddle | straight | average | 20 | 0.04% | 0.32% | 0.28% | 100.00% | 11.6 |
| paddle | straight | fair | 20 | 0.23% | 0.76% | 2.04% | 94.17% | 11.6 |
| paddle | straight | poor | 20 | 49.29% | 55.99% | 85.61% | 21.88% | 13.8 |
| paddle | suggest@0.50 | good | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.9 |
| paddle | suggest@0.50 | average | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.4 |
| paddle | suggest@0.50 | fair | 20 | 0.15% | 0.97% | 0.86% | 99.44% | 11.3 |
| paddle | suggest@0.50 | poor | 20 | 42.95% | 58.84% | 77.55% | 24.39% | 11.7 |
| paddle | suggest@0.80 | good | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.9 |
| paddle | suggest@0.80 | average | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 11.4 |
| paddle | suggest@0.80 | fair | 20 | 0.15% | 0.97% | 0.86% | 99.44% | 11.3 |
| paddle | suggest@0.80 | poor | 20 | 44.20% | 59.43% | 83.41% | 24.39% | 11.7 |
The straight rows come from a second run (`--variant straight`) after straightening switched to cubic interpolation. Seconds/page are not comparable between the two runs, because machine load differed.

Straightening is opt-in: the app shows the detected corners and straightens only after the person taps Straighten page. On these mildly tilted fixtures it costs PaddleOCR accuracy: per image against clean, it is worse on fair 12 times (better 3, equal 5) and on poor 13 times (better 7). Known corners score the same as detected ones. The loss comes from resampling the page during the warp, not from detection.


The suggest@ rows apply the top suggestion to every word the check list offers one for, on top of clean, so they show the cost or gain of accepting every guess blindly; in the app a person confirms each one. The number is the confidence threshold below which a known word is also offered alternatives (unknown words are always offered). Number accuracy is identical to clean because digits, units, dates and laterality words are never suggested. The dictionaries were checked against the fictional ground-truth text and gaps were filled, so the good and average rows are close to clean by construction.
