import { describe, expect, it } from 'vitest';
import { trackingStage } from './caseLabels';
import { composeReportText, emptyDraft, normalisePostcode, validateStep, type ReportDraft } from './model';

const filled = (patch: Partial<ReportDraft> = {}): ReportDraft => ({
  ...emptyDraft(), category: 'damp_mould', description: 'Black mould around the bedroom window',
  home: { id: 'p-001', display_address: '14 Rowan Court', postcode: 'S5 8QJ' }, name: 'Sam Resident', phone: '07700 900123', preferredContact: 'text', ...patch,
});
const none = { photos: 0, voiceNotes: 0 };

describe('resident validation', () => {
  it('requires a category on the problem step', () => {
    expect(validateStep(0, emptyDraft(), none).category).toBeDefined();
  });
  it('requires a description or evidence on the evidence step', () => {
    expect(validateStep(1, filled({ description: '' }), none).evidence).toBeDefined();
    expect(validateStep(1, filled({ description: '' }), { photos: 1, voiceNotes: 0 }).evidence).toBeUndefined();
    expect(validateStep(1, filled({ description: '' }), { photos: 0, voiceNotes: 1 }).evidence).toBeUndefined();
    expect(validateStep(1, filled(), none).evidence).toBeUndefined();
  });
  it('requires a chosen home when searching', () => {
    expect(validateStep(2, filled({ home: null }), none).home).toBeDefined();
    expect(validateStep(2, filled(), none)).toEqual({});
  });
  it('validates a not-listed address with a loose UK postcode check', () => {
    const manual = (addressLine: string, postcode: string) => validateStep(2, filled({ home: null, addressMode: 'manual', addressLine, postcode }), none);
    expect(Object.keys(manual('', '')).sort()).toEqual(['addressLine', 'postcode']);
    expect(manual('12 Example Street', 'S1').postcode).toMatch(/full UK postcode/);
    expect(manual('12 Example Street', 'not a postcode').postcode).toBeDefined();
    for (const ok of ['S1 2AB', 's12ab', 'SW1A 1AA', 'M1 1AE', 'B33 8TH']) expect(manual('12 Example Street', ok)).toEqual({});
  });
  it('validates name, phone and preferred contact', () => {
    expect(Object.keys(validateStep(3, emptyDraft(), none)).sort()).toEqual(['name', 'phone', 'preferredContact']);
    expect(validateStep(3, filled({ phone: '123' }), none).phone).toBeDefined();
    expect(validateStep(3, filled({ phone: '0770O 900123' }), none).phone).toBeDefined();
    expect(validateStep(3, filled({ phone: '+44 7700 900123' }), none).phone).toBeUndefined();
  });
  it('validates every step at review', () => {
    expect(validateStep(4, filled(), none)).toEqual({});
    expect(Object.keys(validateStep(4, emptyDraft(), none)).sort()).toEqual(['category', 'evidence', 'home', 'name', 'phone', 'preferredContact']);
  });
});

describe('helpers', () => {
  it('keeps the local label for categories mapped to other', () => {
    expect(composeReportText(filled({ category: 'heating', description: 'No hot water since Monday', room: 'Kitchen' }))).toBe('Heating or hot water: No hot water since Monday Room: Kitchen.');
    expect(composeReportText(filled({ category: 'structural', description: '' }))).toBe('Structural damage: reported with a photo or voice note');
    expect(composeReportText(filled())).toBe('Black mould around the bedroom window');
  });
  it('normalises postcodes', () => {
    expect(normalisePostcode(' s12ab ')).toBe('S1 2AB');
    expect(normalisePostcode('sw1a1aa')).toBe('SW1A 1AA');
  });
  it('maps case and visit state to resident stages', () => {
    expect(trackingStage({ status: 'new' }).index).toBe(0);
    expect(trackingStage({ status: 'awaiting_approval' }).index).toBe(1);
    expect(trackingStage({ status: 'scheduled' }, { status: 'assigned', operativeFirstName: 'Amira' }).index).toBe(2);
    const travelling = trackingStage({ status: 'scheduled' }, { status: 'travelling', operativeFirstName: 'Amira' });
    expect(travelling.index).toBe(3);
    expect(travelling.detail).toContain('Amira');
    expect(trackingStage({ status: 'in_progress' }, { status: 'on_site', operativeFirstName: null }).index).toBe(4);
    expect(trackingStage({ status: 'resolved' }, { status: 'completed', operativeFirstName: null }).outcome).toBe('completed');
    expect(trackingStage({ status: 'scheduled' }, { status: 'unable_to_complete', operativeFirstName: null }).outcome).toBe('unable');
  });
});

describe('report references', () => {
  it('keeps backend references lower-case and local references upper-case', async () => {
    const { normaliseReference } = await import('./model');
    expect(normaliseReference('  CASE-0EDCA98B ')).toBe('case-0edca98b');
    expect(normaliseReference('case-0edca98b')).toBe('case-0edca98b');
    expect(normaliseReference('hs-26043')).toBe('HS-26043');
  });
});
