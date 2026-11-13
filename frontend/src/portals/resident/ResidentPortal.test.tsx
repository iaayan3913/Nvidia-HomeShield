// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockService, type Case, type Report } from '../../shared/mock';
import { homeShieldService } from '../../shared/data';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { ResidentPortal } from './ResidentPortal';
import { clearSession } from './session';

const renderPortal = (path = '/report') => render(<MemoryRouter initialEntries={[path]}><NotificationProvider><ResidentPortal /></NotificationProvider></MemoryRouter>);
const continueStep = () => fireEvent.click(screen.getByRole('button', { name: /continue/i }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function fillToReview({ manualAddress = false, withPhoto = false } = {}) {
  fireEvent.click(screen.getByLabelText(/damp or mould/i));
  type('Describe the problem', 'Black mould spreading around the bedroom window');
  continueStep();
  if (withPhoto) {
    const file = new File(['image-bytes'], 'IMG_0001.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/take or choose a photo/i, { selector: 'input' }), { target: { files: [file] } });
    await screen.findByRole('button', { name: 'Remove photo' });
  }
  continueStep();
  if (manualAddress) {
    fireEvent.click(screen.getByRole('button', { name: /my address isn’t listed/i }));
    type('First line of your address', '3 New Build Mews');
    type('Postcode', 's11 8aa');
  } else {
    type('Postcode or address', 'S5 8QJ');
    fireEvent.click(screen.getByRole('button', { name: /find address/i }));
    fireEvent.click(await screen.findByLabelText(/14 Rowan Court/));
  }
  continueStep();
  type('Your name', 'Sam Resident');
  type('Phone number', '07700 900123');
  fireEvent.click(screen.getByLabelText('Text message'));
  continueStep();
  expect(screen.getByRole('heading', { name: 'Check and send your report' })).toBeTruthy();
}

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
const fakeResult = (id = 'HS-77777'): { report: Report; case: Case; plan: null; approval: null; warnings: string[] } => {
  const real = mockService.getState().cases[0]!;
  return { report: { id: 'report-x', text: '', category: 'damp_mould', property_id: '', contact: { name: '', contact_number: '', preferred_contact: 'text' }, evidence: [], submitted_at: real.created_at, simulated: true }, case: { ...real, id, hazard_type: 'damp_mould', severity: 'moderate', is_emergency: false }, plan: null, approval: null, warnings: [] };
};

describe('Resident app', () => {
  beforeAll(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:test-${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  beforeEach(() => { mockService.reset(); clearSession(); sessionStorage.clear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('uses real-service language and shows test mode only for simulated services', () => {
    renderPortal();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/fictional|demonstration/i);
    expect(text).toContain('Test mode.');
    expect(text).toContain('0800 111 999');
  });

  it('shows errors at the relevant step', () => {
    renderPortal();
    continueStep();
    expect(screen.getByText('Choose the type of problem.', { selector: 'a' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/damp or mould/i));
    continueStep();
    continueStep();
    expect(screen.getAllByText(/add a photo or voice note/i).length).toBeGreaterThan(0);
  });

  it('searches for an address, shows no-match and supports the not-listed path', async () => {
    renderPortal();
    fireEvent.click(screen.getByLabelText(/leak or flooding/i));
    type('Describe the problem', 'Water coming through the kitchen ceiling');
    continueStep(); continueStep();
    continueStep();
    expect(screen.getByText(/search for your postcode or address and choose your home/i, { selector: 'a' })).toBeTruthy();
    type('Postcode or address', 'ZZ9');
    fireEvent.click(screen.getByRole('button', { name: /find address/i }));
    expect(await screen.findByText(/no homes match/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /my address isn’t listed/i }));
    type('First line of your address', '3 New Build Mews');
    type('Postcode', 'S11');
    continueStep();
    expect(screen.getByText('Enter a full UK postcode, like S1 2AB.', { selector: 'a' })).toBeTruthy();
    type('Postcode', 's11 8aa');
    continueStep();
    expect(screen.getByRole('heading', { name: 'How can we contact you?' })).toBeTruthy();
  });

  it('submits a not-listed address through the structured address fields', async () => {
    const spy = vi.spyOn(mockService, 'createReport').mockImplementation(() => fakeResult('HS-55555'));
    renderPortal();
    await fillToReview({ manualAddress: true });
    fireEvent.click(screen.getByRole('button', { name: /submit repair report/i }));
    expect(await screen.findByText('HS-55555')).toBeTruthy();
    const input = spy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(input.address_line).toBe('3 New Build Mews');
    expect(input.postcode).toBe('S11 8AA');
    expect(mockService.getState().properties.some((property) => property.id === input.property_id)).toBe(true);
  });

  it('shows a pending state, blocks double submission and recovers from an error with retry', async () => {
    const first = deferred<ReturnType<typeof fakeResult>>();
    const spy = vi.spyOn(homeShieldService, 'createReport')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => fakeResult('HS-88888'));
    renderPortal();
    await fillToReview({ withPhoto: true });
    const submit = screen.getByRole('button', { name: /submit repair report/i });
    fireEvent.click(submit); fireEvent.click(submit); fireEvent.click(submit);
    const pending = await screen.findByRole('button', { name: /sending report/i });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0];
    const media = spy.mock.calls[0]![1];
    expect(media?.photos?.[0]).toBeInstanceOf(Blob);
    expect(input.property_id).toBe('p-001');

    await act(async () => { first.reject(new Error('500')); await first.promise.catch(() => undefined); });
    expect(await screen.findByText('Your report was not sent')).toBeTruthy();
    expect(screen.queryByText(/has been sent/i)).toBeNull();
    const saved = sessionStorage.getItem('homeshield.resident.session.v2') ?? '';
    expect(saved).toContain('Black mould spreading');
    expect(saved).not.toContain('blob:');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('HS-88888')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Report sent. Your reference is HS-88888.')).toBeTruthy();
  });

  it('submits a mould report to the shared service and tracks it live through every stage', async () => {
    renderPortal();
    await fillToReview();
    fireEvent.click(screen.getByRole('button', { name: /submit repair report/i }));
    await screen.findByRole('heading', { name: /has been sent/i });
    const created = mockService.getState().cases[0]!;
    expect(screen.getByText(created.id, { selector: 'strong' })).toBeTruthy();
    expect(mockService.getState().reports).toHaveLength(1);
    expect(localStorage.getItem('homeshield.demo-state.v1')).not.toContain('blob:');

    fireEvent.click(screen.getByRole('button', { name: /track this report/i }));
    expect(screen.getByText(new RegExp(`Looking up ${created.id}`))).toBeTruthy();
    expect(await screen.findByText('Your report is being reviewed')).toBeTruthy();

    const job = mockService.getState().jobs.find((item) => item.case_id === created.id)!;
    await act(async () => { const plan = await mockService.generateScheduleProposal(created.id); await mockService.approveProposal(plan.id); });
    expect(await screen.findByText('A repair visit has been scheduled')).toBeTruthy();
    await act(async () => { await mockService.updateJobProgress(job.id, 'travelling'); });
    expect(await screen.findByText('Your operative is on the way')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Hussain/);
    await act(async () => { await mockService.updateJobProgress(job.id, 'on_site'); });
    expect(await screen.findByText('Your operative is at your home')).toBeTruthy();
    await act(async () => { await mockService.updateJobProgress(job.id, 'unable_to_complete'); });
    expect(await screen.findByText('The repair could not be completed on this visit')).toBeTruthy();
    await act(async () => { await mockService.updateJobProgress(job.id, 'completed'); });
    expect(await screen.findByText('Repair completed')).toBeTruthy();
  });

  it('handles unknown references when tracking', async () => {
    renderPortal('/report?view=track&ref=HS-99999');
    expect(await screen.findByText(/could not find HS-99999/i)).toBeTruthy();
    type('Report reference', 'not a ref');
    fireEvent.click(screen.getByRole('button', { name: /find report/i }));
    expect(screen.getByText('Check the reference. It looks like HS-26043.')).toBeTruthy();
  });

  it('sends one photo and explains when more were chosen', async () => {
    renderPortal();
    fireEvent.click(screen.getByLabelText(/damp or mould/i));
    continueStep();
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })];
    fireEvent.change(screen.getByLabelText(/take or choose a photo/i, { selector: 'input' }), { target: { files } });
    expect(await screen.findByText(/one photo with each report/i)).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.rp-thumb img')).toHaveLength(1));
  });
});
