import { mkdirSync } from 'node:fs';
import { expect, test, APIRequestContext, Page } from '@playwright/test';

// A plain task on a work item ("▶ Task"), against `npm run start:local` with the in-memory backlog (see
// playwright.config.ts): the real runner and engine, a real bridge, the fake agent (answers `echo: <prompt>`).
// The link is a workflow run of kind `task`; the card never changes lane.

interface Run { id: string; itemId: string; taskId: string; state: string; kind?: string }

const EVIDENCE = 'reports/evidence';
// Evidence screenshots only on request (EVIDENCE=1), so test:ui leaves the tree clean.
const shot = async (page: Page, name: string) => {
  if (process.env.EVIDENCE !== '1') return;
  mkdirSync(EVIDENCE, { recursive: true });
  const body = await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
  await test.info().attach(name, { body, contentType: 'image/png' });
};
const created: string[] = [];

async function newItem(request: APIRequestContext, title: string): Promise<{ id: string; title: string }> {
  const fullTitle = `${title} ${Date.now().toString(36)}`;
  const res = await request.post('/api/backlog/items', {
    data: { title: fullTitle, description: 'Users want to sign in with a magic link.' },
  });
  expect(res.ok()).toBe(true);
  const id = String((await res.json()).id);
  created.push(id);
  return { id, title: fullTitle };
}

async function laneOf(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`/api/backlog/items/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).lane as string;
}

test.afterEach(async ({ request }) => {
  const runs = (await (await request.get('/api/workflow-runs')).json()) as Run[];
  for (const run of runs.filter((r) => created.includes(r.itemId))) {
    if (!['done', 'stopped', 'failed'].includes(run.state)) await request.post(`/api/workflow-runs/${run.id}/stop`);
    await request.post(`/api/tasks/${run.taskId}/close`);
    await request.delete(`/api/tasks/${run.taskId}`);
  }
  created.length = 0;
});

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const card = (page: Page, id: string) => page.getByTestId(`backlog-card-${id}`);

test('▶ Task starts a plain task linked to the item; Stop ends the link; the card never moves', async ({ page }) => {
  if (process.env.EVIDENCE === '1') mkdirSync(EVIDENCE, { recursive: true });
  const item = await newItem(page.request, 'Magic link');
  const { id } = item;
  expect(await laneOf(page.request, id)).toBe('backlog');

  await page.goto('/#/backlog');
  await expect(lane(page, 'Backlog').getByTestId(`backlog-card-${id}`)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, id).getByRole('button', { name: `Start workflow on #${id}` })).toBeVisible();

  // The New task dialog, prefilled for the item.
  await card(page, id).getByRole('button', { name: `Start task on #${id}` }).click();
  const dialog = page.getByRole('dialog', { name: `New task on #${id}` });
  await expect(dialog.getByLabel('Title')).toHaveValue(`#${id} ${item.title}`);
  const prompt = dialog.getByLabel('Prompt');
  await expect(prompt).toHaveValue(new RegExp(`^We plan to work on backlog item #${id}: ${item.title}\\n\\nUsers want`));
  await expect(prompt).toHaveValue(/Do not change anything yet\.$/);
  await shot(page, '019-dialog');
  await prompt.fill(`Look at #${id}, then wait.`);
  await dialog.getByRole('button', { name: 'Start task' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 }); // the task starts first (worktree, bridge)

  // The task screen of the new task, with its item link; the fake agent answered.
  const runs = (await (await page.request.get('/api/workflow-runs')).json()) as Run[];
  const run = runs.find((r) => r.itemId === id);
  expect(run).toMatchObject({ kind: 'task', state: 'running' });
  await expect(page).toHaveURL(new RegExp(`#/tasks/${run!.taskId}`));
  const view = page.getByRole('article');
  await expect(view.getByText(`echo: Look at #${id}, then wait.`).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('task-workflow-line')).toHaveText(`Task · #${id} on the board`);
  await shot(page, '019-task-screen');

  // Back to the board through the item link: the card's run line, in the same lane.
  await page.getByRole('link', { name: `#${id} on the board` }).click();
  await expect(page).toHaveURL(new RegExp(`#/backlog\\?item=${id}`));
  const line = card(page, id).getByTestId('workflow-run-line');
  await expect(line.getByTestId('workflow-title')).toHaveText('Task');
  await expect(line).toHaveAttribute('data-state', 'running', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-step')).toHaveCount(0);
  await expect(line.getByRole('button', { name: /Continue|Finish/ })).toHaveCount(0);
  await expect(card(page, id).getByRole('button', { name: `Start task on #${id}` })).toHaveCount(0);
  await expect(card(page, id).getByRole('button', { name: `Start workflow on #${id}` })).toHaveCount(0);
  await expect(lane(page, 'Backlog').getByTestId(`backlog-card-${id}`)).toBeVisible();

  // The item detail shows the same link, without a step list.
  const detail = page.getByRole('complementary', { name: 'Item detail' });
  await expect(detail.getByTestId('workflow-run-line').getByTestId('workflow-title')).toHaveText('Task');
  await expect(detail.getByRole('list', { name: 'Workflow steps' })).toHaveCount(0);
  await shot(page, '019-card-run-line');
  await line.getByRole('link', { name: 'Open task' }).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${run!.taskId}`));
  await page.goBack();

  // Stop asks first, ends the link only: the task stays, the buttons come back, the card did not move.
  await line.getByRole('button', { name: '■ Stop' }).click();
  await page.getByRole('dialog', { name: `Stop the task link on #${id}?` }).getByRole('button', { name: 'Yes, stop' }).click();
  await expect(line).toHaveAttribute('data-state', 'stopped');
  await expect(card(page, id).getByRole('button', { name: `Start task on #${id}` })).toBeVisible();
  await expect(card(page, id).getByRole('button', { name: `Start workflow on #${id}` })).toBeVisible();
  const task = await page.request.get(`/api/tasks/${run!.taskId}`);
  expect(task.ok()).toBe(true);
  expect((await task.json()).state).not.toBe('stopped');
  await expect(lane(page, 'Backlog').getByTestId(`backlog-card-${id}`)).toBeVisible();
  expect(await laneOf(page.request, id)).toBe('backlog');
  await shot(page, '019-after-stop');
});
