# OCR accuracy report

Generated 2026-10-31 with tesseract 6.0.1, paddleocr 1.2.0 / PP-OCRv5 mobile (latin). 80 images from 20 fictional reports. Lower CER and WER are better; number accuracy is higher-is-better.

| Engine | Variant | Condition | Images | Mean CER | Worst CER | Mean WER | Number accuracy | Seconds/page |
|---|---|---|---|---|---|---|---|---|
| tesseract | raw | good | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 1.8 |
| tesseract | raw | average | 20 | 0.01% | 0.11% | 0.03% | 100.00% | 2.4 |
| tesseract | raw | fair | 20 | 1.97% | 11.06% | 6.20% | 97.66% | 3.2 |
| tesseract | raw | poor | 20 | 82.36% | 100.00% | 98.22% | 4.77% | 2.3 |
| tesseract | clean | good | 20 | 0.02% | 0.11% | 0.13% | 99.47% | 2.0 |
| tesseract | clean | average | 20 | 0.02% | 0.22% | 0.19% | 98.62% | 2.4 |
| tesseract | clean | fair | 20 | 1.04% | 4.42% | 3.91% | 96.07% | 2.8 |
| tesseract | clean | poor | 20 | 68.69% | 73.22% | 98.56% | 6.09% | 2.9 |
| paddle | raw | good | 20 | 0.04% | 0.32% | 0.26% | 100.00% | 13.5 |
| paddle | raw | average | 20 | 0.07% | 0.43% | 0.52% | 100.00% | 12.0 |
| paddle | raw | fair | 20 | 0.28% | 1.93% | 1.54% | 97.94% | 12.5 |
| paddle | raw | poor | 20 | 45.73% | 74.60% | 77.34% | 22.57% | 10.5 |
| paddle | clean | good | 20 | 0.04% | 0.32% | 0.20% | 100.00% | 13.4 |
| paddle | clean | average | 20 | 0.04% | 0.32% | 0.23% | 100.00% | 12.7 |
| paddle | clean | fair | 20 | 0.15% | 0.76% | 0.96% | 99.44% | 12.4 |
| paddle | clean | poor | 20 | 42.81% | 59.09% | 84.29% | 24.39% | 12.8 |
