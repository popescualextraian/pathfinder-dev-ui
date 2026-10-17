import type { Repository } from './models';
import { request } from './http';

export const listRepositories = () => request<Repository[]>('/api/repositories');
