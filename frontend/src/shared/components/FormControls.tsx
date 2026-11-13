import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type FieldMeta = { label: string; hint?: string; error?: string };

function FieldFrame({ id, label, hint, error, children }: FieldMeta & { id: string; children: React.ReactNode }) {
  const description = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return <div className={`field${error ? ' field--error' : ''}`}>
    <label htmlFor={id}>{label}</label>{children}
    {error ? <span id={`${id}-error`} className="field-error" role="alert">{error}</span> : hint ? <span id={`${id}-hint`} className="field-hint">{hint}</span> : null}
    {description ? null : null}
  </div>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldMeta>(function Input({ label, hint, error, id: suppliedId, ...props }, ref) {
  const autoId = useId(); const id = suppliedId ?? autoId;
  return <FieldFrame id={id} label={label} hint={hint} error={error}><input ref={ref} id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} /></FieldFrame>;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldMeta>(function Select({ label, hint, error, id: suppliedId, children, ...props }, ref) {
  const autoId = useId(); const id = suppliedId ?? autoId;
  return <FieldFrame id={id} label={label} hint={hint} error={error}><select ref={ref} id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props}>{children}</select></FieldFrame>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMeta>(function Textarea({ label, hint, error, id: suppliedId, ...props }, ref) {
  const autoId = useId(); const id = suppliedId ?? autoId;
  return <FieldFrame id={id} label={label} hint={hint} error={error}><textarea ref={ref} id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} /></FieldFrame>;
});
