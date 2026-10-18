import type { TaskCost } from '../api/models';

const usd = (n: number) => (n > 0 && n < 0.005 ? '<$0.01' : `$${n.toFixed(2)}`);

function tokens(n: number): string {
  const short = (v: number, unit: string) => `${v.toFixed(1).replace(/\.0$/, '')}${unit}`;
  // Switch the unit on the rounded value, so 999_999 shows "1M", not "1000k".
  if (n >= 1000 && Math.round(n / 100) / 10 >= 1000) return short(n / 1_000_000, 'M');
  if (n >= 1000) return short(n / 1000, 'k');
  return String(n);
}

/** Two display lines for a task's cost: USD per source, then token counts. */
export function formatCost(c: TaskCost): { usd: string; tokens: string } {
  const parts = [
    c.usd.estimate !== undefined ? `${usd(c.usd.estimate)} (estimate)` : '',
    c.usd.billedCredits !== undefined ? `${usd(c.usd.billedCredits)} credits` : '',
  ].filter(Boolean);
  let line = parts.join(' · ');
  if (c.usd.unknown !== undefined) line = line ? `${line} +?` : '+?';
  return {
    usd: line || '—',
    tokens: `in ${tokens(c.input)} · out ${tokens(c.output)} · cache ${tokens(c.cacheRead)} read / ${tokens(c.cacheWrite)} write`,
  };
}
