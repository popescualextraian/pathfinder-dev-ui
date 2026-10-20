import { FileLink } from '../../service/backlog-connector';

// The owned comment starts with this marker; the JSON block follows on the next line and ends at "-->".
export const FILE_LINKS_MARKER = '<!-- pathfinder:file-links v1';

// `<` and `>` are escaped so that the JSON can never end the HTML comment early.
const escapeJson = (json: string): string => json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const inline = (text: string): string => text.replace(/[`\r\n]+/g, ' ');

export function renderFileLinks(links: FileLink[]): string {
  const json = escapeJson(JSON.stringify(links));
  const lines = links.map((l) => `- \`${inline(l.repo)}:${inline(l.path)}${l.ref ? `@${inline(l.ref)}` : ''}\`${l.note ? ` ${inline(l.note)}` : ''}`);
  return [`${FILE_LINKS_MARKER}\n${json}\n-->`, '**Linked files** (managed by Pathfinder, edits are overwritten)', ...lines].join('\n');
}

// True for a comment that Pathfinder owns, even when its block is damaged: it is then rewritten, not duplicated.
export function isFileLinksComment(body: string): boolean {
  return body.startsWith(FILE_LINKS_MARKER);
}

const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

// undefined when the marker is absent or the block is malformed.
export function parseFileLinks(body: string): FileLink[] | undefined {
  if (!isFileLinksComment(body)) return undefined;
  const match = /^\n([^\n]*)\n-->/.exec(body.slice(FILE_LINKS_MARKER.length));
  if (!match) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(data)) return undefined;
  const links: FileLink[] = [];
  for (const raw of data as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    if (typeof o.repo !== 'string' || typeof o.path !== 'string' || !optionalString(o.ref) || !optionalString(o.note)) return undefined;
    const link: FileLink = { repo: o.repo, path: o.path };
    if (o.ref !== undefined) link.ref = o.ref as string;
    if (o.note !== undefined) link.note = o.note as string;
    links.push(link);
  }
  return links;
}
