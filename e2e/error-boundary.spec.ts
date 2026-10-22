import { expect, test, type Page } from '@playwright/test';
import { mockAudio } from './helpers/audio';

const track = {
  id: 'boundary-track', title: 'Recovery test', artist: 'Artist',
  duration_seconds: 20, audio_url: '/boundary-audio.mp3', version: 3,
  lines: [{ id: 'a', index: 0, text: 'Keep these timings' }],
  alignment: { segments: [{ line_id: 'a', start_ms: 0, end_ms: 3000 }] },
};

async function setCrash(page: Page, enabled: boolean) {
  await page.evaluate(value => {
    Object.assign(window, { __testRenderFailure: value });
  }, enabled);
}

test.beforeEach(async ({ page }) => {
  // Modify only the served test module; no crash trigger enters production code.
  await page.route(/\/src\/editor\/LyricsPane\.tsx(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'function LyricsPane() {';
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(marker, `${marker}
        if (window.__testRenderFailure) throw new Error('Controlled rendering failure');`),
    });
  });
  await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
  await mockAudio(page, '/boundary-audio.mp3', 20);
});

test('retry preserves unsaved timings and history, including after a repeated failure', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') logged.push(message.text());
  });
  await page.goto('/');
  const move = page.getByRole('button', { name: 'Move Keep these timings', exact: true });
  await expect(move).toBeVisible();
  await move.press('ArrowRight');
  await expect(page.getByTestId('segment-a')).toContainText('0:00.100 – 0:03.100');

  await setCrash(page, true);
  await move.press('ArrowRight');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The editor ran into a problem.');
  await expect(alert).toContainText('Your unsaved changes are still in this session.');
  await expect(alert).not.toContainText('Controlled rendering failure');
  await expect(page.getByRole('heading', { name: track.title })).toHaveCount(0);
  await expect.poll(() => logged.some(message =>
    message.includes('Editor rendering failed') && message.includes('LyricsPane'),
  )).toBe(true);

  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(alert).toBeVisible();
  await setCrash(page, false);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId('segment-a')).toContainText('0:00.200 – 0:03.200');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save alignment', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('segment-a')).toContainText('0:00.100 – 0:03.100');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`fallback screenshot at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Object.assign(window, { __testRenderFailure: true });
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `test-results/error-boundary/${viewport.width > 1000 ? 'desktop' : 'mobile'}.png`,
      fullPage: true,
    });
  });
}
