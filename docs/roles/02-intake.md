# Person 2 — Multimodal intake

## Goal and ownership

Convert text/photo/audio into a validated `Case`. Own `intake/`; do not own storage, deadlines, scheduling, or UI.

## Inputs and outputs

Input: `ReportIn` fields and the shared LLM endpoint. Output: Pydantic `Case`, with `None` for missing details and no personal data in logs.

## Steps

```powershell
py -m pytest intake
py -c "from intake.agent import analyse_report; print(analyse_report('Black mould in a child bedroom'))"
```

Implement mock-first, then configure the endpoint from `.env`. Test mould, leak, and electrical fixtures. `VERIFY:` confirm Omni hosted ID and audio format. If audio fails, return a clear text/photo fallback rather than using browser speech APIs.

## Solo test and checkpoints

`USE_MOCKS=true py -m pytest intake` is the solo test. At 13:00 Person 3 must be able to POST a report and receive a `Case`; at 15:00 either the real model or the reliable mock is frozen for the demo. Done means invalid model JSON produces an explicit error and all three hazard fixtures parse.

## Checklist

Still open: one real request to Nano Omni (waiting on Person 1), then the 15:00 freeze decision.

- [x] `analyse_report()` accepts text, photo, and audio references. _Note: photo + audio via backend uploads; audio off until Person 1 confirms format._
- [x] Mould, leak, and electrical fixtures parse. _Note: tested; demo photos in `demo-photos/`._
- [x] Model JSON is validated and missing values become null. _Note: invalid JSON -> clear `IntakeError`._
- [x] Text-only fallback works offline. _Note: `INTAKE_ADAPTER=mock`._
- [x] Person 3 can consume the returned `Case`. _Note: merged to main, backend tests pass._
