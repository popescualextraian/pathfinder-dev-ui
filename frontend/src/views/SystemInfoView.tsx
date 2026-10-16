import { useSystemInfo } from '../state/use-system-info';

export function SystemInfoView() {
  const state = useSystemInfo();

  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;

  const { name, version, uptimeSeconds } = state.data;
  return (
    <dl>
      <dt>Name</dt>
      <dd>{name}</dd>
      <dt>Version</dt>
      <dd>{version}</dd>
      <dt>Uptime</dt>
      <dd>{uptimeSeconds} s</dd>
    </dl>
  );
}
