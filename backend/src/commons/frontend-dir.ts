import { join } from 'node:path';

// backend/src (ts-jest) and dist/backend (built) both sit two levels below the root; Vite builds the frontend into dist/frontend.
export const FRONTEND_DIR = join(__dirname, '..', '..', '..', 'dist', 'frontend');
