export interface SystemInfo {
  name: string;
  version: string;
  uptimeSeconds: number;
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const response = await fetch('/api/system/info');
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as SystemInfo;
}
