import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { checkHealth } from '../../shared/mock';
import { AppShell } from '../AppShell';
import { PortalNav } from '../../shared/components/PortalNav';
import { ResidentPortal } from '../../portals/resident/ResidentPortal';

/** Resident app: report and track only. No staff links, no staff code and no full case list. */
export function ResidentApp() {
  useEffect(checkHealth, []);
  return (
    <Routes>
      <Route element={<AppShell title="HomeShield · Report a repair" nav={<PortalNav links={[]} home="/report" />} />}>
        <Route path="report" element={<ResidentPortal />} />
        <Route path="*" element={<Navigate to="/report" replace />} />
      </Route>
    </Routes>
  );
}
