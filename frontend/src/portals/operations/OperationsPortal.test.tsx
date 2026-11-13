// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockService } from '../../shared/mock';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { OperationsPortal } from './OperationsPortal';

const roads = { type: 'FeatureCollection', metadata: { source: 'synthetic', label: 'SYNTHETIC fallback: straight links between district centroids, not real roads' }, features: [
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-1.515, 53.38], [-1.505, 53.36]] }, properties: { name: 'S10-S11' } },
] };
const stock = { type: 'FeatureCollection', metadata: { source: 'synthetic', label: 'Synthetic social-housing stock (not real addresses)' }, features: [
  { type: 'Feature', id: 'p-001', geometry: { type: 'Point', coordinates: [-1.44624, 53.403643] }, properties: { id: 'p-001', district: 'S4', area: 'Pitsmoor', archetype: 'low_rise_flat', floors: 2 } },
] };

function renderPortal() {
  return render(<NotificationProvider><OperationsPortal /></NotificationProvider>);
}

beforeEach(() => {
  localStorage.clear();
  mockService.reset();
  // jsdom has no WebGL, so the portal must fall back to the 2D schematic.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('roads') ? roads : stock), { status: 200 })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const caseButton = (id: string) => screen.getByRole('button', { name: new RegExp(`^${id}`) });

describe('Operations portal', () => {
  it('shows summary, sources and a usable 2D fallback without WebGL', async () => {
    renderPortal();
    const summary = screen.getByLabelText('Operational summary');
    expect(within(summary).getByText('Open cases').nextElementSibling).toHaveTextContent('2');
    expect(await screen.findByRole('img', { name: /Schematic 2D overview/ })).toBeInTheDocument();
    expect(screen.getByText(/WebGL2 is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/SYNTHETIC fallback: straight links/)).toBeInTheDocument();
    expect(screen.getByText('Synthetic housing stock')).toBeInTheDocument();
  });

  it('reports malformed map data while keeping the case list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"type":"Feature"}', { status: 200 })));
    renderPortal();
    expect(await screen.findByText('Map data could not be read')).toBeInTheDocument();
    expect(caseButton('HS-26041')).toBeInTheDocument();
  });

  it('selects a case from the list and opens a synchronised inspector', async () => {
    renderPortal();
    fireEvent.click(caseButton('HS-26042'));
    const inspector = screen.getByRole('region', { name: 'HS-26042' });
    expect(within(inspector).getByText(/Priya Patel/)).toBeInTheDocument();
    expect(within(inspector).getByText('Officer review required · Unverified, simulated')).toBeInTheDocument();
    expect(caseButton('HS-26042')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a new resident report without reload, then proposes, rejects and approves with human review', async () => {
    renderPortal();
    act(() => { mockService.createReport({ text: 'Black mould around the bedroom window', category: 'damp_mould', property_id: 'p-001', contact: { name: 'Demo Resident', contact_number: '07000 000000', preferred_contact: 'text' } }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Locate HS-26043' }));
    const inspector = screen.getByRole('region', { name: 'HS-26043' });

    fireEvent.click(within(inspector).getByRole('button', { name: 'Create schedule proposal' }));
    const approve = await screen.findByRole('button', { name: 'Approve and activate' });
    expect(approve).toBeDisabled();
    expect(screen.getByText('Not carried into this proposal')).toBeInTheDocument();
    const firstProposal = mockService.getState().proposals[0]!.id;

    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/brief reason/);
    fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Prefer the local operative' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(mockService.getState().active_plan?.id).toBe('plan-base');
    expect(mockService.getState().approvals.find((a) => a.plan_id === firstProposal)?.status).toBe('rejected');
    expect(await screen.findByText(/rejected. The active plan is unchanged/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('region', { name: 'HS-26043' })).getByRole('button', { name: 'Create schedule proposal' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /I have reviewed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and activate' }));
    const state = mockService.getState();
    expect(state.active_plan?.id).not.toBe('plan-base');
    expect(state.approvals[0]?.decided_by).toBe('demo-officer');
    expect(within(screen.getByRole('region', { name: 'HS-26043' })).getByText(/Amira Hussain · visit 1/)).toBeInTheDocument();
  });

  it('simulates exactly one emergency, focuses it, and supports approval and reset', async () => {
    const spy = vi.spyOn(mockService, 'simulateEmergency');
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate emergency' }));
    const dialog = screen.getByRole('dialog', { name: 'Simulate an emergency?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Simulate emergency' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('region', { name: 'HS-EMERGENCY-1' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Operational summary')).getByText('Emergencies').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByLabelText('Proposed plan')).toHaveTextContent('plan-emergency-replan');
    expect(mockService.getState().active_plan?.id).toBe('plan-base');

    fireEvent.click(screen.getByRole('button', { name: 'Review emergency' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockService.getState().cases.filter((c) => c.id === 'HS-EMERGENCY-1')).toHaveLength(1);

    fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and activate' }));
    expect(mockService.getState().active_plan?.id).toBe('plan-emergency-replan');
    expect(screen.getByLabelText('Active plan')).toHaveTextContent('HS-EMERGENCY-1');

    fireEvent.click(screen.getByRole('button', { name: 'Reset demo' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset the demonstration?' })).getByRole('button', { name: 'Reset demonstration' }));
    await waitFor(() => expect(mockService.getState().cases).toHaveLength(2));
    expect(screen.queryByRole('region', { name: 'HS-EMERGENCY-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate emergency' })).toBeInTheDocument();
  });

  it('keeps the dialog keyboard-operable and cancellable with Escape', () => {
    renderPortal();
    const opener = screen.getByRole('button', { name: 'Reset demo' });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Reset the demonstration?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
