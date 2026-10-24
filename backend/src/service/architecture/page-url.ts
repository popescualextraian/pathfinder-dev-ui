// Base URL of a branch's docs/architecture/ folder on the repository's web host, or null when there is none.
// Userinfo never appears in the result.
export function pageBase(repoUrl: string, branch: string): string | null {
  let host: string;
  let path: string;
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(?!\/)(.+)$/.exec(repoUrl);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let u: URL;
    try {
      u = new URL(repoUrl);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'ssh:'].includes(u.protocol) || !u.hostname) return null;
    host = u.hostname;
    path = u.pathname;
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!path || !/^[A-Za-z0-9._~/-]+$/.test(path) || !/^[A-Za-z0-9.-]+$/.test(host)) return null;
  const ref = branch.split('/').map(encodeURIComponent).join('/');
  const blob = host.toLowerCase() === 'github.com' ? 'blob' : '-/blob';
  return `https://${host}/${path}/${blob}/${ref}/docs/architecture/`;
}
