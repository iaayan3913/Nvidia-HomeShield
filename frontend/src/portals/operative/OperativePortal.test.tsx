// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockService } from '../../shared/mock';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { OperativePortal } from './OperativePortal';
import { workItemsFor } from './model';

const renderPortal = (worker = 'w-2') => render(<MemoryRouter initialEntries={[`/operative?worker=${worker}`]}><NotificationProvider><OperativePortal /></NotificationProvider></MemoryRouter>);
const nextHeading = () => screen.getByRole('heading', { level: 2, name: 'Next job' });

describe('operative portal', () => {
  beforeEach(() => mockService.reset());
  afterEach(cleanup);

  it('keeps pending proposals out of assignments until approved', () => {
    const { case: created } = mockService.createReport({ text: 'Mould on bedroom wall', category: 'damp_mould', property_id: 'p-001', contact: { name: 'Demo', contact_number: '0', preferred_contact: 'text', access_notes: 'Key safe by door' } });
    const proposal = mockService.generateScheduleProposal(created.id);
    const worker = proposal.workers[0]!.worker_id;
    expect(workItemsFor(mockService.getState(), worker).map((i) => i.case?.id)).not.toContain(created.id);
    mockService.approveProposal(proposal.id);
    const items = workItemsFor(mockService.getState(), worker);
    expect(items.map((i) => i.case?.id)).toContain(created.id);
    expect(items[0]!.property?.display_address).toBe('14 Rowan Court');
    expect(items[0]!.report?.contact.access_notes).toBe('Key safe by door');
  });

  it('shows the joined next job and switches worker', () => {
    renderPortal();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dan Clarke');
    expect(screen.getByText('8 Norfolk View')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Viewing as (demonstration user)'), { target: { value: 'w-3' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Priya Patel');
    expect(screen.getByText('51 Darnall Lane')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Viewing as (demonstration user)'), { target: { value: 'w-1' } });
    expect(screen.getByText('No active assignments')).toBeTruthy();
  });

  it('progresses a job and requires completion notes', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Start travelling' }));
    expect(mockService.getState().jobs.find((j) => j.id === 'j-041')!.status).toBe('travelling');
    fireEvent.click(screen.getByRole('button', { name: 'Arrived on site' }));
    expect(mockService.getState().cases.find((c) => c.id === 'HS-26041')!.status).toBe('in_progress');
    fireEvent.click(screen.getByRole('button', { name: 'Complete job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completed' }));
    expect(screen.getByRole('alert').textContent).toMatch(/short note/);
    expect(mockService.getState().jobs.find((j) => j.id === 'j-041')!.status).toBe('on_site');
    fireEvent.change(screen.getByLabelText('Completion notes'), { target: { value: 'Replaced trap seal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm completed' }));
    const job = mockService.getState().jobs.find((j) => j.id === 'j-041')!;
    expect(job.status).toBe('completed');
    expect(job.completion_notes).toBe('Replaced trap seal');
    expect(screen.getByText('All assigned jobs finished')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(nextHeading()));
  });

  it('records an unable-to-complete reason', () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Unable to complete' }));
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Nobody home at 10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unable to complete' }));
    expect(mockService.getState().jobs.find((j) => j.id === 'j-041')!.completion_notes).toBe('No access to property: Nobody home at 10:30');
  });

  it('updates live and explains the route change when an emergency re-plan is approved', () => {
    renderPortal();
    let planId = '';
    act(() => { planId = mockService.simulateEmergency().proposal.id; });
    expect(screen.queryByText('42 Park Hill View')).toBeNull();
    act(() => { mockService.approveProposal(planId); });
    expect(screen.getByText('Your route has changed')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/emergency re-plan.*Added: HS-EMERGENCY-1/i);
    expect(screen.getByText('42 Park Hill View')).toBeTruthy();
    expect(screen.getAllByText('Emergency').length).toBeGreaterThan(0);
    act(() => { mockService.reset(); });
    expect(screen.queryByText(/approved by Operations/)).toBeTruthy(); // banner stays until dismissed
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss route change' }));
    expect(screen.queryByText('Your route has changed')).toBeNull();
  });

  it('does not claim a route change after a demo reset', () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Start travelling' }));
    act(() => { mockService.reset(); });
    expect(screen.queryByText('Your route has changed')).toBeNull();
  });

  it('explains an earlier re-plan when the page is opened afterwards', () => {
    mockService.approveProposal(mockService.simulateEmergency().proposal.id);
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

  it('defaults to a worker with assignments when no worker is chosen', () => {
    render(<MemoryRouter initialEntries={['/operative']}><NotificationProvider><OperativePortal /></NotificationProvider></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dan Clarke');
  });
});
