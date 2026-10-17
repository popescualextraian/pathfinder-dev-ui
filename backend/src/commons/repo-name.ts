// The name of a repository: the last part of its URL or path, without a trailing slash or `.git`.
export function repoNameOf(url: string): string {
  const parts = url.replace(/\/+$/, '').split(/[/:]/);
  return (parts[parts.length - 1] ?? '').replace(/\.git$/, '');
}
