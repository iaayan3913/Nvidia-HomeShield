import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck, ClipboardList, Copy, Info, Plus } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { useNotifications } from '../../../shared/notifications/NotificationProvider';
import type { Case, Property } from '../../../shared/mock';
import { needsUrgentAttention } from '../caseLabels';
import { CONTACT_METHODS, type ResidentCategory } from '../model';

export function Confirmation({ created, property, category, preferredContact, onTrack, onNewReport }: {
  created: Case; property?: Property; category?: ResidentCategory; preferredContact: string; onTrack: () => void; onNewReport: () => void;
}) {
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
      <p>This is a demonstration: a simulated report and case were created in this browser.</p>
    </div>

    <div className="rp-reference">
      <span>Your reference</span>
      <strong>{created.id}</strong>
      <Button type="button" variant="quiet" icon={<Copy size={18} aria-hidden="true" />} onClick={() => void copy()}>Copy reference</Button>
    </div>

    <div className={`rp-callout ${urgent ? 'rp-callout--warning' : 'rp-callout--info'}`} role="status">
      {urgent ? <CircleAlert size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
      <div>
        <strong>{urgent ? 'Simulated triage: flagged for urgent human attention' : 'Simulated triage: routine officer review'}</strong>
        <p>{urgent
          ? 'The demonstration’s automatic rules suggest this may need prompt attention, so it has been highlighted for a housing officer. A person decides the actual urgency.'
          : 'The demonstration’s automatic rules did not flag this as urgent. A housing officer still reviews every report and decides the actual priority.'}</p>
        {created.hazard_type === 'gas' ? <p><strong>If you can smell gas, call 0800 111 999 now if you have not already.</strong></p> : null}
      </div>
    </div>

    <section aria-labelledby="rp-next-title" className="rp-next">
      <h3 id="rp-next-title">What happens next</h3>
      <ol>
        <li>A housing officer reviews your {category ? category.label.toLowerCase() : 'repair'} report{property ? ` for ${property.display_address}` : ''}.</li>
        <li>If a repair visit is needed, the team plans an appointment with a suitable operative.</li>
        <li>They contact you by {contact} to arrange access.</li>
        <li>You can check progress at any time using your reference.</li>
      </ol>
      <p className="field-hint">Timings are not guaranteed in this demonstration and no legal deadline is being set.</p>
    </section>

    <div className="rp-actions">
      <Button type="button" variant="primary" icon={<ClipboardList size={20} aria-hidden="true" />} onClick={onTrack}>Track this report</Button>
      <Button type="button" variant="secondary" icon={<Plus size={20} aria-hidden="true" />} onClick={onNewReport}>Report another problem</Button>
    </div>
  </section>;
}
