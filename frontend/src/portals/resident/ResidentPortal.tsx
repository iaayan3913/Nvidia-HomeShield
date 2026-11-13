import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardList, ClipboardPenLine, LoaderCircle, RotateCcw, Send } from 'lucide-react';
import { Button } from '../../shared/components/Button';
import { homeShieldService, isApiMode, useDemoState, type Case, type CreateReportInput, type Property } from '../../shared/data';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { Confirmation } from './components/Confirmation';
import { DETAILS_FIELD_IDS, DetailsStep } from './components/DetailsStep';
import { ErrorSummary } from './components/ErrorSummary';
import { EVIDENCE_FIELD_IDS, EvidenceStep } from './components/EvidenceStep';
import { PROBLEM_FIELD_IDS, ProblemStep } from './components/ProblemStep';
import { ReviewStep } from './components/ReviewStep';
import { EmergencyStrip, SafetyPanel } from './components/SafetyNotice';
import { Stepper } from './components/Stepper';
import { TrackReport } from './components/TrackReport';
import { STEPS, categoryById, composeReportText, emptyDraft, formatBytes, formatDuration, validateStep, type FieldErrors, type ReportDraft, type ResidentCategory, type StepIndex } from './model';
import { readSession, rememberReference, resetDraft, writeSession } from './session';
import { usePhotos, useVoiceRecorder } from './useEvidence';
import './resident.css';

const STEP_TITLES = ['What is the problem?', 'Add photos or a voice note', 'Your home and contact details', 'Check and send your report'] as const;
const FIELD_IDS: Partial<Record<keyof FieldErrors, string>> = { ...PROBLEM_FIELD_IDS, ...EVIDENCE_FIELD_IDS, ...DETAILS_FIELD_IDS };
const FIELD_STEP: Record<keyof FieldErrors, StepIndex> = { category: 0, room: 0, description: 0, evidence: 1, propertyId: 2, name: 2, phone: 2, preferredContact: 2, accessNotes: 2 };
const SUBMIT_DELAY_MS = 450;

interface Submitted { created: Case; property?: Property; category?: ResidentCategory; preferredContact: string }

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
      <span className="eyebrow">Resident portal · {isApiMode ? 'connected to FastAPI' : 'demonstration'}</span>
      <h1>{view === 'track' ? 'Check on a repair report' : 'Report a problem with your home'}</h1>
      <p>{view === 'track' ? `See where your report has got to in the ${isApiMode ? 'connected' : 'simulated'} repairs workflow.` : 'Tell us what is wrong in four short steps. It usually takes about three minutes.'}</p>
      <EmergencyStrip />
    </header>

    <nav className="rp-views" aria-label="Resident options">
      <button type="button" className="rp-view-link" aria-current={view === 'report' ? 'page' : undefined} onClick={() => showView('report')}><ClipboardPenLine size={18} aria-hidden="true" />Report a problem</button>
      <button type="button" className="rp-view-link" aria-current={view === 'track' ? 'page' : undefined} onClick={() => showView('track')}><ClipboardList size={18} aria-hidden="true" />Track a report</button>
    </nav>

    <div className="rp-layout">
      <div className="rp-main">
        {view === 'track'
          ? <TrackReportView reference={reference} recentRefs={recentRefs} onReferenceChange={(ref) => showView('track', ref)} />
          : <ReportFlow onSubmitted={(ref) => { rememberReference(ref); setRecentRefs(readSession().submittedRefs); }} onTrack={(ref) => showView('track', ref)} />}
      </div>
      <aside className="rp-aside" aria-label="Safety and demonstration information">
        <SafetyPanel />
        <section className="rp-aside-note" aria-labelledby="rp-demo-title">
          <h2 id="rp-demo-title">About this demonstration</h2>
          <p>{isApiMode ? 'HomeShield is a prototype connected to FastAPI. Property choices remain synthetic, automated triage is provisional, and contact details are not yet stored by the backend.' : 'HomeShield is a prototype. Properties, people and reports are fictional. Triage and scheduling are simulated by fixed rules, not an official assessment, and nothing reaches a real landlord.'}</p>
        </section>
      </aside>
    </div>
  </div>;
}

function TrackReportView({ reference, recentRefs, onReferenceChange }: { reference: string; recentRefs: string[]; onReferenceChange: (ref: string) => void }) {
  return <div className="rp-panel"><TrackReport initialReference={reference} recentReferences={recentRefs} onReferenceChange={onReferenceChange} /></div>;
}

function ReportFlow({ onSubmitted, onTrack }: { onSubmitted: (reference: string) => void; onTrack: (reference: string) => void }) {
  const properties = useDemoState((state) => state.properties);
  const { notify } = useNotifications();
  const initial = readSession();
  const [draft, setDraft] = useState<ReportDraft>(initial.draft);
  const [step, setStep] = useState<StepIndex>(initial.step);
  const [furthest, setFurthest] = useState<StepIndex>(initial.furthest);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const submittingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const photos = usePhotos();
  const recorder = useVoiceRecorder();

  const evidence = { photos: photos.photos.length, voiceNotes: recorder.notes.length };

  useEffect(() => { writeSession({ draft, step, furthest }); }, [draft, step, furthest]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  // Clear an error as soon as the resident fixes the relevant field.
  const update = useCallback((patch: Partial<ReportDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const keys = Object.keys(patch) as Array<keyof ReportDraft>;
      if (!keys.some((key) => current[key]) && !(patch.description && current.evidence)) return current;
      const next = { ...current }; keys.forEach((key) => delete next[key]); if (patch.description) delete next.evidence; return next;
    });
    setConfirmReset(false);
  }, []);
  useEffect(() => { if (evidence.photos + evidence.voiceNotes > 0) setErrors((current) => (current.evidence ? { ...current, evidence: undefined } : current)); }, [evidence.photos, evidence.voiceNotes]);

  const goTo = (next: StepIndex) => { setErrors({}); setSubmitError(null); setStep(next); if (next > furthest) setFurthest(next); };
  const showErrors = (found: FieldErrors) => { setErrors(found); window.setTimeout(() => summaryRef.current?.focus(), 0); };

  const next = () => {
    const found = validateStep(step, draft, evidence);
    if (Object.keys(found).length) { showErrors(found); return; }
    goTo((step + 1) as StepIndex);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    const found = validateStep(3, draft, evidence);
    const keys = Object.keys(found) as Array<keyof FieldErrors>;
    if (keys.length) {
      const target = Math.min(...keys.map((key) => FIELD_STEP[key])) as StepIndex;
      setStep(target);
      showErrors(validateStep(target, draft, evidence));
      return;
    }
    const category = categoryById(draft.category)!;
    const input: CreateReportInput = {
      text: composeReportText(draft) || undefined,
      category: category.hazard,
      property_id: draft.propertyId,
      contact: { name: draft.name.trim(), contact_number: draft.phone.trim(), preferred_contact: draft.preferredContact || 'phone', ...(draft.accessNotes.trim() ? { access_notes: draft.accessNotes.trim() } : {}) },
      // Descriptors only: no bytes, file names, paths or object URLs leave this component.
      evidence: [
        ...photos.photos.map((photo, index) => ({ kind: 'photo' as const, description: `Photo ${index + 1} (${photo.file.type || 'image'}, ${formatBytes(photo.file.size)}); session-only, not uploaded in the demonstration` })),
        ...recorder.notes.map((note, index) => ({ kind: 'audio' as const, description: `Voice note ${index + 1} (${formatDuration(note.seconds)}); session-only, not uploaded in the demonstration` })),
      ],
    };
    submittingRef.current = true; setSubmitting(true); setSubmitError(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, SUBMIT_DELAY_MS));
      const result = await homeShieldService.createReport(input, { photos: photos.photos.map((item) => item.file), audio: recorder.notes[0]?.blob ?? null, audioName: recorder.notes[0] ? `voice-note.${recorder.notes[0].mimeType.includes('ogg') ? 'ogg' : 'webm'}` : undefined });
      setSubmitted({ created: result.case, property: properties.find((item) => item.id === draft.propertyId), category, preferredContact: draft.preferredContact });
      onSubmitted(result.case.id);
      notify({ kind: 'success', title: 'Report sent', message: `Reference ${result.case.id}${isApiMode ? ' was stored by FastAPI.' : ' (simulated).'}` });
      if (result.warnings.length) notify({ kind: 'warning', title: 'Media processing notice', message: result.warnings.join(' ') });
      photos.clear(); recorder.clear(); resetDraft();
      setDraft(emptyDraft()); setStep(0); setFurthest(0); setErrors({});
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Something went wrong while sending your report.');
    } finally {
      submittingRef.current = false; setSubmitting(false);
    }
  };

  const onFormSubmit = (event: FormEvent) => { event.preventDefault(); if (step === 3) void submit(); else next(); };

  const startAgain = () => {
    photos.clear(); recorder.clear(); resetDraft();
    setDraft(emptyDraft()); setStep(0); setFurthest(0); setErrors({}); setSubmitError(null); setConfirmReset(false);
    headingRef.current?.focus();
  };

  if (submitted) return <div className="rp-panel">
    <Confirmation {...submitted} onTrack={() => onTrack(submitted.created.id)} onNewReport={() => { setSubmitted(null); }} />
  </div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || evidence.photos + evidence.voiceNotes > 0;
  const property = properties.find((item) => item.id === draft.propertyId);

  return <form className="rp-panel rp-form" onSubmit={onFormSubmit} noValidate aria-labelledby="rp-step-title">
    <Stepper current={step} furthest={furthest} onSelect={goTo} />
    <h2 id="rp-step-title" ref={headingRef} tabIndex={-1} className="rp-step-title">{STEP_TITLES[step]}</h2>
    <ErrorSummary ref={summaryRef} errors={errors} fieldIds={FIELD_IDS} />

    {step === 0 ? <ProblemStep draft={draft} errors={errors} update={update} /> : null}
    {step === 1 ? <EvidenceStep photos={photos} recorder={recorder} errors={errors} hasDescription={Boolean(draft.description.trim())} live={isApiMode} /> : null}
    {step === 2 ? <DetailsStep draft={draft} errors={errors} update={update} properties={properties} live={isApiMode} /> : null}
    {step === 3 ? <ReviewStep draft={draft} property={property} photos={photos.photos} notes={recorder.notes} onEdit={goTo} live={isApiMode} /> : null}

    {submitError ? <div className="rp-callout rp-callout--danger" role="alert"><div><strong>Your report was not sent</strong><p>{submitError} Your answers are still here. Please try again.</p></div></div> : null}

    <div className="rp-form-actions">
      {step > 0 ? <Button type="button" variant="secondary" icon={<ArrowLeft size={20} aria-hidden="true" />} onClick={() => goTo((step - 1) as StepIndex)} disabled={submitting}>Back</Button> : <span />}
      {step < 3
        ? <Button type="submit" variant="primary" disabled={recorder.status === 'recording'}>Continue<ArrowRight size={20} aria-hidden="true" /></Button>
        : <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting} icon={submitting ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Send size={20} aria-hidden="true" />}>{submitting ? 'Sending report…' : 'Submit repair report'}</Button>}
    </div>
    {recorder.status === 'recording' && step === 1 ? <p className="field-hint rp-actions-hint">Stop the recording before continuing.</p> : null}

    {dirty && !submitting ? <div className="rp-reset">
      {confirmReset
        ? <><span>Clear everything you have entered, including photos and voice notes?</span><Button type="button" variant="danger" onClick={startAgain}>Yes, clear the form</Button><Button type="button" variant="quiet" onClick={() => setConfirmReset(false)}>Keep my answers</Button></>
        : <Button type="button" variant="quiet" icon={<RotateCcw size={18} aria-hidden="true" />} onClick={() => setConfirmReset(true)}>Start again</Button>}
    </div> : null}
    <p className="rp-visually-hidden" aria-live="polite">{`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}</p>
  </form>;
}
