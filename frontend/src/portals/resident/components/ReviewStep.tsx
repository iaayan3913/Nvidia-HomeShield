import { Pencil } from 'lucide-react';
import type { Property } from '../../../shared/mock';
import { CONTACT_METHODS, categoryById, type ReportDraft, type StepIndex } from '../model';
import type { PhotoItem, VoiceNote } from '../useEvidence';
import { PhotoThumb, VoiceClip } from './EvidenceStep';

export function ReviewStep({ draft, property, photos, notes, onEdit, live = false }: { draft: ReportDraft; property?: Property; photos: PhotoItem[]; notes: VoiceNote[]; onEdit: (step: StepIndex) => void; live?: boolean }) {
  const category = categoryById(draft.category);
  const contact = CONTACT_METHODS.find((item) => item.id === draft.preferredContact)?.label;
  return <div className="rp-step-body">
    <p className="rp-lead">Check your report before you send it. You can change anything.</p>

    <ReviewSection title="Problem" step={0} onEdit={onEdit}>
      <Row label="Type">{category?.label ?? 'Not chosen'}</Row>
      <Row label="Room">{draft.room || 'Not specified'}</Row>
      <Row label="Description">{draft.description.trim() ? <span className="rp-prewrap">{draft.description.trim()}</span> : <em>No written description</em>}</Row>
    </ReviewSection>

    <ReviewSection title="Evidence" step={1} onEdit={onEdit}>
      <Row label="Photos">{photos.length ? <>{photos.length} added<ul className="rp-thumbs rp-thumbs--small" aria-label="Photos to send">{photos.map((photo, index) => <PhotoThumb key={photo.id} photo={photo} index={index} />)}</ul></> : 'None'}</Row>
      <Row label="Voice notes">{notes.length ? <>{notes.length} recorded<ul className="rp-voice-list" aria-label="Voice notes to send">{notes.map((note, index) => <VoiceClip key={note.id} note={note} index={index} />)}</ul></> : 'None'}</Row>
    </ReviewSection>

    <ReviewSection title="Home and contact" step={2} onEdit={onEdit}>
      <Row label="Property">{property ? `${property.display_address}, ${property.postcode} (fictional)` : 'Not chosen'}</Row>
      <Row label="Name">{draft.name.trim() || 'Not given'}</Row>
      <Row label="Contact number">{draft.phone.trim() || 'Not given'}</Row>
      <Row label="Preferred contact">{contact ?? 'Not chosen'}</Row>
      <Row label="Access notes">{draft.accessNotes.trim() || 'None'}</Row>
    </ReviewSection>

    <p className="rp-demo-note">{live ? 'By submitting, the fictional report is sent to FastAPI and may create a persisted case and schedule proposal. Contact fields are not included in the current backend contract.' : 'By submitting, a simulated report and case are created in this demonstration. A housing officer would review it; nothing is sent to a real landlord or repairs service.'}</p>
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
