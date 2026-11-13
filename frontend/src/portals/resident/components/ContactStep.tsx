import { ShieldCheck } from 'lucide-react';
import { Input, Textarea } from '../../../shared/components/FormControls';
import { CONTACT_METHODS, type FieldErrors, type ReportDraft } from '../model';

export const CONTACT_FIELD_IDS = { name: 'rp-name', phone: 'rp-phone', preferredContact: `rp-contact-${CONTACT_METHODS[0]!.id}` } as const;

export function PrivacyNote() {
  return <div className="rp-privacy">
    <ShieldCheck size={20} aria-hidden="true" />
    <div>
      <strong>How we use your details</strong>
      <p>Your report, name and phone number are shared with your housing team so they can assess the repair. We need your phone number to arrange a visit and to reach you if the problem sounds urgent. Your photo and voice note go to the repairs team only.</p>
    </div>
  </div>;
}

export function ContactStep({ draft, errors, update }: { draft: ReportDraft; errors: FieldErrors; update: (patch: Partial<ReportDraft>) => void }) {
  return <div className="rp-step-body">
    <Input id={CONTACT_FIELD_IDS.name} label="Your name" autoComplete="name" autoCapitalize="words" error={errors.name} value={draft.name} maxLength={80}
      onChange={(event) => update({ name: event.target.value })} />
    <Input id={CONTACT_FIELD_IDS.phone} label="Phone number" type="tel" inputMode="tel" autoComplete="tel" hint="A mobile or landline, for example 07700 900123." error={errors.phone}
      value={draft.phone} maxLength={20} onChange={(event) => update({ phone: event.target.value })} />
    <fieldset className={`rp-fieldset${errors.preferredContact ? ' rp-fieldset--error' : ''}`} aria-describedby={errors.preferredContact ? 'rp-contact-error' : undefined}>
      <legend className="rp-legend-small">How would you prefer us to contact you?</legend>
      {errors.preferredContact ? <span id="rp-contact-error" className="field-error">{errors.preferredContact}</span> : null}
      <div className="rp-radio-row">
        {CONTACT_METHODS.map((method) => <label key={method.id} className="rp-radio" data-checked={draft.preferredContact === method.id}>
          <input type="radio" name="rp-contact" id={`rp-contact-${method.id}`} value={method.id} checked={draft.preferredContact === method.id} onChange={() => update({ preferredContact: method.id })} />
          <span>{method.label}</span>
        </label>)}
      </div>
    </fieldset>
    <Textarea label="Access notes (optional)" hint="For example, times to avoid, a pet in the home, or how to get into the building." value={draft.accessNotes} maxLength={500} rows={3}
      onChange={(event) => update({ accessNotes: event.target.value })} />
    <PrivacyNote />
  </div>;
}
