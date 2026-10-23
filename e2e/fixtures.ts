import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Download, Locator, Page, Request } from "@playwright/test";

export async function skipWalkthrough(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("lyric-alignment:walkthrough:v1", "dismissed");
  });
}

// Walkthrough tests can opt in with test.use({ skipWalkthrough: false }).
export const test = base.extend<{ skipWalkthrough: boolean }>({
  skipWalkthrough: [true, { option: true }],
  page: async ({ page, skipWalkthrough: shouldSkipWalkthrough }, use) => {
    if (shouldSkipWalkthrough) await skipWalkthrough(page);
    await use(page);
  },
});
