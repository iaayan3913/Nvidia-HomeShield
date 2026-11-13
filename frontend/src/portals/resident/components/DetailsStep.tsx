import { MapPin } from 'lucide-react';
import { Input, Select, Textarea } from '../../../shared/components/FormControls';
import type { Property } from '../../../shared/mock';
import { CONTACT_METHODS, type FieldErrors, type ReportDraft } from '../model';

export const DETAILS_FIELD_IDS = { propertyId: 'rp-property', name: 'rp-name', phone: 'rp-phone', preferredContact: `rp-contact-${CONTACT_METHODS[0]!.id}` } as const;

export function DetailsStep({ draft, errors, update, properties }: { draft: ReportDraft; errors: FieldErrors; update: (patch: Partial<ReportDraft>) => void; properties: Property[] }) {
  const property = properties.find((item) => item.id === draft.propertyId);
  return <div className="rp-step-body">
    <p className="rp-demo-note"><strong>Demonstration only.</strong> Every property here is fictional. Please use made-up details: they are kept only in this demo’s simulated records in your browser.</p>

    <section className="rp-subsection" aria-labelledby="rp-home-title">
      <h3 id="rp-home-title">Your home</h3>
      <Select id={DETAILS_FIELD_IDS.propertyId} label="Property" hint="Choose one of the fictional demonstration homes." error={errors.propertyId}
        value={draft.propertyId} onChange={(event) => update({ propertyId: event.target.value })} disabled={!properties.length}>
        <option value="">{properties.length ? 'Choose a property' : 'No demonstration properties available'}</option>
        {properties.map((item) => <option key={item.id} value={item.id}>{item.display_address}, {item.postcode}</option>)}
      </Select>
      {property
        ? <div className="rp-address" aria-live="polite">
            <MapPin size={20} aria-hidden="true" />
            <div>
              <span className="rp-address-label">Address we will use</span>
              <strong>{property.display_address}</strong>
              <span>{property.area} · {property.postcode}</span>
              <span className="rp-tag">Fictional address</span>
            </div>
          </div>
        : null}
    </section>

    <section className="rp-subsection" aria-labelledby="rp-contact-title">
      <h3 id="rp-contact-title">How we can reach you</h3>
      <Input id={DETAILS_FIELD_IDS.name} label="Your name" autoComplete="off" error={errors.name} value={draft.name} maxLength={80}
        onChange={(event) => update({ name: event.target.value })} />
      <Input id={DETAILS_FIELD_IDS.phone} label="Contact number" type="tel" inputMode="tel" autoComplete="off" hint="For example 07700 900123 (a fictional number is fine)." error={errors.phone}
        value={draft.phone} maxLength={20} onChange={(event) => update({ phone: event.target.value })} />
      <fieldset className={`rp-fieldset${errors.preferredContact ? ' rp-fieldset--error' : ''}`} aria-describedby={errors.preferredContact ? 'rp-contact-error' : undefined}>
        <legend className="rp-legend-small">How would you prefer to be contacted?</legend>
        {errors.preferredContact ? <span id="rp-contact-error" className="field-error">{errors.preferredContact}</span> : null}
        <div className="rp-radio-row">
          {CONTACT_METHODS.map((method) => <label key={method.id} className="rp-radio" data-checked={draft.preferredContact === method.id}>
            <input type="radio" name="rp-contact" id={`rp-contact-${method.id}`} value={method.id} checked={draft.preferredContact === method.id} onChange={() => update({ preferredContact: method.id })} />
            <span>{method.label}</span>
          </label>)}
        </div>
      </fieldset>
      <Textarea label="Access notes (optional)" hint="For example, times to avoid, a pet in the home, or a door code. Do not include anything sensitive." value={draft.accessNotes} maxLength={500} rows={3}
        onChange={(event) => update({ accessNotes: event.target.value })} />
    </section>
  </div>;
}
