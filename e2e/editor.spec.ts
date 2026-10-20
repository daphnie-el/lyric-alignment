import { expect, test } from '@playwright/test';
import { mockAudio, waitForAudio } from './helpers/audio';

const longLine = `A long lyric that should wrap naturally ${'through the quiet night '.repeat(12)}`;
const track = {
  id: 'different-track', title: 'A Different Song', artist: 'Another Artist',
  duration_seconds: 247.125, audio_url: '/test-audio.mp3', version: 3,
  lines: [
    { id: 'verse-a', index: 0, text: 'The first line of another song' },
    { id: 'verse-b', index: 1, text: longLine },
    { id: 'verse-c', index: 2, text: 'An untimed ending' },
  ],
  alignment: { segments: [{ line_id: 'verse-b', start_ms: 12345, end_ms: 16789 }] },
};

test.beforeEach(async ({ page }) => {
  await mockAudio(page, track.audio_url, track.duration_seconds);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`selection shows timing while karaoke follows playback at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: track.title })).toBeVisible();
    await waitForAudio(page);
    await expect(page.getByText('Another Artist · 4:07')).toBeVisible();
    await expect(page.getByText('3 lines · 1 placed')).toBeVisible();
    const inspector = page.getByRole('complementary', { name: 'Selection' });
    const preview = page.getByRole('region', { name: 'Karaoke · selection preview' });
    await expect(inspector.getByText('Select a lyric line to view its timing.')).toBeVisible();

    const lyrics = page.getByRole('list', { name: 'Lyric lines' });
    const line = lyrics.getByRole('button', { name: `${longLine} 0:12.345`, exact: true });
    await line.focus();
    await page.keyboard.press('Enter');
    await expect(line).toHaveAttribute('aria-current', 'true');
    await expect(inspector.getByText(longLine, { exact: true })).toBeVisible();
    await expect(inspector.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:12');
    await expect(inspector.getByRole('textbox', { name: 'End', exact: true })).toHaveValue('0:16');
    await expect(inspector.getByText('0:04', { exact: true })).toBeVisible();
    await expect(preview.getByText('♪ ♪ ♪', { exact: true })).toBeVisible();
    await expect(preview.getByText(longLine, { exact: true })).toHaveCount(0);

    await page.locator('audio').evaluate(audio => { audio.currentTime = 12.345; });
    await expect(preview.getByText(longLine, { exact: true })).toBeVisible();
    await expect(preview.getByText(track.lines[0].text, { exact: true })).toBeVisible();

    await page.locator('audio').evaluate(audio => { audio.currentTime = 16.789; });
    await expect(preview.getByText('♪ ♪ ♪', { exact: true })).toBeVisible();
    await expect(line).toHaveAttribute('aria-current', 'true');

    await page.locator('audio').evaluate(audio => { audio.currentTime = 20; });
    await lyrics.getByRole('button', { name: 'An untimed ending Untimed', exact: true }).click();
    await expect(line).toHaveAttribute('aria-current', 'false');
    await expect(inspector.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:20');
    await expect(inspector.getByRole('textbox', { name: 'End', exact: true })).toHaveValue('4:07');
    await expect(inspector.getByText('3:47', { exact: true })).toBeVisible();
    await expect(preview.getByText('An untimed ending', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Clear selection' }).click();
    await expect(preview.getByText('♪ ♪ ♪', { exact: true })).toBeVisible();
    await expect(inspector.getByText('Select a lyric line to view its timing.')).toBeVisible();
    await expect(page.getByTestId('segment-verse-c')).toHaveCount(0);
    await expect(page.getByText('3 lines · 1 placed')).toBeVisible();
    await expect(lyrics.getByRole('button', { name: 'An untimed ending Untimed', exact: true })).toHaveAttribute('aria-current', 'false');
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345 – 0:19.999');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
    if (viewport.width > 1100) {
      const lyricsBox = await page.getByRole('region', { name: 'Lyrics', exact: true }).boundingBox();
      const timelineBox = await page.getByRole('region', { name: 'Timeline', exact: true }).boundingBox();
      const inspectorBox = await inspector.boundingBox();
      expect(lyricsBox!.x + lyricsBox!.width).toBeLessThanOrEqual(timelineBox!.x);
      expect(timelineBox!.x + timelineBox!.width).toBeLessThanOrEqual(inspectorBox!.x);
    }
  });
}

test('loading and failed requests retain the shell and support retry with empty lyrics', async ({ page }) => {
  let shouldFail = true;
  await page.route('**/api/v1/track', async route => {
    if (shouldFail) {
      await route.fulfill({ status: 503, json: { error: 'unavailable' } });
    } else {
      await route.fulfill({ json: { ...track, lines: [], alignment: null } });
    }
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load the track.');
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  shouldFail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: track.title })).toBeVisible();
  await expect(page.getByText('No lyrics yet. This track has no lines to select.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shell remains visible while the track is loading', async ({ page }) => {
  await page.route('**/api/v1/track', () => {});
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading track…');
  await expect(page.getByRole('heading', { name: 'Lyrics', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selection', exact: true })).toBeVisible();
});

test.describe('timing edits', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
    await page.goto('/');
    await page.getByRole('list', { name: 'Lyric lines' }).getByRole('button').nth(1).click();
  });

  test('preserves fine timing on unchanged blur and accepts minutes and seconds', async ({ page }) => {
    const start = page.getByRole('textbox', { name: 'Start', exact: true });
    const end = page.getByRole('textbox', { name: 'End', exact: true });
    await start.focus();
    await start.blur();
    await end.focus();
    await end.blur();
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345 – 0:16.789');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await end.fill('1:33');
    await end.press('Enter');
    await start.fill('1:30');
    await start.press('Enter');
    await expect(start).toHaveValue('1:30');
    await expect(end).toHaveValue('1:33');
    await expect(page.getByTestId('segment-verse-b')).toContainText('1:30.000 – 1:33.000');
  });

  test('requires m:ss endpoints and positive duration, commits on blur', async ({ page }) => {
    const start = page.getByRole('textbox', { name: 'Start', exact: true });
    const end = page.getByRole('textbox', { name: 'End', exact: true });
    for (const value of ['', '1.30', '0:60', '0:17', '12345']) {
      await start.fill(value);
      await start.blur();
      await expect(start).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345');
    }
    await start.fill('0:00');
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345');
    await start.blur();
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:00.000');
    await expect(start).toHaveValue('0:00');
    await end.fill('4:08');
    await end.blur();
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    await end.fill('4:07');
    await end.blur();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('segment-verse-b')).toContainText('4:07.000');
  });
});
