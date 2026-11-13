import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, MapPin, Search } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/FormControls';
import { StatusBadge } from '../../../shared/components/Status';
import { isApiMode, useDemoState } from '../../../shared/data';
import { JOB_STATUS, RESIDENT_STATUS, TIMELINE, formatDateTime, needsUrgentAttention, timelineIndex } from '../caseLabels';
import { CATEGORIES } from '../model';

export function TrackReport({ initialReference, recentReferences, onReferenceChange }: { initialReference: string; recentReferences: string[]; onReferenceChange: (reference: string) => void }) {
  const [query, setQuery] = useState(initialReference);
  const [searched, setSearched] = useState(initialReference.trim().toUpperCase());
  const [error, setError] = useState<string | undefined>();
  const resultRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const cases = useDemoState((state) => state.cases);
  const reports = useDemoState((state) => state.reports);
  const properties = useDemoState((state) => state.properties);
  const jobs = useDemoState((state) => state.jobs);

  useEffect(() => { setQuery(initialReference); setSearched(initialReference.trim().toUpperCase()); }, [initialReference]);

  const found = searched ? cases.find((item) => item.id.toUpperCase() === searched) : undefined;
  const property = found ? properties.find((item) => item.id === found.property_id) : undefined;
  const job = found ? jobs.find((item) => item.case_id === found.id) : undefined;
  const report = found?.report_id ? reports.find((item) => item.id === found.report_id) : undefined;
  const categoryLabel = report ? labelForReport(report.category, report.text) : found ? found.hazard_type.replaceAll('_', ' ') : '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const reference = query.trim().toUpperCase();
    if (!reference) { setError('Enter your report reference, for example HS-26043.'); return; }
    setError(undefined); setSearched(reference); onReferenceChange(reference);
    window.setTimeout(() => resultRef.current?.focus(), 0);
  };

  const stage = found ? timelineIndex(found.status) : 0;

  return <section className="rp-track" aria-labelledby={titleId}>
    <h2 id={titleId}>Track a report</h2>
    <p className="rp-lead">Enter the reference you were given when you sent your report. Progress updates from the {isApiMode ? 'connected housing system' : 'simulated workflow'}.</p>
    <form className="rp-track-form" onSubmit={submit} noValidate>
      <Input label="Report reference" placeholder="HS-26043" value={query} error={error} autoCapitalize="characters" autoComplete="off" spellCheck={false}
        onChange={(event) => setQuery(event.target.value)} />
      <Button type="submit" variant="primary" icon={<Search size={20} aria-hidden="true" />}>Find report</Button>
    </form>

    {recentReferences.length ? <div className="rp-recent">
      <span className="field-hint">Reports sent from this tab:</span>
      <ul>{recentReferences.map((reference) => <li key={reference}><button type="button" className="rp-chip" onClick={() => { setQuery(reference); setSearched(reference); setError(undefined); onReferenceChange(reference); }}>{reference}</button></li>)}</ul>
    </div> : null}

    <div ref={resultRef} tabIndex={-1} className="rp-track-result" aria-live="polite">
      {!searched ? <p className="rp-empty">Your report’s progress will appear here.</p>
        : !found ? <div className="rp-callout rp-callout--warning" role="alert"><div><strong>We could not find {searched}</strong><p>Check the reference and try again. References look like HS-26043. If the demonstration was reset, earlier reports are cleared.</p></div></div>
        : <article className="rp-case" aria-label={`Report ${found.id}`}>
            <header className="rp-case-head">
              <div><span className="rp-address-label">Reference</span><strong className="rp-case-ref">{found.id}</strong></div>
              <StatusBadge value={found.status} />
            </header>
            <p className="rp-case-status">{RESIDENT_STATUS[found.status]}</p>
            <ol className="rp-timeline" aria-label="Progress">
              {TIMELINE.map((label, index) => <li key={label} data-state={index < stage ? 'done' : index === stage ? 'current' : 'todo'} aria-current={index === stage ? 'step' : undefined}>
                <span className="rp-timeline-dot" aria-hidden="true">{index < stage || (index === stage && found.status === 'resolved') ? <Check size={12} strokeWidth={3} /> : null}</span>
                <span>{label}<span className="rp-visually-hidden">{index < stage ? ' (done)' : index === stage ? ' (current)' : ' (not yet)'}</span></span>
              </li>)}
            </ol>
            <dl className="rp-case-details">
              <div><dt>Problem</dt><dd className="rp-capitalise">{categoryLabel}</dd></div>
              {property ? <div><dt>Property</dt><dd><MapPin size={16} aria-hidden="true" /> {property.display_address}, {property.postcode} <span className="rp-tag">Fictional</span></dd></div> : null}
              {job ? <div><dt>Repair visit</dt><dd>{JOB_STATUS[job.status]}</dd></div> : null}
              <div><dt>Simulated triage</dt><dd>{needsUrgentAttention(found) ? 'Flagged for urgent human attention' : 'Routine officer review'}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDateTime(found.updated_at)}</dd></div>
            </dl>
            <p className="field-hint">{isApiMode ? 'Statuses come from FastAPI. Automated triage still requires professional review.' : 'All statuses are part of a simulated demonstration workflow and are not an official decision.'}</p>
          </article>}
    </div>
  </section>;
}

function labelForReport(category: string, text: string) {
  const mapped = CATEGORIES.find((item) => item.hazard === 'other' && item.id !== 'other' && text.startsWith(`${item.label}:`));
  if (mapped) return mapped.label;
  return CATEGORIES.find((item) => item.id === category)?.label ?? category.replaceAll('_', ' ');
}
