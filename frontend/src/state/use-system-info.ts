import { useEffect, useState } from 'react';
import { fetchSystemInfo, SystemInfo } from '../api/system-api';

export type SystemInfoState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: SystemInfo };

export function useSystemInfo(): SystemInfoState {
  const [state, setState] = useState<SystemInfoState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    fetchSystemInfo().then(
      (data) => active && setState({ status: 'success', data }),
      (error: unknown) =>
        active && setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
