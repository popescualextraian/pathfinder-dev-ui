import { expect, test } from '@playwright/test';

// The workflow editor against `npm run start:local` with a writable copy of e2e/fixtures/workflows
// (START_LOCAL_COPY_WORKFLOWS, see playwright.config.ts): create a workflow, run it on a card, edit it.

interface Run { id: string; itemId: string; taskId: string; state: string }

const suffix = Date.now().toString(36);
const title = `Editor flow ${suffix}`;
const id = `editor-flow-${suffix}`;
let itemId: string | undefined;

test.afterEach(async ({ request }) => {
  const runs = (await (await request.get('/api/workflow-runs')).json()) as Run[];
  for (const run of runs.filter((r) => r.itemId === itemId)) {
    if (!['done', 'stopped', 'failed'].includes(run.state)) await request.post(`/api/workflow-runs/${run.id}/stop`);
    await request.post(`/api/tasks/${run.taskId}/close`);
    await request.delete(`/api/tasks/${run.taskId}`);
  }
  const stored = await request.get(`/api/workflows/${id}`);
  if (stored.ok()) {
    const { version } = (await stored.json()) as { version: string };
    await request.delete(`/api/workflows/${id}?version=${version}`);
  }
});

test('create a workflow in the editor, run it on a card, edit it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: 'New workflow' }).click();

  // Step 1: no lane, a prompt.
  await page.getByLabel('Workflow title').fill(title);
  await expect(page.getByLabel('Workflow id')).toHaveValue(id);
  await page.getByLabel('Step title').fill('Draft');
  await page.getByRole('textbox', { name: 'Session 1 prompt' }).fill('Draft #{{item.id}}: {{item.title}}');
  await expect(page.getByLabel('When this step starts, move the item to')).toHaveValue('');

  // Step 2: moves the card to Review.
  await page.getByRole('button', { name: '+ step' }).click();
  await expect(page.getByTestId('step-box-2')).toBeVisible();
  await page.getByLabel('Step title').fill('Check');
  await page.getByLabel('When this step starts, move the item to').selectOption({ label: 'Review' });
  await page.getByRole('textbox', { name: 'Session 1 prompt' }).fill('Check #{{item.id}}');
  await expect(page.getByTestId('step-box-2')).toContainText('→ Review');
  await expect(page.getByTestId('step-box-1')).toContainText('no lane move');
  await page.screenshot({ path: 'test-results/workflow-editor.png', fullPage: true });

  await page.getByRole('button', { name: 'Save' }).click();
  // Saved: the editor stays on the file (id locked, nothing left to save); Cancel leaves it without asking.
  await expect(page.getByLabel('Workflow id')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  const row = page.getByTestId(`workflow-row-${id}`);
  await expect(row).toContainText(title);
  await expect(row).toContainText('Draft → Check');

  // Start it on a card.
  const res = await page.request.post('/api/backlog/items', { data: { title: `Editor item ${suffix}` } });
  itemId = String((await res.json()).id);
  await page.goto('/#/backlog');
  const card = page.getByTestId(`backlog-card-${itemId}`);
  await card.getByRole('button', { name: `Start workflow on #${itemId}` }).click();
  await page.getByRole('dialog', { name: `Choose a workflow for #${itemId}` }).getByRole('button', { name: title }).click();
  await page.getByRole('dialog', { name: `Start ${title} on #${itemId}?` }).getByRole('button', { name: 'Start' }).click();

  const line = card.getByTestId('workflow-run-line');
  await expect(line).toHaveAttribute('data-state', 'awaiting-approval', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-step')).toHaveText('Draft · 1/2');
  await line.getByRole('button', { name: 'Continue → Check' }).click();
  await expect(page.getByRole('region', { name: 'Review', exact: true }).getByTestId(`backlog-card-${itemId}`)).toBeVisible({ timeout: 30_000 });
  await expect(line).toHaveAttribute('data-state', 'awaiting-approval', { timeout: 30_000 });
  await expect(line.getByTestId('workflow-step')).toHaveText('Check · 2/2');
  await line.getByRole('button', { name: 'Finish' }).click();
  await expect(line).toHaveAttribute('data-state', 'done', { timeout: 30_000 });

  // Edit: a new title shows in the list.
  await page.goto('/');
  await page.getByRole('button', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  await expect(page.getByLabel('Workflow id')).toBeDisabled();
  await page.getByLabel('Workflow title').fill(`${title} v2`);
  await page.getByTestId('step-box-1').click();
  await page.getByRole('textbox', { name: 'Session 1 prompt' }).fill('Draft again #{{item.id}}');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId(`workflow-row-${id}`)).toContainText(`${title} v2`);
  await page.reload();
  await expect(page.getByTestId(`workflow-row-${id}`)).toContainText(`${title} v2`);
});
