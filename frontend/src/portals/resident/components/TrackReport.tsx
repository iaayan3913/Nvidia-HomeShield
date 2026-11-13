import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/FormControls';
import { useTrackedCase } from '../contract';
import { TRACK_STAGES, UNABLE_LABEL, formatDateTime, needsUrgentAttention, trackingStage } from '../caseLabels';
import { CATEGORIES, normaliseReference } from '../model';

const REFERENCE_SHAPE = /^[A-Z]{2,}-[A-Z0-9-]+$/i;

export function TrackReport({ initialReference, recentReferences, onReferenceChange }: { initialReference: string; recentReferences: string[]; onReferenceChange: (reference: string) => void }) {
  const [query, setQuery] = useState(initialReference);
  const [error, setError] = useState<string | undefined>();
  const resultRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const searched = normaliseReference(initialReference) || null;
  const tracked = useTrackedCase(searched);

  useEffect(() => { setQuery(initialReference); }, [initialReference]);

  const lookUp = (reference: string) => {
    setError(undefined); setQuery(reference); onReferenceChange(reference);
    window.setTimeout(() => resultRef.current?.focus(), 0);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const reference = normaliseReference(query);
    if (!reference) { setError('Enter your report reference, for example HS-26043.'); return; }
    if (!REFERENCE_SHAPE.test(reference)) { setError('Check the reference. It looks like HS-26043.'); return; }
    lookUp(reference);
  };

  return <section className="rp-track" aria-labelledby={titleId}>
    <h2 id={titleId}>Track a report</h2>
    <p className="rp-lead">Enter the reference you were given when you sent your report. This page updates by itself as your repair progresses.</p>
    <form className="rp-track-form" onSubmit={submit} noValidate>
      <Input label="Report reference" placeholder="HS-26043" value={query} error={error} autoCapitalize="characters" autoComplete="off" spellCheck={false} enterKeyHint="search"
        onChange={(event) => setQuery(event.target.value)} />
      <Button type="submit" variant="primary" disabled={tracked.status === 'loading'} icon={<Search size={20} aria-hidden="true" />}>Find report</Button>
    </form>

    {recentReferences.length ? <div className="rp-recent">
      <span className="field-hint">Reports sent from this device:</span>
      <ul>{recentReferences.map((reference) => <li key={reference}><button type="button" className="rp-chip" aria-pressed={searched === reference} onClick={() => lookUp(reference)}>{reference}</button></li>)}</ul>
    </div> : null}

    <div ref={resultRef} tabIndex={-1} className="rp-track-result" aria-live="polite" aria-busy={tracked.status === 'loading'}>
      {tracked.status === 'idle' ? <p className="rp-empty">Your report’s progress will appear here.</p> : null}
      {tracked.status === 'loading' ? <p className="rp-loading"><LoaderCircle size={20} className="rp-spin" aria-hidden="true" />Looking up {searched}…</p> : null}
      {tracked.status === 'not_found' ? <div className="rp-callout rp-callout--warning" role="alert"><div><strong>We could not find {searched}</strong><p>Check the reference and try again. It looks like HS-26043 and is shown on the confirmation screen after you send a report.</p></div></div> : null}
      {tracked.status === 'error' ? <div className="rp-callout rp-callout--warning" role="alert"><div><strong>We could not load this report just now</strong><p>Check your connection and try again.</p><Button type="button" variant="secondary" onClick={tracked.retry}>Try again</Button></div></div> : null}
      {tracked.status === 'ready' && tracked.case ? <CaseProgress item={tracked.case} visit={tracked.visit} /> : null}
    </div>
  </section>;
}

function CaseProgress({ item, visit }: { item: NonNullable<ReturnType<typeof useTrackedCase>['case']>; visit: ReturnType<typeof useTrackedCase>['visit'] }) {
  const stage = trackingStage(item, visit);
  const problem = item.hazard_type === 'other' ? 'Repair' : CATEGORIES.find((entry) => entry.id === item.hazard_type)?.label ?? 'Repair';
  return <article className="rp-case" aria-label={`Report ${item.id}`}>
    <header className="rp-case-head">
      <div><span className="rp-address-label">Reference</span><strong className="rp-case-ref">{item.id}</strong></div>
      <span className="rp-stage-pill" data-outcome={stage.outcome ?? 'progress'}>{stage.outcome === 'unable' ? UNABLE_LABEL : TRACK_STAGES[stage.index]}</span>
    </header>
    <div>
      <p className="rp-case-status">{stage.headline}</p>
      <p className="rp-case-detail">{stage.detail}</p>
    </div>
    <ol className="rp-timeline" aria-label="Progress">
      {TRACK_STAGES.map((label, index) => {
        const isLast = index === TRACK_STAGES.length - 1;
        const state = index < stage.index || (index === stage.index && stage.outcome === 'completed') ? 'done' : index === stage.index ? (stage.outcome === 'unable' ? 'unable' : 'current') : 'todo';
        const text = isLast && stage.outcome === 'unable' ? UNABLE_LABEL : label;
        return <li key={label} data-state={state} aria-current={index === stage.index ? 'step' : undefined}>
          <span className="rp-timeline-dot" aria-hidden="true">{state === 'done' ? <Check size={12} strokeWidth={3} /> : state === 'unable' ? <X size={12} strokeWidth={3} /> : null}</span>
          <span>{text}<span className="rp-visually-hidden">{state === 'done' ? ' (done)' : state === 'current' ? ' (current stage)' : state === 'unable' ? ' (not completed)' : ' (not yet)'}</span></span>
        </li>;
      })}
    </ol>
    <dl className="rp-case-details">
      <div><dt>Problem</dt><dd>{problem}</dd></div>
      <div><dt>Priority</dt><dd>{needsUrgentAttention(item) ? 'Our automated check suggested prompt attention. A housing officer confirms the priority.' : 'Our automated check suggested a routine repair. A housing officer confirms the priority.'}</dd></div>
      <div><dt>Last updated</dt><dd>{formatDateTime(item.updated_at)}</dd></div>
    </dl>
  </article>;
}
