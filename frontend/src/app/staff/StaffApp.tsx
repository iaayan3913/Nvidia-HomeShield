import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { PortalNav, STAFF_LINKS } from '../../shared/components/PortalNav';
import { startLiveData } from '../../shared/mock';

const OperationsPortal = lazy(() => import('../../portals/operations/OperationsPortal').then((m) => ({ default: m.OperationsPortal })));
const OperativePortal = lazy(() => import('../../portals/operative/OperativePortal').then((m) => ({ default: m.OperativePortal })));
const Loading = () => <p className="page-loading" role="status">Loading…</p>;

/** Staff app (laptop/PC): Operations and Operative, fed by the live backend. */
export function StaffApp() {
  useEffect(() => { startLiveData(); }, []);
  return (
    <Routes>
      <Route element={<AppShell title="HomeShield Staff" nav={<PortalNav links={STAFF_LINKS} home="/operations" product="HomeShield Staff" />} />}>
        <Route index element={<Navigate to="/operations" replace />} />
        <Route path="operations" element={<Suspense fallback={<Loading />}><OperationsPortal /></Suspense>} />
        <Route path="operative" element={<Suspense fallback={<Loading />}><OperativePortal /></Suspense>} />
        <Route path="*" element={<Navigate to="/operations" replace />} />
      </Route>
    </Routes>
  );
}
