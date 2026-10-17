import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { AppShell } from './views/AppShell';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell sidebar={<p>agentic</p>} list={<p>Tasks</p>} main={<p>Select a task</p>} facts={null} />
  </StrictMode>,
);
