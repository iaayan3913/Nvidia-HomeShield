import type { LucideIcon } from 'lucide-react';

export function PortalPlaceholder({ eyebrow, title, description, icon: Icon, children }: { eyebrow: string; title: string; description: string; icon: LucideIcon; children?: React.ReactNode }) {
  return <section className="placeholder-page">
    <div className="placeholder-copy"><span className="eyebrow">{eyebrow}</span><Icon className="placeholder-icon" aria-hidden="true" /><h1>{title}</h1><p>{description}</p>{children}</div>
    <aside className="foundation-panel"><span>Foundation ready</span><strong>Shared design, data and workflow contracts are active.</strong><p>This shell is intentionally minimal and is owned by the assigned portal developer.</p></aside>
  </section>;
}
