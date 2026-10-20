import { expect, test, type Page } from '@playwright/test';

const track = {
  id: 'add-track', title: 'Add line test', artist: 'Artist', duration_seconds: 20,
  audio_url: '/test-audio.mp3', version: 3,
  lines: [{ id: 'a', index: 2, text: 'Existing lyric' }, { id: 'b', index: 7, text: 'Last lyric' }],
  alignment: { segments: [{ line_id: 'a', start_ms: 0, end_ms: 3000 }] },
};
const sheet = (page: Page) => page.getByRole('textbox', { name: 'Lyric sheet', exact: true });
const add = (page: Page) => page.getByRole('button', { name: '+ Add line', exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const lines = (page: Page) => page.getByRole('list', { name: 'Lyric lines' });

async function load(page: Page, data = track) {
  await page.route('**/test-audio.mp3', route => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/track', route => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(sheet(page)).toBeEnabled();
}

test('adds trimmed text as one untimed entry, selects it, and supports undo/redo', async ({ page }) => {
  await load(page);
  await expect(add(page)).toBeDisabled();
  await sheet(page).fill(' \n\t ');
  await expect(add(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add all lines', exact: true })).toBeDisabled();
  await sheet(page).fill('  New lyric\nSecond verse  ');
  await add(page).click();
  await expect(lines(page).getByRole('listitem')).toHaveCount(3);
  const added = lines(page).getByRole('button').last();
  await expect(added).toContainText('New lyric\nSecond verse');
  await expect(added).toContainText('Untimed');
  await expect(added).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('textbox', { name: 'Lyric text', exact: true })).toHaveValue('New lyric\nSecond verse');
  await expect(page.getByText('3 lines · 1 placed', { exact: true })).toBeVisible();
  await expect(sheet(page)).toHaveValue('');
  await expect(sheet(page)).toBeFocused();
  await expect(add(page)).toBeDisabled();
  await expect(save(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(lines(page).getByRole('listitem')).toHaveCount(2);
  await expect(save(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(lines(page).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await sheet(page).fill('Replacement');
  await add(page).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
});

test('uses unique UUIDs and indexes after deletion, saves inspector edits, and reloads', async ({ page }) => {
  let persisted = structuredClone(track);
  await load(page);
  await page.unroute('**/api/v1/track');
  await page.route('**/api/v1/track', route => route.fulfill({ json: persisted }));
  await page.route('**/api/v1/track/alignment', async route => {
    const body = route.request().postDataJSON();
    expect(body.segments).toEqual(track.alignment.segments);
    expect(body.lines.map((line: { index: number }) => line.index)).toEqual([2, 7, 8, 9]);
    expect(body.lines[3].text).toBe('Edited lyric');
    for (const line of body.lines.slice(2)) {
      expect(line.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    persisted = { ...persisted, version: 4, lines: body.lines, alignment: { segments: body.segments } };
    await route.fulfill({ json: { version: persisted.version, lines: persisted.lines, alignment: persisted.alignment } });
  });
  await sheet(page).fill('First addition');
  await add(page).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await sheet(page).fill('Temporary');
  await add(page).click();
  await sheet(page).fill('Final');
  await add(page).click();
  const inspector = page.getByRole('textbox', { name: 'Lyric text', exact: true });
  await inspector.fill('Edited lyric');
  await inspector.blur();
  await save(page).click();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toBeVisible();
  expect(new Set(persisted.lines.map(line => line.id)).size).toBe(4);
  await page.reload();
  await expect(lines(page).getByRole('button').last()).toContainText('Edited lyric');
  await expect(lines(page).getByRole('button').last()).toContainText('Untimed');
});

test('starts indexes at zero on an empty track', async ({ page }) => {
  await load(page, { ...track, lines: [], alignment: { segments: [] } });
  await page.route('**/api/v1/track/alignment', async route => {
    const body = route.request().postDataJSON();
    expect(body.lines).toEqual([{ id: expect.any(String), index: 0, text: 'First' }]);
    expect(body.segments).toEqual([]);
    await route.fulfill({ json: { version: 4, lines: body.lines, alignment: { segments: [] } } });
  });
  await sheet(page).fill('First');
  await add(page).click();
  await save(page).click();
  await expect(page.getByText('Changes saved successfully', { exact: true })).toBeVisible();
});

test('blocks input while loading, after load failure, during interaction, and while saving', async ({ page }) => {
  let releaseLoad!: () => void;
  const loading = new Promise<void>(resolve => { releaseLoad = resolve; });
  await page.route('**/api/v1/track', async route => {
    await loading;
    await route.fulfill({ status: 503 });
  });
  await page.goto('/');
  await expect(sheet(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  releaseLoad();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(sheet(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  await page.unroute('**/api/v1/track');
  await load(page);
  await sheet(page).fill('Pending lyric');
  const handle = page.getByRole('button', { name: 'Resize end of Existing lyric' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30);
  await expect(sheet(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(add(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Move Existing lyric', exact: true }).press('ArrowRight');
  let releaseSave!: () => void;
  const saving = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route('**/api/v1/track/alignment', async route => {
    await saving;
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { version: 4, lines: body.lines, alignment: { segments: body.segments } } });
  });
  await save(page).click();
  await expect(sheet(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  releaseSave();
  await expect(add(page)).toBeEnabled();
  await expect(sheet(page)).toHaveValue('Pending lyric');
});
