import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ResidentPortal } from '../portals/resident/ResidentPortal';
import { OperationsPortal } from '../portals/operations/OperationsPortal';
import { OperativePortal } from '../portals/operative/OperativePortal';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/report" replace />} />
        <Route path="report" element={<ResidentPortal />} />
        <Route path="operations" element={<OperationsPortal />} />
        <Route path="operative" element={<OperativePortal />} />
        <Route path="*" element={<Navigate to="/report" replace />} />
      </Route>
    </Routes>
  );
}
