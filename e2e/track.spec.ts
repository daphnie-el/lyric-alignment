import { test, expect } from './fixtures';

/**
 * Exercise the real API and proxy without assuming the demo is still current.
 * Imports persist, so the running workspace may contain any song or be empty.
 */
test('the app renders the current API track or an empty workspace', async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/track' && response.request().method() === 'GET'),
    page.goto('/'),
  ]);
  const payload = await response.json();
  if (response.status() === 404) {
    expect(payload.error).toBe('no_current_track');
    await expect(page.getByText('No song loaded. Use Load song to choose an audio file from your device or enter a direct audio URL.', { exact: true })).toHaveCount(2);
  } else {
    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { name: payload.title, exact: true })).toBeVisible();
  }
});
