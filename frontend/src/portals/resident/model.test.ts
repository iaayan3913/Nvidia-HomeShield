import { describe, expect, it } from 'vitest';
import { composeReportText, emptyDraft, validateStep, type ReportDraft } from './model';

const filled = (patch: Partial<ReportDraft> = {}): ReportDraft => ({ ...emptyDraft(), category: 'damp_mould', description: 'Black mould around the bedroom window', propertyId: 'p-001', name: 'Demo Resident', phone: '07700 900123', preferredContact: 'text', ...patch });
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
  it('validates property, name, phone and preferred contact', () => {
    const errors = validateStep(2, emptyDraft(), none);
    expect(Object.keys(errors).sort()).toEqual(['name', 'phone', 'preferredContact', 'propertyId']);
    expect(validateStep(2, filled({ phone: '123' }), none).phone).toBeDefined();
    expect(validateStep(2, filled({ phone: '0770O 900123' }), none).phone).toBeDefined();
    expect(validateStep(2, filled({ phone: '+44 7700 900123' }), none).phone).toBeUndefined();
  });
  it('passes a complete draft at review', () => {
    expect(validateStep(3, filled(), none)).toEqual({});
  });
});

describe('composeReportText', () => {
  it('keeps the local label for categories mapped to other', () => {
    expect(composeReportText(filled({ category: 'heating', description: 'No hot water since Monday', room: 'Kitchen' }))).toBe('Heating or hot water: No hot water since Monday Room: Kitchen.');
    expect(composeReportText(filled({ category: 'structural', description: '' }))).toBe('Structural damage: reported with photo or voice evidence');
  });
  it('leaves directly mapped categories unchanged', () => {
    expect(composeReportText(filled())).toBe('Black mould around the bedroom window');
    expect(composeReportText(filled({ description: '' }))).toBe('');
  });
});
