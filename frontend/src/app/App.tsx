import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ResidentPortal } from '../portals/resident/ResidentPortal';
import { OperationsPortal } from '../portals/operations/OperationsPortal';
import { OperativePortal } from '../portals/operative/OperativePortal';
import { startLiveData } from '../shared/mock';

/** Combined app for `npm run dev` and tests: every route in one bundle. Production uses the two apps. */
export function App() {
  useEffect(() => { startLiveData(); }, []);
  return (
    <Routes>
      <Route element={<AppShell title="HomeShield" />}>
        <Route index element={<Navigate to="/report" replace />} />
        <Route path="report" element={<ResidentPortal />} />
        <Route path="operations" element={<OperationsPortal />} />
        <Route path="operative" element={<OperativePortal />} />
        <Route path="*" element={<Navigate to="/report" replace />} />
      </Route>
    </Routes>
  );
}
