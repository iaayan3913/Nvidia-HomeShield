import { CircleAlert, Info, PhoneCall, ShieldAlert } from 'lucide-react';
import type { ResidentCategory } from '../model';

/** Always-visible emergency guidance. Calm in tone; numbers are links so they can be tapped on a phone. */
export function EmergencyStrip() {
  return <p className="rp-emergency-strip">
    <PhoneCall size={18} aria-hidden="true" />
    <span>In immediate danger? Call <a href="tel:999">999</a>. Smell gas? Call <a href="tel:08001119999">0800 111 999</a>.</span>
  </p>;
}

export function SafetyPanel() {
  return <section className="rp-safety" aria-labelledby="rp-safety-title">
    <h2 id="rp-safety-title"><ShieldAlert size={20} aria-hidden="true" />Keeping safe</h2>
    <dl>
      <div><dt>Someone in immediate danger, fire or a collapse</dt><dd><a className="rp-phone" href="tel:999">Call 999</a></dd></div>
      <div><dt>Smell gas or a carbon monoxide alarm is sounding (Great Britain)</dt><dd><a className="rp-phone" href="tel:08001119999">Call 0800 111 999</a></dd></div>
    </dl>
    <p>HomeShield does not replace the emergency services. Reports are reviewed by people during working hours.</p>
  </section>;
}

export function CategorySafety({ category }: { category: ResidentCategory }) {
  if (!category.safety) return null;
  const { tone, title, points } = category.safety;
  const Icon = tone === 'danger' ? CircleAlert : Info;
  return <div className={`rp-callout rp-callout--${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
    <Icon size={20} aria-hidden="true" />
    <div>
      <strong>{title}</strong>
      <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
      {tone === 'danger' ? <a className="button button--danger rp-callout-action" href="tel:08001119999"><PhoneCall size={18} aria-hidden="true" />Call 0800 111 999</a> : null}
    </div>
  </div>;
}
