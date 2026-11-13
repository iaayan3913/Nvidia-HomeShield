// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockService } from '../../shared/mock';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { ResidentPortal } from './ResidentPortal';
import { resetDraft } from './session';

const renderPortal = (path = '/report') => render(<MemoryRouter initialEntries={[path]}><NotificationProvider><ResidentPortal /></NotificationProvider></MemoryRouter>);
const continueStep = () => fireEvent.click(screen.getByRole('button', { name: /continue/i }));

describe('Resident portal', () => {
  beforeAll(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:test-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  beforeEach(() => { mockService.reset(); resetDraft(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('shows errors at the relevant step', () => {
    renderPortal();
    continueStep();
    expect(screen.getByText('Choose the type of problem.', { selector: 'a' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/damp or mould/i));
    continueStep();
    // No description on step 1, so the evidence step needs a photo or voice note.
    continueStep();
    expect(screen.getAllByText(/add a photo or voice note/i).length).toBeGreaterThan(0);
  });

  it('submits a mould report with a photo, creating exactly one case and no persisted media', async () => {
    vi.useFakeTimers();
    const before = mockService.getState().cases.length;
    renderPortal();
    fireEvent.click(screen.getByLabelText(/damp or mould/i));
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: 'Black mould spreading around the bedroom window' } });
    continueStep();

    const file = new File(['fake-image-bytes'], 'mould.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add photos', { selector: 'input' }), { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeTruthy();
    continueStep();

    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'p-001' } });
    expect(screen.getByText('14 Rowan Court')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Demo Resident' } });
    fireEvent.change(screen.getByLabelText('Contact number'), { target: { value: '07700 900123' } });
    fireEvent.click(screen.getByLabelText('Text message'));
    continueStep();

    const submit = screen.getByRole('button', { name: /submit repair report/i });
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole('button', { name: /sending report/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const state = mockService.getState();
    expect(state.cases.length).toBe(before + 1);
    expect(state.reports.length).toBe(1);
    const created = state.cases[0]!;
    expect(created.hazard_type).toBe('damp_mould');
    expect(screen.getByText(created.id)).toBeTruthy();
    expect(screen.getByText(/simulated triage/i)).toBeTruthy();

    const stored = localStorage.getItem('homeshield.demo-state.v1') ?? '';
    expect(stored).not.toContain('blob:');
    expect(stored).not.toContain('fake-image-bytes');
    expect(stored).not.toContain('mould.jpg');
    expect(state.reports[0]!.evidence).toEqual([expect.objectContaining({ kind: 'photo', uri: null })]);
  });

  it('tracks a report by reference and handles unknown references', () => {
    renderPortal('/report?view=track&ref=HS-26041');
    expect(screen.getByText('Repair visit planned')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Report reference'), { target: { value: 'hs-99999' } });
    fireEvent.click(screen.getByRole('button', { name: /find report/i }));
    expect(screen.getByText(/could not find HS-99999/i)).toBeTruthy();
  });
});
