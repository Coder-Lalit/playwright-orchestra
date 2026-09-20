import { expect, type Page, test } from '@playwright/test';

export async function searchWikipedia(page: Page, term: string): Promise<void> {
  console.log(`STEP open_wikipedia url=https://www.wikipedia.org/ term=${term}`);
  await page.goto('https://www.wikipedia.org/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

  const search = page.locator('#searchInput');
  await search.waitFor({ state: 'visible', timeout: 20_000 });
  console.log(`STEP fill_search term=${term}`);
  await search.fill(term);

  console.log('STEP submit_search');
  const submit = page.locator('#search-form button[type="submit"]');
  const navigation = page.waitForURL(
    (url) => /\/wiki\/|Special:Search|search=/i.test(url.toString()),
    { timeout: 30_000 }
  );
  if ((await submit.count()) > 0) {
    await submit.click();
  } else {
    await search.press('Enter');
  }
  await navigation;
  await page.waitForLoadState('domcontentloaded');

  console.log('STEP assert_title');
  const heading = page.locator('#firstHeading').first();
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(heading).toContainText(term, { ignoreCase: true, timeout: 30_000 });

  if (process.env.SCREENSHOT_PATH) {
    try {
      await page.screenshot({ path: process.env.SCREENSHOT_PATH, timeout: 10_000 });
    } catch (error) {
      console.log(`STEP screenshot_skipped error=${error instanceof Error ? error.message : error}`);
    }
  }
}

export function wikipediaSpec(term: string): void {
  test(`search for ${term} and assert page title`, async ({ page }) => {
    await searchWikipedia(page, term);
  });
}
