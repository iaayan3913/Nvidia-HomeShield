import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Ban, Camera, CheckCircle2, CircleDot, Clock, Footprints, KeyRound, MapPin, Navigation, Siren, TriangleAlert, Wrench, X } from 'lucide-react';
import { Button } from '../../shared/components/Button';
import { Select, Textarea } from '../../shared/components/FormControls';
import { homeShieldService, isApiMode } from '../../shared/data';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import type { JobStatus } from '../../shared/types/domain';
import { NEXT_STEP, STATUS_LABEL, formatTime, humanise, isFinished, priorityOf, timeWindow, type WorkItem } from './model';

const PRIORITY_ICON = { emergency: Siren, urgent: TriangleAlert, high: TriangleAlert, standard: Clock };
const STATUS_ICON: Record<JobStatus, typeof Clock> = { unassigned: CircleDot, assigned: CircleDot, travelling: Navigation, on_site: Footprints, completed: CheckCircle2, unable_to_complete: Ban };
const UNABLE_REASONS = ['No access to property', 'Parts or materials needed', 'Unsafe to proceed', 'Needs a different skill', 'Other'];
const MAX_PHOTOS = 6;

export function PriorityTag({ item }: { item: WorkItem }) {
  const { level, label } = priorityOf(item); const Icon = PRIORITY_ICON[level];
  return <span className="op-priority" data-level={level}><Icon size={16} aria-hidden="true" />{label}</span>;
}

export function JobStatusTag({ status }: { status: JobStatus }) {
  const Icon = STATUS_ICON[status];
  return <span className="op-status" data-status={status}><Icon size={16} aria-hidden="true" />{STATUS_LABEL[status]}</span>;
}

export function JobCard({ item, route, headingLevel = 3 }: { item: WorkItem; route?: ReactNode; headingLevel?: 2 | 3 }) {
  const { job, case: housingCase, property, report } = item;
  const { notify } = useNotifications();
  const [finishing, setFinishing] = useState<'completed' | 'unable_to_complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const reference = housingCase?.id ?? job.case_id;
  const step = NEXT_STEP[job.status];
  const finished = isFinished(job.status);
  const Heading = `h${headingLevel}` as const;

  async function advance(status: JobStatus) {
    setError(null);
    try {
      await homeShieldService.updateJobProgress(job.id, status);
      notify({ kind: 'success', title: STATUS_LABEL[status], message: isApiMode ? `${reference} updated locally only; FastAPI does not yet persist operative progress.` : `${reference} updated. Operations can see this now.` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The job could not be updated. Try again.'); }
  }

  return <article className="op-job" data-priority={priorityOf(item).level} aria-label={`${reference}: ${housingCase?.summary ?? 'Repair job'}`}>
    <div className="op-job__tags"><PriorityTag item={item} /><JobStatusTag status={job.status} /></div>
    <Heading className="op-job__title"><span className="op-job__ref">{reference}</span>{housingCase?.summary ?? 'Repair job (case details unavailable)'}</Heading>

    <dl className="op-facts">
      <div><dt><MapPin size={18} aria-label="Address" /></dt><dd><strong>{property?.display_address ?? 'Address unavailable'}</strong>{property && <span>{property.postcode} · {property.area} · fictional address</span>}</dd></div>
      <div><dt><Clock size={18} aria-label="Timing" /></dt><dd><strong>ETA {formatTime(item.eta)}</strong><span>Window {timeWindow(job)} · about {job.duration_minutes} min on site</span></dd></div>
      <div><dt><Wrench size={18} aria-label="Work required" /></dt><dd><strong>{humanise(job.required_skill)} skill</strong><span>{[housingCase && humanise(housingCase.hazard_type), housingCase?.room, property && `${humanise(property.archetype)}, ${property.floors} floor${property.floors === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></dd></div>
      {report?.contact.access_notes && <div className="op-facts__access"><dt><KeyRound size={18} aria-label="Access notes" /></dt><dd><strong>Safe access</strong><span>{report.contact.access_notes}</span></dd></div>}
    </dl>
    {housingCase?.is_emergency && <p className="op-job__warning" role="note"><Siren size={18} aria-hidden="true" />Emergency simulation. Follow your safety procedure; for immediate danger call 999 or the National Gas Emergency Service on 0800 111 999.</p>}

    {route}

    {finished ? <p className="op-job__done">{job.status === 'completed' ? 'Completed' : 'Unable to complete'} at {formatTime(job.updated_at)}{job.completion_notes ? <>: <q>{job.completion_notes}</q></> : null}</p>
      : finishing ? <FinishForm item={item} mode={finishing} onCancel={() => { setFinishing(null); requestAnimationFrame(() => actionsRef.current?.querySelector('button')?.focus()); }} onDone={() => setFinishing(null)} />
      : <div className="op-actions" ref={actionsRef}>
        {step && <Button icon={step.status === 'completed' ? <CheckCircle2 size={20} aria-hidden="true" /> : step.status === 'on_site' ? <Footprints size={20} aria-hidden="true" /> : <Navigation size={20} aria-hidden="true" />}
          onClick={() => step.status === 'completed' ? setFinishing('completed') : void advance(step.status)}>{step.label}</Button>}
        <Button variant="secondary" icon={<Ban size={18} aria-hidden="true" />} onClick={() => setFinishing('unable_to_complete')}>Unable to complete</Button>
      </div>}
    {error && <p className="op-error" role="alert">{error}</p>}
  </article>;
}

function FinishForm({ item, mode, onCancel, onDone }: { item: WorkItem; mode: 'completed' | 'unable_to_complete'; onCancel(): void; onDone(): void }) {
  const { notify } = useNotifications();
  const [notes, setNotes] = useState(''); const [reason, setReason] = useState(UNABLE_REASONS[0]!);
  const [photos, setPhotos] = useState<File[]>([]); const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null);
  const photoId = useId(); const reference = item.case?.id ?? item.job.case_id;
  const completing = mode === 'completed';

  // Binary media stays in component memory only; object URLs are revoked and never persisted.
  useEffect(() => { const urls = photos.map((file) => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach((url) => URL.revokeObjectURL(url)); }, [photos]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (notes.trim().length < 5) { setError(completing ? 'Add a short note on the work done (at least 5 characters).' : 'Explain briefly why the job could not be completed.'); return; }
    const evidence = photos.length ? ` [${photos.length} photo${photos.length === 1 ? '' : 's'} selected on device; not uploaded in demonstration]` : '';
    const text = `${completing ? '' : `${reason}: `}${notes.trim()}${evidence}`;
    try {
      await homeShieldService.updateJobProgress(item.job.id, mode, text);
      notify({ kind: completing ? 'success' : 'warning', title: completing ? 'Job completed' : 'Marked unable to complete', message: isApiMode ? `${reference} changed locally only; FastAPI has no operative progress endpoint.` : `${reference} updated. Operations can see your notes.` });
      onDone();
      document.getElementById('op-next-heading')?.focus();
    } catch (cause) { setSubmitError(cause instanceof Error ? cause.message : 'The job could not be updated. Your notes are still here; try again.'); }
  }

  return <form className="op-finish" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} noValidate aria-labelledby={`${photoId}-title`}>
    <h4 id={`${photoId}-title`}>{completing ? 'Confirm job completed' : 'Confirm unable to complete'}</h4>
    <p className="op-finish__lead">{completing ? `This marks ${reference} as completed and resolves the case for Operations.` : `This tells Operations ${reference} needs follow-up. It stays on record.`}</p>
    {!completing && <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>{UNABLE_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>}
    <Textarea label={completing ? 'Completion notes' : 'What happened'} hint="Required. Keep it short; 500 characters maximum." maxLength={500} autoFocus value={notes} error={error ?? undefined}
      onChange={(e) => { setNotes(e.target.value); if (error) setError(null); }} />
    <div className="op-photos">
      <input id={photoId} className="op-visually-hidden" type="file" accept="image/*" multiple
        onChange={(e) => { const chosen = Array.from(e.target.files ?? []); setPhotos((current) => [...current, ...chosen].slice(0, MAX_PHOTOS)); e.target.value = ''; }} />
      <label htmlFor={photoId} className="button button--secondary"><Camera size={18} aria-hidden="true" />Add photos (optional)</label>
      <p className="field-hint">Photos stay on this device for the demonstration; only the count is recorded.</p>
      {previews.length > 0 && <ul className="op-photos__list" aria-label={`${previews.length} photo${previews.length === 1 ? '' : 's'} selected`}>
        {previews.map((url, i) => <li key={url}><img src={url} alt={`Selected photo ${i + 1}`} />
          <button type="button" onClick={() => setPhotos((current) => current.filter((_, index) => index !== i))} aria-label={`Remove photo ${i + 1}`}><X size={16} aria-hidden="true" /></button></li>)}
      </ul>}
    </div>
    {submitError && <p className="op-error" role="alert">{submitError}</p>}
    <div className="op-actions">
      <Button type="submit" variant={completing ? 'primary' : 'danger'} icon={completing ? <CheckCircle2 size={20} aria-hidden="true" /> : <Ban size={18} aria-hidden="true" />}>{completing ? 'Confirm completed' : 'Confirm unable to complete'}</Button>
      <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}
