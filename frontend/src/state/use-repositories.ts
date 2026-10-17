import { useEffect, useState } from 'react';
import type { Repository } from '../api/models';
import { listRepositories } from '../api/repositories-api';

export function useRepositories() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listRepositories()
      .then((list) => active && setRepositories(list))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { repositories, loading, error };
}
