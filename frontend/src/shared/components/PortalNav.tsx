import { ClipboardPenLine, HardHat, Map } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { DemoIndicator } from './Status';

const links = [
  { to: '/report', label: 'Report a problem', icon: ClipboardPenLine },
  { to: '/operations', label: 'Operations', icon: Map },
  { to: '/operative', label: 'Operative', icon: HardHat },
];

export function PortalNav() {
  return (
    <header className="topbar">
      <NavLink className="brand" to="/report" aria-label="HomeShield home">
        <span className="brand-mark" aria-hidden="true">H</span>
        <span>HomeShield</span>
      </NavLink>
      <nav className="portal-nav" aria-label="Portal navigation">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `portal-link${isActive ? ' is-active' : ''}`}>
            <Icon size={17} aria-hidden="true" /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <DemoIndicator />
    </header>
  );
}
