// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  createReport: vi.fn(),
  findProperties: vi.fn(),
}));

vi.mock('../../shared/data', () => ({
  dataSourceMode: 'mock',
  homeShieldService: {
    createReport: shared.createReport,
    findProperties: shared.findProperties,
  },
  useConnection: vi.fn(),
  useDemoState: vi.fn(),
  useTrackedCase: vi.fn(),
}));

import { findProperties, submitReport, type ResidentReportInput } from './contract';

const input = (): ResidentReportInput => ({
  property_id: 'p-001',
  category: 'leak',
  text: 'Water is coming through the ceiling.',
  contact: { name: 'Resident', contact_number: '07000000000', preferred_contact: 'text' },
});

describe('resident shared data contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits reports and media through the selected shared service', async () => {
    const photo = new File(['photo'], 'leak.jpg', { type: 'image/jpeg' });
    const audio = new Blob(['audio'], { type: 'audio/webm' });
    const result = { report: { id: 'report-1' }, case: { id: 'case-1' }, warnings: [] };
    shared.createReport.mockResolvedValue(result);

    await expect(submitReport({ ...input(), photo, audio })).resolves.toEqual(result);
    expect(shared.createReport).toHaveBeenCalledWith(expect.objectContaining({ photo, audio }), {
      photos: [photo],
      audio,
    });
  });

  it('searches properties through the selected shared service', async () => {
    const matches = [{ id: 'p-001' }];
    shared.findProperties.mockResolvedValue(matches);

    await expect(findProperties('S5 1AA')).resolves.toBe(matches);
    expect(shared.findProperties).toHaveBeenCalledWith('S5 1AA');
  });
});
