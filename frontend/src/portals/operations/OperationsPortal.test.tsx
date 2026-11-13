// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockService } from '../../shared/mock';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { OperationsPortal } from './OperationsPortal';

const ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0)';
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', metadata: { source: 'openfreemap-openmaptiles', label: 'Test', attribution: ATTRIBUTION }, features });
const files: Record<string, unknown> = {
  '/data/sheffield-buildings.geojson': collection([{ type: 'Feature', id: 'b1', geometry: { type: 'Polygon', coordinates: [[[-1.4489, 53.3687], [-1.4485, 53.3687], [-1.4485, 53.3689], [-1.4489, 53.3689], [-1.4489, 53.3687]]] }, properties: { height: 12 } }]),
  '/data/sheffield-roads.geojson': collection([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-1.47, 53.38], [-1.46, 53.38]] }, properties: { highway: 'primary' } }]),
  '/data/sheffield-places.geojson': collection([{ type: 'Feature', geometry: { type: 'Point', coordinates: [-1.47, 53.38] }, properties: { name: 'City Centre', place: 'suburb' } }]),
};

function renderPortal() {
  return render(<NotificationProvider><OperationsPortal /></NotificationProvider>);
}

beforeEach(() => {
  localStorage.clear();
  mockService.reset();
  document.documentElement.dataset.theme = 'dark';
  // jsdom has no WebGL, so the portal must use the 2D view.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (files[url] ? new Response(JSON.stringify(files[url]), { status: 200 }) : new Response('<!doctype html>', { status: 200 }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; });

const caseButton = (id: string) => screen.getByRole('button', { name: new RegExp(`^${id}`) });
const details = () => screen.getByRole('region', { name: 'Case details and activity' });
const stat = (label: string) => within(screen.getByRole('region', { name: 'Operational summary' })).getByText(label).nextElementSibling;

describe('Operations portal', () => {
  it('shows live stats, local data attribution and a usable 2D view without WebGL', async () => {
    renderPortal();
    expect(await screen.findByRole('img', { name: /2D map of central Sheffield/ })).toBeInTheDocument();
    expect(stat('Open cases')).toHaveTextContent('2');
    expect(screen.getByText(/WebGL2 is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Local data: OpenFreeMap © OpenMapTiles Data from OpenStreetMap/)).toBeInTheDocument();
    expect(screen.getByText('Local data')).toBeInTheDocument(); // connection indicator in local mode
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.queryByText(/fictional|synthetic housing stock/i)).not.toBeInTheDocument();
  });

  it('pans and zooms the 2D view from the keyboard and buttons without errors', async () => {
    renderPortal();
    const canvas = await screen.findByRole('img', { name: /2D map/ });
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    fireEvent.keyDown(canvas, { key: '+' });
    fireEvent.click(within(screen.getByRole('toolbar', { name: '2D map controls' })).getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(within(screen.getByRole('toolbar', { name: '2D map controls' })).getByRole('button', { name: /Reset view/ }));
    expect(canvas).toBeInTheDocument();
  });

  it('selects a case from the list and shows synchronised details', async () => {
    renderPortal();
    fireEvent.click(caseButton('HS-26042'));
    expect(within(details()).getByRole('heading', { name: 'HS-26042' })).toBeInTheDocument();
    expect(within(details()).getByText(/Priya Patel/)).toBeInTheDocument();
    expect(within(details()).getByText(/not an official HHSRS determination/)).toBeInTheDocument();
    expect(caseButton('HS-26042')).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches between the Cases and Layers tabs and toggles layers', async () => {
    renderPortal();
    fireEvent.click(screen.getByRole('tab', { name: 'Layers' }));
    const density = screen.getByRole('checkbox', { name: /Case density/ });
    expect(density).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Hazard columns/ })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hazard columns/ }));
    expect(screen.getByRole('checkbox', { name: /Hazard columns/ })).not.toBeChecked();
    expect(screen.getByText('Gas')).toBeInTheDocument(); // hazard legend names every type
    fireEvent.click(screen.getByRole('tab', { name: /Cases/ }));
    expect(caseButton('HS-26041')).toBeInTheDocument();
  });

  it('shows a new report without reload, then proposes, rejects and approves with human review', async () => {
    renderPortal();
    act(() => { mockService.createReport({ text: 'Black mould around the bedroom window', category: 'damp_mould', property_id: 'p-001', contact: { name: 'Resident', contact_number: '07700 900123', preferred_contact: 'text' } }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Locate HS-26043' }));
    expect(within(details()).getByRole('heading', { name: 'HS-26043' })).toBeInTheDocument();

    fireEvent.click(within(details()).getByRole('button', { name: 'Create schedule proposal' }));
    const approve = await screen.findByRole('button', { name: 'Approve and activate' });
    expect(approve).toBeDisabled();
    const firstProposal = mockService.getState().proposals[0]!.id;

    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/brief reason/);
    fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: 'Prefer the local operative' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject proposal' }));
    await waitFor(() => expect(mockService.getState().approvals.find((a) => a.plan_id === firstProposal)?.status).toBe('rejected'));
    expect(mockService.getState().active_plan?.id).toBe('plan-base');
    expect(await screen.findByText(/rejected. The active plan is unchanged/)).toBeInTheDocument();

    fireEvent.click(within(details()).getByRole('button', { name: 'Create schedule proposal' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /I have reviewed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and activate' }));
    await waitFor(() => expect(mockService.getState().active_plan?.id).not.toBe('plan-base'));
    expect(mockService.getState().approvals[0]?.decided_by).toBe('demo-officer');
    expect(await within(details()).findByText(/Amira Hussain · visit 1/)).toBeInTheDocument();
  });

  it('simulates exactly one emergency in test mode, focuses it, and supports approval and reset', async () => {
    const spy = vi.spyOn(mockService, 'simulateEmergency');
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate emergency' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Simulate an emergency?' })).getByRole('button', { name: 'Simulate emergency' }));
    expect(await within(details()).findByRole('heading', { name: 'HS-EMERGENCY-1' })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(stat('Emergencies')).toHaveTextContent('1');
    expect(screen.getByLabelText('Proposed plan')).toHaveTextContent('plan-emergency-replan');
    expect(mockService.getState().active_plan?.id).toBe('plan-base');

    fireEvent.click(screen.getByRole('button', { name: 'Review emergency' }));
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and activate' }));
    await waitFor(() => expect(mockService.getState().active_plan?.id).toBe('plan-emergency-replan'));
    expect(screen.getByLabelText('Active plan')).toHaveTextContent('HS-EMERGENCY-1');

    fireEvent.click(screen.getByRole('button', { name: 'Reset test data' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset the test data?' })).getByRole('button', { name: 'Reset test data' }));
    await waitFor(() => expect(mockService.getState().cases).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Simulate emergency' })).toBeInTheDocument();
  });

  it('collapses and reopens both side panels', () => {
    renderPortal();
    fireEvent.click(screen.getByRole('button', { name: 'Hide cases and layers' }));
    expect(screen.queryByRole('tab', { name: 'Layers' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show cases and layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide details and activity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details and activity' }));
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
  });

  it('keeps the dialog keyboard-operable and cancellable with Escape', () => {
    renderPortal();
    const opener = screen.getByRole('button', { name: 'Reset test data' });
    opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Reset the test data?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
