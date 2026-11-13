import { ClipboardPenLine, HardHat, Map, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { ThemeControl } from '../theme/ThemeControl';
import { ConnectionIndicator, TestModeIndicator } from './Status';

export interface NavItem { to: string; label: string; icon: LucideIcon }
export const RESIDENT_LINK: NavItem = { to: '/report', label: 'Report a problem', icon: ClipboardPenLine };
export const STAFF_LINKS: NavItem[] = [
  { to: '/operations', label: 'Operations', icon: Map },
  { to: '/operative', label: 'Operative', icon: HardHat },
];

/** Shared header. The resident app passes no links; the staff app passes the staff links. */
export function PortalNav({ links = [RESIDENT_LINK, ...STAFF_LINKS], home = '/report', product = 'HomeShield', showConnection = links.some((l) => l.to !== '/report') }: { links?: NavItem[]; home?: string; product?: string; showConnection?: boolean }) {
  return (
    <header className="topbar">
      <NavLink className="brand" to={home} aria-label={`${product} home`}>
        <img className="brand-logo" src="/logo.png" alt="" />
        <span>{product}</span>
      </NavLink>
      {links.length > 0 ? <nav className="portal-nav" aria-label="Main navigation">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `portal-link${isActive ? ' is-active' : ''}`}>
            <Icon size={17} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
      </nav> : <span />}
      <div className="topbar__tools">
        <TestModeIndicator />
        {showConnection && <ConnectionIndicator />}
        <ThemeControl />
      </div>
    </header>
  );
}
