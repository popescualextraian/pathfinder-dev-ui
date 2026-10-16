import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SystemInfoView } from './views/SystemInfoView';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>agentic-dev-base</h1>
    <SystemInfoView />
  </StrictMode>,
);
