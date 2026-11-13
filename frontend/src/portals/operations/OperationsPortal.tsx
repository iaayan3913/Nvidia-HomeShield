import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, RotateCcw, Siren } from 'lucide-react';
import { mockService, useDemoState } from '../../shared/mock';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import type { SchedulePlan } from '../../shared/types/domain';
import {
  DEFAULT_FILTERS, EMERGENCY_CASE_ID, buildCaseMarkers, buildCaseRows, buildLookups, buildRoutes, buildSummary, buildTimeline, buildWorkerMarkers,
  comparePlans, matchesFilters, pendingProposals, planRoutes, sortRows, type CaseFilters, type RouteDatum,
} from './lib/derive';
import { boundsOf, type LonLat } from './lib/geo';
import { detectWebGL, useElementSize, useIsWide, useReducedMotion, useThemeName, useTransition } from './hooks/environment';
import { useConnection } from './hooks/connection';
import { useLocalMapData, type LocalMapData } from './hooks/useLocalMapData';
import { DEFAULT_LAYERS, type ActiveSource, type CaseScene, type DataPreference, type FocusRequest, type LayerVisibility, type MapPick, type MapScene } from './map/types';
import { FallbackMap } from './map/FallbackMap';
import { Attribution, LayersPanel } from './panels/LayersPanel';
import { StatsOverlay } from './panels/StatsOverlay';
import { CaseRail } from './panels/CaseRail';
import { Inspector, Timeline, type InspectorTarget } from './panels/Inspector';
import { ScheduleDrawer, type DecisionMessage } from './panels/ScheduleDrawer';
import { SidePanel } from './panels/SidePanel';
import { ConfirmDialog } from './panels/ConfirmDialog';
import './operations.css';

const TwinMap = lazy(() => import('./map/TwinMap'));

type Selection = { kind: 'case' | 'worker'; id: string } | null;
type Dialog = 'emergency' | 'reset' | null;
const EMPTY_LOCAL: LocalMapData = { buildings: null, roads: null, places: null };

class MapBoundary extends Component<{ onError(reason: string): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError/i.test(error.message);
    this.props.onError(chunk
      ? 'The 3D map code could not be loaded. If the development server was running during an npm install, restart it with “npm run dev -- --force”, then try 3D again.'
      : 'The 3D map failed to start in this browser.');
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

export function OperationsPortal() {
  const state = useDemoState();
  const { notify } = useNotifications();
  const isWide = useIsWide();
  const reducedMotion = useReducedMotion();
  const theme = useThemeName();
  const connection = useConnection();
  const localState = useLocalMapData();
  const local = localState.status === 'ready' ? localState.data : EMPTY_LOCAL;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  /* ---------------------------------------------------------- local UI state */
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<CaseFilters>(DEFAULT_FILTERS);
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftTab, setLeftTab] = useState('cases');
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState('details');
  const [drawer, setDrawer] = useState({ open: false, expanded: false });
  const [reviewPlanId, setReviewPlanId] = useState<string | null>(null);
  const [message, setMessage] = useState<DecisionMessage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [dataPreference, setDataPreference] = useState<DataPreference>('auto');
  const [activeSource, setActiveSource] = useState<ActiveSource>('none');
  const [caseLocations, setCaseLocations] = useState<Record<string, CaseScene['location']>>({});
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [fitKey] = useState(0);
  const [timelineScope, setTimelineScope] = useState<'all' | 'case'>('all');
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [webgl] = useState(detectWebGL);
  const [mapFailure, setMapFailure] = useState<string | null>(null);
  const [preferred2d, setPreferred2d] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const view: '3d' | '2d' = webgl.ok && !mapFailure && !preferred2d ? '3d' : '2d';

  /* ---------------------------------------------------------- derived joins */
  const lookups = useMemo(() => buildLookups(state), [state]);
  const rows = useMemo(() => buildCaseRows(state, lookups, now), [state, lookups, now]);
  const visibleRows = useMemo(() => sortRows(rows.filter((row) => matchesFilters(row, filters))), [rows, filters]);
  const summary = useMemo(() => buildSummary(state, lookups, now), [state, lookups, now]);
  const pending = useMemo(() => pendingProposals(state), [state]);
  const reviewPlan: SchedulePlan | null = pending.find((plan) => plan.id === reviewPlanId) ?? pending[0] ?? null;
  const comparison = useMemo(() => (reviewPlan ? comparePlans(state.active_plan, reviewPlan, lookups) : null), [reviewPlan, state.active_plan, lookups]);
  const activeRoutes = useMemo(() => planRoutes(state.active_plan, lookups), [state.active_plan, lookups]);
  const reviewRoutes = useMemo(() => planRoutes(reviewPlan, lookups), [reviewPlan, lookups]);
  const caseMarkers = useMemo(() => buildCaseMarkers(state, lookups), [state, lookups]);
  const workerMarkers = useMemo(() => buildWorkerMarkers(state, lookups), [state, lookups]);
  const active = useMemo(() => buildRoutes(state.active_plan, lookups, 'active'), [state.active_plan, lookups]);
  // Pending (unapproved) routes are only drawn while the officer is reviewing them in the Schedule drawer;
  // otherwise a full-day proposal covers the city in dashed lines that nobody has asked to see.
  const proposed = useMemo(() => buildRoutes(drawer.open ? reviewPlan : null, lookups, 'proposed'), [drawer.open, reviewPlan, lookups]);
  const densityPoints = useMemo(() => state.cases.flatMap((c) => { const p = lookups.properties.get(c.property_id); return p ? [[p.lon, p.lat] as LonLat] : []; }), [state.cases, lookups]);

  // Re-plan morph: remember the previous plan's routes and morph them into the newly approved ones.
  const activePlanId = state.active_plan?.id ?? null;
  const previousPlan = useRef(state.active_plan);
  const [releasedRoutes, setReleasedRoutes] = useState<RouteDatum[]>([]);
  useEffect(() => {
    if (previousPlan.current?.id === activePlanId) return;
    setReleasedRoutes(buildRoutes(previousPlan.current, lookups, 'active').routes);
    previousPlan.current = state.active_plan;
  }, [activePlanId]); // Only plan identity changes matter; lookups are read at that moment.
  const routeProgress = useTransition(activePlanId, 1200, !reducedMotion);
  const emergencyMarker = caseMarkers.find((marker) => marker.caseIds.includes(EMERGENCY_CASE_ID)) ?? null;
  const emergencyPulse = useTransition(emergencyMarker?.propertyId ?? null, 2600, !reducedMotion);

  const scene: MapScene = useMemo(() => ({
    caseMarkers, workers: workerMarkers, activeRoutes: active.routes, activeStops: active.stops,
    proposedRoutes: proposed.routes, proposedStops: proposed.stops, releasedRoutes, densityPoints,
  }), [caseMarkers, workerMarkers, active, proposed, releasedRoutes, densityPoints]);
  const extent = useMemo(() => boundsOf([...caseMarkers.map((m) => m.position), ...workerMarkers.map((w) => w.position)]), [caseMarkers, workerMarkers]);

  /* ---------------------------------------------------------- selection */
  const selectedRow = selection?.kind === 'case' ? rows.find((row) => row.case.id === selection.id) ?? null : null;
  useEffect(() => { if (selection?.kind === 'case' && !lookups.cases.has(selection.id)) setSelection(null); }, [selection, lookups]);
  const requestFocus = useCallback((position: LonLat) => setFocus((prev) => ({ key: (prev?.key ?? 0) + 1, position })), []);
  const selectCase = useCallback((caseId: string, moveCamera = true) => {
    const current = mockService.getState();
    const item = current.cases.find((c) => c.id === caseId);
    if (!item) return;
    setSelection({ kind: 'case', id: caseId }); setRightOpen(true); setRightTab('details');
    const property = current.properties.find((p) => p.id === item.property_id);
    if (property && moveCamera) requestFocus([property.lon, property.lat]);
    setArrivals((list) => list.filter((id) => id !== caseId));
    if (!isWide) setLeftOpen(false);
  }, [isWide, requestFocus]);
  const onPick = useCallback((pick: MapPick) => {
    if (pick.kind === 'property') {
      const marker = caseMarkers.find((m) => m.propertyId === pick.id);
      if (marker) selectCase(marker.primaryCaseId, true);
    } else { setSelection({ kind: 'worker', id: pick.id }); setRightOpen(true); setRightTab('details'); }
  }, [caseMarkers, selectCase]);
  const locateSelection = useCallback(() => {
    if (selection?.kind === 'case' && selectedRow?.property) requestFocus([selectedRow.property.lon, selectedRow.property.lat]);
    if (selection?.kind === 'worker') { const w = lookups.workers.get(selection.id); if (w) requestFocus([w.lon, w.lat]); }
  }, [selection, selectedRow, lookups, requestFocus]);

  const inspectorTarget: InspectorTarget | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'case') {
      if (!selectedRow) return null;
      const siblings = state.cases.filter((c) => c.property_id === selectedRow.case.property_id && c.id !== selectedRow.case.id && c.status !== 'resolved').map((c) => c.id);
      return { kind: 'case', row: selectedRow, activity: buildTimeline(state, selectedRow.case.id), siblings, location: caseLocations[selectedRow.case.property_id] ?? null };
    }
    const worker = lookups.workers.get(selection.id); if (!worker) return null;
    return { kind: 'worker', worker, active: activeRoutes.find((r) => r.workerId === worker.id)?.visits ?? [], proposed: reviewRoutes.find((r) => r.workerId === worker.id)?.visits ?? [] };
  }, [selection, selectedRow, state, lookups, activeRoutes, reviewRoutes, caseLocations]);

  /* ---------------------------------------------------------- new reports (from residents' devices) */
  const knownCases = useRef<Set<string> | null>(null);
  const ownCases = useRef(new Set<string>());
  useEffect(() => {
    const ids = state.cases.map((c) => c.id);
    if (!knownCases.current) { knownCases.current = new Set(ids); return; }
    const fresh = ids.filter((id) => !knownCases.current!.has(id) && !ownCases.current.has(id));
    ids.forEach((id) => knownCases.current!.add(id));
    if (fresh.length) setArrivals((list) => [...fresh, ...list.filter((id) => !fresh.includes(id))].slice(0, 4));
  }, [state.cases]);

  /* ---------------------------------------------------------- workflow actions (all awaited; the contract allows Promises) */
  const showDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: true })), []);
  const run = useCallback(async (key: string, action: () => Promise<void>, failure: string, retry: () => void) => {
    setBusy(key);
    try { await action(); }
    catch (error) { setMessage({ tone: 'error', text: `${failure} ${errorText(error)}`, retry }); showDrawer(); }
    finally { setBusy(null); }
  }, [showDrawer]);

  const createProposal = useCallback((caseId: string): void => {
    void run('propose', async () => {
      await mockService.recordActivity({ case_id: caseId, type: 'schedule.requested', summary: `Housing officer requested a schedule proposal for ${caseId}` });
      const plan = await mockService.generateScheduleProposal(caseId);
      setReviewPlanId(plan.id); showDrawer();
      setMessage({ tone: 'info', text: `Proposal ${plan.id} is ready for review. Routes and assignments stay unchanged until you approve it.` });
    }, 'Could not create a proposal.', () => createProposal(caseId));
  }, [run, showDrawer]);
  const reviewProposal = useCallback((planId: string) => { setReviewPlanId(planId); showDrawer(); }, [showDrawer]);
  const approve = useCallback((planId: string): void => {
    void run('approve', async () => {
      const plan = await mockService.approveProposal(planId, 'demo-officer');
      const visits = plan.workers.reduce((sum, route) => sum + route.stops.length, 0);
      setReviewPlanId(null);
      setMessage({ tone: 'success', text: `Approved. Plan ${plan.id} is now active with ${visits} operative ${visits === 1 ? 'assignment' : 'assignments'}.` });
      notify({ kind: 'success', title: 'Plan activated', message: `${plan.id} approved. Operative assignments updated.` });
    }, 'Approval failed; the previous plan is still active.', () => approve(planId));
  }, [run, notify]);
  const reject = useCallback((planId: string, reason: string): void => {
    void run('reject', async () => {
      await mockService.rejectProposal(planId, reason, 'demo-officer');
      setReviewPlanId(null);
      setMessage({ tone: 'info', text: `Proposal ${planId} rejected. The active plan is unchanged.` });
    }, 'Rejection failed.', () => reject(planId, reason));
  }, [run]);

  const emergencyExists = state.cases.some((c) => c.id === EMERGENCY_CASE_ID);
  const emergencyLock = useRef(false);
  const focusEmergency = useCallback((planId: string | null) => {
    setFilters(DEFAULT_FILTERS); selectCase(EMERGENCY_CASE_ID);
    if (planId) setReviewPlanId(planId);
    showDrawer();
  }, [selectCase, showDrawer]);
  const runEmergency = useCallback((): void => {
    setDialog(null);
    if (emergencyLock.current) return;
    emergencyLock.current = true;
    void run('emergency', async () => {
      const { proposal } = await mockService.simulateEmergency(); // called once; the button becomes “Review emergency”
      ownCases.current.add(EMERGENCY_CASE_ID);
      focusEmergency(proposal.id);
      setMessage({ tone: 'info', text: `Test emergency ${EMERGENCY_CASE_ID} created with re-plan ${proposal.id}. The active route is unchanged until you approve.` });
    }, 'Emergency simulation failed.', () => setDialog('emergency')).finally(() => { emergencyLock.current = false; });
  }, [run, focusEmergency]);
  const onEmergencyButton = useCallback(() => {
    if (mockService.getState().cases.some((c) => c.id === EMERGENCY_CASE_ID)) focusEmergency(pendingProposals(mockService.getState()).find((p) => p.kind === 'replan')?.id ?? null);
    else setDialog('emergency');
  }, [focusEmergency]);
  const runReset = useCallback((): void => {
    setDialog(null);
    void run('reset', async () => {
      knownCases.current = null; ownCases.current.clear();
      await mockService.reset();
      setSelection(null); setFilters(DEFAULT_FILTERS); setReviewPlanId(null); setMessage(null); setArrivals([]);
      setDrawer({ open: false, expanded: false }); setLayers(DEFAULT_LAYERS); setTimelineScope('all'); setLeftOpen(true); setLeftTab('cases');
      setResetKey((k) => k + 1);
      notify({ kind: 'success', title: 'Test data reset', message: 'Cases, proposals and approvals returned to the starting data.' });
    }, 'Reset failed.', () => setDialog('reset'));
  }, [run, notify]);

  /* ---------------------------------------------------------- layout */
  const rootRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(64);
  useLayoutEffect(() => {
    const measure = () => { const el = rootRef.current; if (el) setTop(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))); };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const [statsRef, statsSize] = useElementSize<HTMLDivElement>();
  const insets = useMemo(() => ({ top: statsSize.height ? statsSize.height + 16 : 0, left: 0, right: 0, bottom: 0 }), [statsSize.height]);
  const timeline = useMemo(() => buildTimeline(state, timelineScope === 'case' ? selectedRow?.case.id ?? null : null), [state, timelineScope, selectedRow]);
  const mapSelection = useMemo(() => ({ propertyId: selectedRow?.case.property_id ?? null, workerId: selection?.kind === 'worker' ? selection.id : null }), [selectedRow, selection]);
  const onMapFailure = useCallback((reason: string) => setMapFailure((prev) => prev ?? reason), []);
  const retry3d = useCallback(() => { setMapFailure(null); setPreferred2d(false); setMapAttempt((n) => n + 1); }, []);

  const casesTab = <CaseRail rows={visibleRows} totalCount={rows.length} filters={filters} onFiltersChange={setFilters} selectedCaseId={selectedRow?.case.id ?? null} onSelect={selectCase} arrivals={arrivals} onDismissArrivals={() => setArrivals([])} />;
  const layersTab = <LayersPanel layers={layers} onChange={setLayers} dataPreference={dataPreference} onDataPreferenceChange={setDataPreference} activeSource={activeSource} local={localState.status === 'ready' ? local : null} view={view} canUse3d={webgl.ok} onViewChange={(next) => (next === '3d' ? retry3d() : setPreferred2d(true))} />;
  const detailsTab = inspectorTarget
    ? <Inspector target={inspectorTarget} now={now} busy={busy === 'propose'} simulatedServices={connection.simulatedServices} onLocate={locateSelection} onCreateProposal={createProposal} onReviewProposal={reviewProposal} onSelectCase={selectCase} />
    : <div className="ops-empty"><p>Select a case on the map or in the Cases list to see its details.</p></div>;
  const activityTab = <div className="ops-activity">
    <p className="ops-solver-note">Human-readable summaries from the activity log, case records and approval records. Not model reasoning.</p>
    <div className="ops-segmented" role="radiogroup" aria-label="Activity scope">
      <button type="button" role="radio" aria-checked={timelineScope === 'all'} onClick={() => setTimelineScope('all')}>All</button>
      <button type="button" role="radio" aria-checked={timelineScope === 'case'} disabled={!selectedRow} onClick={() => setTimelineScope('case')}>{selectedRow?.case.id ?? 'Selected case'}</button>
    </div>
    <Timeline entries={timeline} now={now} />
  </div>;

  const style = { '--ops-top': `${top}px` } as CSSProperties;
  return <div className="ops" ref={rootRef} style={style} data-left={leftOpen || undefined} data-right={rightOpen || undefined}>
    <h1 className="ops-sr-only">Sheffield operations</h1>
    <SidePanel side="left" label="Cases and layers" collapsedLabel="cases and layers" open={leftOpen} onOpenChange={setLeftOpen} active={leftTab} onActiveChange={setLeftTab}
      tabs={[{ id: 'cases', label: 'Cases', badge: arrivals.length ? <span className="ops-pill ops-pill--new">{arrivals.length} new</span> : <span className="ops-count-badge">{summary.openCases}</span>, content: casesTab }, { id: 'layers', label: 'Layers', content: layersTab }]} />

    <div className="ops-centre">
      <div className="ops-map" role="region" aria-label="Sheffield digital twin">
        {localState.status === 'loading' ? <MapStatus icon={<Loader2 className="ops-spin" size={22} aria-hidden="true" />} title="Loading Sheffield" text="Preparing streets and buildings." />
          : view === '3d' ? <MapBoundary key={mapAttempt} onError={onMapFailure}>
            <Suspense fallback={<MapStatus icon={<Loader2 className="ops-spin" size={22} aria-hidden="true" />} title="Starting the 3D twin" text="Loading the map engine." />}>
              <TwinMap local={local} scene={scene} extent={extent} selection={mapSelection} layers={layers} dataPreference={dataPreference} focus={focus} resetKey={resetKey} fitKey={fitKey} insets={insets}
                reducedMotion={reducedMotion} theme={theme} routeProgress={routeProgress} emergencyPulse={emergencyPulse} onPick={onPick} onFailure={onMapFailure} onSourceChange={setActiveSource} onCaseLocations={setCaseLocations} />
            </Suspense>
          </MapBoundary>
            : <FallbackMap local={local} scene={scene} extent={extent} selection={mapSelection} layers={layers} onPick={onPick} theme={theme} focus={focus} resetKey={resetKey} fitKey={fitKey}
              reason={mapFailure ?? webgl.reason ?? (preferred2d ? 'You switched to the 2D view.' : null)} onRetry={webgl.ok ? retry3d : undefined} />}
        <div className="ops-stats-wrap" ref={statsRef}>
          <StatsOverlay summary={summary} connection={connection} scheduleOpen={drawer.open} pendingCount={pending.length} onToggleSchedule={() => setDrawer((d) => ({ ...d, open: !d.open }))} emergencyExists={emergencyExists} onEmergency={onEmergencyButton} onReset={() => setDialog('reset')} />
        </div>
        <Attribution source={view === '2d' ? '2d' : activeSource} local={localState.status === 'ready' ? local : null} />
      </div>
      {drawer.open ? <div className="ops-drawer-wrap" data-expanded={drawer.expanded || undefined}>
        <ScheduleDrawer expanded={drawer.expanded} onToggleExpanded={() => setDrawer((d) => ({ ...d, expanded: !d.expanded }))} onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          now={now} simulatedServices={connection.simulatedServices} activePlan={state.active_plan} activeRoutes={activeRoutes} pending={pending} reviewPlan={reviewPlan} reviewRoutes={reviewRoutes} comparison={comparison}
          onReviewPlanChange={setReviewPlanId} onApprove={approve} onReject={reject} busy={busy === 'approve' || busy === 'reject'} message={message} />
      </div> : null}
    </div>

    <SidePanel side="right" label="Case details and activity" collapsedLabel="details and activity" contentKey={selection ? `${selection.kind}:${selection.id}` : 'none'} open={rightOpen} onOpenChange={setRightOpen} active={rightTab} onActiveChange={setRightTab}
      tabs={[{ id: 'details', label: 'Details', content: detailsTab }, { id: 'activity', label: 'Activity', content: activityTab }]} />

    {dialog === 'emergency' ? <ConfirmDialog title="Simulate an emergency?" icon={<Siren size={20} aria-hidden="true" />} confirmLabel="Simulate emergency" confirmVariant="danger" onConfirm={runEmergency} onCancel={() => setDialog(null)}>
      <p>This test creates one gas emergency, {EMERGENCY_CASE_ID}, at property p-110 (Park Hill) and asks the scheduler for a re-plan.</p>
      <p>The current approved routes stay in place. Nothing changes for operatives until you review and approve the re-plan.</p>
    </ConfirmDialog> : null}
    {dialog === 'reset' ? <ConfirmDialog title="Reset the test data?" icon={<RotateCcw size={20} aria-hidden="true" />} confirmLabel="Reset test data" confirmVariant="danger" onConfirm={runReset} onCancel={() => setDialog(null)}>
      <p>This clears all reports, proposals, approvals and emergencies for every connected screen and restores the starting data.</p>
    </ConfirmDialog> : null}
  </div>;
}

function MapStatus({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="ops-map-status" role="status">{icon}<strong>{title}</strong><p>{text}</p></div>;
}
