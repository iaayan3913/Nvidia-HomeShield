import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Ban, Camera, CheckCircle2, CircleDot, Clock, Footprints, KeyRound, Loader2, MapPin, Navigation, RotateCcw, Siren, TriangleAlert, Wrench, X } from 'lucide-react';
import { Button } from '../../shared/components/Button';
import { Select, Textarea } from '../../shared/components/FormControls';
import { mockService } from '../../shared/mock';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import type { JobStatus } from '../../shared/types/domain';
import { NEXT_STEP, STATUS_LABEL, formatTime, humanise, isEmergency, sentence, isFinished, priorityOf, referenceOf, timeWindow, titleOf, type WorkItem } from './model';

const PRIORITY_ICON = { emergency: Siren, urgent: TriangleAlert, high: TriangleAlert, standard: Clock };
const STATUS_ICON: Record<JobStatus, typeof Clock> = { unassigned: CircleDot, assigned: CircleDot, travelling: Navigation, on_site: Footprints, completed: CheckCircle2, unable_to_complete: Ban };
const UNABLE_REASONS = ['No access to property', 'Parts or materials needed', 'Unsafe to proceed', 'Needs a different skill', 'Other'];
const MAX_PHOTOS = 6;
const hazardLabel = (hazard: string | null | undefined) => hazard && hazard !== 'other' ? sentence(humanise(hazard)) : null;
const message = (error: unknown) => error instanceof Error && error.message ? error.message : 'The job could not be updated.';

export function PriorityTag({ item }: { item: WorkItem }) {
  const { level, label } = priorityOf(item); const Icon = PRIORITY_ICON[level];
  return <span className="op-priority" data-level={level}><Icon size={16} aria-hidden="true" />{label}</span>;
}

export function JobStatusTag({ status }: { status: JobStatus }) {
  const Icon = STATUS_ICON[status];
  return <span className="op-status" data-status={status}><Icon size={16} aria-hidden="true" />{STATUS_LABEL[status]}</span>;
}

export function JobCard({ item, route }: { item: WorkItem; route?: ReactNode }) {
  const { job, case: housingCase, property, report } = item;
  const { notify } = useNotifications();
  const [finishing, setFinishing] = useState<'completed' | 'unable_to_complete' | null>(null);
  const [pending, setPending] = useState<JobStatus | null>(null);
  const [failed, setFailed] = useState<{ status: JobStatus; text: string } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const reference = referenceOf(item);
  const step = NEXT_STEP[job.status];
  const finished = isFinished(job.status);
  const accessNotes = job.access_notes ?? report?.contact.access_notes;

  // Changing job (selection or live update) clears any half-finished interaction.
  useEffect(() => { setFinishing(null); setFailed(null); }, [job.id]);

  async function advance(status: JobStatus) {
    setPending(status); setFailed(null);
    try {
      await mockService.updateJobProgress(job.id, status);
      notify({ kind: 'success', title: STATUS_LABEL[status], message: `${reference} updated. Operations can see this now.` });
    } catch (error) { setFailed({ status, text: message(error) }); }
    finally { setPending(null); }
  }

  return <article className="op-job" data-priority={priorityOf(item).level} aria-labelledby={`job-${job.id}-title`} aria-busy={pending !== null}>
    <div className="op-job__tags"><PriorityTag item={item} /><JobStatusTag status={job.status} />{job.source === 'planned' && <span className="op-tag">Planned maintenance</span>}</div>
    <h2 className="op-job__title" id={`job-${job.id}-title`}><span className="op-job__ref">{reference}</span>{titleOf(item)}</h2>

    <dl className="op-facts">
      <div><dt><MapPin size={18} aria-label="Address" /></dt><dd><strong>{property?.display_address ?? 'Address not available'}</strong>{property && <span>{property.postcode} · {property.area}</span>}</dd></div>
      <div><dt><Clock size={18} aria-label="Timing" /></dt><dd><strong>ETA {formatTime(item.eta)}</strong><span>{timeWindow(job)} · about {job.duration_minutes} min on site</span></dd></div>
      <div><dt><Wrench size={18} aria-label="Work required" /></dt><dd><strong>{humanise(job.required_skill)} skill</strong><span>{[hazardLabel(housingCase?.hazard_type ?? job.hazard_type), housingCase?.room, property && `${humanise(property.archetype)}, ${property.floors} floor${property.floors === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></dd></div>
      {accessNotes && <div className="op-facts__access"><dt><KeyRound size={18} aria-label="Access notes" /></dt><dd><strong>Safe access</strong><span>{accessNotes}</span></dd></div>}
    </dl>
    {isEmergency(item) && <p className="op-job__warning" role="note"><Siren size={18} aria-hidden="true" />Possible emergency. Follow your safety procedure. For immediate danger call 999; for gas, the National Gas Emergency Service on 0800 111 999.</p>}

    {route}

    {finished ? <p className="op-job__done">{job.status === 'completed' ? 'Completed' : 'Unable to complete'}{job.updated_at ? ` at ${formatTime(job.updated_at)}` : ''}{job.completion_notes ? <>: <q>{job.completion_notes}</q></> : null}{job.evidence_count ? ` · ${job.evidence_count} photo${job.evidence_count === 1 ? '' : 's'} taken` : ''}</p>
      : finishing ? <FinishForm item={item} mode={finishing} onCancel={() => { setFinishing(null); requestAnimationFrame(() => actionsRef.current?.querySelector('button')?.focus()); }} onDone={() => setFinishing(null)} />
      : <div className="op-actions" ref={actionsRef}>
        {step && <Button disabled={pending !== null} icon={pending === step.status ? <Loader2 className="op-spin" size={20} aria-hidden="true" /> : step.status === 'completed' ? <CheckCircle2 size={20} aria-hidden="true" /> : step.status === 'on_site' ? <Footprints size={20} aria-hidden="true" /> : <Navigation size={20} aria-hidden="true" />}
          onClick={() => step.status === 'completed' ? setFinishing('completed') : void advance(step.status)}>{pending === step.status ? 'Updating…' : step.label}</Button>}
        <Button variant="secondary" disabled={pending !== null} icon={<Ban size={18} aria-hidden="true" />} onClick={() => setFinishing('unable_to_complete')}>Unable to complete</Button>
      </div>}
    {failed && <div className="op-error" role="alert"><span>{STATUS_LABEL[failed.status]} was not saved: {failed.text}</span>
      <Button variant="secondary" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => void advance(failed.status)}>Retry</Button></div>}
  </article>;
}

function FinishForm({ item, mode, onCancel, onDone }: { item: WorkItem; mode: 'completed' | 'unable_to_complete'; onCancel(): void; onDone(): void }) {
  const { notify } = useNotifications();
  const [notes, setNotes] = useState(''); const [reason, setReason] = useState(UNABLE_REASONS[0]!);
  const [photos, setPhotos] = useState<File[]>([]); const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const photoId = useId(); const reference = referenceOf(item);
  const completing = mode === 'completed';

  // Photos stay in component memory only; object URLs are revoked and never persisted or uploaded.
  useEffect(() => { const urls = photos.map((file) => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach((url) => URL.revokeObjectURL(url)); }, [photos]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (notes.trim().length < 5) { setError(completing ? 'Add a short note on the work done (at least 5 characters).' : 'Explain briefly why the job could not be completed.'); return; }
    setSaving(true); setSubmitError(null);
    try {
      await mockService.updateJobProgress(item.job.id, mode, `${completing ? '' : `${reason}: `}${notes.trim()}`, photos.length || undefined);
      notify({ kind: completing ? 'success' : 'warning', title: completing ? 'Job completed' : 'Marked unable to complete', message: `${reference} updated. Operations can see your notes.` });
      onDone();
      document.getElementById('op-detail-heading')?.focus();
    } catch (cause) { setSubmitError(`${message(cause)} Your notes are still here; try again.`); }
    finally { setSaving(false); }
  }

  return <form className="op-finish" onSubmit={(e) => void submit(e)} onKeyDown={(e) => { if (e.key === 'Escape' && !saving) onCancel(); }} noValidate aria-labelledby={`${photoId}-title`} aria-busy={saving}>
    <h3 id={`${photoId}-title`}>{completing ? 'Confirm job completed' : 'Confirm unable to complete'}</h3>
    <p className="op-finish__lead">{completing ? `This marks ${reference} as completed and updates the case for Operations.` : `This tells Operations ${reference} needs follow-up. It stays on record.`}</p>
    {!completing && <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving}>{UNABLE_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>}
    <Textarea label={completing ? 'Completion notes' : 'What happened'} hint="Required. Keep it short; 500 characters maximum." maxLength={500} autoFocus value={notes} error={error ?? undefined} disabled={saving}
      onChange={(e) => { setNotes(e.target.value); if (error) setError(null); }} />
    <div className="op-photos">
      <input id={photoId} className="visually-hidden" type="file" accept="image/*" multiple disabled={saving}
        onChange={(e) => { const chosen = Array.from(e.target.files ?? []); setPhotos((current) => [...current, ...chosen].slice(0, MAX_PHOTOS)); e.target.value = ''; }} />
      <label htmlFor={photoId} className="button button--secondary"><Camera size={18} aria-hidden="true" />Add photos (optional)</label>
      <p className="field-hint">Photos stay on this device; only the number of photos is recorded.</p>
      {previews.length > 0 && <ul className="op-photos__list" aria-label={`${previews.length} photo${previews.length === 1 ? '' : 's'} selected`}>
        {previews.map((url, i) => <li key={url}><img src={url} alt={`Selected photo ${i + 1}`} />
          <button type="button" onClick={() => setPhotos((current) => current.filter((_, index) => index !== i))} aria-label={`Remove photo ${i + 1}`}><X size={16} aria-hidden="true" /></button></li>)}
      </ul>}
    </div>
    {submitError && <p className="op-error" role="alert">{submitError}</p>}
    <div className="op-actions">
      <Button type="submit" disabled={saving} variant={completing ? 'primary' : 'danger'} icon={saving ? <Loader2 className="op-spin" size={20} aria-hidden="true" /> : completing ? <CheckCircle2 size={20} aria-hidden="true" /> : <Ban size={18} aria-hidden="true" />}>{saving ? 'Saving…' : completing ? 'Confirm completed' : 'Confirm unable to complete'}</Button>
      <Button type="button" variant="quiet" onClick={onCancel} disabled={saving}>Cancel</Button>
    </div>
  </form>;
}
