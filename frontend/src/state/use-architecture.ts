import { useEffect, useRef, useState } from 'react';
import { getArchitecture, getArchitectureStatus, getReview, listReviews } from '../api/architecture-api';
import { ApiError } from '../api/http';
import type { CurrentArchitecture, ReviewDetail, ReviewList } from '../api/models';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Whether the feature is on and which repositories it lists. */
export function useArchitectureStatus() {
  const [state, setState] = useState<{ enabled: boolean; repositories: string[]; loading: boolean }>({
    enabled: false,
    repositories: [],
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    getArchitectureStatus()
      .then((s) => {
        if (alive) setState({ enabled: s !== null, repositories: s?.repositories ?? [], loading: false });
      })
      .catch(() => {
        if (alive) setState({ enabled: false, repositories: [], loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

interface Loaded<T> {
  loading: boolean;
  error: string | null;
  notFound: boolean;
  data: T | null;
}

/** Loads on a change of `key`; a response that is no longer the latest request is dropped. */
function useLoaded<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<Loaded<T>>({ loading: true, error: null, notFound: false, data: null });
  useEffect(() => {
    const seq = ++latest.current;
    setState({ loading: true, error: null, notFound: false, data: null });
    loadRef.current().then(
      (data) => {
        if (seq === latest.current) setState({ loading: false, error: null, notFound: false, data });
      },
      (e: unknown) => {
        if (seq !== latest.current) return;
        const notFound = e instanceof ApiError && e.status === 404;
        setState({ loading: false, error: message(e), notFound, data: null });
      },
    );
    return () => {
      latest.current++;
    };
  }, [key]);
  return state;
}

export function useArchitecture(repository: string | null): {
  loading: boolean; error: string | null; notFound: boolean; data: CurrentArchitecture | null;
} {
  return useLoaded(() => getArchitecture(repository), repository ?? '');
}

export function useArchitectureReviews(repository: string | null): {
  loading: boolean; error: string | null; list: ReviewList | null;
} {
  const { loading, error, data } = useLoaded(() => listReviews(repository), repository ?? '');
  return { loading, error, list: data };
}

export function useReviewDetail(
  repository: string | null,
  branch: string,
  slug: string,
): { loading: boolean; error: string | null; notFound: boolean; data: ReviewDetail | null } {
  return useLoaded(() => getReview(repository, branch, slug), JSON.stringify([repository, branch, slug]));
}
