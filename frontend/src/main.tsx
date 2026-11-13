import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { NotificationProvider } from './shared/notifications/NotificationProvider';
import './styles/global.css';

// __APP_TARGET__ is a build-time constant, so the bundler drops the branches for the other apps
// (the resident bundle contains no MapLibre, deck.gl or staff portal code).
const loadApp = (): Promise<ComponentType> =>
  __APP_TARGET__ === 'resident' ? import('./app/resident/ResidentApp').then((m) => m.ResidentApp)
    : __APP_TARGET__ === 'staff' ? import('./app/staff/StaffApp').then((m) => m.StaffApp)
      : import('./app/App').then((m) => m.App);

void loadApp().then((App) => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
));
