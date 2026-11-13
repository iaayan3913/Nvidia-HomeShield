import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardList, ClipboardPenLine, LoaderCircle, RotateCcw, Send } from 'lucide-react';
import { Button } from '../../shared/components/Button';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { homeLabel } from './components/ReviewStep';
import { Confirmation, type SubmittedReport } from './components/Confirmation';
import { CONTACT_FIELD_IDS, ContactStep } from './components/ContactStep';
import { ErrorSummary } from './components/ErrorSummary';
import { EVIDENCE_FIELD_IDS, EvidenceStep } from './components/EvidenceStep';
import { HOME_FIELD_IDS, HomeStep } from './components/HomeStep';
import { PROBLEM_FIELD_IDS, ProblemStep } from './components/ProblemStep';
import { ReviewStep } from './components/ReviewStep';
import { EmergencyStrip, SafetyPanel } from './components/SafetyNotice';
import { Stepper } from './components/Stepper';
import { OfflineNotice, TestModeBadge } from './components/TestModeBadge';
import { TrackReport } from './components/TrackReport';
import { SubmitTimeoutError, submitReport, type ResidentReportInput } from './contract';
import { FIELD_STEP, LAST_STEP, STEPS, categoryById, composeReportText, emptyDraft, formatBytes, formatDuration, normalisePostcode, validateStep, type FieldErrors, type ReportDraft, type StepIndex } from './model';
import { readSession, rememberReference, resetDraft, writeSession } from './session';
import { usePhoto, useVoiceRecorder } from './useEvidence';
import './resident.css';

const FIELD_IDS: Partial<Record<keyof FieldErrors, string>> = { ...PROBLEM_FIELD_IDS, ...EVIDENCE_FIELD_IDS, ...HOME_FIELD_IDS, ...CONTACT_FIELD_IDS };

export function ResidentPortal() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'track' ? 'track' : 'report';
  const reference = params.get('ref') ?? '';
  const [recentRefs, setRecentRefs] = useState(() => readSession().submittedRefs);

  const showView = (next: 'report' | 'track', ref?: string) => {
    const nextParams = new URLSearchParams();
    if (next === 'track') { nextParams.set('view', 'track'); if (ref) nextParams.set('ref', ref); }
    setParams(nextParams);
  };

  return <div className="rp-page">
    <header className="rp-hero">
      <span className="eyebrow">Housing repairs</span>
      <h1>{view === 'track' ? 'Check on a repair report' : 'Report a problem with your home'}</h1>
      <p>{view === 'track' ? 'See where your repair has got to. Updates appear here automatically.' : 'Tell us what is wrong in five short steps. It usually takes about three minutes.'}</p>
      <EmergencyStrip />
      <TestModeBadge />
      <OfflineNotice />
    </header>

    <nav className="rp-views" aria-label="Resident options">
      <button type="button" className="rp-view-link" aria-current={view === 'report' ? 'page' : undefined} onClick={() => showView('report')}><ClipboardPenLine size={18} aria-hidden="true" />Report a problem</button>
      <button type="button" className="rp-view-link" aria-current={view === 'track' ? 'page' : undefined} onClick={() => showView('track')}><ClipboardList size={18} aria-hidden="true" />Track a report</button>
    </nav>

    <div className="rp-layout">
      <div className="rp-main">
        {view === 'track'
          ? <div className="rp-panel"><TrackReport initialReference={reference} recentReferences={recentRefs} onReferenceChange={(ref) => showView('track', ref)} /></div>
          : <ReportFlow onSubmitted={(ref) => { rememberReference(ref); setRecentRefs(readSession().submittedRefs); }} onTrack={(ref) => showView('track', ref)} />}
      </div>
      <aside className="rp-aside" aria-label="Safety information">
        <SafetyPanel />
      </aside>
    </div>
  </div>;
}

function describeFailure(cause: unknown): { title: string; message: string } {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { title: 'You are offline', message: 'Your report has not been sent because this device is not connected to the internet. Your answers are saved on this device. Reconnect, then try again.' };
  if (cause instanceof SubmitTimeoutError) return { title: 'The service took too long to reply', message: 'We could not confirm that your report arrived. Your answers are saved on this device. Please try again; you will get a reference number once it has been received.' };
  return { title: 'Your report was not sent', message: 'Something went wrong on our side. Your answers are saved on this device. Please try again in a moment.' };
}

function ReportFlow({ onSubmitted, onTrack }: { onSubmitted: (reference: string) => void; onTrack: (reference: string) => void }) {
  const { notify } = useNotifications();
  const initial = readSession();
  const [draft, setDraft] = useState<ReportDraft>(initial.draft);
  const [step, setStep] = useState<StepIndex>(initial.step);
  const [furthest, setFurthest] = useState<StepIndex>(initial.furthest);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedReport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const submittingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const photo = usePhoto();
  const recorder = useVoiceRecorder();

  const evidence = { photos: photo.photo ? 1 : 0, voiceNotes: recorder.note ? 1 : 0 };

  useEffect(() => { writeSession({ draft, step, furthest }); }, [draft, step, furthest]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  // Clear an error as soon as the resident changes the relevant field.
  const update = useCallback((patch: Partial<ReportDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current } as FieldErrors;
      let changed = false;
      const drop = (key: keyof FieldErrors) => { if (next[key]) { delete next[key]; changed = true; } };
      (Object.keys(patch) as Array<keyof ReportDraft>).forEach((key) => { if (key in FIELD_STEP) drop(key as keyof FieldErrors); });
      if (patch.description) drop('evidence');
      if ('home' in patch || 'addressMode' in patch) { drop('home'); drop('addressLine'); drop('postcode'); }
      return changed ? next : current;
    });
    setConfirmReset(false);
  }, []);
  useEffect(() => { if (evidence.photos + evidence.voiceNotes > 0) setErrors((current) => (current.evidence ? { ...current, evidence: undefined } : current)); }, [evidence.photos, evidence.voiceNotes]);

  const goTo = (next: StepIndex) => { setErrors({}); setFailure(null); setStep(next); if (next > furthest) setFurthest(next); };
  const showErrors = (found: FieldErrors) => { setErrors(found); window.setTimeout(() => summaryRef.current?.focus(), 0); };

  const next = () => {
    const found = validateStep(step, draft, evidence);
    if (Object.keys(found).length) { showErrors(found); return; }
    goTo((step + 1) as StepIndex);
  };

  const buildInput = (): ResidentReportInput => {
    const category = categoryById(draft.category)!;
    const home = draft.addressMode === 'search' && draft.home
      ? { property_id: draft.home.id }
      : { address_line: draft.addressLine.trim(), postcode: normalisePostcode(draft.postcode) };
    return {
      text: composeReportText(draft) || undefined,
      category: category.hazard,
      ...home,
      contact: { name: draft.name.trim(), contact_number: draft.phone.trim(), preferred_contact: draft.preferredContact || 'phone', ...(draft.accessNotes.trim() ? { access_notes: draft.accessNotes.trim() } : {}) },
      ...(photo.photo ? { photo: photo.photo.blob } : {}),
      ...(recorder.note ? { audio: recorder.note.blob } : {}),
      // Descriptors for the record; the media itself travels as the photo/audio Blobs, never as URLs.
      evidence: [
        ...(photo.photo ? [{ kind: 'photo' as const, description: `Photo from resident (${photo.photo.blob.type || 'image'}, ${formatBytes(photo.photo.blob.size)})` }] : []),
        ...(recorder.note ? [{ kind: 'audio' as const, description: `Voice note from resident (${formatDuration(recorder.note.seconds)})` }] : []),
      ],
    };
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const found = validateStep(LAST_STEP, draft, evidence);
    const keys = Object.keys(found) as Array<keyof FieldErrors>;
    if (keys.length) {
      const target = Math.min(...keys.map((key) => FIELD_STEP[key])) as StepIndex;
      setStep(target);
      showErrors(validateStep(target, draft, evidence));
      return;
    }
    submittingRef.current = true; setSubmitting(true); setFailure(null);
    const sentCategory = categoryById(draft.category);
    const sentHome = homeLabel(draft);
    const sentContact = draft.preferredContact;
    try {
      const result = await submitReport(buildInput());
      setSubmitted({ created: result.case, home: sentHome, category: sentCategory, preferredContact: sentContact });
      onSubmitted(result.case.id);
      notify({ kind: 'success', title: 'Report sent', message: `Your reference is ${result.case.id}.` });
      if (result.warnings.length) notify({ kind: 'warning', title: 'Report received with a warning', message: result.warnings.join(' ') });
      photo.clear(); recorder.clear(); resetDraft();
      setDraft(emptyDraft()); setStep(0); setFurthest(0); setErrors({});
    } catch (cause) {
      setFailure(describeFailure(cause));
      window.setTimeout(() => failureRef.current?.focus(), 0);
    } finally {
      submittingRef.current = false; setSubmitting(false);
    }
  };

  const onFormSubmit = (event: FormEvent) => { event.preventDefault(); if (step === LAST_STEP) void submit(); else next(); };

  const startAgain = () => {
    photo.clear(); recorder.clear(); resetDraft();
    setDraft(emptyDraft()); setStep(0); setFurthest(0); setErrors({}); setFailure(null); setConfirmReset(false);
    headingRef.current?.focus();
  };

  if (submitted) return <div className="rp-panel">
    <Confirmation {...submitted} onTrack={() => onTrack(submitted.created.id)} onNewReport={() => setSubmitted(null)} />
  </div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || evidence.photos + evidence.voiceNotes > 0;
  const blocked = recorder.status === 'recording' || photo.processing;

  return <form className="rp-panel rp-form" onSubmit={onFormSubmit} noValidate aria-labelledby="rp-step-title">
    <Stepper current={step} furthest={furthest} onSelect={goTo} />
    <h2 id="rp-step-title" ref={headingRef} tabIndex={-1} className="rp-step-title">{STEPS[step].title}</h2>
    <ErrorSummary ref={summaryRef} errors={errors} fieldIds={FIELD_IDS} />

    {step === 0 ? <ProblemStep draft={draft} errors={errors} update={update} /> : null}
    {step === 1 ? <EvidenceStep photo={photo} recorder={recorder} errors={errors} hasDescription={Boolean(draft.description.trim())} /> : null}
    {step === 2 ? <HomeStep draft={draft} errors={errors} update={update} /> : null}
    {step === 3 ? <ContactStep draft={draft} errors={errors} update={update} /> : null}
    {step === 4 ? <ReviewStep draft={draft} photo={photo.photo} note={recorder.note} onEdit={goTo} /> : null}

    {failure ? <div ref={failureRef} tabIndex={-1} className="rp-callout rp-callout--danger rp-failure" role="alert">
      <div><strong>{failure.title}</strong><p>{failure.message}</p>
        <Button type="button" variant="secondary" disabled={submitting} icon={<RotateCcw size={18} aria-hidden="true" />} onClick={() => void submit()}>Try again</Button>
      </div>
    </div> : null}

    <div className="rp-form-actions">
      {step > 0 ? <Button type="button" variant="secondary" icon={<ArrowLeft size={20} aria-hidden="true" />} onClick={() => goTo((step - 1) as StepIndex)} disabled={submitting}>Back</Button> : <span />}
      {step < LAST_STEP
        ? <Button type="submit" variant="primary" disabled={blocked}>Continue<ArrowRight size={20} aria-hidden="true" /></Button>
        : <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting} icon={submitting ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Send size={20} aria-hidden="true" />}>{submitting ? 'Sending report…' : 'Submit repair report'}</Button>}
    </div>
    {blocked && step === 1 ? <p className="field-hint rp-actions-hint">{photo.processing ? 'Wait for the photo to finish preparing.' : 'Stop the recording before continuing.'}</p> : null}

    {dirty && !submitting ? <div className="rp-reset">
      {confirmReset
        ? <><span>Clear everything you have entered, including your photo and voice note?</span><Button type="button" variant="danger" onClick={startAgain}>Yes, clear the form</Button><Button type="button" variant="quiet" onClick={() => setConfirmReset(false)}>Keep my answers</Button></>
        : <Button type="button" variant="quiet" icon={<RotateCcw size={18} aria-hidden="true" />} onClick={() => setConfirmReset(true)}>Start again</Button>}
    </div> : null}
    <p className="rp-visually-hidden" aria-live="polite">{submitting ? 'Sending your report' : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}</p>
  </form>;
}
