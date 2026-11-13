# Prompt A: app shell, tabs and the resident report screen

Copy everything below the line into your coding agent.

---

You are working on HomeShield, a hackathon demo (NVIDIA Hack for Impact, Sheffield, today). It has a React + TypeScript + Vite frontend in `frontend/` (deck.gl and MapLibre map) and a FastAPI backend in `backend/`. Read `docs/ui-rework/README.md` first: it lists the shared rules, the backend API, and Step 0 (the frontend source must be committed before you start). Work on a new branch from `main`.

**You own:** the app shell (top-level layout, header navigation, routing), the Schedule tab container, the Agent activity drawer, the resident report page, `frontend/vite.config.*`, frontend env/config, and the device/network runbook. **Do not change** map layers (workstream B) or the case list, case cards and header counters (workstream C). Your layout change merges first, so keep it focused and open the PR early.

## Why

Two kinds of people use HomeShield. The **operator** watches one big screen: the live twin of Sheffield and the open cases. **Residents** report problems from their own phones, tablets or laptops. Today both are crammed into one dashboard, and the schedule and agent activity are always visible, which buries the map.

## Tasks

1. **Split into two screens with routing.**
   - `/` is the operator dashboard.
   - `/report` is the resident report, a standalone page with no operator UI, no map and no case data.
   - Remove the resident report from the operator dashboard. The operator header can keep a small "Resident link" button that shows the `/report` URL and a QR code (any small QR library pinned to an exact version, or a pre-generated image).
2. **Operator tabs.** The operator dashboard gets two tabs: **Twin** (default: map + cases) and **Schedule**.
   - Move the component that renders **"Today's schedule"** out of the always-visible layout into the Schedule tab.
   - Keep its contents. Workstream C reduces its text later.
   - The Twin tab should give the map most of the screen.
3. **Agent activity becomes a drawer.** The panel titled **"Agent activity"** is hidden by default.
   - It opens from a header icon button that shows an unread count.
   - Esc and a close button dismiss it.
   - It must not cover the case list permanently.
4. **Resident report works on any device.**
   - Mobile-first and responsive: 360 px phones up to laptops.
   - Large touch targets, one column on phones, nothing scrolls sideways.
   - Fields: a short free-text description; an optional photo (`<input type="file" accept="image/*" capture="environment">`, so phones open the camera); and an optional property picker (searchable list of `p-001`…`p-400` with the district from `properties.geojson`, defaulting to "I don't know").
   - Show a clear success state: "Report received" plus a reference number. Show a friendly error state with a retry button.
   - Keep the copy short and plain. No operator jargon.
5. **Resident submissions reach the backend.**
   - In live mode, submit to `POST /api/reports`. Use multipart (`text`, `property_id`, `photo` file) when a photo is attached, otherwise JSON `{text, property_id}`.
   - Put this in its own small module (for example `src/lib/report-api.ts`). Workstream C owns the shared read/SSE data layer.
   - In mock mode, the page fakes a success response so it can be demoed with no backend.
6. **Make it reachable from other devices without CORS problems.**
   - In `vite.config`, set `server.host: true` and add a dev-server proxy: `/api` → the backend URL from an env var, for example `HOMESHIELD_API=http://<spark-ip>:8000`, defaulting to `http://127.0.0.1:8000`.
   - Proxy SSE too, with streaming left on.
   - The frontend then calls same-origin `/api/...`, so phones only need to reach the operator laptop, and the backend's `CORS_ORIGINS` needs no changes.
   - Document live mode versus mock mode in `frontend/README.md`.
7. **Device runbook.** Add `docs/DEMO_DEVICES.md` covering:
   - **Laptop 1:** SSH into the DGX Spark; runs the backend in `~/cuopt-env` with `SCHEDULER_ADAPTER=cuopt`; GPU dashboard visible.
   - **Laptop 2:** operator dashboard on the big screen; runs `npm run dev -- --host` with `HOMESHIELD_API` pointing at the Spark.
   - **Laptops 3–5:** resident report, presenter notes, and an offline backup laptop running the whole stack with `USE_MOCKS=true`.
   - **Phones:** open `http://<laptop-2-ip>:5173/report`, or scan the QR code.
   - Also list the exact commands, how to find each IP, and what to do if venue Wi-Fi blocks device-to-device traffic: use a phone hotspot for all devices.
8. **At feature freeze only:** run `npm run build -- --outDir mock-build` (or the existing equivalent) once and commit the refreshed `frontend/mock-build/`.

## Done means

- [ ] `/` shows Twin and Schedule tabs. Neither the schedule nor the agent activity is visible by default.
- [ ] Agent activity opens and closes from the header and shows an unread count.
- [ ] `/report` works on a real phone and a laptop: text plus a camera photo submits, and success and error states show.
- [ ] A report sent from a phone in live mode appears on the operator dashboard on another device.
- [ ] Mock mode still works with no backend: `npm run dev` with no API configured.
- [ ] `npm run build` passes with no TypeScript errors. `docs/DEMO_DEVICES.md` is written and tested with at least one phone.

When you finish, report what you changed, what you tested on which devices, and anything left for B or C.
