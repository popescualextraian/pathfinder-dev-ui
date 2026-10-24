import { ApiError, request } from './http';
import type { ArchitectureStatus, CurrentArchitecture, ReviewDetail, ReviewList } from './models';

const withRepository = (path: string, repository?: string | null) =>
  repository ? `${path}?repository=${encodeURIComponent(repository)}` : path;

/** Null when the feature is off (404). */
export async function getArchitectureStatus(): Promise<ArchitectureStatus | null> {
  try {
    return await request<ArchitectureStatus>('/api/architecture/status');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const getArchitecture = (repository?: string | null) =>
  request<CurrentArchitecture>(withRepository('/api/architecture', repository));

export const listReviews = (repository?: string | null) =>
  request<ReviewList>(withRepository('/api/architecture/reviews', repository));

export const getReview = (repository: string | null, branch: string, slug: string) =>
  request<ReviewDetail>(
    withRepository(`/api/architecture/reviews/${encodeURIComponent(branch)}/${encodeURIComponent(slug)}`, repository),
  );
