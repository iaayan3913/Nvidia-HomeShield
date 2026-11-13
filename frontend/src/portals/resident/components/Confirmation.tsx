import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck, ClipboardList, Copy, Info, Plus } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useNotifications } from '../../../shared/notifications/NotificationProvider';
import type { Case } from '../../../shared/mock';
import { needsUrgentAttention } from '../caseLabels';
import { CONTACT_METHODS, type ResidentCategory } from '../model';

export interface SubmittedReport { created: Case; home: string | null; category?: ResidentCategory; preferredContact: string }

export function Confirmation({ created, home, category, preferredContact, onTrack, onNewReport }: SubmittedReport & { onTrack: () => void; onNewReport: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { notify } = useNotifications();
  useEffect(() => { headingRef.current?.focus(); }, []);
  const urgent = needsUrgentAttention(created);
  const contact = CONTACT_METHODS.find((item) => item.id === preferredContact)?.label.toLowerCase() ?? 'your preferred method';

  const copy = async () => {
    try { await navigator.clipboard.writeText(created.id); notify({ kind: 'success', title: 'Reference copied', message: `${created.id} is on your clipboard.` }); }
    catch { notify({ kind: 'warning', title: 'Could not copy', message: `Please note down your reference: ${created.id}.` }); }
  };

  return <section className="rp-confirmation" aria-labelledby="rp-confirm-title">
    <div className="rp-confirm-head">
      <CircleCheck size={32} aria-hidden="true" className="rp-confirm-icon" />
      <h2 id="rp-confirm-title" ref={headingRef} tabIndex={-1}>Your repair report has been sent</h2>
      <p>Thank you. Your housing team has received it.</p>
      <p className="rp-visually-hidden" role="status">Report sent. Your reference is {created.id}.</p>
    </div>

    <div className="rp-reference">
      <span>Your reference</span>
      <strong>{created.id}</strong>
      <Button type="button" variant="quiet" icon={<Copy size={18} aria-hidden="true" />} onClick={() => void copy()}>Copy reference</Button>
      <p className="field-hint">Keep this reference. You will need it to check progress or if you contact the housing team.</p>
    </div>

    <div className={`rp-callout ${urgent ? 'rp-callout--warning' : 'rp-callout--info'}`}>
      {urgent ? <CircleAlert size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
      <div>
        <strong>{urgent ? 'Our automated check suggests this may need prompt attention' : 'Our automated check suggests this is a routine repair'}</strong>
        <p>A housing officer will confirm the priority. If things get worse before then, report it again or call the housing team.</p>
        {created.hazard_type === 'gas' ? <p><strong>If you can smell gas, call 0800 111 999 now if you have not already.</strong></p> : null}
      </div>
    </div>

    <section aria-labelledby="rp-next-title" className="rp-next">
      <h3 id="rp-next-title">What happens next</h3>
      <ol>
        <li>A housing officer reviews your {category ? category.label.toLowerCase() : 'repair'} report{home ? ` for ${home}` : ''}.</li>
        <li>If a repair visit is needed, the team books an operative with the right skills.</li>
        <li>We contact you by {contact} to arrange access.</li>
        <li>You can check progress at any time with your reference.</li>
      </ol>
    </section>

    <div className="rp-actions">
      <Button type="button" variant="primary" icon={<ClipboardList size={20} aria-hidden="true" />} onClick={onTrack}>Track this report</Button>
      <Button type="button" variant="secondary" icon={<Plus size={20} aria-hidden="true" />} onClick={onNewReport}>Report another problem</Button>
    </div>
  </section>;
}
