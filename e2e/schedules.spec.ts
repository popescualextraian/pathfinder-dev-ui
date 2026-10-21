import { expect, test, APIRequestContext, Page } from '@playwright/test';

// Schedules, against `npm run start:local` (see playwright.config.ts: zone UTC, a tick every 2 s): the real scheduler and
// engine, real bridges, the fake agent. When the agent ends its turn the bridge asks it for a summary, writes the answer
// to result.md and stops; the fake agent answers `echo: <the request>`, which the schedule keeps as the summary.

interface Schedule { id: string; title: string }
interface Task { id: string; title: string }

const suffix = Date.now().toString(36);

// Remove whatever the tests left behind (also when one failed half way).
test.afterEach(async ({ request }: { request: APIRequestContext }) => {
  const schedules = (await (await request.get('/api/schedules')).json()) as Schedule[];
  for (const s of schedules.filter((x) => x.title.includes(suffix))) await request.delete(`/api/schedules/${s.id}`);
  const tasks = (await (await request.get('/api/tasks')).json()) as Task[];
  for (const t of tasks.filter((x) => x.title.includes(suffix))) {
    await request.post(`/api/tasks/${t.id}/close`);
    await request.delete(`/api/tasks/${t.id}`);
  }
});

async function openNewForm(page: Page, title: string, text: string): Promise<void> {
  await page.goto('/#/schedules');
  await page.getByRole('button', { name: 'New schedule' }).click();
  const form = page.getByRole('form', { name: 'New schedule' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Prompt').fill(text);
}

test('create a schedule, Run now, see its task on the board and its summary in the detail', async ({ page }) => {
  test.setTimeout(120_000); // the detail refreshes every 30 s
  const title = `Nightly ${suffix}`;
  const task = `tidy up ${suffix}`;
  await openNewForm(page, title, task);
  const form = page.getByRole('form', { name: 'New schedule' });
  await form.getByRole('radio', { name: 'Repeat', exact: true }).check();
  await expect(page.getByTestId('schedule-next-runs')).toContainText('Next runs:');
  await form.getByRole('button', { name: 'Save' }).click();

  // saved: the detail opens
  const detail = page.getByRole('article', { name: title });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Run now' }).click();
  await expect(detail.getByRole('status')).toContainText('started task');

  // the task is on the board with the clock chip and the schedule's title
  await page.goto('/');
  const chip = page.getByRole('link', { name: new RegExp(title) }).first();
  // a run that is over is in Done, whose closed tasks are folded
  const folded = page.getByRole('button', { name: /closed tasks/ });
  if (!(await chip.isVisible()) && (await folded.count()) > 0) await folded.click();
  await expect(chip).toBeVisible({ timeout: 30_000 });

  // the run ends and its result.md is the summary
  await page.goto('/#/schedules');
  await page.getByRole('link', { name: title, exact: true }).click();
  const result = page.getByRole('article', { name: title }).getByRole('listitem').filter({ hasText: 'Run now' });
  await expect(result).toContainText('echo:', { timeout: 60_000 });
  await expect(result).toContainText('done');
});

test('a one-off a minute ahead fires by itself', async ({ page }) => {
  test.setTimeout(180_000);
  const title = `Once ${suffix}`;
  const task = `tidy once ${suffix}`;
  await openNewForm(page, title, task);
  const form = page.getByRole('form', { name: 'New schedule' });
  await form.getByRole('radio', { name: 'Once', exact: true }).check();
  const at = new Date(Date.now() + 90_000).toISOString(); // zone UTC
  await form.getByLabel('Date').fill(at.slice(0, 10));
  await form.getByLabel('At', { exact: true }).fill(at.slice(11, 16));
  await form.getByRole('button', { name: 'Save' }).click();

  const detail = page.getByRole('article', { name: title });
  await expect(detail).toBeVisible();
  const result = detail.getByRole('listitem').filter({ hasText: 'By schedule' });
  await expect(result).toContainText('echo:', { timeout: 150_000 });
  await expect(result).toContainText('done');
});
