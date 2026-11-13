import { beforeEach, describe, expect, it } from 'vitest';
import { mockService } from './mockService';

describe('shared mock workflow', () => {
  beforeEach(() => mockService.reset());
  it('creates a report and case without persisting media URIs', () => {
    const result = mockService.createReport({ text:'Black mould around the bedroom window', category:'damp_mould', property_id:'p-001', contact:{name:'Demo Resident',contact_number:'07000 000000',preferred_contact:'text'}, evidence:[{kind:'photo'}] });
    expect(result.case.property_id).toBe('p-001');
    expect(result.case.evidence[0]?.uri).toBeNull();
  });
  it('keeps proposals inactive until approval', () => {
    const { case: created } = mockService.createReport({ text:'A leak under the bath',category:'leak',property_id:'p-003',contact:{name:'Demo Resident',contact_number:'07000 000000',preferred_contact:'phone'} });
    const before = mockService.getState().active_plan?.id;
    const proposal = mockService.generateScheduleProposal(created.id);
    expect(mockService.getState().active_plan?.id).toBe(before);
    mockService.approveProposal(proposal.id);
    expect(mockService.getState().active_plan?.id).toBe(proposal.id);
  });
  it('creates one deterministic emergency proposal', () => {
    const first = mockService.simulateEmergency();
    const second = mockService.simulateEmergency();
    expect(first.case.id).toBe('HS-EMERGENCY-1');
    expect(second.proposal.id).toBe(first.proposal.id);
  });
});
