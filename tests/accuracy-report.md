# OCR accuracy report

Generated 2026-10-31 with tesseract 6.0.1, paddleocr 1.2.0 / PP-OCRv5 mobile (latin). 80 images from 20 fictional reports. Lower CER and WER are better; number accuracy is higher-is-better.

| Engine | Variant | Condition | Images | Mean CER | Worst CER | Mean WER | Number accuracy | Seconds/page |
|---|---|---|---|---|---|---|---|---|
| tesseract | raw | good | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 1.9 |
| tesseract | raw | average | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 2.6 |
| tesseract | raw | fair | 20 | 1.97% | 11.06% | 6.20% | 97.66% | 3.3 |
| tesseract | raw | poor | 20 | 82.36% | 100.00% | 98.22% | 4.77% | 2.3 |
| tesseract | clean | good | 20 | 0.01% | 0.11% | 0.07% | 100.00% | 2.1 |
| tesseract | clean | average | 20 | 0.01% | 0.11% | 0.07% | 100.00% | 2.5 |
| tesseract | clean | fair | 20 | 4.79% | 18.89% | 8.29% | 91.65% | 2.9 |
| tesseract | clean | poor | 20 | 69.23% | 74.60% | 95.80% | 10.12% | 3.0 |
| paddle | raw | good | 20 | 0.04% | 0.32% | 0.26% | 100.00% | 13.5 |
| paddle | raw | average | 20 | 0.07% | 0.43% | 0.52% | 100.00% | 12.0 |
| paddle | raw | fair | 20 | 0.28% | 1.93% | 1.54% | 97.94% | 12.4 |
| paddle | raw | poor | 20 | 45.73% | 74.60% | 77.34% | 22.57% | 10.3 |
| paddle | clean | good | 20 | 0.04% | 0.32% | 0.24% | 99.72% | 14.0 |
| paddle | clean | average | 20 | 0.04% | 0.32% | 0.25% | 100.00% | 12.9 |
| paddle | clean | fair | 20 | 0.23% | 0.65% | 1.43% | 99.72% | 12.2 |
| paddle | clean | poor | 20 | 63.02% | 77.12% | 90.87% | 12.24% | 11.1 |
