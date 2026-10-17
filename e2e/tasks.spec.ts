import { expect, test, Page } from '@playwright/test';

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, name: string, title: string) =>
  section(page, name).getByRole('button', { name: new RegExp(title) });

async function startTask(page: Page, prompt: string) {
  await page.getByRole('button', { name: '+ New task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Prompt').fill(prompt);
  await dialog.getByRole('button', { name: 'Start task' }).click();
  await expect(dialog).toBeHidden();
}

test('task lifecycle: start, ask, answer, follow-up, full run, close, delete', async ({ page }) => {
  const id = Date.now().toString(36);
  const echoTitle = `echo ${id}`;
  const askTitle = `ASK:pick ${id}`;

  await page.goto('/');
  await page.evaluate(() => window.location.reload()); // list loaded once, then live only
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
