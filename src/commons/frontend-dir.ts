import { join } from 'node:path';

// src/ (ts-jest) and dist/ (built) both sit one level below the root; Vite builds the frontend into dist/frontend.
export const FRONTEND_DIR = join(__dirname, '..', '..', 'dist', 'frontend');
