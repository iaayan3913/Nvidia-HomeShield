import { BrickWall, CircleHelp, CloudFog, DoorOpen, Droplets, Flame, Thermometer, Zap, type LucideIcon } from 'lucide-react';
import type { ContactMethod, HazardType } from '../../shared/mock';

/** Resident-facing problem categories. Several map onto the shared `other` hazard type. */
export type ResidentCategoryId = 'damp_mould' | 'leak' | 'electrical' | 'heating' | 'gas' | 'doors_windows' | 'structural' | 'other';

export interface ResidentCategory {
  id: ResidentCategoryId;
  hazard: HazardType;
  label: string;
  hint: string;
  icon: LucideIcon;
  safety?: { tone: 'danger' | 'warning' | 'info'; title: string; points: string[] };
}

export const CATEGORIES: ResidentCategory[] = [
  { id: 'damp_mould', hazard: 'damp_mould', label: 'Damp or mould', hint: 'Black spots, musty smell, condensation, peeling paint', icon: CloudFog,
    safety: { tone: 'info', title: 'While you wait', points: ['Do not try to scrub large areas of mould yourself.', 'Keep rooms ventilated where you safely can.', 'Tell us if anyone in your home has breathing problems or is very young or elderly.'] } },
  { id: 'leak', hazard: 'leak', label: 'Leak or flooding', hint: 'Dripping pipes, water through a ceiling, overflowing tank', icon: Droplets,
    safety: { tone: 'warning', title: 'If water is near electrics', points: ['Do not touch switches, sockets or appliances that are wet.', 'If it is safe, turn off the water at the stop tap and the power at the fuse box.'] } },
  { id: 'electrical', hazard: 'electrical', label: 'Electrical', hint: 'Sparking or warm sockets, lights failing, tripping fuses', icon: Zap,
    safety: { tone: 'warning', title: 'Electrical safety', points: ['Stop using the socket or appliance.', 'If you see smoke, sparks or fire, leave and call 999.'] } },
  { id: 'heating', hazard: 'other', label: 'Heating or hot water', hint: 'No heating, no hot water, boiler faults', icon: Thermometer,
    safety: { tone: 'info', title: 'Staying warm', points: ['Tell us if anyone in your home is elderly, unwell or a young child.', 'If you also smell gas, call 0800 111 999 straight away.'] } },
  { id: 'gas', hazard: 'gas', label: 'Gas', hint: 'Smell of gas, carbon monoxide alarm, faulty gas appliance', icon: Flame,
    safety: { tone: 'danger', title: 'If you smell gas, call 0800 111 999 now', points: ['Do not use switches, flames or electrical items.', 'Open doors and windows and turn off the gas at the meter if you can.', 'Leave the property. If anyone feels unwell or there is a fire, call 999.', 'Report it here only after you have called the emergency line.'] } },
  { id: 'doors_windows', hazard: 'other', label: 'Doors, windows or locks', hint: 'Broken locks, windows that will not close, damaged front door', icon: DoorOpen,
    safety: { tone: 'info', title: 'Keeping secure', points: ['If your home cannot be secured and you feel unsafe, contact the police on 101, or 999 in an emergency.'] } },
  { id: 'structural', hazard: 'other', label: 'Structural damage', hint: 'Cracks, sagging ceilings, loose stairs or balconies', icon: BrickWall,
    safety: { tone: 'warning', title: 'Keep clear', points: ['Keep everyone away from ceilings, walls or stairs that might fall.', 'If something has collapsed or someone is hurt, call 999.'] } },
  { id: 'other', hazard: 'other', label: 'Something else', hint: 'Any other repair or safety worry in your home', icon: CircleHelp },
];

export const categoryById = (id: ResidentCategoryId | '') => CATEGORIES.find((item) => item.id === id);

export const ROOMS = ['Kitchen', 'Bathroom or toilet', 'Bedroom', 'Living room', 'Hallway or stairs', 'Several rooms', 'Outside or shared area'];

export const CONTACT_METHODS: Array<{ id: Extract<ContactMethod, 'phone' | 'text'>; label: string }> = [
  { id: 'phone', label: 'Phone call' },
  { id: 'text', label: 'Text message' },
];

export interface ReportDraft {
  category: ResidentCategoryId | '';
  room: string;
  description: string;
  propertyId: string;
  name: string;
  phone: string;
  preferredContact: ContactMethod | '';
  accessNotes: string;
}

export const emptyDraft = (): ReportDraft => ({ category: '', room: '', description: '', propertyId: '', name: '', phone: '', preferredContact: '', accessNotes: '' });

export const STEPS = [
  { id: 'problem', label: 'Problem' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'details', label: 'Home and contact' },
  { id: 'review', label: 'Review' },
] as const;
export type StepIndex = 0 | 1 | 2 | 3;

export type FieldErrors = Partial<Record<keyof ReportDraft | 'evidence', string>>;

export interface EvidenceSummary { photos: number; voiceNotes: number }

const phoneDigits = (value: string) => value.replace(/\D/g, '');

export function validateStep(step: StepIndex, draft: ReportDraft, evidence: EvidenceSummary): FieldErrors {
  const errors: FieldErrors = {};
  const description = draft.description.trim();
  if (step === 0 || step === 3) {
    if (!draft.category) errors.category = 'Choose the type of problem.';
    if (description && description.length < 10) errors.description = 'Add a little more detail (at least 10 characters), or leave this blank and add a photo or voice note next.';
  }
  if (step === 1 || step === 3) {
    if (!description && evidence.photos + evidence.voiceNotes === 0) errors.evidence = 'Add a photo or voice note, or go back and describe the problem in writing.';
  }
  if (step === 2 || step === 3) {
    if (!draft.propertyId) errors.propertyId = 'Choose the demonstration property.';
    if (draft.name.trim().length < 2) errors.name = 'Enter your name.';
    const digits = phoneDigits(draft.phone);
    if (!draft.phone.trim()) errors.phone = 'Enter a contact number.';
    else if (!/^[+\d\s()-]+$/.test(draft.phone.trim()) || digits.length < 10 || digits.length > 13) errors.phone = 'Enter a UK phone number, like 07700 900123.';
    if (!draft.preferredContact) errors.preferredContact = 'Choose how you would like us to contact you.';
  }
  return errors;
}

/** Text sent to the mock service. Mapped categories keep their resident-facing label so officers see it. */
export function composeReportText(draft: ReportDraft): string {
  const category = categoryById(draft.category);
  const description = draft.description.trim();
  const parts: string[] = [];
  if (category && category.hazard === 'other' && category.id !== 'other') parts.push(`${category.label}: ${description || 'reported with photo or voice evidence'}`);
  else if (description) parts.push(description);
  if (draft.room) parts.push(`Room: ${draft.room}.`);
  return parts.join(' ');
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
