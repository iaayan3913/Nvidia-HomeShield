# Person 5 — Frontend, twin and demo

## Goal and ownership

Own the React dashboard, resident form, live offline twin, animations, and pitch. Do not duplicate backend rules or inference.

## Commands

```powershell
cd frontend
npm install
npm run dev
```

Use `VITE_API_URL` from `.env`. Render local `public/sample-properties.json` and `public/roads.geojson`; connect `GET /api/stream`, with two-second polling fallback. Keep severity colours in one module and show counters, case cards, live feed, trace, approvals, and inject-emergency.

## Checkpoints

- 10:45: shell runs against mock API.
- 13:00: report and SSE event appear on the twin.
- 15:00: emergency flies to a red property and routes change.
- 16:00: freeze and record backup video.
- Done: judge can complete the three-minute flow offline in under five minutes.

## Checklist

- [ ] React dashboard runs against `USE_MOCKS=true`.
- [ ] Resident text/photo/audio form is visible.
- [ ] Offline properties and roads render.
- [ ] Severity legend, counters, case cards, and agent trace render.
- [ ] SSE and polling fallback are wired.
- [ ] Approval and inject-emergency flows are visible.
- [ ] Route change animation and backup video are ready.
