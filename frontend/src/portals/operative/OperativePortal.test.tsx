// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockService } from '../../shared/mock';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import type { Job } from '../../shared/types/domain';
import { OperativePortal } from './OperativePortal';
import { titleOf, workItemsFor } from './model';

const renderPortal = (worker: string | null = 'w-2') => render(<MemoryRouter initialEntries={[worker ? `/operative?worker=${worker}` : '/operative']}><NotificationProvider><OperativePortal /></NotificationProvider></MemoryRouter>);
const job = (id: string) => mockService.getState().jobs.find((j) => j.id === id)!;
const contact = { name: 'Resident', contact_number: '0', preferred_contact: 'text' as const, access_notes: 'Key safe by door' };

describe('operative dashboard', () => {
  beforeEach(async () => { await mockService.reset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps pending proposals out of assignments until approved, and joins by ID', async () => {
    const { case: created } = await mockService.createReport({ text: 'Mould on bedroom wall', category: 'damp_mould', property_id: 'p-001', contact });
    const proposal = await mockService.generateScheduleProposal(created.id);
    const worker = proposal.workers[0]!.worker_id;
    expect(workItemsFor(mockService.getState(), worker).map((i) => i.case?.id)).not.toContain(created.id);
    await mockService.approveProposal(proposal.id);
    const item = workItemsFor(mockService.getState(), worker).find((i) => i.case?.id === created.id)!;
    expect(item.property?.display_address).toBe('14 Rowan Court');
    expect(item.report?.contact.access_notes).toBe('Key safe by door');
  });

  it('labels the scheduler’s planned work that has no resident case', () => {
    const planned = { id: 'j-001', case_id: 'case-seed-001', source: 'planned', hazard_type: 'leak' } as Job;
    expect(titleOf({ job: planned, eta: '', sequence: 0 })).toBe('Planned leak maintenance visit');
  });

  it('shows the next job and switches operative', () => {
    renderPortal();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dan Clarke');
    expect(screen.getAllByText('8 Norfolk View').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Viewing as'), { target: { value: 'w-3' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Priya Patel');
    expect(screen.getAllByText('51 Darnall Lane').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Viewing as'), { target: { value: 'w-1' } });
    expect(screen.getByText('No active assignments')).toBeTruthy();
    expect(screen.queryByText(/demonstration|fictional/i)).toBeNull();
  });

  it('awaits each progress step and requires completion notes', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Start travelling' }));
    await screen.findByRole('button', { name: 'Arrived on site' });
    expect(job('j-041').status).toBe('travelling');
    fireEvent.click(screen.getByRole('button', { name: 'Arrived on site' }));
    await screen.findByRole('button', { name: 'Complete job' });
    expect(mockService.getState().cases.find((c) => c.id === 'HS-26041')!.status).toBe('in_progress');
    fireEvent.click(screen.getByRole('button', { name: 'Complete job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completed' }));
    expect(screen.getByRole('alert').textContent).toMatch(/short note/);
    expect(job('j-041').status).toBe('on_site');
    fireEvent.change(screen.getByLabelText('Completion notes'), { target: { value: 'Replaced trap seal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completed' }));
    await screen.findByText(/All assigned jobs are finished/);
    expect(job('j-041')).toMatchObject({ status: 'completed', completion_notes: 'Replaced trap seal' });
    expect(document.activeElement?.id).toBe('op-detail-heading');
  });

  it('shows a readable error with retry when an update fails', async () => {
    const spy = vi.spyOn(mockService, 'updateJobProgress').mockRejectedValueOnce(new Error('Cannot reach HomeShield.'));
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Start travelling' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Travelling was not saved: Cannot reach HomeShield/);
    expect(job('j-041').status).toBe('assigned');
    spy.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Arrived on site' });
    expect(job('j-041').status).toBe('travelling');
  });

  it('records an unable-to-complete reason', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Unable to complete' }));
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Nobody home at 10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unable to complete' }));
    await waitFor(() => expect(job('j-041').completion_notes).toBe('No access to property: Nobody home at 10:30'));
  });

  it('updates live and explains the route change when an emergency re-plan is approved', async () => {
    renderPortal();
    let planId = '';
    await act(async () => { planId = (await mockService.simulateEmergency()).proposal.id; });
    expect(screen.queryByText(/42 Park Hill View/)).toBeNull();
    await act(async () => { await mockService.approveProposal(planId); });
    expect(screen.getByText('Your route has changed')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/emergency re-plan.*Added: HS-EMERGENCY-1/i);
    expect(screen.getAllByText(/42 Park Hill View/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 Norfolk View').length).toBeGreaterThan(0); // existing work is kept
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss route change' }));
    expect(screen.queryByText('Your route has changed')).toBeNull();
  });

  it('does not claim a route change after a reset', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Start travelling' }));
    await screen.findByRole('button', { name: 'Arrived on site' });
    await act(async () => { await mockService.reset(); });
    expect(screen.queryByText('Your route has changed')).toBeNull();
  });

  it('explains an earlier re-plan when the page is opened afterwards', async () => {
    await mockService.approveProposal((await mockService.simulateEmergency()).proposal.id);
    renderPortal();
    expect(screen.getByText(/Your route was updated by an emergency re-plan/)).toBeTruthy();
  });

  it('returns focus to the actions when the confirmation is cancelled with Escape', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Unable to complete' }));
    fireEvent.keyDown(screen.getByLabelText('What happened'), { key: 'Escape' });
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement?.textContent).toBe('Start travelling');
  });

  it('defaults to an operative with assignments and lets another job be selected', async () => {
    const { proposal } = await mockService.simulateEmergency();
    await mockService.approveProposal(proposal.id);
    renderPortal(null);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dan Clarke');
    const items = screen.getAllByRole('button', { name: /Norfolk View|Park Hill View/ });
    expect(items.length).toBe(2);
    const other = items.find((b) => b.getAttribute('aria-current') !== 'true')!;
    fireEvent.click(other);
    expect(other.getAttribute('aria-current')).toBe('true');
  });
});
