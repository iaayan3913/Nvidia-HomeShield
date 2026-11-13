import { Outlet, useLocation } from 'react-router-dom';
import { PortalNav } from '../shared/components/PortalNav';

export function AppShell() {
  const { pathname } = useLocation();
  const theme = pathname.startsWith('/operations') ? 'operations' : pathname.startsWith('/operative') ? 'operative' : 'resident';
  return (
    <div className="app" data-portal={theme}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <PortalNav />
      <main id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
