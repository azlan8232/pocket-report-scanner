# Working conventions
Read README.md and HANDOVER.md before changes. Keep this standalone; do not integrate with HDW Connect. Preserve browser-only OCR. Never send reports to cloud OCR, add analytics, or commit patient images, OCR output or identifiers. Use fictional fixtures for public tests. Review remains required; never infer missing medical wording (see the rule below). Bump the offline cache when application files change. Verify changes before publishing and preserve the Site audience.

# Medical wording rule
Never insert or silently change medical wording; dictionary suggestions for uncertain words need an explicit tap, and numbers, units, dates and laterality are never suggested.
