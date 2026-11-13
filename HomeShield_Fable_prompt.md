# Prompt for Fable: HomeShield hackathon plan, checklists and repo scaffold

> Copy everything below this line into Fable (high reasoning) in Claude Code, opened in your team repo. It will write the files directly into the repo.

---

You are the technical lead and project manager for a 5-person student team at **NVIDIA Hack for Impact: Sheffield**, a one-day hackathon running **today, Friday 13 November 2026, 09:00–20:00** (it is now about 10:00). Your job is to produce a **complete, executable plan for today**, **tick-box checklists** for every team member, and a **repo scaffold** with fixed interfaces, so that five people can build in parallel from minute one and join their work up without surprises.

Be decisive. Where a choice is open, pick the option that is fastest to build and least likely to break during a live demo, and say why in one line. Do not invent APIs, model names, CLI flags or package versions. Anything you are not certain of must be marked `VERIFY:` with what to check and a fallback.

## 1. The project (team's own description)

"Our team plans to build HomeShield, a multi AI agent system to help social housing providers respond to housing hazards and issues more effectively.

This idea came from looking at Sheffield's 2025 housing data, where we found a significant number of cases that involved damp and mould conditions. This showed that, although systems are already in place to report these sort of issues, there is an opportunity to make the process more efficient by improving how these cases are understood, scheduled and followed through to completion.

Residents can report all types of problems such as dampness and mould, electric faults or leaks using text, images or voice. Using a locally running multimodal AI model it will interpret the report, extract relevant information and create a case. The system would then use an AI agent to determine what actions are required, monitor legal and operational deadlines and coordinate the case until it is resolved.

HomeShield would also use AI in planning work. By using available information such as the availability of repair staff, location of the incident, skillset, existing schedule or overlaps, and case priority, the system could decide which workers are assigned to a property and when they should attend by editing their schedule. If a new emergency appeared during the day, the system could automatically replan the timetables and routes while also ensuring that the existing cases still meet their legally mandated deadlines.

We plan to use the DGX Spark to run the AI models locally so that sensitive information (such as residents' addresses) remains on-device rather than being sent out to external AI services.

For the hackathon we could demonstrate the system using Sheffield housing data where available alongside realistic repair cases. The goal is to show how agentic AI can move beyond simply identifying a problem, and instead help improve the entire operational response from the initial report to allocating appropriate repair teams to resolve the case."

## 2. How we are judged

- **Impact:** does it address a real problem?
- **Technical execution:** how well does it use agentic AI and local compute?
- **Feasibility:** could it realistically be built or deployed beyond the hackathon?

Judges come from NVIDIA, Scan, Pendo and the Sheffield startup scene. Tracks: Economic Systems, Public Services, Urban Operations (HomeShield fits Public Services and Urban Operations). **The pitch is about 5 minutes**, including the live demo. The submission format and deadline are not yet known. Include a checklist item to ask the organisers at once, and plan with the assumption that judging starts around 17:30–18:00.

## 3. The legal hook (make it the spine of the pitch)

Awaab's Law (Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025):
- **Phase 1**, in force since 27 October 2025, covers significant damp and mould hazards and all emergency hazards.
- **Emergency hazards** must be investigated and made safe within **24 hours**.
- **Significant hazards** must be investigated within **10 working days**, with safety works starting within **5 working days** of the investigation concluding.
- **Phase 2** comes into force on **30 November 2026**, 17 days after this hackathon. It extends the same timescales to a much wider range of HHSRS hazards.

Implement these as **configurable rules in a YAML file**, not hard-coded, with a `VERIFY:` note to check them against the official MHCLG guidance. Working days exclude weekends (and ideally England bank holidays).

Sheffield context for the pitch: 1,970 new disrepair cases in the year to April 2023, up from 117 in 2018, and only 6.5% completed within the council's 55-day target (Local Government Lawyer, Sept 2023). The team has its own 2025 Sheffield housing figures to use instead.

## 4. Environment facts (already confirmed; do not contradict them)

**Hardware: one NVIDIA DGX Spark per team.**
- GB10 Grace Blackwell chip with a **20-core Arm64 CPU (aarch64)**. Software built only for x86 will not run.
- **128 GB unified memory** shared by the CPU and GPU, at **273 GB/s**. Token generation is limited by memory bandwidth, so MoE models with ~3B active parameters are fast and dense large models are slow.
- Up to 1 PFLOP at FP4, so **NVFP4 weights are preferred**.
- Runs DGX OS (Ubuntu-based) with Docker and the NVIDIA container stack.
- **Access:** NVIDIA Sync app (SSH plus one-click Terminal, DGX Dashboard on port 11000, JupyterLab), or plain `ssh user@<ip>`. Use the IP if `.local` names don't resolve on venue Wi-Fi. For a laptop, forward Nano Omni safely with `ssh -L 18000:localhost:8000 ...`; keep local 8001 for FastAPI.

**Team laptops:** mostly **Windows**, using VS Code or Cursor and **GitHub Desktop**. They are not using WSL.
- All laptop instructions must give Windows/PowerShell commands (`py -m venv .venv`, `.venv\Scripts\activate`).
- The repo needs a `.gitattributes` containing `* text=auto eol=lf` so scripts don't break on the Spark.
- Only Person 1 pulls code onto the Spark (HTTPS clone, plus a personal access token if the repo is private).

**Models: verified working on NVIDIA's hosted API.**
- Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions` (OpenAI-compatible), using the `NVIDIA_API_KEY` environment variable.
- Model `nvidia/nemotron-3.5-lightning-30b-a3b` works. It is a **reasoning model**:
  - It returns its thinking in `message.reasoning_content` and the answer in `message.content`.
  - Thinking tokens count toward `max_tokens`. With `max_tokens=50`, `content` came back `null` with `finish_reason="length"`.
  - So always set `max_tokens` to 2048 or more, treat `content == null` as an error, and surface `reasoning_content` in the agent-trace UI.
  - How to disable thinking is `VERIFY:`. It may be `chat_template_kwargs: {"enable_thinking": false}` or a `/no_think` system line.
- **Nemotron 3 Nano Omni** (30B total / 3B active) takes image, audio, video and text, so it is the intake model. Its Hugging Face weights are listed as **BF16 (about 60 GB)**. `VERIFY:` its hosted model ID and whether an FP8 or NVFP4 build exists. It may need a different endpoint or message format for images and audio, so check the model's page on build.nvidia.com.
- **Parakeet ASR** is the fallback if Omni handles audio poorly.
- **NemoGuard PII** detection is optional.

**Spark status: set up and reachable, with Ollama + Open WebUI preloaded by the organisers.** The exact models aren't known yet.
- **Use the preloaded Ollama as the primary local serving path.** It saves the vLLM setup and the large downloads on venue Wi-Fi. Ollama has an OpenAI-compatible API at `http://<spark-ip>:11434/v1`.
- **First task for Person 1:**
  - Run `ollama list` to see what's loaded, then `ollama ps` and `curl http://localhost:11434/v1/models`.
  - Record the exact model names in `.env`.
  - If no Nemotron is loaded, try `ollama pull` for the Nemotron 3 entries in the Ollama library. The exact tags are `VERIFY:`, so check with `ollama search` or the library page.
  - Otherwise, use the best preloaded model with vision and tool-calling support.
- **Ollama binds to 127.0.0.1 by default.** For laptops to reach it, either restart it with `OLLAMA_HOST=0.0.0.0` (for example, a systemd override), or have each laptop open an SSH tunnel: `ssh -L 11434:localhost:11434 user@<spark-ip>`. Pick whichever the Spark's setup allows, and document both.
- **`VERIFY:` items for Ollama:**
  - Image input through the OpenAI-compatible endpoint, for vision models.
  - Audio input support. It is likely missing, so plan Parakeet on the Spark as the voice path. Do not use the browser's Web Speech API: in Chrome it sends audio to Google's servers, which breaks the privacy argument and the offline demo. If Parakeet can't be set up in time, the demo falls back to text plus a photo.
  - Tool-calling support for the chosen model.
  - How reasoning output is returned. The OpenAI-compatible endpoint may use a `reasoning` field, and the native `/api/chat` has a `think` parameter.
  - `llm_client.py` must handle `reasoning_content`, `reasoning` and in-text `<think>` blocks.
- **vLLM is an optional upgrade, not the default.** Use it only if Ollama's speed or model choice is a problem, following NVIDIA's "Serve LLMs with vLLM on One Device" playbook. The image tag is `VERIFY:` from the playbook. Run it in `tmux` with `--host 0.0.0.0` and an explicit `--gpu-memory-utilization` that leaves room for Ollama, cuOpt and the OS.
- **Run each model once and share it.** No one runs their own copy.
- **Intake reads `LLM_BASE_URL`, `LLM_API_KEY` and `INTAKE_MODEL`; the Python agent reads `AGENT_BASE_URL`, `AGENT_API_KEY` and `AGENT_MODEL`.** NemoClaw remains independently configured. Switching services must be a config change only. Provide ready-made `.env` profiles.

**Optimisation:**
- **NVIDIA cuOpt** (open source, Python API and REST server) for vehicle routing. Relevant features: time windows, heterogeneous fleet, order↔vehicle matching (worker skills), vehicle breaks, start and end locations, prize collection (priority), initial solution (warm start for re-planning), and precise time limits.
- `VERIFY:` that cuOpt installs on aarch64 first thing.
- Hide the solver behind a `Scheduler` interface with an **OR-Tools fallback** that has identical inputs and outputs, so the demo never depends on one install.
- Travel-time matrix: OSMnx on Sheffield's road network. If that fails or is slow, use haversine distance × 1.3 at an average 25 km/h.

**Do not use:** Isaac Sim, Omniverse, Sionna, Cosmos, ComfyUI, fine-tuning, or NeMo Agent Toolkit (deprecated October 2026). NemoClaw/OpenShell **is in scope** (owned by Person 1, with a 45-minute checkpoint), because it shows NVIDIA's agent stack running locally and backs up the privacy argument with sandbox network rules.

**Rules:** no project code was written before today. Everything in the repo is created today.

## 5. Architecture to implement

1. **Intake agent:** takes text, an image and/or a voice note and calls the vision model. That's Nano Omni if it's available on Ollama or the hosted API, otherwise the best preloaded vision model. Voice goes to speech-to-text first if the model can't take audio. It returns a validated `Case` (Pydantic, structured JSON output) with: hazard_type, hhsrs_category, severity, is_emergency, room, vulnerable_occupants, a short summary and evidence references. It removes personal data before logging.
2. **Case and compliance agent:** the team wants **NemoClaw (OpenClaw inside an OpenShell sandbox)** as the agent runtime. Design it so NemoClaw is the preferred path, with a **plain-Python tool-calling loop** (OpenAI SDK, against Lightning or the best preloaded tool-calling model) as a drop-in fallback using the same tools.
   - NemoClaw calls the HomeShield tools through the backend's HTTP endpoints. The OpenShell policy must allow the backend's host and port. `VERIFY:` how to add a custom allow rule; the NemoClaw guide uses `policy-list` and `policy-add`.
   - `VERIFY:` whether NemoClaw can use the existing Ollama or vLLM endpoint instead of its managed vLLM. Express setup defaults to loading its own model (`Qwen3.6-35B-A3B-NVFP4` on the Spark), which would duplicate memory use. Prefer custom onboarding (`nemoclaw onboard`) pointed at the shared endpoint.
   - Hard rule: if NemoClaw isn't working after 45 minutes of focused setup, switch to the Python fallback. Retry NemoClaw only after the end-to-end flow works.
   - Whichever runtime is used, the agent:
     - applies the deadline rules from YAML
     - sets case status
     - calls tools: `create_case`, `compute_deadlines`, `schedule_job`, `request_approval`, `notify_resident`, `escalate`
     - logs every step (thought summary, tool call, result) as an `AgentEvent` for the trace panel and audit log
3. **Scheduler:**
   - Inputs: workers (skills, shift, start lat/lon, breaks) and jobs (location, required skill, duration, earliest/latest from deadlines, priority).
   - Output: a `Plan` per worker with ordered stops, ETAs and slack before each deadline.
   - `replan(new_emergency)` warm-starts from the current plan, using workers' current positions.
   - Target: under 2 seconds for 8 workers and 30–50 jobs.
4. **API:** a FastAPI backend with SQLite that exposes REST endpoints for the UI, plus `GET /api/stream` (Server-Sent Events) for the live digital twin. It also exposes the HomeShield tools over HTTP, so that both the NemoClaw agent and the Python fallback agent call exactly the same endpoints.
5. **Dashboard: a live 3D digital twin of Sheffield** (React + deck.gl, Vite + TypeScript; the team chose this stack). This is the centrepiece of the demo, so it gets the most visual polish.
   - **What it shows:** a dark 3D view of Sheffield in which every social-housing property is drawn. Most are quiet grey. When a resident reports an issue, that house **lights up in real time**, coloured by severity:

     | Colour | Meaning |
     | --- | --- |
     | Red, pulsing | Emergency hazard (24 h), or any case at risk of breaching its legal deadline |
     | Orange | Significant hazard (e.g. damp and mould with vulnerable occupants) |
     | Yellow | Routine or moderate issue |
     | Blue | A worker is scheduled or on the way |
     | Green, fading back to grey | Resolved |

     Put these colours in one shared config so the map, case cards and legend always match. Add a legend on screen.
   - **It must feel live:**
     - The backend pushes changes to the frontend over **Server-Sent Events** (`GET /api/stream`), with polling every 2 s as a fallback. The events are: case created, status changed, deadline risk changed, plan updated, and agent event.
     - A new issue appears with a short ripple or pulse animation and an alert in a live feed panel.
     - A **simulator** (`data/simulate_reports.py`, or a backend toggle) can drip synthetic resident reports into the system at a configurable rate, e.g. one every 20–40 s. That way the twin is visibly busy during the pitch, alongside reports submitted live through the form.
     - Workers are drawn as moving icons along their routes (`TripsLayer` with a demo clock that can run 10–60× faster). When a worker arrives, the house turns blue, then green.
     - On emergency re-planning, the old routes fade out and the new ones animate in. Show the solver time ("re-planned in 0.8 s, cuOpt") as an on-screen toast.
   - **Geometry:**
     - **Properties:** a synthetic stock of about 300–500 social-housing properties at plausible residential locations across Sheffield (not in parks or rivers; snap them to the road network or to OSM residential buildings). Of these, 30–50 have active cases. Draw each property as a small extruded 3D block (`PolygonLayer` or `ColumnLayer`) whose height grows with urgency.
     - **Optional:** real OSM building footprints for one or two neighbourhoods, extruded, if export and file size allow. `VERIFY:` the size; keep the GeoJSON under ~10 MB.
     - **Roads:** the Sheffield road network from OSMnx, exported to GeoJSON and drawn as a faint `PathLayer`.
   - **It must work offline,** because the demo pulls the network cable. Don't depend on internet map tiles: all the geometry comes from local files in `frontend/public/`. A MapLibre basemap is only an optional extra when online.
   - **Interaction:**
     - Click a house to open its case card: a photo thumbnail, the AI's summary, the hazard, a deadline countdown, the assigned worker and the activity log.
     - Camera presets: a city overview, and fly-to when a new emergency arrives.
     - A city-wide counter strip: open cases, emergencies, deadlines at risk, and the percentage on track.
   - **Other panels:** a live agent-activity feed (real backend events, including the agent's reasoning summary), an approvals queue for the housing officer, the resident report page (photo upload, audio record or upload, text) and an "inject emergency" demo button.

## 6. Team roles (the team's own split; keep it)

The team has already agreed this split. **Keep every item below and don't reassign ownership.** Expand each item into concrete sub-tasks with timeboxes and a definition of done. Add any missing tasks needed for the digital twin and integration to the most fitting owner, marked `(added)`. Use `[Name]` placeholders; the team will fill in names.

**Person 1: DGX Spark, NVIDIA models and NemoClaw** (only this person owns infrastructure and model deployment)
- Get Spark access; check the GPU, memory and Docker.
- Set up GitHub deployment access and remote connections.
- Check which models are already installed (Ollama + Open WebUI are preloaded).
- Start Nano Omni with a supported runtime (Ollama if it's available there, otherwise vLLM), and make it available to the intake developer.
- Install and configure NemoClaw with OpenShell. Prefer connecting it to the existing model server rather than loading a duplicate model.
- Confirm the NemoClaw agent responds locally.
- With Person 3, expose one real HomeShield tool to the agent, and confirm the agent can call it and receive the result.
- Keep the servers running reliably and monitor memory. Prepare a backup if local inference fails (the hosted NVIDIA API profile).
- *Done when:* the team can call the local AI API, and NemoClaw can demonstrate a genuine approved tool action.
- *Checkpoint:* if NemoClaw isn't working after 45 minutes of focused setup, switch to the working agent fallback and revisit it after integration.

**Person 2: Multimodal intake** (only this person owns report interpretation)
- Create `analyse_report()`, accepting text, a photo and an optional voice recording.
- Connect to the shared Nano Omni API, with a consistent hazard-extraction prompt.
- Return structured JSON using the agreed field names, validated with Pydantic, using null for missing details.
- Test mould, leak and electrical-fault reports. Add helpful errors for failed model requests and a reliable text-only fallback.
- Hand the function to Person 3.
- *Done when:* a resident's report becomes a valid structured case that Person 3's backend can use.
- *Not responsible for:* database storage, deadlines, scheduling or frontend code.

**Person 3: Backend, compliance and orchestration** (the application integration lead)
- Create the FastAPI project with the agreed routes, the shared Pydantic models and a simple SQLite database.
- Implement case creation, retrieval and status updates.
- Write a deterministic policy and deadline module from verified government guidance.
- Require human approval for consequential actions.
- Connect Person 2's intake function and Person 4's optimisation function.
- Integrate NemoClaw through the interface agreed with Person 1, with a Python tool-calling fallback if needed.
- Record real agent and tool events in each case's activity log.
- Add an emergency report endpoint that triggers re-planning.
- (added) Add the `GET /api/stream` SSE endpoint and the report simulator toggle for the live digital twin.
- Check the whole workflow end to end.
- *Done when:* an API request creates a case, processes it, requests scheduling and returns the results to the frontend.
- *Not responsible for:* deploying model servers, writing cuOpt algorithms or designing React components.

**Person 4: cuOpt, worker scheduling and map data** (only this person owns optimisation logic)
- Create synthetic data for 8 workers (qualifications, shifts, availability) and 30 jobs, at Sheffield coordinates.
- (added) Generate the synthetic property stock (about 300–500 properties) and export the Sheffield roads (plus optional building footprints) as GeoJSON for the digital twin.
- Prepare a travel-time matrix from road data, or a clearly labelled synthetic fallback.
- Install and test cuOpt on the Spark, and implement `optimise_schedule()` respecting qualifications, working hours, appointment windows and service durations.
- Return worker assignments and ordered stops, and report unassigned jobs and conflicts.
- Implement emergency re-optimisation, test a before-and-after schedule, and provide a simple OR-Tools fallback.
- *Done when:* adding an urgent job produces a revised, validated schedule, with a measured solver time.
- *Not responsible for:* drawing the map, building APIs or calculating legal deadlines.

**Person 5: Frontend, dashboard and demo** (only this person owns the user interface and pitch materials)
- Create the React/TypeScript frontend with a simple resident report form (photo upload, optional audio recording).
- Build the housing officer dashboard showing cases, statuses, priority indicators and deadlines.
- (expanded) Build the **live 3D Sheffield digital twin** (section 5): properties coloured by severity, live updates over SSE, worker icons moving along routes, and click-through to case cards.
- Add an agent activity panel showing real backend events, and a demo button that submits the emergency report.
- Animate route changes when the new plan arrives.
- Connect to the backend API.
- Prepare the pitch outline and slides, rehearse the live demo, and record a backup video.
- *Done when:* a judge can submit a report, see the resulting case and schedule, and watch an emergency trigger visible re-planning on the live twin.
- *Not responsible for:* AI inference, routing calculations or backend business logic.

## 7. Timeline constraints (from about 10:00)

- **10:00–10:45:** repo scaffold pushed, everyone running mocks locally, Spark smoke tests passed.
- **By 13:00 (Checkpoint 1):** a rough end-to-end run using mocks or real models: report → Case → deadlines → schedule → map.
- **By 15:00 (Checkpoint 2):** real models on the Spark, real cuOpt (or the fallback), emergency re-plan working.
- **16:00:** feature freeze.
- **16:00–17:30:** polish, backup video, deck.
- **17:30 onwards:** rehearse the pitch three times.

## 8. Demo script to design for (about 3 minutes, within a 5-minute pitch)

0. Open on the live digital twin: Sheffield in 3D, with houses lighting up as simulated reports arrive. The counter strip shows open cases and the percentage on track.
1. A resident uploads a photo of black mould in a child's bedroom plus a voice note. Their house lights up orange on the twin.
2. A case card appears: damp and mould, significant hazard, vulnerable occupant, deadline countdowns.
3. The agent-trace panel shows the agent reasoning, calling `schedule_job` and requesting approval. A human approves.
4. The damp specialist is assigned, and the route appears on the 3D map.
5. "Inject emergency: gas smell, flat in S2." The camera flies to a house pulsing red. It is classed as 24 h, the routes are re-planned in about a second (with an on-screen toast showing the solver time), the routes animate, and all deadlines stay on track.
6. Pull the network cable or disable Wi-Fi. A new report still works. Show the DGX Dashboard with the GPU busy.

## 9. What to produce

Produce all of the following. **You are running in Claude Code inside the team's repo: write the files directly.** Show the file tree first. When you finish, summarise what you created and list every `VERIFY:` item in one place. Do not commit or push. The team will review the changes and push with GitHub Desktop. Keep code files small and focused. Stubs must run, and they must use mocks until the real component is ready (a `USE_MOCKS=true` flag).

1. **`PLAN.md`**
   - a one-paragraph goal
   - the scope, split into Must / Should / Could, with explicit cut lines (what we drop at 14:00 and 15:30 if behind)
   - an hour-by-hour timeline per role
   - integration points and who connects to whom
   - checkpoints with pass/fail criteria
   - a risk register (risk → early warning sign → fallback → owner) covering at least: cuOpt fails on Arm, Omni too slow or too big, the preloaded Ollama models lack vision or tool calling, no local speech-to-text, the map breaking offline, venue Wi-Fi slow for model downloads, reasoning tokens make replies empty or slow, Spark unreachable from laptops, demo failure on stage
2. **`CHECKLIST.md`**
   - built from the team's own split in section 6: keep every original item word for word, with added items marked `(added)`
   - the master tracker: one section per role, then shared sections (Setup, Integration, Demo prep, Pitch)
   - every item is a `- [ ]` task with an owner, a timebox and a one-line definition of done
   - a progress summary table at the top (role | items | done | % | status) for the team to update
   - checkpoint gates as their own checklist items
3. **`docs/roles/01-spark-models-nemoclaw.md`, `02-intake.md`, `03-backend-orchestration.md`, `04-cuopt-scheduling-mapdata.md`, `05-frontend-twin-demo.md`**
   - each person's own runbook: their goal, the files they own, their inputs and outputs, step-by-step tasks with exact commands (Windows commands for laptops, Linux for the Spark), how to test their part alone using mocks, and what "done" looks like at each checkpoint
4. **`docs/CONTRACTS.md`**
   - every data model and every API endpoint (method, path, request, response, an example JSON), including the SSE event types for the digital twin and the shared severity → colour mapping
   - the agent tool definitions in OpenAI function-calling format
   - the event types for the trace panel
5. **`backend/schemas.py`:** Pydantic v2 models for `Case`, `Evidence`, `Deadlines`, `Worker`, `Job`, `Stop`, `Plan`, `AgentEvent`, `ReportIn`, plus the enums (HazardType, Severity, CaseStatus, Skill).
6. **Backend skeleton:**
   - `backend/` with the FastAPI app and routes
   - `intake/` (agent + mock), `agent/` (orchestrator loop, tools, rules engine + `rules/awaabs_law.yaml`), `scheduler/` (interface, cuOpt implementation, OR-Tools implementation, mock), `store/`, `config.py` (reads `.env`), `llm_client.py` (an OpenAI-SDK wrapper that handles `reasoning_content`, timeouts and retries)
   - working-day maths with unit tests
7. **`frontend/` skeleton:** Vite + React + TypeScript + deck.gl.
   - Views: the **live digital twin** (section 5) as the home screen, with case cards, a live feed, the agent trace, a counter strip and the inject-emergency button, the resident report page (photo upload, audio record/upload, text) and an approvals queue.
   - It runs against the mock API from the start, using a `VITE_API_URL` setting.
   - Include `npm` commands that work on Windows.
   - Sheffield's roads are drawn from local GeoJSON in `frontend/public/`, so the map works offline.
8. **`data/`:**
   - `export_roads_geojson.py`, which exports the Sheffield road network from OSMnx to GeoJSON for the offline map, simplified to keep the file small
   - `generate_properties.py`: 300–500 synthetic social-housing properties at plausible residential Sheffield locations
   - `simulate_reports.py`: drips synthetic resident reports into the backend at a configurable rate
   - `generate_synthetic.py`, producing 8 workers and 40 cases with real Sheffield postcode coordinates (include a small embedded list of real Sheffield postcode districts with approximate centroids, marked `VERIFY:`)
   - `build_travel_matrix.py` (OSMnx, with the haversine fallback)
   - small sample JSON outputs so the UI works immediately
9. **`scripts/spark/`:**
   - `smoke_test.sh` (`nvidia-smi`, `uname -m`, `free -h`, `df -h`, a Docker GPU check)
   - `ollama_inventory.sh`: `ollama list`, `ollama ps`, a `/v1/models` check, and a test of image input and tool calling for each candidate model
   - `expose_ollama.md`: how to set `OLLAMA_HOST=0.0.0.0` via a systemd override, plus the SSH-tunnel alternative
   - optional `start_vllm.sh` (tmux, `--host 0.0.0.0`, a memory split, the image tag marked `VERIFY:` from the playbook)
   - `check_endpoints.py`, which tests whichever `.env` profile is active
   - `warmup.py`
   - an `ssh_tunnel` example for Windows PowerShell
10. **Repo hygiene:** `README.md` (a 5-minute quickstart for Windows laptops and for the Spark), `.env.example` (no secrets), `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), `requirements.txt` (note any aarch64 caveats).
11. **`docs/PITCH.md`:**
    - a 5-minute structure (problem → Awaab's Law → live demo → architecture slide → feasibility → ask)
    - the speaker split across 5 people
    - likely judge questions with answers (privacy, scale, cost, false positives, human in the loop, integration with existing housing management systems, why local and not cloud)
    - a backup plan if the live demo fails

## 10. Quality bar

- A teammate who has never used Linux or an NVIDIA product can follow their runbook unaided.
- Every component runs on its own with mocks. Integration means switching flags, not rewriting code.
- Demo reliability beats features. Show visible NVIDIA tech on screen (agent trace, GPU dashboard, cuOpt solve time) over hidden complexity.
- Keep personal data out of logs, and keep everything runnable offline once the models are on the Spark.
- End with a short "First 15 minutes" list telling each of the 5 people exactly what to do right now.
