import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { AppNotification } from '../types/domain';

type ToastInput = Pick<AppNotification, 'kind' | 'title' | 'message'>;
type NotificationContextValue = { notify(input: ToastInput): void };
const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const remove = useCallback((id: string) => setToasts((items) => items.filter((item) => item.id !== id)), []);
  const notify = useCallback((input: ToastInput) => {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { ...input, id, created_at: new Date().toISOString(), read: false }]);
    window.setTimeout(() => remove(id), 5200);
  }, [remove]);
  const value = useMemo(() => ({ notify }), [notify]);
  return <NotificationContext.Provider value={value}>{children}<div className="toast-region" aria-live="polite" aria-label="Notifications">
    {toasts.map((toast) => { const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'warning' || toast.kind === 'critical' ? TriangleAlert : Info; return <div className="toast" data-kind={toast.kind} key={toast.id}><Icon aria-hidden="true" /><div><strong>{toast.title}</strong><p>{toast.message}</p></div><button type="button" onClick={() => remove(toast.id)} aria-label="Dismiss notification"><X size={16} /></button></div>; })}
  </div></NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationProvider');
  return value;
}
