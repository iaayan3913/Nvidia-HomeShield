import { forwardRef } from 'react';
import { CircleAlert } from 'lucide-react';
import type { FieldErrors } from '../model';

/** Focusable summary shown when a step fails validation. Links move focus to the field. */
export const ErrorSummary = forwardRef<HTMLDivElement, { errors: FieldErrors; fieldIds: Partial<Record<keyof FieldErrors, string>> }>(function ErrorSummary({ errors, fieldIds }, ref) {
  const entries = Object.entries(errors).filter(([, message]) => Boolean(message)) as Array<[keyof FieldErrors, string]>;
  if (!entries.length) return null;
  return <div ref={ref} className="rp-error-summary" role="alert" tabIndex={-1} aria-labelledby="rp-error-title">
    <CircleAlert size={20} aria-hidden="true" />
    <div>
      <h3 id="rp-error-title">{entries.length === 1 ? 'There is a problem' : `There are ${entries.length} problems`}</h3>
      <ul>{entries.map(([key, message]) => {
        const target = fieldIds[key];
        return <li key={key}>{target ? <a href={`#${target}`} onClick={(event) => { event.preventDefault(); document.getElementById(target)?.focus(); }}>{message}</a> : message}</li>;
      })}</ul>
    </div>
  </div>;
});
