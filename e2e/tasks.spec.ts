import { expect, test, Page, APIRequestContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, name: string, title: string) =>
  section(page, name).getByRole('button', { name: new RegExp(title) });

async function startTask(page: Page, prompt: string) {
  await page.getByRole('button', { name: '+ New task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Prompt').fill(prompt);
  await dialog.getByRole('button', { name: 'Start task' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

let testId = '';

// Remove whatever the test left behind (also when it failed half way).
test.afterEach(async ({ request }: { request: APIRequestContext }) => {
  if (!testId) return;
  const res = await request.get('/api/tasks');
  const tasks = (await res.json()) as { id: string; title: string }[];
  for (const t of tasks.filter((x) => x.title.includes(testId))) {
    await request.post(`/api/tasks/${t.id}/close`);
    await request.delete(`/api/tasks/${t.id}`);
  }
});

test('task lifecycle: start, ask, answer, follow-up, full run, close, delete', async ({ page }) => {
  const id = Date.now().toString(36);
  testId = id;
  const echoTitle = `echo ${id}`;
  const askTitle = `ASK:pick ${id}`;

  await page.goto('/');
  await page.reload();
  await expect(page.getByRole('button', { name: '+ New task' })).toBeVisible();

  // start a task: it ends up in review with its echo
  await startTask(page, echoTitle);
  const view = page.getByRole('article', { name: echoTitle });
  await expect(card(page, 'In review', echoTitle)).toBeVisible({ timeout: 30_000 });
  await expect(view.getByText(`echo: ${echoTitle}`).first()).toBeVisible({ timeout: 30_000 });

  // ASK: puts a task under Needs you (no reload anywhere in this test)
  await startTask(page, askTitle);
  await expect(card(page, 'Needs you', askTitle)).toBeVisible({ timeout: 30_000 });
  const askView = page.getByRole('article', { name: askTitle });
  const question = askView.getByRole('region', { name: 'Question' });
  await expect(question).toBeVisible();

  // answer it: the card leaves Needs you
  await question.getByLabel('Your answer').fill('the first one');
  await question.getByRole('button', { name: 'Answer' }).click();
  await expect(card(page, 'Needs you', askTitle)).toHaveCount(0, { timeout: 30_000 });
  await expect(card(page, 'In review', askTitle)).toBeVisible({ timeout: 30_000 });

  // follow-up on the first task: it works, then comes back to review with the new echo
  await card(page, 'In review', echoTitle).click();
  await view.getByLabel('Follow-up').fill('second turn');
  await view.getByLabel('Follow-up').press('Enter');
  await expect(view.getByText('echo: second turn').first()).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'In review', echoTitle)).toBeVisible({ timeout: 30_000 });

  // full run: only on request
  await expect(page.getByTestId('full-run')).toHaveCount(0);
  await view.getByRole('button', { name: /View full run/ }).click();
  const run = page.getByTestId('full-run');
  await expect(run.getByText('echo: second turn')).toBeVisible({ timeout: 30_000 });
  await view.getByRole('button', { name: /Hide full run/ }).click();
  await expect(run).toHaveCount(0);

  // close: the card moves to Done (collapsed), the record stays
  await view.getByRole('button', { name: 'Close task' }).click();
  await expect(card(page, 'In review', echoTitle)).toHaveCount(0, { timeout: 30_000 });
  await expect(view.getByRole('button', { name: 'Close task' })).toHaveCount(0);
  const done = section(page, 'Done');
  // Done is collapsed unless it holds the selected task (which is the closed one now)
  await expect(done.getByRole('button', { name: new RegExp(echoTitle) })).toBeVisible();
  await done.getByRole('button', { name: /closed tasks/ }).click(); // hide
  await expect(done.getByRole('button', { name: new RegExp(echoTitle) })).toHaveCount(0);
  await done.getByRole('button', { name: /closed tasks/ }).click(); // show
  await expect(done.getByRole('button', { name: new RegExp(echoTitle) })).toBeVisible();

  // delete forever
  await done.getByRole('button', { name: new RegExp(echoTitle) }).click();
  await view.getByRole('button', { name: 'Delete forever' }).click();
  await view.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(done.getByRole('button', { name: new RegExp(echoTitle) })).toHaveCount(0);

  // clean up the other task too
  await card(page, 'In review', askTitle).click();
  await askView.getByRole('button', { name: 'Close task' }).click();
  await expect(card(page, 'In review', askTitle)).toHaveCount(0, { timeout: 30_000 });
});

test('facts panel shows the cost: a dash without one, the ledger sum after a turn', async ({ page, request }) => {
  const id = Date.now().toString(36);
  testId = id;
  const title = `cost ${id}`;
  await page.goto('/');
  await startTask(page, title);
  const view = page.getByRole('article', { name: title });
  await expect(card(page, 'In review', title)).toBeVisible({ timeout: 30_000 });
  const facts = page.locator('dl', { has: page.getByText('Task id') });
  const costRow = facts.locator('div', { has: page.getByText('Cost', { exact: true }) });
  await expect(costRow).toHaveText(/—/);

  // seed the ledger the cost plugin would write, then end another turn so the engine reads it
  const tasks = (await (await request.get('/api/tasks')).json()) as { id: string; title: string }[];
  const task = tasks.find((t) => t.title === title)!;
  const record = {
    schema: 'cost-record/v1', ts: '2026-10-17T10:00:00Z', project: 'p', harness: 'claude-code', session: 's1',
    context: { kind: 'task', task: task.id }, models: [],
    totals: { input: 12300, output: 45600, cache_read: 1_200_000, cache_write: 80_000, cost: { estimate: 1.84 } },
  };
  const dir = join(process.cwd(), '.local', '3100', 'local-tasks', task.id, 'task');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ledger.jsonl'), `${JSON.stringify(record)}\n`);
  await view.getByLabel('Follow-up').fill('again');
  await view.getByLabel('Follow-up').press('Enter');
  await expect(costRow).toContainText('$1.84 (estimate)', { timeout: 30_000 });
  await expect(costRow).toContainText('in 12.3k · out 45.6k · cache 1.2M read / 80k write');
});
