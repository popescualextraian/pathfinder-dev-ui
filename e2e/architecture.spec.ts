import { mkdirSync } from 'node:fs';
import { expect, test, Page, TestInfo } from '@playwright/test';

// The Architect page, against `npm run start:local` (see playwright.config.ts): ARCHITECTURE_ENABLED=1 and ENGINE_REPOS
// with two bare fixture repositories built by e2e/support/architecture-fixture.ts: `acme-shop` (the fixture model, its
// full review, plan reviews on `feature/gift-cards` and `agentic/T-20261024-ab12-move-catalog`) and `plain` (one part,
// no modules). The default repository stays this checkout, which has no architecture doc.

const EVIDENCE = 'reports/evidence';
// Evidence screenshots only on request (EVIDENCE=1), so test:ui leaves the tree clean.
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (process.env.EVIDENCE !== '1') return;
  mkdirSync(EVIDENCE, { recursive: true });
  const body = await page.screenshot({ path: `${EVIDENCE}/architecture-${name}.png`, fullPage: true });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

const chip = (page: Page, id: string) => page.getByTestId(`chip-${id}`);

test('the Architect page: picture, full review, plan reviews with their overlay, another repository', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/#/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const team = nav.locator('div').filter({ has: page.getByRole('heading', { name: 'Team', exact: true }) }).last();
  await team.getByRole('button', { name: 'Architect' }).click();
  await expect(page).toHaveURL(/#\/architect$/);

  // A repository without a doc: the empty state says how to make one (the default, this checkout, has one now).
  await page.getByRole('combobox', { name: 'Repository' }).selectOption('nodocs');
  await expect(page.getByText('/architect seed')).toBeVisible();

  await page.getByRole('combobox', { name: 'Repository' }).selectOption('acme-shop');
  await expect(page).toHaveURL(/#\/architect\?repo=acme-shop$/);
  const frontend = page.getByRole('region', { name: 'Frontend' });
  const backend = page.getByRole('region', { name: 'Backend' });
  await expect(frontend).toBeVisible();
  await expect(backend).toBeVisible();
  await expect(page.getByText('Modular monolith, layered')).toBeVisible();
  await expect(page.getByText(/^doc on main @ [0-9a-f]{7}$/)).toBeVisible();
  // No plan overlay on the current architecture.
  await expect(page.getByRole('img', { name: 'new component' })).toHaveCount(0);
  await expect(chip(page, 'order-service').getByRole('img', { name: '1 open finding' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Full review' })).toContainText('1 open');

  await chip(page, 'order-service').click();
  await expect(page.getByRole('complementary', { name: 'Order service' })).toContainText('Owns orders');
  await shot(page, testInfo, 'current');

  const reviewsTab = page.getByRole('tab', { name: 'Plan reviews (2)' });
  await reviewsTab.click();
  await expect(reviewsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Gift cards at checkout/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Serve the catalog from a headless CMS/ })).toBeVisible();
  await shot(page, testInfo, 'reviews');

  await page.getByRole('button', { name: /Gift cards at checkout/ }).click();
  await expect(page).toHaveURL(/#\/architect\/reviews\/feature%2Fgift-cards\/2026-10-20-gift-cards\?repo=acme-shop$/);
  const giftCard = chip(page, 'gift-card-service');
  await expect(giftCard).toHaveAttribute('data-state', 'new');
  await expect(giftCard).toContainText('+');
  await expect(giftCard).toContainText('Gift card service');
  await expect(giftCard).toHaveCSS('border-top-style', 'dashed');
  await expect(chip(page, 'order-service').getByRole('img', { name: 'changed component' })).toBeVisible();
  const impact = page.getByRole('region', { name: 'Gift cards at checkout' });
  await expect(impact).toContainText('The plan has the checkout view call the orders client direct');
  await shot(page, testInfo, 'gift-cards');

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Plan reviews (2)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Gift cards at checkout/ })).toHaveAttribute('aria-current', 'true');
  await expect(chip(page, 'gift-card-service')).toHaveAttribute('data-state', 'new');

  await page.getByRole('button', { name: /Serve the catalog from a headless CMS/ }).click();
  const catalogStore = chip(page, 'catalog-store');
  await expect(catalogStore).toHaveAttribute('data-state', 'removed');
  await expect(catalogStore.locator('s')).toHaveText('Catalog store');
  await expect(page.getByTestId('review-agentic/T-20261024-ab12-move-catalog/2026-10-22-move-catalog')).toContainText(
    'agentic/T-20261024-ab12-move-catalog',
  );
  await shot(page, testInfo, 'move-catalog');

  await page.getByRole('combobox', { name: 'Repository' }).selectOption('plain');
  await expect(page).toHaveURL(/#\/architect\?repo=plain$/);
  await expect(page.getByRole('tab', { name: 'Current architecture' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'App' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('columnheader')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Plan reviews (0)' })).toBeVisible();
  await shot(page, testInfo, 'plain');
});
