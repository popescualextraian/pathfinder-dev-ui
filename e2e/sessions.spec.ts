import { expect, test, Page, APIRequestContext } from '@playwright/test';

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, name: string, title: string) =>
  section(page, name).getByRole('button', { name: new RegExp(title) });

let testId = '';

test.afterEach(async ({ request }: { request: APIRequestContext }) => {
  if (!testId) return;
  const tasks = (await (await request.get('/api/tasks')).json()) as { id: string; title: string }[];
  for (const t of tasks.filter((x) => x.title.includes(testId))) {
    await request.post(`/api/tasks/${t.id}/close`);
    await request.delete(`/api/tasks/${t.id}`);
  }
});

test('sessions: add, fork, ask in a second session, answer from its tab, reload on the tab', async ({ page }) => {
  const id = Date.now().toString(36);
  testId = id;
  const title = `sess ${id}`;

  await page.goto('/');
  await page.getByRole('button', { name: '+ New task' }).click();
  const newTask = page.getByRole('dialog');
  await newTask.getByLabel('Prompt').fill(title);
  await newTask.getByRole('button', { name: 'Start task' }).click();
  await expect(newTask).toBeHidden({ timeout: 60_000 });

  const view = page.getByRole('article', { name: title });
  await expect(card(page, 'In review', title)).toBeVisible({ timeout: 30_000 });
  await expect(view.getByText(`echo: ${title}`).first()).toBeVisible({ timeout: 30_000 });
  const tabs = view.getByRole('tablist', { name: 'Sessions' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(page.getByTestId('session-tab-main')).toHaveAttribute('aria-selected', 'true');
  const taskId = (await (await page.request.get('/api/tasks')).json() as { id: string; title: string }[])
    .find((t) => t.title === title)!.id;

  const addSession = async (name: string, prompt: string, forkFrom?: string) => {
    await view.getByRole('button', { name: '+ Session' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New session' })).toBeVisible();
    await dialog.getByLabel('Name').fill(name);
    if (forkFrom) await dialog.getByLabel('Copy conversation from').selectOption(forkFrom);
    await dialog.getByLabel('First prompt (optional)').fill(prompt);
    await dialog.getByRole('button', { name: 'Create session' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  };

  // a second session with its own prompt and response; the main response is not shown there
  await addSession('second', 'hello second');
  await expect(page.getByTestId('session-tab-second')).toHaveAttribute('aria-selected', 'true');
  await expect(view.getByText('echo: hello second').first()).toBeVisible({ timeout: 30_000 });
  await expect(view.getByText(`echo: ${title}`)).toHaveCount(0);
  await page.getByTestId('session-tab-main').click();
  await expect(view.getByText(`echo: ${title}`).first()).toBeVisible();
  await expect(view.getByText('echo: hello second')).toHaveCount(0);
  await expect(card(page, 'In review', title)).toContainText('2 sessions', { timeout: 30_000 });

  // a session forked from main knows the main conversation (user + agent message = 2)
  await addSession('forked', 'HISTORY', 'main');
  await expect(page.getByTestId('session-tab-forked')).toBeVisible();
  await expect(view.getByText('history: 2').first()).toBeVisible({ timeout: 30_000 });
  await expect(card(page, 'In review', title)).toContainText('3 sessions', { timeout: 30_000 });

  // a question in `second` marks its tab and the card
  await page.getByTestId('session-tab-second').click();
  await expect(page.getByTestId('session-tab-second')).toHaveAttribute('aria-selected', 'true'); // panel swapped
  await view.getByLabel('Follow-up').fill('ASK:which one');
  await view.getByLabel('Follow-up').press('Enter');
  await expect(card(page, 'Needs you', title)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('session-tab-second').getByRole('img', { name: 'open question' })).toBeVisible();
  await expect(page.getByTestId('session-tab-main').getByRole('img', { name: 'open question' })).toHaveCount(0);
  await expect(page.getByTestId('card-asking')).toContainText('second asks');

  // answer it from its tab
  const question = view.getByRole('region', { name: 'Question' });
  await expect(question).toBeVisible();
  await question.getByLabel('Your answer').fill('the first one');
  await question.getByRole('button', { name: 'Answer' }).click();
  await expect(card(page, 'Needs you', title)).toHaveCount(0, { timeout: 30_000 });
  await expect(card(page, 'In review', title)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('session-tab-second').getByRole('img', { name: 'open question' })).toHaveCount(0);

  // full run of one session only
  await view.getByRole('button', { name: /View full run/ }).click();
  const run = page.getByTestId('full-run');
  await expect(run.getByText('echo: hello second')).toBeVisible({ timeout: 30_000 });
  await expect(run.getByText('history: 2')).toHaveCount(0);

  // reload on the session URL lands on that tab
  await page.goto(`/#/tasks/${taskId}?session=second`);
  await page.reload();
  await expect(page.getByTestId('session-tab-second')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('session-tab-main')).toHaveAttribute('aria-selected', 'false');
  const reloaded = page.getByRole('article', { name: title });
  await expect(reloaded.getByRole('region', { name: 'Last response' })).toBeVisible();
  await expect(reloaded.getByText(`echo: ${title}`)).toHaveCount(0); // main's response is not on this tab
});
