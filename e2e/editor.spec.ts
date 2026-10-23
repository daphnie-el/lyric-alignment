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

test('deleting a timed lyric supports undo and redo', async ({ page }) => {
  await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
  await page.goto('/');
  const lyrics = page.getByRole('list', { name: 'Lyric lines' });
  const line = lyrics.getByRole('button').filter({ hasText: track.lines[1].text });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const save = page.getByRole('button', { name: 'Save alignment', exact: true });
  const segment = page.getByTestId('segment-verse-b');

  await line.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(line).toHaveCount(0);
  await expect(lyrics.getByRole('button')).toHaveCount(2);
  await expect(segment).toHaveCount(0);
  await expect(save).toBeEnabled();

  await undo.click();
  await expect(line).toBeVisible();
  await expect(lyrics.getByRole('button').nth(1)).toContainText(track.lines[1].text);
  await expect(segment).toContainText('0:12.345 – 0:16.789');
  await expect(save).toBeDisabled();
  await redo.click();
  await expect(line).toHaveCount(0);
  await expect(segment).toHaveCount(0);

  await undo.click();
  // A new deletion branches history and invalidates the previous redo.
  await line.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(redo).toBeDisabled();
  await expect(line).toHaveCount(0);
});

test('lyric text commits on blur and follows undo, redo, and selection', async ({ page }) => {
  await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
  await page.goto('/');
  const lyrics = page.getByRole('list', { name: 'Lyric lines' });
  await lyrics.getByRole('button').nth(1).click();
  const text = page.getByRole('textbox', { name: 'Lyric text', exact: true });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const save = page.getByRole('button', { name: 'Save alignment', exact: true });
  await expect(text).toHaveValue(longLine);
  await text.fill('An edited lyric');
  await expect(lyrics.getByRole('button').nth(1)).toContainText(longLine);
  await expect(save).toBeDisabled();
  await text.blur();
  await expect(lyrics.getByRole('button').nth(1)).toContainText('An edited lyric');
  await expect(save).toBeEnabled();
  await undo.click();
  await expect(text).toHaveValue(longLine);
  await expect(save).toBeDisabled();
  await redo.click();
  await expect(text).toHaveValue('An edited lyric');
  // An unchanged blur must not add another undo step.
  await text.focus();
  await text.blur();
  await undo.click();
  await expect(text).toHaveValue(longLine);
  await expect(undo).toBeDisabled();
  await lyrics.getByRole('button').nth(0).click();
  await expect(text).toHaveValue(track.lines[0].text);
  await lyrics.getByRole('button').nth(1).click();
  await expect(text).toHaveValue(longLine);
});

test('timing edits and lyric deletion share the same undo history', async ({ page }) => {
  await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
  await page.goto('/');
  const lyrics = page.getByRole('list', { name: 'Lyric lines' });
  await lyrics.getByRole('button').nth(1).click();
  const start = page.getByRole('textbox', { name: 'Start at', exact: true });
  await start.fill('0:10');
  await start.press('Enter');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const segment = page.getByTestId('segment-verse-b');
  await undo.click();
  await expect(segment).toContainText('0:10.000 – 0:16.789');
  await undo.click();
  await expect(segment).toContainText('0:12.345 – 0:16.789');
  await expect(page.getByRole('button', { name: 'Save alignment', exact: true })).toBeDisabled();
  await redo.click();
  await expect(segment).toContainText('0:10.000 – 0:16.789');
  await lyrics.getByRole('button').nth(1).click();
  await redo.click();
  await expect(segment).toHaveCount(0);
  await expect(lyrics.getByRole('button')).toHaveCount(2);
  await expect(page.getByRole('complementary', { name: 'Selection' })).toContainText('Select a lyric line');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`inspector autogrows, caps text, and keeps actions aligned at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/v1/track', route => route.fulfill({ json: track }));
    await page.goto('/');
    await page.getByRole('list', { name: 'Lyric lines' }).getByRole('button').nth(1).click();
    const inspector = page.getByRole('complementary', { name: 'Selection' });
    const text = inspector.getByRole('textbox', { name: 'Lyric text', exact: true });
    await text.fill('Short lyric');
    const minimum = await text.evaluate(element => element.getBoundingClientRect().height);
    await text.fill(Array.from({ length: 6 }, () => 'A lyric line').join('\n'));
    expect(await text.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(minimum);
    await text.fill(Array.from({ length: 40 }, () => 'A lyric line').join('\n'));
    await expect(text).toHaveCSS('resize', 'none');
    await expect(text).toHaveCSS('overflow-y', 'auto');
    const capped = await text.evaluate(element => ({
      height: element.getBoundingClientRect().height,
      maximum: parseFloat(getComputedStyle(element).maxHeight),
      overflowing: element.scrollHeight > element.clientHeight,
    }));
    expect(capped.height).toBe(capped.maximum);
    expect(capped.overflowing).toBe(true);
    await text.fill('Short lyric');
    expect(await text.evaluate(element => element.getBoundingClientRect().height)).toBe(minimum);
    await text.fill(longLine);
    const merge = inspector.getByRole('button', { name: 'Merge with next lyric', exact: true });
    const split = inspector.getByRole('button', { name: 'Split', exact: true });
    const remove = inspector.getByRole('button', { name: 'Delete', exact: true });
    await expect(remove.getByText('Delete', { exact: true })).toBeVisible();
    await inspector.evaluate(element => { element.style.width = '220px'; });
    await expect(remove.getByText('Delete', { exact: true })).toBeHidden();
    expect(await inspector.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await inspector.evaluate(element => { element.style.width = ''; });
    await expect(remove.getByText('Delete', { exact: true })).toBeVisible();
    const boxes = await Promise.all([merge, split, remove].map(button => button.boundingBox()));
    expect(boxes.every(box => box!.y === boxes[0]!.y)).toBe(true);
    for (const [button, label] of [[merge, 'Merge with next lyric'], [split, 'Split'], [remove, 'Delete']] as const) {
      await expect(button).not.toHaveAttribute('title');
      await button.hover();
      await expect(page.getByRole('tooltip')).toHaveText(label);
      await expect(button).toHaveAccessibleDescription(label);
      await button.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    }
    await page.mouse.move(0, 0);
    await merge.focus();
    await expect(page.getByRole('tooltip')).toHaveText('Merge with next lyric');
    await page.keyboard.press('Tab');
    await expect(split).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toHaveText('Split');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const start = inspector.getByRole('textbox', { name: 'Start at', exact: true });
    await expect(start).toHaveCSS('text-align', 'center');
    const labelBox = await inspector.locator('dt').filter({ hasText: 'Start at' }).boundingBox();
    const inputBox = await start.boundingBox();
    expect(Math.abs(labelBox!.y + labelBox!.height / 2 - inputBox!.y - inputBox!.height / 2)).toBeLessThan(1);
    await start.fill('');
    await inspector.getByRole('textbox', { name: 'End at', exact: true }).fill('');
    await expect(inspector.getByRole('alert')).toHaveCount(2);
    expect(await inspector.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await inspector.screenshot({ path: testInfo.outputPath('inspector.png') });
  });

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
    await expect(inspector.getByRole('textbox', { name: 'Lyric text', exact: true })).toHaveValue(longLine);
    await expect(inspector.getByRole('textbox', { name: 'Start at', exact: true })).toHaveValue('0:12');
    await expect(inspector.getByRole('textbox', { name: 'End at', exact: true })).toHaveValue('0:16');
    await expect(inspector.getByText('0:04', { exact: true })).toBeVisible();
    await expect(preview.getByText('♪ ♪ ♪', { exact: true })).toBeVisible();
    await expect(preview.getByText(longLine, { exact: true })).toHaveCount(0);

    await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 12.345; });
    await expect(preview.getByText(longLine, { exact: true })).toBeVisible();
    await expect(preview.getByText(track.lines[0].text, { exact: true })).toBeVisible();

    await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 16.789; });
    await expect(preview.getByText('♪ ♪ ♪', { exact: true })).toBeVisible();
    await expect(line).toHaveAttribute('aria-current', 'true');

    await page.locator('audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 20; });
    await lyrics.getByRole('button', { name: 'An untimed ending Untimed', exact: true }).click();
    await expect(line).toHaveAttribute('aria-current', 'false');
    await expect(inspector.getByRole('textbox', { name: 'Lyric text', exact: true })).toHaveValue('An untimed ending');
    await expect(inspector.getByRole('textbox', { name: 'Start at', exact: true })).toBeDisabled();
    await expect(inspector.getByRole('textbox', { name: 'Start at', exact: true })).toHaveValue('');
    await expect(inspector.getByRole('textbox', { name: 'End at', exact: true })).toBeDisabled();
    await expect(inspector.getByRole('textbox', { name: 'End at', exact: true })).toHaveValue('');
    await expect(page.getByTestId('segment-verse-c')).toHaveCount(0);
    await expect(page.getByText('3 lines · 1 placed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save alignment', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Stamp current time', exact: true }).click();
    await lyrics.getByRole('button').nth(2).click();
    await expect(inspector.getByRole('textbox', { name: 'Start at', exact: true })).toHaveValue('0:20');
    await expect(inspector.getByRole('textbox', { name: 'End at', exact: true })).toHaveValue('4:07');
    await expect(inspector.getByText('3:47', { exact: true })).toBeVisible();
    await expect(preview.getByText('An untimed ending', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Remove Segment', exact: true }).click();
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
  await expect(page.getByText('No lyrics yet. Enter lyrics in the lyric sheet, one line per lyric, then choose Add all lines.')).toBeVisible();
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

  test('shows individual errors for missing, malformed, and out-of-order times', async ({ page }) => {
    const start = page.getByRole('textbox', { name: 'Start at', exact: true });
    const end = page.getByRole('textbox', { name: 'End at', exact: true });
    await start.fill('   ');
    await end.fill('');
    await expect(start).toHaveAccessibleDescription('Please provide the start at time.');
    await expect(end).toHaveAccessibleDescription('Please provide the end at time.');
    await start.fill('bad');
    await expect(start).toHaveAccessibleDescription('Enter the start at time as minutes:seconds, for example 1:30.');
    await expect(end).toHaveAccessibleDescription('Please provide the end at time.');
    await end.fill('bad');
    await expect(end).toHaveAccessibleDescription('Enter the end at time as minutes:seconds, for example 1:30.');
    await start.fill('0:17');
    await expect(start).toHaveAccessibleDescription('Choose a start time before the end time.');
    await end.fill('0:12');
    await expect(end).toHaveAccessibleDescription('Choose an end time after the start time.');
    await end.fill('4:08');
    await expect(end).toHaveAccessibleDescription('Choose an end time within the song.');
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345 – 0:16.789');
    await expect(page.getByRole('button', { name: 'Save alignment', exact: true })).toBeDisabled();
  });

  test('preserves fine timing on unchanged blur and accepts minutes and seconds', async ({ page }) => {
    const start = page.getByRole('textbox', { name: 'Start at', exact: true });
    const end = page.getByRole('textbox', { name: 'End at', exact: true });
    await start.focus();
    await start.blur();
    await end.focus();
    await end.blur();
    await expect(page.getByTestId('segment-verse-b')).toContainText('0:12.345 – 0:16.789');
    await expect(page.getByRole('button', { name: 'Save alignment', exact: true })).toBeDisabled();
    await end.fill('1:33');
    await end.press('Enter');
    await start.fill('1:30');
    await start.press('Enter');
    await expect(start).toHaveValue('1:30');
    await expect(end).toHaveValue('1:33');
    await expect(page.getByTestId('segment-verse-b')).toContainText('1:30.000 – 1:33.000');
  });

  test('requires m:ss endpoints and positive duration, commits on blur', async ({ page }) => {
    const start = page.getByRole('textbox', { name: 'Start at', exact: true });
    const end = page.getByRole('textbox', { name: 'End at', exact: true });
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
