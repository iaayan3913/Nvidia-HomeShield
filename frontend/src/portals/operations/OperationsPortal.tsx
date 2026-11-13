import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, MapPinOff, PanelLeftOpen, RotateCcw, Siren } from 'lucide-react';
import { homeShieldService, isApiMode, switchDataSource, useConnectionState, useDemoState } from '../../shared/data';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import type { SchedulePlan } from '../../shared/types/domain';
import {
  DEFAULT_FILTERS, EMERGENCY_CASE_ID, buildCaseMarkers, buildCaseRows, buildLookups, buildRoutes, buildSummary, buildTimeline, buildWorkerMarkers,
  comparePlans, matchesFilters, pendingProposals, planRoutes, sortRows, type CaseFilters, type RouteDatum,
} from './lib/derive';
import { boundsOf, type LonLat } from './lib/geo';
import { detectWebGL, useElementSize, useIsDesktop, useIsWide, useOnline, useReducedMotion, useTransition } from './hooks/environment';
import { useGeoData } from './hooks/useGeoData';
import { DEFAULT_LAYERS, type FocusRequest, type LayerVisibility, type MapPick, type MapScene } from './map/types';
import { FallbackMap } from './map/FallbackMap';
import { LayerMenu, SourceStrip } from './map/LayerMenu';
import { OpsHeader } from './panels/OpsHeader';
import { CaseRail } from './panels/CaseRail';
import { Inspector, type InspectorTarget } from './panels/Inspector';
import { ScheduleDrawer, type DecisionMessage, type DrawerTab } from './panels/ScheduleDrawer';
import { ConfirmDialog } from './panels/ConfirmDialog';
import './operations.css';

const TwinMap = lazy(() => import('./map/TwinMap'));

type Selection = { kind: 'case' | 'stock' | 'worker'; id: string } | null;
type Dialog = 'emergency' | 'reset' | null;

class MapBoundary extends Component<{ onError(reason: string): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError('The 3D map failed to start in this browser.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

export function OperationsPortal() {
  const state = useDemoState();
  const connection = useConnectionState();
  const { notify } = useNotifications();
  const isDesktop = useIsDesktop();
  const isWide = useIsWide();
  const reducedMotion = useReducedMotion();
  const online = useOnline();
  const { state: geoState, retry: retryGeo } = useGeoData();

  /* ---------------------------------------------------------- clock for due-soon values */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);

  /* ---------------------------------------------------------- local UI state */
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<CaseFilters>(DEFAULT_FILTERS);
  const [railOpen, setRailOpen] = useState(isDesktop);
  const [drawer, setDrawer] = useState<{ open: boolean; tab: DrawerTab; expanded: boolean }>({ open: false, tab: 'schedule', expanded: false });
  const [reviewPlanId, setReviewPlanId] = useState<string | null>(null);
  const [message, setMessage] = useState<DecisionMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [timelineScope, setTimelineScope] = useState<'all' | 'case'>('all');
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [webgl] = useState(detectWebGL);
  const [mapFailure, setMapFailure] = useState<string | null>(null);
  const [preferred2d, setPreferred2d] = useState(false);
  const view: '3d' | '2d' = webgl.ok && !mapFailure && !preferred2d ? '3d' : '2d';

  /* ---------------------------------------------------------- derived joins (memoised on shared state) */
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
  const proposed = useMemo(() => buildRoutes(reviewPlan, lookups, 'proposed'), [reviewPlan, lookups]);

  // Approved-route transition: remember the previous plan's routes and draw the new ones in.
  const activePlanId = state.active_plan?.id ?? null;
  const previousPlan = useRef(state.active_plan);
  const [releasedRoutes, setReleasedRoutes] = useState<RouteDatum[]>([]);
  useEffect(() => {
    if (previousPlan.current?.id === activePlanId) return;
    setReleasedRoutes(buildRoutes(previousPlan.current, lookups, 'active').routes);
    previousPlan.current = state.active_plan;
  }, [activePlanId]); // Only react to plan identity changes; lookups are read at that moment.
  const routeProgress = useTransition(activePlanId, 1100, !reducedMotion);

  const emergencyMarker = caseMarkers.find((marker) => marker.caseIds.includes(EMERGENCY_CASE_ID)) ?? null;
  const emergencyPulse = useTransition(emergencyMarker?.propertyId ?? null, 2600, !reducedMotion);

  const scene: MapScene = useMemo(() => ({
    caseMarkers, workers: workerMarkers, activeRoutes: active.routes, activeStops: active.stops,
    proposedRoutes: proposed.routes, proposedStops: proposed.stops, releasedRoutes,
  }), [caseMarkers, workerMarkers, active, proposed, releasedRoutes]);

  const geo = geoState.status === 'ready' ? geoState.data : null;
  const extent = useMemo(() => {
    const points: LonLat[] = [...state.properties.map((p) => [p.lon, p.lat] as LonLat), ...state.workers.map((w) => [w.lon, w.lat] as LonLat)];
    if (geo) points.push(...geo.stock.items.map((unit) => unit.position));
    return boundsOf(points);
  }, [geo, state.properties, state.workers]);

  /* ---------------------------------------------------------- selection */
  const selectedRow = selection?.kind === 'case' ? rows.find((row) => row.case.id === selection.id) ?? null : null;
  useEffect(() => { // Drop selections that no longer exist in shared state (e.g. reset from another tab).
    if (selection?.kind === 'case' && !lookups.cases.has(selection.id)) setSelection(null);
  }, [selection, lookups]);

  const requestFocus = useCallback((position: LonLat) => setFocus((prev) => ({ key: (prev?.key ?? 0) + 1, position })), []);
  const selectCase = useCallback((caseId: string, moveCamera = true) => {
    const current = homeShieldService.getState();
    const item = current.cases.find((c) => c.id === caseId);
    if (!item) return;
    setSelection({ kind: 'case', id: caseId });
    const property = current.properties.find((p) => p.id === item.property_id);
    if (property && moveCamera) requestFocus([property.lon, property.lat]);
    setArrivals((list) => list.filter((id) => id !== caseId));
    // Below 1280px the inspector replaces the rail so the map keeps a usable width; one tap reopens it.
    if (!isWide) setRailOpen(false);
  }, [isWide, requestFocus]);

  const onPick = useCallback((pick: MapPick) => {
    if (pick.kind === 'property') {
      const marker = caseMarkers.find((m) => m.propertyId === pick.id);
      if (marker) selectCase(marker.primaryCaseId, false);
    } else setSelection({ kind: pick.kind, id: pick.id });
  }, [caseMarkers, selectCase]);

  const locateSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'case' && selectedRow?.property) requestFocus([selectedRow.property.lon, selectedRow.property.lat]);
    if (selection.kind === 'worker') { const w = lookups.workers.get(selection.id); if (w) requestFocus([w.lon, w.lat]); }
    if (selection.kind === 'stock') { const unit = geo?.stock.items.find((u) => u.id === selection.id); if (unit) requestFocus(unit.position); }
  }, [selection, selectedRow, lookups, geo, requestFocus]);

  const inspectorTarget: InspectorTarget | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'case') {
      if (!selectedRow) return null;
      const siblings = state.cases.filter((c) => c.property_id === selectedRow.case.property_id && c.id !== selectedRow.case.id && c.status !== 'resolved').map((c) => c.id);
      return { kind: 'case', row: selectedRow, activity: buildTimeline(state, selectedRow.case.id), siblings };
    }
    if (selection.kind === 'stock') { const unit = geo?.stock.items.find((u) => u.id === selection.id); return unit ? { kind: 'stock', unit } : null; }
    const worker = lookups.workers.get(selection.id); if (!worker) return null;
    return { kind: 'worker', worker, active: activeRoutes.find((r) => r.workerId === worker.id)?.visits ?? [], proposed: reviewRoutes.find((r) => r.workerId === worker.id)?.visits ?? [] };
  }, [selection, selectedRow, state, geo, lookups, activeRoutes, reviewRoutes]);

  /* ---------------------------------------------------------- new resident reports (incl. from other tabs) */
  const knownCases = useRef<Set<string> | null>(null);
  const ownCases = useRef(new Set<string>());
  useEffect(() => {
    const ids = state.cases.map((c) => c.id);
    if (!knownCases.current) { knownCases.current = new Set(ids); return; }
    const fresh = ids.filter((id) => !knownCases.current!.has(id) && !ownCases.current.has(id));
    ids.forEach((id) => knownCases.current!.add(id));
    if (fresh.length) setArrivals((list) => [...fresh, ...list.filter((id) => !fresh.includes(id))].slice(0, 4));
  }, [state.cases]);

  /* ---------------------------------------------------------- drawer helpers */
  const openDrawer = useCallback((tab: DrawerTab) => setDrawer((d) => ({ open: !(d.open && d.tab === tab), tab, expanded: d.expanded })), []);
  const showDrawer = useCallback((tab: DrawerTab) => setDrawer((d) => ({ ...d, open: true, tab })), []);

  /* ---------------------------------------------------------- workflow actions */
  const createProposal = useCallback(async (caseId: string) => {
    setBusy(true);
    try {
      homeShieldService.recordActivity({ case_id: caseId, type: 'schedule.requested', summary: `Housing officer requested a schedule proposal for ${caseId}`, tool_name: isApiMode ? 'backend' : 'mock-deterministic' });
      const plan = await homeShieldService.generateScheduleProposal(caseId);
      setReviewPlanId(plan.id); showDrawer('schedule');
      setMessage({ tone: 'info', text: `Proposal ${plan.id} is ready for review. Routes and assignments stay unchanged until you approve it.` });
    } catch (error) {
      setMessage({ tone: 'error', text: `Could not create a proposal: ${errorText(error)}` }); showDrawer('schedule');
    } finally { setBusy(false); }
  }, [showDrawer]);

  const reviewProposal = useCallback((planId: string) => { setReviewPlanId(planId); showDrawer('schedule'); }, [showDrawer]);

  const approve = useCallback(async (planId: string) => {
    setBusy(true);
    try {
      const decidedBy = isApiMode ? 'frontend-officer' : 'demo-officer';
      const plan = await homeShieldService.approveProposal(planId, decidedBy);
      const visits = plan.workers.reduce((sum, route) => sum + route.stops.length, 0);
      setReviewPlanId(null);
      setMessage({ tone: 'success', text: `Approved. Plan ${plan.id} is now active with ${visits} operative ${visits === 1 ? 'assignment' : 'assignments'}.` });
      notify({ kind: 'success', title: 'Plan activated', message: `${plan.id} approved by ${decidedBy}. Operative assignments updated.` });
    } catch (error) {
      setMessage({ tone: 'error', text: `Approval failed; the previous plan is still active. ${errorText(error)}` });
    } finally { setBusy(false); }
  }, [notify]);

  const reject = useCallback(async (planId: string, reason: string) => {
    setBusy(true);
    try {
      await homeShieldService.rejectProposal(planId, reason, isApiMode ? 'frontend-officer' : 'demo-officer');
      setReviewPlanId(null);
      setMessage({ tone: 'info', text: `Proposal ${planId} rejected. The active plan is unchanged.` });
    } catch (error) {
      setMessage({ tone: 'error', text: `Rejection failed: ${errorText(error)}` });
    } finally { setBusy(false); }
  }, []);

  const emergencyExists = state.cases.some((c) => isApiMode ? c.is_emergency : c.id === EMERGENCY_CASE_ID);
  const emergencyLock = useRef(false);
  const focusEmergency = useCallback((planId: string | null, caseId = EMERGENCY_CASE_ID) => {
    setFilters(DEFAULT_FILTERS);
    selectCase(caseId);
    if (planId) setReviewPlanId(planId);
    setTimelineScope('all');
    showDrawer('schedule');
  }, [selectCase, showDrawer]);

  const runEmergency = useCallback(async () => {
    setDialog(null);
    if (emergencyLock.current) return;
    emergencyLock.current = true;
    try {
      const { case: emergencyCase, proposal } = await homeShieldService.simulateEmergency();
      ownCases.current.add(emergencyCase.id);
      if (proposal) focusEmergency(proposal.id, emergencyCase.id); else { selectCase(emergencyCase.id); showDrawer('schedule'); }
      setMessage({ tone: proposal ? 'info' : 'error', text: proposal ? `Emergency ${emergencyCase.id} created with re-plan ${proposal.id}. The active route is unchanged until you approve.` : `Emergency ${emergencyCase.id} was stored, but scheduling did not produce a plan. Review backend activity before retrying.` });
    } catch (error) {
      setMessage({ tone: 'error', text: `Emergency simulation failed: ${errorText(error)}` }); showDrawer('schedule');
    } finally { emergencyLock.current = false; }
  }, [focusEmergency, selectCase, showDrawer]);

  const onEmergencyButton = useCallback(() => {
    const current=homeShieldService.getState(); const existing=current.cases.find((c)=>isApiMode?c.is_emergency:c.id===EMERGENCY_CASE_ID);
    if (existing) {
      const replan = pendingProposals(homeShieldService.getState()).find((p) => p.kind === 'replan');
      if(isApiMode){selectCase(existing.id);if(replan)setReviewPlanId(replan.id);showDrawer('schedule');}else focusEmergency(replan?.id ?? null);
    } else setDialog('emergency');
  }, [focusEmergency, selectCase, showDrawer]);

  const runReset = useCallback(() => {
    setDialog(null);
    knownCases.current = null; ownCases.current.clear();
    try { homeShieldService.reset(); } catch (error) { setMessage({ tone: 'error', text: errorText(error) }); return; }
    setSelection(null); setFilters(DEFAULT_FILTERS); setReviewPlanId(null); setMessage(null); setArrivals([]);
    setDrawer({ open: false, tab: 'schedule', expanded: false }); setLayers(DEFAULT_LAYERS); setTimelineScope('all');
    setRailOpen(isDesktop); setResetKey((k) => k + 1);
    notify({ kind: 'success', title: 'Demonstration reset', message: 'Shared demo data and this workspace returned to the baseline.' });
  }, [isDesktop, notify]);

  /* ---------------------------------------------------------- layout: measure panels so the camera frames the visible map */
  const rootRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(64);
  useLayoutEffect(() => {
    const measure = () => { const el = rootRef.current; if (el) setTop(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))); };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const [railRef, railSize] = useElementSize<HTMLDivElement>();
  const [inspectorRef, inspectorSize] = useElementSize<HTMLDivElement>();
  const [drawerRef, drawerSize] = useElementSize<HTMLDivElement>();
  const insets = useMemo(() => isDesktop
    ? { top: 0, left: railOpen ? railSize.width : 0, right: inspectorTarget ? inspectorSize.width : 0, bottom: drawer.open ? drawerSize.height : 0 }
    : { top: 0, left: 0, right: 0, bottom: Math.max(drawer.open ? drawerSize.height : 0, inspectorTarget ? inspectorSize.height : 0) },
  [isDesktop, railOpen, railSize.width, inspectorTarget, inspectorSize, drawer.open, drawerSize.height]);

  const style = { '--ops-top': `${top}px`, '--inset-left': `${insets.left}px`, '--inset-right': `${insets.right}px`, '--inset-bottom': `${insets.bottom}px` } as CSSProperties;
  const timeline = useMemo(() => buildTimeline(state, timelineScope === 'case' ? selectedRow?.case.id ?? null : null), [state, timelineScope, selectedRow]);
  const mapSelection = useMemo(() => ({
    propertyId: selectedRow?.case.property_id ?? null,
    stockId: selection?.kind === 'stock' ? selection.id : null,
    workerId: selection?.kind === 'worker' ? selection.id : null,
  }), [selectedRow, selection]);
  const onMapFailure = useCallback((reason: string) => setMapFailure((prev) => prev ?? reason), []);
  const onBasemapError = useCallback(() => {
    setBasemapFailed(true);
    setLayers((current) => (current.basemap ? { ...current, basemap: false } : current));
    notify({ kind: 'warning', title: 'Online basemap unavailable', message: 'Local roads, markers, operatives and routes continue to work.' });
  }, [notify]);

  return <div className="ops" ref={rootRef} style={style}>
    <OpsHeader summary={summary} online={isApiMode ? connection.status === 'connected' : online} railOpen={railOpen} onToggleRail={() => setRailOpen((v) => !v)} drawerTab={drawer.open ? drawer.tab : null} onOpenDrawer={openDrawer} pendingCount={pending.length} emergencyExists={emergencyExists} onEmergency={onEmergencyButton} onReset={() => isApiMode ? switchDataSource('mock') : setDialog('reset')} live={isApiMode} />

    <div className="ops-workspace" data-rail={railOpen || undefined} data-inspector={Boolean(inspectorTarget) || undefined} data-drawer={drawer.open || undefined}>
      <div className="ops-map" role="region" aria-label="Sheffield digital twin">
        {geoState.status === 'loading' ? <MapStatus icon={<Loader2 className="ops-spin" size={22} aria-hidden="true" />} title="Loading local map data" text="Reading the committed Sheffield road and synthetic stock files." />
          : geoState.status === 'error' ? <MapStatus icon={<MapPinOff size={22} aria-hidden="true" />} title={geoState.kind === 'malformed' ? 'Map data could not be read' : geoState.kind === 'offline' ? 'Offline and map files unavailable' : 'Map data unavailable'} text={`${geoState.message} The case list, inspector, schedule and approvals still work.`} action={<button type="button" className="button button--secondary" onClick={retryGeo}><RotateCcw size={16} aria-hidden="true" />Retry</button>} />
            : view === '3d' ? <MapBoundary onError={onMapFailure}>
              <Suspense fallback={<MapStatus icon={<Loader2 className="ops-spin" size={22} aria-hidden="true" />} title="Starting the 3D twin" text="Initialising MapLibre and deck.gl locally." />}>
                <TwinMap geo={geo!} scene={scene} extent={extent} selection={mapSelection} layers={layers} focus={focus} resetKey={resetKey} insets={insets} reducedMotion={reducedMotion} routeProgress={routeProgress} emergencyPulse={emergencyPulse} emergencyPropertyId={emergencyMarker?.propertyId ?? null} onPick={onPick} onFailure={onMapFailure} onBasemapError={onBasemapError} />
              </Suspense>
            </MapBoundary>
              : <FallbackMap geo={geo!} scene={scene} extent={extent} selection={mapSelection} layers={layers} onPick={onPick} reason={mapFailure ?? webgl.reason ?? (preferred2d ? 'You switched to the 2D schematic view.' : null)} onRetry={webgl.ok && (mapFailure || preferred2d) ? () => { setMapFailure(null); setPreferred2d(false); } : undefined} />}
      </div>

      {geo ? <>
        <div className="ops-map-tools">
          <LayerMenu layers={layers} onChange={setLayers} online={online} basemapFailed={basemapFailed} view={view} canUse3d={webgl.ok} onViewChange={(next) => { setPreferred2d(next === '2d'); if (next === '3d') setMapFailure(null); }} />
        </div>
        <SourceStrip roads={geo.roads.metadata} stock={geo.stock.metadata} basemap={layers.basemap && view === '3d'} />
      </> : null}

      {railOpen ? <div className="ops-rail-wrap" ref={railRef}>
        <CaseRail rows={visibleRows} totalCount={rows.length} filters={filters} onFiltersChange={setFilters} selectedCaseId={selectedRow?.case.id ?? null} onSelect={selectCase} arrivals={arrivals} onDismissArrivals={() => setArrivals([])} onClose={() => setRailOpen(false)} />
      </div> : <button type="button" className="ops-rail-toggle" onClick={() => setRailOpen(true)} aria-label={`Show case list, ${summary.openCases} open cases`}>
        <PanelLeftOpen size={17} aria-hidden="true" /><span>Cases</span><span className="ops-pill">{summary.openCases}</span>{arrivals.length ? <span className="ops-pill ops-pill--new">{arrivals.length} new</span> : null}
      </button>}

      {inspectorTarget ? <div className="ops-inspector-wrap" ref={inspectorRef}>
        <Inspector target={inspectorTarget} now={now} busy={busy} onClose={() => setSelection(null)} onLocate={locateSelection} onCreateProposal={createProposal} onReviewProposal={reviewProposal} onSelectCase={selectCase} />
      </div> : null}

      {drawer.open ? <div className="ops-drawer-wrap" ref={drawerRef}>
        <ScheduleDrawer tab={drawer.tab} onTabChange={(tab) => setDrawer((d) => ({ ...d, tab }))} expanded={drawer.expanded} onToggleExpanded={() => setDrawer((d) => ({ ...d, expanded: !d.expanded }))} onClose={() => setDrawer((d) => ({ ...d, open: false }))}
          now={now} activePlan={state.active_plan} activeRoutes={activeRoutes} pending={pending} reviewPlan={reviewPlan} reviewRoutes={reviewRoutes} comparison={comparison} onReviewPlanChange={setReviewPlanId}
          onApprove={approve} onReject={reject} busy={busy} message={message} timeline={timeline} timelineScope={timelineScope} onTimelineScopeChange={setTimelineScope} selectedCaseId={selectedRow?.case.id ?? null} />
      </div> : null}
    </div>

    {dialog === 'emergency' ? <ConfirmDialog title="Simulate an emergency?" icon={<Siren size={20} aria-hidden="true" />} confirmLabel="Simulate emergency" confirmVariant="danger" onConfirm={runEmergency} onCancel={() => setDialog(null)}>
      <p>This creates one fictional gas emergency, {EMERGENCY_CASE_ID}, at demonstration property p-110 (Park Hill) and a proposed re-plan from the deterministic solver.</p>
      <p>The current active routes stay in place. Nothing changes for operatives until you review and approve the re-plan.</p>
    </ConfirmDialog> : null}
    {dialog === 'reset' ? <ConfirmDialog title="Reset the demonstration?" icon={<RotateCcw size={20} aria-hidden="true" />} confirmLabel="Reset demonstration" confirmVariant="danger" onConfirm={runReset} onCancel={() => setDialog(null)}>
      <p>This clears all demonstration reports, proposals, approvals and emergencies for every open HomeShield tab and restores the deterministic baseline.</p>
    </ConfirmDialog> : null}
  </div>;
}

function MapStatus({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="ops-map-status" role="status">{icon}<strong>{title}</strong><p>{text}</p>{action}</div>;
}
