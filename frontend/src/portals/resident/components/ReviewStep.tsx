import { Pencil } from 'lucide-react';
import { CONTACT_METHODS, categoryById, normalisePostcode, type ReportDraft, type StepIndex } from '../model';
import type { PhotoItem, VoiceNote } from '../useEvidence';
import { PhotoThumb, VoiceClip } from './EvidenceStep';

export const homeLabel = (draft: ReportDraft) => draft.addressMode === 'manual'
  ? (draft.addressLine.trim() ? `${draft.addressLine.trim()}, ${normalisePostcode(draft.postcode)}` : null)
  : (draft.home ? `${draft.home.display_address}, ${draft.home.postcode}` : null);

export function ReviewStep({ draft, photo, note, onEdit }: { draft: ReportDraft; photo: PhotoItem | null; note: VoiceNote | null; onEdit: (step: StepIndex) => void }) {
  const category = categoryById(draft.category);
  const contact = CONTACT_METHODS.find((item) => item.id === draft.preferredContact)?.label;
  return <div className="rp-step-body">
    <p className="rp-lead">Check your report before you send it. You can change anything.</p>

    <ReviewSection title="Problem" step={0} onEdit={onEdit}>
      <Row label="Type">{category?.label ?? 'Not chosen'}</Row>
      <Row label="Room">{draft.room || 'Not specified'}</Row>
      <Row label="Description">{draft.description.trim() ? <span className="rp-prewrap">{draft.description.trim()}</span> : <em>No written description</em>}</Row>
    </ReviewSection>

    <ReviewSection title="Photo and voice note" step={1} onEdit={onEdit}>
      <Row label="Photo">{photo ? <>1 photo<PhotoThumb photo={photo} small /></> : 'None'}</Row>
      <Row label="Voice note">{note ? <VoiceClip note={note} /> : 'None'}</Row>
    </ReviewSection>

    <ReviewSection title="Your home" step={2} onEdit={onEdit}>
      <Row label="Address">{homeLabel(draft) ?? 'Not given'}{draft.addressMode === 'manual' ? <span className="field-hint rp-block"> Not found in our records; the housing team will check it.</span> : null}</Row>
    </ReviewSection>

    <ReviewSection title="Contact details" step={3} onEdit={onEdit}>
      <Row label="Name">{draft.name.trim() || 'Not given'}</Row>
      <Row label="Phone number">{draft.phone.trim() || 'Not given'}</Row>
      <Row label="Preferred contact">{contact ?? 'Not chosen'}</Row>
      <Row label="Access notes">{draft.accessNotes.trim() || 'None'}</Row>
    </ReviewSection>
  </div>;
}

function ReviewSection({ title, step, onEdit, children }: { title: string; step: StepIndex; onEdit: (step: StepIndex) => void; children: React.ReactNode }) {
  return <section className="rp-review-section" aria-label={title}>
    <div className="rp-block-head">
      <h3>{title}</h3>
      <button type="button" className="rp-link-button" onClick={() => onEdit(step)}><Pencil size={16} aria-hidden="true" />Change<span className="rp-visually-hidden"> {title.toLowerCase()}</span></button>
    </div>
    <dl>{children}</dl>
  </section>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rp-review-row"><dt>{label}</dt><dd>{children}</dd></div>;
}
