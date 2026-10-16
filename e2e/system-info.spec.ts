import { expect, test } from '@playwright/test';
import pkg from '../package.json';

test('shows name and version from package.json', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(pkg.name, { exact: true })).toBeVisible();
  await expect(page.getByText(pkg.version, { exact: true })).toBeVisible();
});
