import { useEffect, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PortalNav } from '../shared/components/PortalNav';

/** Shared page frame. `data-portal` is a styling hook only; the colour theme lives on <html data-theme>. */
export function AppShell({ nav = <PortalNav />, title }: { nav?: ReactNode; title: string }) {
  const { pathname } = useLocation();
  const portal = pathname.startsWith('/operations') ? 'operations' : pathname.startsWith('/operative') ? 'operative' : 'resident';
  useEffect(() => { document.title = title; }, [title]);
  return (
    <div className="app" data-portal={portal}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {nav}
      <main id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
