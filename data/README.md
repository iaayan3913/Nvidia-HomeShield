# Data handling

## Real Excel workbook

Put the 40 MB workbook on the local machine of the person analysing it:

```text
data/raw/sheffield-housing-real.xlsx
```

`data/raw/` is ignored by Git. Do not commit, push, attach, or copy the workbook to the public repository, GitHub Issues, slides, frontend, or DGX Spark unless the data owner has explicitly authorised that use.

Before analysing it, check whether it contains names, addresses, postcodes, phone numbers, emails, case references, free-text reports, or exact property locations. Treat those fields as personal or potentially identifying data. Do not put them into logs, prompts, screenshots, demo fixtures, or the live dashboard.

## What to extract

Create only a small, non-identifying summary in `data/processed/`, such as:

- total cases and date range;
- counts by hazard type;
- counts by year/month;
- emergency/significant/routine proportions;
- completion and deadline performance;
- postcode district or ward counts only where aggregation is large enough;
- the source and extraction date.

Round or suppress small groups. Do not export row-level records. The dashboard should continue using the synthetic properties and cases in `data/generated/`.

## Recommended workflow

1. Keep the original workbook in `data/raw/` and make a backup outside the repository.
2. Inspect sheet names and column names without copying cell contents into chat.
3. Agree which aggregate metrics are safe with the data owner.
4. Generate a small aggregate JSON/CSV for the pitch.
5. Add only anonymised headline numbers to `docs/PITCH.md` and `PLAN.md`.
6. Delete temporary extracted files containing row-level data.

`VERIFY:` confirm the workbook's licence, permitted use, retention rules, and whether the team may show any statistics publicly.
