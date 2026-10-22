import { expect, test, type Page } from "@playwright/test";
import { mockAudio, waitForAudio } from "./helpers/audio";

const durationSeconds = 12.5;
const track = {
  id: "playback-fixture",
  title: "A different short track",
  artist: "Playback test",
  duration_seconds: durationSeconds,
  audio_url: "/playback-fixture.wav",
  version: 0,
  lines: ["first", "second", "third"].map((id, index) => ({
    id,
    index,
    text: `Playback lyric ${id}`,
  })),
  alignment: {
    segments: [{ line_id: "first", start_ms: 0, end_ms: 2000 }],
  },
};

async function load(page: Page) {
  await page.route("**/api/v1/track", (route) => route.fulfill({ json: track }));
  await mockAudio(page, track.audio_url, durationSeconds);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: track.title })).toBeVisible();
  await waitForAudio(page);
}

async function playheadX(page: Page) {
  return page
    .getByTestId("timeline-playhead")
    .evaluate(
      (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41,
    );
}

async function expectPlayheadVisible(page: Page) {
  await expect.poll(() => page.getByTestId("timeline-playhead").evaluate((head) => {
    const container = head.closest(".timeline-scroll")!;
    const bounds = container.getBoundingClientRect();
    const marker = head.getBoundingClientRect();
    const left = bounds.left + container.clientLeft;
    return marker.left >= left - 1 &&
      marker.right <= left + container.clientWidth + 1;
  })).toBe(true);
}

test("playhead follows seeking, zoom and resizing without changing editor state", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await load(page);
  const audio = page.locator("audio");
  const scroller = page.getByLabel("Scrollable timeline");
  await page.getByRole("button", { name: "Move Playback lyric first", exact: true }).click();
  await expectPlayheadVisible(page);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 10; });
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expectPlayheadVisible(page);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const originalScroll = await scroller.evaluate((element) => element.scrollLeft);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 9.9; });
  await expect(page.getByLabel("Current playback position")).toHaveText("0:09.900");
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(originalScroll);

  const pageScroll = await page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 900, height: 1000 });
  await expectPlayheadVisible(page);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration; });
  await expect(page.getByLabel("Current playback position")).toHaveText("0:12.500");
  await expectPlayheadVisible(page);
  // Include the six-pixel right extent of the marker's triangular cap.
  expect(await scroller.evaluate((element) => element.scrollLeft + element.clientWidth)).toBeGreaterThanOrEqual(2006);
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0; });
  await expect(page.getByLabel("Current playback position")).toHaveText("0:00.000");
  await expectPlayheadVisible(page);
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await expect(page.getByTestId("segment-first")).toHaveClass(/timeline-selected/);
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();

  const block = page.getByRole("button", { name: "Move Playback lyric first", exact: true });
  await block.focus();
  await block.press("ArrowRight");
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 11; });
  await expect(page.getByLabel("Current playback position")).toHaveText("0:11.000");
  await expectPlayheadVisible(page);
  await expect(block).toBeFocused();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});

test("manual scrolling stays until the next seek or playback update", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await load(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const scroller = page.getByLabel("Scrollable timeline");
  const audio = page.locator("audio");
  await scroller.evaluate((element) => { element.scrollLeft = 500; });
  await page.waitForTimeout(150);
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(500);
  // Zoom must restore visibility even when zero milliseconds still maps to zero pixels.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expectPlayheadVisible(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await scroller.evaluate((element) => { element.scrollLeft = 500; });
  await audio.evaluate((element: HTMLAudioElement) => { element.currentTime = 0.1; });
  await expect(page.getByLabel("Current playback position")).toHaveText("0:00.100");
  await expectPlayheadVisible(page);

  // Start just inside the viewport's right edge and cross it through real playback.
  const edgeTime = await scroller.evaluate((element) => (element.clientWidth - 30) / 160);
  await audio.evaluate(async (element: HTMLAudioElement, time) => {
    const seeked = new Promise<void>((resolve) => {
      element.addEventListener("seeked", () => resolve(), { once: true });
    });
    element.currentTime = time;
    await seeked;
    await element.play();
  }, edgeTime);
  const before = await scroller.evaluate((element) => element.scrollLeft);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 20);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await expectPlayheadVisible(page);
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
});

test("native playback, pause, seek, and end synchronize the shared position", async ({ page }) => {
  await load(page);
  const audio = page.locator("audio");
  const position = page.getByLabel("Current playback position");
  await expect(position).toHaveText("0:00.000");
  expect(await audio.evaluate((element: HTMLAudioElement) => element.controls)).toBe(true);

  // Space belongs to the focused native audio control, without an app shortcut.
  await audio.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Playing", { exact: true })).toBeVisible();
  await expect.poll(() => playheadX(page)).toBeGreaterThan(10);
  await page.keyboard.press("Space");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  const pausedPosition = await position.textContent();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
  await expect(position).toHaveText(pausedPosition!);

  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = 4.25;
  });
  await expect(position).toHaveText("0:04.250");
  await expect.poll(() => playheadX(page)).toBeCloseTo(170, 1);
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();

  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.currentTime = element.duration - 0.1;
    await element.play();
  });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.ended)).toBe(true);
  await expect(position).toHaveText("0:12.500");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect.poll(() => playheadX(page)).toBeCloseTo(500, 1);
});

test("playhead respects zoom and scrolling; karaoke follows playback independently of selection", async ({ page }) => {
  await load(page);
  const preview = page.getByRole("region", { name: "Karaoke · selection preview" });
  await expect(preview.getByText("Playback lyric first", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Move Playback lyric first", exact: true })
    .click();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 5;
  });
  await expect.poll(() => playheadX(page)).toBeCloseTo(200, 1);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => playheadX(page)).toBeCloseTo(400, 1);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => playheadX(page)).toBeCloseTo(800, 1);
  await page.getByLabel("Scrollable timeline").evaluate((element) => {
    element.scrollLeft = 300;
  });
  await expect.poll(() => playheadX(page)).toBeCloseTo(800, 1);
  await expect(preview.getByText("♪ ♪ ♪", { exact: true })).toBeVisible();
  await expect(preview.getByText("Playback lyric first", { exact: true })).toHaveCount(0);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 1.999; });
  await expect(preview.getByText("Playback lyric first", { exact: true })).toBeVisible();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 2; });
  await expect(preview.getByText("♪ ♪ ♪", { exact: true })).toBeVisible();
  await expect(page.getByTestId("segment-first")).toHaveClass(
    /timeline-selected/,
  );
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
});

test("saving the same track preserves the audio element and running playback", async ({ page }) => {
  await load(page);
  await page.route("**/api/v1/track/alignment", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        version: 1,
        lines: body.lines,
        alignment: { segments: body.segments },
      },
    });
  });
  await page
    .getByRole("button", { name: "Move Playback lyric first", exact: true })
    .press("ArrowRight");
  const audio = page.locator("audio");
  const original = await audio.elementHandle();
  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.currentTime = 3;
    await element.play();
  });
  await page.getByRole("button", { name: "Save alignment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  expect(
    await audio.evaluate((element, previous) => element === previous, original),
  ).toBe(true);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await expect.poll(() => playheadX(page)).toBeGreaterThan(120);
});

async function clickTimeline(page: Page, positionMs: number, scale = 40, y = 18) {
  const canvas = (await page.getByTestId("timeline-track").boundingBox())!;
  await page.mouse.click(canvas.x + (positionMs * scale) / 1000, canvas.y + y);
}

test("timeline seeking accounts for zoom and scroll and preserves playback state", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await load(page);
  const audio = page.locator("audio");
  const position = page.getByLabel("Current playback position");
  await clickTimeline(page, 3000);
  await expect(position).toHaveText("0:03.000");
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByLabel("Scrollable timeline").evaluate((element) => {
    element.scrollLeft = 300;
  });
  await clickTimeline(page, 5000, 160, 190);
  await expect(position).toHaveText("0:05.000");
  await expect.poll(() => playheadX(page)).toBeCloseTo(800, 1);

  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await clickTimeline(page, 4000, 160);
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThanOrEqual(4);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(6);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("native seek slider supports keyboard seeking and track boundaries", async ({ page }) => {
  await load(page);
  const slider = page.getByRole("slider", { name: "Seek playback" });
  const position = page.getByLabel("Current playback position");
  await slider.focus();
  await slider.press("End");
  await expect(position).toHaveText("0:12.500");
  await slider.press("ArrowRight");
  await expect(position).toHaveText("0:12.500");
  await slider.press("Home");
  await expect(position).toHaveText("0:00.000");
  await slider.press("ArrowLeft");
  await expect(position).toHaveText("0:00.000");
  await slider.press("ArrowRight");
  await expect(position).toHaveText("0:00.100");
  await expect(slider).toHaveAttribute("aria-valuetext", "0:00.100");
  expect(
    await page.locator("audio").evaluate((element: HTMLAudioElement) => element.paused),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
});

test("selection, moving, resizing, dropping and empty-space drags do not seek", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await load(page);
  const position = page.getByLabel("Current playback position");
  await page.locator("audio").evaluate((element: HTMLAudioElement) => {
    element.currentTime = 9;
  });
  await expect(position).toHaveText("0:09.000");
  const body = page.getByRole("button", {
    name: "Move Playback lyric first",
    exact: true,
  });
  await body.click();
  await expect(position).toHaveText("0:09.000");
  await expect(page.getByTestId("segment-first")).toHaveClass(
    /timeline-selected/,
  );

  const handle = (await page
    .getByRole("button", { name: "Resize end of Playback lyric first" })
    .boundingBox())!;
  const handleX = handle.x + handle.width / 2;
  await page.mouse.move(handleX, handle.y + 30);
  await page.mouse.down();
  await page.mouse.move(handleX + 20, handle.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("segment-first")).toContainText("0:02.500");
  await expect(position).toHaveText("0:09.000");

  const block = (await body.boundingBox())!;
  await page.mouse.move(block.x + 20, block.y + 20);
  await page.mouse.down();
  await page.mouse.move(block.x + 100, block.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("segment-first")).toContainText("0:02.000");
  await expect(position).toHaveText("0:09.000");

  const lyric = (await page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button", { name: /Playback lyric second/ })
    .boundingBox())!;
  const canvas = (await page.getByTestId("timeline-track").boundingBox())!;
  await page.mouse.move(lyric.x + 30, lyric.y + 20);
  await page.mouse.down();
  await page.mouse.move(lyric.x + 45, lyric.y + 20, { steps: 4 });
  await page.mouse.move(canvas.x + 240, canvas.y + 110, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("segment-second")).toBeVisible();
  await expect(position).toHaveText("0:09.000");

  await page.mouse.move(canvas.x + 40, canvas.y + 190);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 120, canvas.y + 190, { steps: 5 });
  await page.mouse.up();
  await expect(position).toHaveText("0:09.000");
  // Suppression ends at the next ordinary click.
  await clickTimeline(page, 1000);
  await expect(position).toHaveText("0:01.000");
});

test("seeking is unavailable when audio metadata cannot load", async ({ page }) => {
  await page.route("**/api/v1/track", (route) => route.fulfill({ json: track }));
  await page.route("**/playback-fixture.wav", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: track.title })).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Seek playback" }),
  ).toBeDisabled();
  await clickTimeline(page, 4000);
  await expect(page.getByLabel("Current playback position")).toHaveText(
    "0:00.000",
  );
});
