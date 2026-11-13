import { beforeEach, describe, expect, it } from 'vitest';
import { mockService } from '../../../shared/mock';
import {
  DEFAULT_FILTERS, EMERGENCY_CASE_ID, buildCaseMarkers, buildCaseRows, buildLookups, buildRoutes, buildSummary, buildTimeline,
  comparePlans, dueInfo, matchesFilters, pendingProposals, sortRows,
} from './derive';

const NOON = Date.parse('2026-11-13T12:00:00.000Z');
const contact = { name: 'Demo Resident', contact_number: '07000 000000', preferred_contact: 'text' as const };

describe('operations derivations', () => {
  beforeEach(() => mockService.reset());

  it('derives baseline summary counters from shared state', () => {
    const state = mockService.getState();
    const lookups = buildLookups(state);
    const summary = buildSummary(state, lookups, NOON);
    expect(summary.openCases).toBe(2);
    expect(summary.emergencies).toBe(0);
    // j-041 window ends 14:00 and HS-26041 investigate by 15:00; j-042 window ends 16:00 — all inside 4 h of noon.
    expect(summary.jobsDueSoon).toBe(2);
    expect(summary.availableOperatives).toBe(6);
    expect(summary.totalOperatives).toBe(8);
  });

  it('joins case rows with property, job, operative and due state', () => {
    const state = mockService.getState();
    const rows = buildCaseRows(state, buildLookups(state), NOON);
    const leak = rows.find((row) => row.case.id === 'HS-26041')!;
    expect(leak.property?.area).toBe('Norfolk Park');
    expect(leak.job?.id).toBe('j-041');
    expect(leak.worker?.name).toBe('Dan Clarke');
    expect(leak.due.label).toMatch(/^Visit window ends|^Investigate by/);
    expect(leak.due.reviewRequired).toBe(true);
  });

  it('filters by search text, urgency and status', () => {
    const state = mockService.getState();
    const rows = buildCaseRows(state, buildLookups(state), NOON);
    expect(rows.filter((row) => matchesFilters(row, { ...DEFAULT_FILTERS, query: 'norfolk' })).map((r) => r.case.id)).toEqual(['HS-26041']);
    expect(rows.filter((row) => matchesFilters(row, { ...DEFAULT_FILTERS, query: 'priya' })).map((r) => r.case.id)).toEqual(['HS-26042']);
    expect(rows.filter((row) => matchesFilters(row, { ...DEFAULT_FILTERS, urgency: 'significant' })).map((r) => r.case.id)).toEqual(['HS-26041']);
    expect(rows.filter((row) => matchesFilters(row, { ...DEFAULT_FILTERS, status: 'needs_action' })).map((r) => r.case.id)).toEqual(['HS-26042']);
  });

  it('sorts emergencies first and counts them once simulated', () => {
    mockService.simulateEmergency();
    const state = mockService.getState();
    const lookups = buildLookups(state);
    const rows = sortRows(buildCaseRows(state, lookups, NOON));
    expect(rows[0]!.case.id).toBe(EMERGENCY_CASE_ID);
    expect(buildSummary(state, lookups, NOON).emergencies).toBe(1);
    const markers = buildCaseMarkers(state, lookups);
    const emergency = markers.find((m) => m.caseIds.includes(EMERGENCY_CASE_ID))!;
    expect(emergency.propertyId).toBe('p-110');
    expect(emergency.emergency).toBe(true);
  });

  it('keeps proposed routes separate from the active plan and reports released visits', async () => {
    const { case: created } = await mockService.createReport({ text: 'Mould in the bathroom', category: 'damp_mould', property_id: 'p-001', contact });
    const proposal = await mockService.generateScheduleProposal(created.id);
    const state = mockService.getState();
    const lookups = buildLookups(state);
    expect(pendingProposals(state).map((p) => p.id)).toEqual([proposal.id]);
    const active = buildRoutes(state.active_plan, lookups, 'active');
    const proposed = buildRoutes(proposal, lookups, 'proposed');
    expect(active.routes.every((r) => r.status === 'active')).toBe(true);
    expect(proposed.routes).toHaveLength(1);
    expect(proposed.routes[0]!.path[0]).toEqual([-1.4585, 53.422]); // starts at Amira Hussain's base
    const comparison = comparePlans(state.active_plan, proposal, lookups);
    expect(comparison.changes.map((c) => [c.change, c.case?.id, c.to?.name])).toEqual([['added', created.id, 'Amira Hussain']]);
    expect(comparison.released.map((v) => v.jobId).sort()).toEqual(['j-041', 'j-042']);
    const row = buildCaseRows(state, lookups, NOON).find((r) => r.case.id === created.id)!;
    expect(row.pendingWorker?.name).toBe('Amira Hussain');
    expect(row.worker).toBeUndefined();
  });

  it('builds a timeline covering report, classification, deadlines, scheduling, approval and activation', async () => {
    const { case: created } = await mockService.createReport({ text: 'Mould', category: 'damp_mould', property_id: 'p-001', contact });
    await mockService.recordActivity({ case_id: created.id, type: 'schedule.requested', summary: 'requested' });
    const proposal = await mockService.generateScheduleProposal(created.id);
    await mockService.approveProposal(proposal.id, 'demo-officer');
    const titles = buildTimeline(mockService.getState()).map((e) => e.title);
    for (const title of ['Report received', 'Classification proposed', 'Deadlines calculated', 'Scheduling requested', 'Schedule result returned', 'Approval requested', 'Plan activated']) expect(titles).toContain(title);
    const caseOnly = buildTimeline(mockService.getState(), created.id);
    expect(caseOnly.every((e) => e.caseId === created.id)).toBe(true);
  });

  it('marks overdue and soon deadlines', () => {
    const state = mockService.getState();
    const item = state.cases.find((c) => c.id === 'HS-26042')!;
    expect(dueInfo(item, undefined, Date.parse('2026-11-13T17:00:00.000Z')).tone).toBe('overdue');
    expect(dueInfo(item, undefined, Date.parse('2026-11-13T13:00:00.000Z')).tone).toBe('soon');
    expect(dueInfo(item, undefined, Date.parse('2026-11-13T06:00:00.000Z')).tone).toBe('later');
  });
});
