import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from '../../../shared/components/Button';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  icon?: ReactNode;
  onConfirm(): void;
  onCancel(): void;
}

/** Modal confirmation with focus trap, Escape to cancel and focus restoration to the opener. */
export function ConfirmDialog({ title, children, confirmLabel, confirmVariant = 'primary', icon, onConfirm, onCancel }: Props) {
  const titleId = useId(); const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); onCancel(); return; }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <div ref={dialogRef} className="ops-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} onKeyDown={onKeyDown}>
      <h2 id={titleId}>{icon}{title}</h2>
      <div id={bodyId} className="ops-modal__body">{children}</div>
      <div className="ops-modal__actions">
        {/* Plain element (same shared classes) because the shared Button does not forward refs. */}
        <button ref={cancelRef} type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
        <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </div>;
}
