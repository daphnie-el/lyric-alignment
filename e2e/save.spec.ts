import { expect, test, type Page } from '@playwright/test';
import { mockAudio } from './helpers/audio';

const track = {
  id: 'save-track', title: 'Save test', artist: 'Artist', duration_seconds: 20,
  audio_url: '/test-audio.mp3', version: 3,
  lines: ['a', 'b'].map((id, index) => ({ id, index, text: `Lyric ${id}` })),
  alignment: { segments: [{ line_id: 'a', start_ms: 0, end_ms: 3000 }] },
};
const save = (page: Page) => page.getByRole('button', { name: 'Save alignment', exact: true });
const move = (page: Page) => page.getByRole('button', { name: 'Move Lyric a', exact: true });
async function load(page: Page, data = track) {
  await mockAudio(page, '/test-audio.mp3', 20);
  await page.route('**/api/v1/track', route => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: data.title, exact: true })).toBeVisible();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(0);
}

test('saves latest inspector edit, resets selection and history, retains returned versions, and reloads persisted data', async ({ page }) => {
  let persisted = structuredClone(track);
  const requests: unknown[] = [];
  await load(page);
  await page.unroute('**/api/v1/track');
  await page.route('**/api/v1/track', route => route.fulfill({ json: persisted }));
  await page.route('**/api/v1/track/alignment', async route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(body.version).toBe(persisted.version);
    persisted = { ...persisted, version: persisted.version + 1, lines: body.lines, alignment: { segments: body.segments } };
    await route.fulfill({ json: { version: persisted.version, lines: persisted.lines, alignment: persisted.alignment } });
  });
  await expect(save(page)).toBeDisabled();
  await move(page).press('ArrowRight');
  await move(page).press('ArrowRight');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const end = page.getByRole('textbox', { name: 'End', exact: true });
  await end.fill('0:04');
  // Clicking Save commits the focused inspector field before submitting.
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(1);
  expect(requests[0]).toEqual({ track_id: track.id, version: 3, lines: track.lines, segments: [{ line_id: 'a', start_ms: 100, end_ms: 4000 }] });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await expect(page.getByText('Select a lyric line to view its timing.')).toBeVisible();
  await move(page).press('ArrowRight');
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(2);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ version: 4 });
  page.on('dialog', () => { throw new Error('Clean state must not warn before reload'); });
  await page.reload();
  await expect(page.getByTestId('segment-a')).toContainText('0:00.200 – 0:04.100');
});

test('saving all removed placements sends an empty array', async ({ page }) => {
  await page.clock.install();
  await load(page);
  let body: unknown;
  await page.route('**/api/v1/track/alignment', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { version: 4, lines: track.lines, alignment: { segments: [] } } });
  });
  await move(page).click();
  await page.getByRole('button', { name: 'Remove Segment', exact: true }).click();
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  expect(body).toEqual({ track_id: track.id, version: 3, lines: track.lines, segments: [] });
  await expect(page.getByText('Changes saved successfully', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close toast' })).toBeVisible();
  await page.clock.fastForward(14_000);
  await expect(page.getByText('Changes saved successfully', { exact: true })).toBeVisible();
  await page.clock.fastForward(1_500);
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(0);
});

test('dirty status follows content through undo and redo, ignoring selection, zoom, and rejected edits', async ({ page }) => {
  await load(page);
  await move(page).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const end = page.getByRole('textbox', { name: 'End', exact: true });
  await end.focus(); await end.blur();
  await end.fill('0:25'); await end.blur();
  await expect(save(page)).toBeDisabled();
  await move(page).press('ArrowRight');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(save(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(save(page)).toBeEnabled();
});

test('alignment repairs are unsaved', async ({ page }) => {
  await load(page, { ...track, alignment: { segments: [...track.alignment.segments, { line_id: 'b', start_ms: 2000, end_ms: 4000 }] } });
  await expect(page.getByTestId('segment-b')).toContainText('0:03.000 – 0:05.000');
  await expect(save(page)).toBeEnabled();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
});

for (const failure of ['network', 'server', 'conflict'] as const) {
  test(`${failure} failure preserves work and history with friendly feedback`, async ({ page }) => {
    await load(page);
    let calls = 0;
    await page.route('**/api/v1/track/alignment', async route => {
      calls++;
      expect(route.request().postDataJSON().version).toBe(3);
      if (calls === 1) {
        if (failure === 'network') await route.abort('failed');
        else await route.fulfill({ status: failure === 'conflict' ? 409 : 500, json: { error: failure, version: 99, lines: track.lines, alignment: { segments: [] } } });
      } else {
        await route.fulfill({ json: { version: 4, lines: track.lines, alignment: { segments: route.request().postDataJSON().segments } } });
      }
    });
    await move(page).press('ArrowRight');
    await save(page).click();
    await expect(page.getByRole('alert')).toContainText(failure === 'conflict' ? 'Another session saved a newer version' : 'Could not save your changes');
    await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(0);
    await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await expect(page.getByTestId('segment-a')).toContainText('0:00.100 – 0:03.100');
    await expect(page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:00');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await save(page).click();
    await expect(save(page)).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(1);
  });
}

test('in-flight save blocks edits and duplicate submissions, keeps zoom and unload protection', async ({ page }) => {
  await load(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/v1/track/alignment', async route => {
    calls++;
    await pending;
    await route.fulfill({ json: { version: 4, lines: track.lines, alignment: { segments: route.request().postDataJSON().segments } } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await move(page).press('ArrowRight');
  const idleWidth = (await save(page).boundingBox())!.width;
  await save(page).click();
  const busy = page.locator('button[aria-busy="true"]');
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(busy.locator('.button-spinner')).toBeVisible();
  await expect(busy).toHaveAccessibleName('Save alignment');
  expect((await busy.boundingBox())!.width).toBeCloseTo(idleWidth, 1);
  await expect(busy.locator('.button-loading-label')).toHaveCSS('opacity', '0');
  expect(await busy.locator('.button-spinner').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await busy.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(0);
  await expect(move(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resize end of Lyric a' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Start', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove Segment', exact: true })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Lyric lines' }).getByRole('button').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  expect(calls).toBe(1);
  release();
  await expect(save(page)).toBeDisabled();
  await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(save(page).locator('.button-spinner')).toBeHidden();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('segment-a')).toContainText('0:00.100 – 0:03.100');
});

test('reload warning can be cancelled or accepted and disappears after undoing to saved content', async ({ page }) => {
  await load(page);
  await move(page).press('ArrowRight');
  const warning = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.getByTestId('segment-a')).toContainText('0:00.100 – 0:03.100');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await move(page).press('ArrowRight');
  page.once('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.accept(); });
  await page.reload();
  await expect(page.getByTestId('segment-a')).toContainText('0:00.000 – 0:03.000');
  await expect(save(page)).toBeDisabled();
});

test('save is disabled during resizing and cancelled previews leave content clean', async ({ page }) => {
  await load(page);
  await move(page).press('ArrowRight');
  const handle = page.getByRole('button', { name: 'Resize end of Lyric a' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30);
  await expect(save(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(save(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(save(page)).toBeDisabled();
});
