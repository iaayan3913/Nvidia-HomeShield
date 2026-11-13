import { beforeEach, describe, expect, it } from 'vitest';
import { localService as mockService } from './localService';

const contact = { name: 'Resident', contact_number: '07000 000000', preferred_contact: 'text' as const };

describe('local data service', () => {
  beforeEach(() => mockService.reset());

  it('creates a report and case without persisting media URIs', async () => {
    const result = await mockService.createReport({ text: 'Black mould around the bedroom window', category: 'damp_mould', property_id: 'p-001', contact, evidence: [{ kind: 'photo' }], photo: new Blob(['x']) });
    expect(result.case.property_id).toBe('p-001');
    expect(result.case.evidence.every((item) => item.uri === null)).toBe(true);
    expect(result.case.evidence.map((item) => item.kind)).toEqual(['photo', 'photo']);
  });

  it('keeps proposals inactive until approval', async () => {
    const { case: created } = await mockService.createReport({ text: 'A leak under the bath', category: 'leak', property_id: 'p-003', contact });
    const before = mockService.getState().active_plan?.id;
    const proposal = await mockService.generateScheduleProposal(created.id);
    expect(mockService.getState().active_plan?.id).toBe(before);
    await mockService.approveProposal(proposal.id);
    expect(mockService.getState().active_plan?.id).toBe(proposal.id);
  });

  it('creates one deterministic emergency proposal', async () => {
    const first = await mockService.simulateEmergency();
    const second = await mockService.simulateEmergency();
    expect(first.case.id).toBe('HS-EMERGENCY-1');
    expect(second.proposal.id).toBe(first.proposal.id);
  });

  it('keeps unrelated assignments when an emergency re-plan is approved', async () => {
    const { proposal } = await mockService.simulateEmergency();
    await mockService.approveProposal(proposal.id);
    const active = mockService.getState().assignments.filter((a) => a.active).map((a) => a.job_id);
    expect(active).toEqual(expect.arrayContaining(['job-emergency-1', 'j-041', 'j-042']));
  });

  it('validates progress transitions and records the evidence count', async () => {
    await expect(mockService.updateJobProgress('j-041', 'completed', 'done')).rejects.toThrow(/cannot move/);
    await mockService.updateJobProgress('j-041', 'travelling');
    await mockService.updateJobProgress('j-041', 'on_site');
    await expect(mockService.updateJobProgress('j-041', 'completed')).rejects.toThrow(/short note/);
    const job = await mockService.updateJobProgress('j-041', 'completed', 'Fixed', 2);
    expect(job.evidence_count).toBe(2);
    await expect(mockService.updateJobProgress('j-041', 'on_site')).rejects.toThrow(/cannot move/);
  });

  it('searches properties by postcode district or address', async () => {
    expect((await mockService.findProperties('S5 1AA')).every((p) => p.postcode.startsWith('S5'))).toBe(true);
    expect((await mockService.findProperties('rowan'))[0]?.id).toBe('p-001');
  });
});
