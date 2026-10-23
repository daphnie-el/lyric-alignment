import { expect, test, type Page } from "@playwright/test";
import {
  moveSegments,
  normalizeSegments,
  placeSegment,
} from "../apps/web/src/utils/timing";
import { Segment } from "../apps/web/src/utils/types";
import { mockAudio, waitForAudio } from "./helpers/audio";

const s = (id: string, start: number, end: number): Segment => ({
  line_id: id,
  start_ms: start,
  end_ms: end,
});
const segments = [s("a", 0, 3000), s("b", 3000, 6000)];
const track = {
  id: "timeline-track",
  title: "Timeline test",
  artist: "Artist",
  duration_seconds: 20,
  audio_url: "/test-audio.mp3",
  version: 0,
  lines: ["a", "b", "c", "d"].map((id, index) => ({
    id,
    index,
    text: `Lyric ${id}`,
  })),
  alignment: { segments },
};
async function load(page: Page, data = track) {
  await mockAudio(page, data.audio_url, data.duration_seconds);
  await page.route("**/api/v1/track", (route) => route.fulfill({ json: data }));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: data.title, exact: true }),
  ).toBeVisible();
  if (await page.locator("audio").count()) await waitForAudio(page);
}
async function dragTo(
  page: Page,
  source: ReturnType<Page["getByRole"]>,
  ms: number,
) {
  const box = (await source.boundingBox())!;
  const canvas = (await page.getByTestId("timeline-track").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.move(canvas.x + (ms * 40) / 1000, canvas.y + 110, {
    steps: 16,
  });
  await expect(page.locator(".timeline-preview")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set lyric start time", exact: true }),
  ).toBeDisabled();
  await page.mouse.up();
}

test("timing rules preserve gaps, cascade only when necessary, and reject atomically", () => {
  expect(placeSegment(segments, s("c", 2000, 5000), 20000).segments).toEqual([
    s("c", 2000, 5000),
    s("a", 5000, 8000),
    s("b", 8000, 11000),
  ]);
  const spaced = [s("a", 0, 1000), s("b", 4000, 6000), s("c", 10000, 12000)];
  expect(placeSegment(spaced, s("d", 1000, 4000), 20000).segments).toEqual([
    spaced[0],
    s("d", 1000, 4000),
    spaced[1],
    spaced[2],
  ]);
  expect(placeSegment(spaced, s("b", 4000, 5000), 20000).segments).toEqual([
    spaced[0],
    s("b", 4000, 5000),
    spaced[2],
  ]);
  expect(placeSegment(segments, s("c", 2000, 19000), 20000).error).toContain(
    "enough room",
  );
  expect(segments).toEqual([s("a", 0, 3000), s("b", 3000, 6000)]);
  for (const invalid of [
    s("a", -1, 3000),
    s("a", 1000, 1000),
    s("a", 0.5, 3000),
    s("a", 0, 20001),
  ])
    expect(placeSegment(segments, invalid, 20000).error).toBeTruthy();
  expect(
    normalizeSegments(
      [s("a", 0, 3000), s("b", 2000, 4000)],
      20000,
      new Set(["a", "b"]),
    ).segments,
  ).toEqual([s("a", 0, 3000), s("b", 3000, 5000)]);
  expect(
    normalizeSegments(
      [s("a", 0, 3000), s("a", 4000, 6000)],
      20000,
      new Set(["a"]),
    ).error,
  ).toContain("duplicate");
});

test("lyric clicks select only; explicit stamping and keyboard resizing synchronize inspector", async ({
  page,
}) => {
  await load(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 6;
  });
  const lyric = page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(2);
  const inspector = page.getByRole("complementary", { name: "Selection" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await lyric.click();
  await lyric.click();
  await lyric.press("Enter");
  await lyric.press("Space");
  await expect(lyric).toHaveAttribute("aria-current", "true");
  await expect(inspector.getByRole("textbox", { name: "Lyric text", exact: true })).toHaveValue("Lyric c");
  for (const name of ["Start at", "End at"]) {
    const field = inspector.getByRole("textbox", { name, exact: true });
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue("");
  }
  await expect(page.getByTestId("segment-c")).toHaveCount(0);
  await expect(page.getByText("4 lines · 2 placed")).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await lyric.click();
  await expect(page.getByTestId("segment-c")).toHaveCount(1);
  await expect(page.getByText("4 lines · 3 placed")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:06");
  const endField = page.getByRole("textbox", { name: "End at", exact: true });
  await expect(endField).toHaveValue("0:20");
  await endField.fill("0:09");
  await endField.blur();
  const end = page.getByRole("button", {
    name: "Resize end of Lyric c",
    exact: true,
  });
  await end.press("ArrowRight");
  await expect(
    page.getByRole("textbox", { name: "End at", exact: true }),
  ).toHaveValue("0:09");
  await page
    .getByRole("button", { name: "Resize start of Lyric c", exact: true })
    .press("Shift+ArrowRight");
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:07");
  await page
    .getByRole("button", { name: "Move Lyric c", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:07");
  await expect(
    page.getByRole("textbox", { name: "End at", exact: true }),
  ).toHaveValue("0:09");
});

test("drop at an exact time ripples conflicts and moving preserves duration and grab offset", async ({
  page,
}) => {
  await load(page);
  await dragTo(
    page,
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(2),
    2000,
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:02.000 – 0:05.000",
  );
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:05.000 – 0:08.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:08.000 – 0:11.000",
  );
  // Grab the center: the new start must account for the 1.5-second offset.
  await dragTo(
    page,
    page.getByRole("button", { name: "Move Lyric c", exact: true }),
    1500,
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:05.000 – 0:08.000",
  );
});

test("pointer resizing previews ripple, commits both edges, and Escape cancels", async ({
  page,
}) => {
  await load(page);
  await page.getByRole("button", { name: "Move Lyric a", exact: true }).click();
  const handle = page.getByRole("button", {
    name: "Resize end of Lyric a",
    exact: true,
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30, { steps: 5 });
  await expect(page.locator(".timeline-preview")).toBeVisible();
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "End at", exact: true }),
  ).toHaveValue("0:04");
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:04.000 – 0:07.000",
  );
  const left = (await page
    .getByRole("button", { name: "Resize start of Lyric a", exact: true })
    .boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + 30);
  await page.mouse.down();
  await page.mouse.move(left.x + left.width / 2 + 40, left.y + 30, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:01");
  const updated = (await handle.boundingBox())!;
  await page.mouse.move(updated.x + updated.width / 2, updated.y + 30);
  await page.mouse.down();
  await page.mouse.move(updated.x + updated.width / 2 + 40, updated.y + 30, {
    steps: 5,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "End at", exact: true }),
  ).toHaveValue("0:04");
});

test("inspector ripples edits and rejects overflow without changing any segment", async ({
  page,
}) => {
  await load(page);
  await page.getByRole("button", { name: "Move Lyric a", exact: true }).click();
  const end = page.getByRole("textbox", { name: "End at", exact: true });
  await end.fill("0:04");
  await end.blur();
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:04.000 – 0:07.000",
  );
  await end.fill("0:19");
  await end.blur();
  await expect(page.getByRole("alert")).toContainText("enough room");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:04.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:04.000 – 0:07.000",
  );
});

test("loading repairs overlaps and rejects duplicates or impossible alignments", async ({
  page,
}) => {
  await load(page, {
    ...track,
    alignment: { segments: [s("a", 0, 3000), s("b", 2000, 4000)] },
  });
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.000 – 0:05.000",
  );
  await page.unroute("**/api/v1/track");
  await page.route("**/api/v1/track", (route) =>
    route.fulfill({
      json: {
        ...track,
        alignment: { segments: [s("a", 0, 3000), s("a", 5000, 6000)] },
      },
    }),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("duplicate");
  await page.unroute("**/api/v1/track");
  await page.route("**/api/v1/track", (route) =>
    route.fulfill({
      json: {
        ...track,
        alignment: { segments: [s("a", 0, 19000), s("b", 1000, 4000)] },
      },
    }),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("enough room");
});

test("timeline scrolls on mobile without widening the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await expect(page.getByTestId("segment-a")).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const scroller = page.getByLabel("Scrollable timeline");
  await scroller.evaluate((element) => {
    element.scrollLeft = 200;
  });
  expect(
    await scroller.evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
});

test("cancelled dragging leaves an unplaced lyric unplaced", async ({
  page,
}) => {
  await load(page);
  const lyric = page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(2);
  const box = (await lyric.boundingBox())!;
  const canvas = (await page.getByTestId("timeline-track").boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 80, canvas.y + 110, { steps: 20 });
  await expect(page.locator(".timeline-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".timeline-preview")).toHaveCount(0);
  await expect(page.getByTestId("segment-c")).toHaveCount(0);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
});

test("scrolled drops use the content position and reject a segment past the audio end", async ({
  page,
}) => {
  await load(page);
  const scroller = page.getByLabel("Scrollable timeline");
  await scroller.evaluate((element) => {
    element.scrollLeft = 200;
  });
  const scroll = await scroller.evaluate((element) => element.scrollLeft);
  expect(scroll).toBeGreaterThan(0);
  await dragTo(
    page,
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(2),
    10000,
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:10.000 – 0:13.000",
  );
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await dragTo(
    page,
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(3),
    19000,
  );
  await expect(page.getByRole("alert")).toContainText(
    "Choose an end time within the song.",
  );
  await expect(page.getByTestId("segment-d")).toHaveCount(0);
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:10.000 – 0:13.000",
  );
});

test("explicit stamping shortens a segment near the track end", async ({
  page,
}) => {
  await load(page, { ...track, duration_seconds: 7 });
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 6;
  });
  await page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(2)
    .click();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:06.000 – 0:07.000",
  );
  await expect(page.getByText("4 lines · 3 placed")).toBeVisible();
});

test("undo and redo restore insertions and their entire ripple in one step", async ({
  page,
}) => {
  await load(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await dragTo(
    page,
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(2),
    2000,
  );
  await undo.click();
  await expect(page.getByTestId("segment-c")).toHaveCount(0);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.000 – 0:06.000",
  );
  await expect(undo).toBeDisabled();
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(3).click();
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").nth(2).click();
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();
  // Selection stays on the lyric even while its placement is undone.
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toBeDisabled();
  await redo.click();
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:02.000 – 0:05.000",
  );
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:05.000 – 0:08.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:08.000 – 0:11.000",
  );
  await expect(redo).toBeDisabled();
});

test("keyboard history traverses moves, resizes, and inspector edits; a new edit clears redo", async ({
  page,
}) => {
  await load(page);
  const body = page.getByRole("button", { name: "Move Lyric a", exact: true });
  await body.press("ArrowRight");
  await page
    .getByRole("button", { name: "Resize end of Lyric a", exact: true })
    .press("ArrowRight");
  const end = page.getByRole("textbox", { name: "End at", exact: true });
  await end.fill("0:04");
  await end.blur();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.200",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.200 – 0:06.200",
  );
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Meta+Shift+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:04.000",
  );
  await page.keyboard.press("Control+z");
  await body.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
});

test("selection, zoom, unchanged and rejected edits preserve redo history", async ({
  page,
}) => {
  await load(page);
  const body = page.getByRole("button", { name: "Move Lyric a", exact: true });
  await body.press("ArrowRight");
  await page.keyboard.press("Control+z");
  await body.click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const end = page.getByRole("textbox", { name: "End at", exact: true });
  await end.focus();
  await end.blur();
  // Valid endpoint, but the cascade would exceed track duration.
  await end.fill("0:19");
  await end.blur();
  await expect(page.getByRole("alert")).toContainText("enough room");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Control+y");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
});

test("history shortcuts preserve native editing in text fields and editable content", async ({
  page,
}) => {
  await load(page);
  await page
    .getByRole("button", { name: "Move Lyric a", exact: true })
    .press("ArrowRight");
  const start = page.getByRole("textbox", { name: "Start at", exact: true });
  await start.focus();
  await start.press("Control+z");
  await start.press("Control+y");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
  const prevented = await page.evaluate(() => {
    return ["input", "textarea", "div"].map((tag) => {
      const element = document.createElement(tag);
      if (tag === "div") element.contentEditable = "true";
      document.body.append(element);
      element.focus();
      const event = new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      element.remove();
      return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([false, false, false]);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
});

test("pointer resizing ignores history shortcuts during the gesture and commits one history step", async ({
  page,
}) => {
  await load(page);
  await page
    .getByRole("button", { name: "Move Lyric a", exact: true })
    .press("ArrowRight");
  const handle = page.getByRole("button", {
    name: "Resize end of Lyric a",
    exact: true,
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30, { steps: 8 });
  await page.keyboard.press("Control+z");
  await page.mouse.up();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:04.100",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.100 – 0:06.100",
  );
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:04.100 – 0:07.100",
  );
});

test("history keeps only the most recent 100 edits", async ({ page }) => {
  await load(page, { ...track, duration_seconds: 120 });
  const body = page.getByRole("button", { name: "Move Lyric a", exact: true });
  await body.focus();
  for (let i = 0; i < 101; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 100; i++) await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
});

test("drag previews and cancellation preserve history; a completed move is one step", async ({
  page,
}) => {
  await load(page);
  const body = page.getByRole("button", { name: "Move Lyric a", exact: true });
  await body.press("ArrowRight");
  await body.press("ArrowRight");
  await page.keyboard.press("Control+z");
  const box = (await body.boundingBox())!;
  const canvas = (await page.getByTestId("timeline-track").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 200, canvas.y + 110, { steps: 16 });
  await expect(page.locator(".timeline-preview")).toBeVisible();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
  await dragTo(page, body, 1500);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.100 – 0:03.100",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.100 – 0:06.100",
  );
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
});

test("clear selection removes only the selected placement and supports undo, redo, and placing again", async ({
  page,
}) => {
  await load(page);
  const inspector = page.getByRole("complementary", { name: "Selection" });
  const preview = page.getByRole("region", {
    name: "Karaoke · selection preview",
  });
  const lyrics = page.getByRole("list", { name: "Lyric lines" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await page.getByRole("button", { name: "Move Lyric a", exact: true }).click();
  const end = inspector.getByRole("textbox", { name: "End at", exact: true });
  await end.fill("0:19");
  await end.blur();
  await expect(page.getByRole("alert")).toContainText("enough room");
  await inspector.getByRole("button", { name: "Remove Segment" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("segment-a")).toHaveCount(0);
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.000 – 0:06.000",
  );
  await expect(page.getByText("4 lines · 1 placed")).toBeVisible();
  await expect(
    lyrics.getByRole("button", { name: /Lyric a Untimed/ }),
  ).toHaveAttribute("aria-current", "false");
  await expect(lyrics.getByRole("button")).toHaveCount(4);
  await expect(
    inspector.getByText("Select a lyric line to view its timing."),
  ).toBeVisible();
  await expect(preview.getByText("♪ ♪ ♪", { exact: true })).toBeVisible();
  await undo.click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.000 – 0:06.000",
  );
  await expect(
    inspector.getByText("Select a lyric line to view its timing."),
  ).toBeVisible();
  await expect(preview.getByText("Lyric a", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(page.getByTestId("segment-a")).toHaveCount(0);
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:03.000 – 0:06.000",
  );
  await expect(preview.getByText("♪ ♪ ♪", { exact: true })).toBeVisible();
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 0;
  });
  await lyrics.getByRole("button", { name: /Lyric a Untimed/ }).click();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:02.999",
  );
  await expect(page.getByText("4 lines · 2 placed")).toBeVisible();
});

test("clearing an unplaced selection preserves history; removing a placement clears redo", async ({
  page,
}) => {
  await load(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 6;
  });
  const inspector = page.getByRole("complementary", { name: "Selection" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(2)
    .click();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await undo.click();
  await expect(
    inspector.getByRole("textbox", { name: "Start at", exact: true }),
  ).toBeDisabled();
  await inspector.getByRole("button", { name: "Remove Segment" }).click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect(
    inspector.getByText("Select a lyric line to view its timing."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move Lyric a", exact: true }).click();
  await inspector.getByRole("button", { name: "Remove Segment" }).click();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(page.getByTestId("segment-c")).toHaveCount(0);
  await expect(undo).toBeDisabled();
});

const groupTrack = {
  ...track,
  alignment: {
    segments: [s("a", 2000, 4000), s("b", 6000, 8000), s("c", 12000, 14000)],
  },
};
const block = (page: Page, id: string) =>
  page.getByRole("button", { name: `Move Lyric ${id}`, exact: true });
async function selectGroup(page: Page, ids = ["a", "b"]) {
  await block(page, ids[0]).click();
  for (const id of ids.slice(1))
    await block(page, id).click({ modifiers: ["Shift"] });
}

test("Delete removes the focused selected placement, keeps its lyric, and supports Undo", async ({
  page,
}) => {
  await load(page);
  await block(page, "a").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("segment-a")).toHaveCount(0);
  await expect(page.getByTestId("segment-b")).toBeVisible();
  const lyrics = page.getByRole("list", { name: "Lyric lines" });
  await expect(
    lyrics.getByRole("button", { name: /Lyric a Untimed/ }),
  ).toBeVisible();
  await expect(lyrics.getByRole("button")).toHaveCount(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:00.000 – 0:03.000",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("Delete removes all selected placements in one undo step", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page, ["a", "c"]);
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("segment-c")).toHaveCount(0);
  await expect(page.getByTestId("segment-a")).toHaveCount(0);
  await expect(page.getByTestId("segment-b")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("segment-a")).toBeVisible();
  await expect(page.getByTestId("segment-c")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("Backspace removes 100 selected placements with one Undo and Redo", async ({
  page,
}) => {
  test.setTimeout(60000);
  const ids = Array.from({ length: 101 }, (_, i) => String(i));
  const bulkTrack = {
    ...track,
    duration_seconds: 210,
    lines: ids.map((id, index) => ({ id, index, text: `Lyric ${id}` })),
    alignment: {
      segments: ids.map((id, i) => s(id, i * 2000, i * 2000 + 1000)),
    },
  };
  await load(page, bulkTrack);
  await selectGroup(page, ids.slice(0, 100));
  await expect(page.locator(".timeline-selected")).toHaveCount(100);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".timeline-block")).toHaveCount(1);
  await expect(page.getByTestId("segment-100")).toContainText(
    "3:20.000 – 3:21.000",
  );
  await expect(
    page.getByRole("list", { name: "Lyric lines" }).getByRole("button"),
  ).toHaveCount(101);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(101);
  await expect(page.locator(".timeline-selected")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(1);
  await expect(page.getByTestId("segment-100")).toContainText(
    "3:20.000 – 3:21.000",
  );
});

test("bulk removal preserves references and history for no-ops and duplicate IDs", async ({
  page,
}) => {
  await load(page);
  const result = await page.evaluate(async (payload) => {
    const modulePath = "/src/context/EditorContext.tsx";
    const { reducer, initialState } = (await import(
      modulePath
    )) as typeof import("../apps/web/src/context/EditorContext");
    const loaded = reducer(initialState, { type: "loadSuccess", payload });
    const removed = reducer(loaded, {
      type: "removeSegments",
      lineIds: ["a", "a", "missing"],
    });
    const restored = reducer(removed, { type: "undo" });
    return {
      removedIds: removed.track!.segments.map((segment) => segment.line_id),
      linesShared: removed.track!.lines === loaded.track!.lines,
      survivorShared: removed.track!.segments[0] === loaded.track!.segments[1],
      snapshotShared: removed.past[0].segments === loaded.track!.segments,
      historyLength: removed.past.length,
      emptyUnchanged:
        reducer(restored, { type: "removeSegments", lineIds: [] }) === restored,
      unmatchedUnchanged:
        reducer(restored, { type: "removeSegments", lineIds: ["missing"] }) ===
        restored,
      interactionUnchanged: (() => {
        const active = { ...restored, interacting: true };
        return (
          reducer(active, { type: "removeSegments", lineIds: ["a"] }) === active
        );
      })(),
      redoPreserved: restored.future.length === 1,
      redoCleared:
        reducer(restored, { type: "removeSegments", lineIds: ["b"] }).future
          .length === 0,
    };
  }, track);
  expect(result).toEqual({
    removedIds: ["b"],
    linesShared: true,
    survivorShared: true,
    snapshotShared: true,
    historyLength: 1,
    emptyUnchanged: true,
    unmatchedUnchanged: true,
    interactionUnchanged: true,
    redoPreserved: true,
    redoCleared: true,
  });
});

test("Delete preserves unselected placements and normal text editing", async ({
  page,
}) => {
  await load(page);
  await block(page, "a").focus();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("segment-a")).toBeVisible();
  await block(page, "a").click();
  const text = page.getByRole("textbox", { name: "Lyric text", exact: true });
  await text.focus();
  await text.press("Home");
  await text.press("Delete");
  await expect(text).toHaveValue("yric a");
  await expect(page.getByTestId("segment-a")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

async function previewGroupMove(page: Page, id: string, deltaPx: number) {
  const box = (await block(page, id).boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaPx, y, { steps: 12 });
  await expect(page.locator(".timeline-preview")).toHaveCount(2);
}

test("group timing preserves durations and gaps and rejects overlaps and boundaries atomically", () => {
  const original = groupTrack.alignment.segments;
  expect(moveSegments(original, ["a", "b"], 1000, 20000).segments).toEqual([
    s("a", 3000, 5000),
    s("b", 7000, 9000),
    original[2],
  ]);
  expect(moveSegments(original, ["a", "c"], 1000, 20000).segments).toEqual([
    s("a", 3000, 5000),
    original[1],
    s("c", 13000, 15000),
  ]);
  expect(moveSegments(original, ["a", "b"], 4000, 20000).segments).toEqual([
    s("a", 6000, 8000),
    s("b", 10000, 12000),
    original[2],
  ]);
  for (const delta of [-2001, 5000, 12001, 0.5])
    expect(moveSegments(original, ["a", "b"], delta, 20000).error).toBeTruthy();
  expect(
    moveSegments(original, ["a", "missing"], 1000, 20000).error,
  ).toBeTruthy();
  expect(moveSegments(original, [], 1000, 20000).error).toBeTruthy();
  expect(moveSegments(original, ["a", "b"], 0, 20000).segments).toEqual(
    original,
  );
  expect(original).toEqual([
    s("a", 2000, 4000),
    s("b", 6000, 8000),
    s("c", 12000, 14000),
  ]);
});

test("Shift-click toggles nonadjacent lines, updates inspector, and does not dirty content", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page, ["a", "c"]);
  await expect(block(page, "a")).toHaveAttribute("aria-current", "true");
  await expect(block(page, "c")).toHaveAttribute("aria-current", "true");
  await expect(block(page, "b")).toHaveAttribute("aria-current", "false");
  await expect(
    page.getByText("2 lines selected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove Segment", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resize start of Lyric a", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await block(page, "c").click({ modifiers: ["Shift"] });
  await expect(block(page, "c")).toHaveAttribute("aria-current", "false");
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:02");
  await expect(
    page.getByRole("button", { name: "Resize start of Lyric a", exact: true }),
  ).toBeEnabled();
  await block(page, "a").click({ modifiers: ["Shift"] });
  await expect(block(page, "a")).toHaveAttribute("aria-current", "false");
  await selectGroup(page);
  await page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(2)
    .click();
  await expect(block(page, "a")).toHaveAttribute("aria-current", "false");
  await expect(block(page, "c")).toHaveAttribute("aria-current", "true");
  await selectGroup(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".timeline-selected")).toHaveCount(0);
  await selectGroup(page);
  await page
    .getByTestId("timeline-track")
    .click({ position: { x: 200, y: 30 } });
  await expect(page.locator(".timeline-selected")).toHaveCount(0);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBe(5);
});

test("dragging either selected member previews and commits the group as one undo step", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page);
  await previewGroupMove(page, "b", 40);
  await expect(page.locator(".timeline-invalid")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:03.000 – 0:05.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:07.000 – 0:09.000",
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:12.000 – 0:14.000",
  );
  await expect(page.locator(".timeline-selected")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:02.000 – 0:04.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:06.000 – 0:08.000",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await previewGroupMove(page, "a", -40);
  await page.mouse.up();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:02.000 – 0:04.000",
  );
  await expect(page.locator(".timeline-selected")).toHaveCount(2);
});

test("invalid and cancelled group drags preserve timing, selection, and redo history", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page);
  await block(page, "a").press("ArrowRight");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await previewGroupMove(page, "b", 200);
  await expect(page.locator(".timeline-invalid")).toHaveCount(2);
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("overlap");
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:06.000 – 0:08.000",
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:12.000 – 0:14.000",
  );
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
  await previewGroupMove(page, "a", 40);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".timeline-preview")).toHaveCount(0);
  await expect(page.locator(".timeline-selected")).toHaveCount(2);
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:02.000 – 0:04.000",
  );
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
});

test("group keyboard movement saves all endpoints without persisting selection", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page, ["a", "c"]);
  await block(page, "a").press("ArrowRight");
  await block(page, "c").press("Shift+ArrowLeft");
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:01.100 – 0:03.100",
  );
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:11.100 – 0:13.100",
  );
  let body: unknown;
  await page.route("**/api/v1/track/alignment", async (route) => {
    const data = route.request().postDataJSON();
    body = data;
    await route.fulfill({
      json: {
        version: 1,
        lines: data.lines,
        alignment: { segments: data.segments },
      },
    });
  });
  await page.getByRole("button", { name: "Save alignment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  expect(body).toEqual({
    track_id: track.id,
    version: 0,
    lines: track.lines,
    segments: [s("a", 1100, 3100), s("b", 6000, 8000), s("c", 11100, 13100)],
  });
});

test("group drag respects zoom and scroll; dragging an unselected block returns to single selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await load(page, groupTrack);
  await selectGroup(page);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByLabel("Scrollable timeline").evaluate((element) => {
    element.scrollLeft = 100;
  });
  await previewGroupMove(page, "b", 80);
  await page.mouse.up();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:03.000 – 0:05.000",
  );
  await expect(page.getByTestId("segment-b")).toContainText(
    "0:07.000 – 0:09.000",
  );
  await page.getByLabel("Scrollable timeline").evaluate((element) => {
    element.scrollLeft = 650;
  });
  const box = (await block(page, "c").boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 12 });
  await expect(page.locator(".timeline-preview")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".timeline-selected")).toHaveCount(1);
  await expect(block(page, "c")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("segment-c")).toContainText(
    "0:13.000 – 0:15.000",
  );
});

test("zero-offset group drags preserve redo and undo prunes placements from selection", async ({
  page,
}) => {
  await load(page, groupTrack);
  await selectGroup(page);
  await block(page, "a").press("ArrowRight");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const box = (await block(page, "a").boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await previewGroupMove(page, "a", 40);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save alignment", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".timeline-selected")).toHaveCount(2);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 16;
  });
  await page
    .getByRole("list", { name: "Lyric lines" })
    .getByRole("button")
    .nth(3)
    .click();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await selectGroup(page, ["a", "d"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("segment-d")).toHaveCount(0);
  await expect(page.locator(".timeline-selected")).toHaveCount(1);
  await expect(block(page, "a")).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("textbox", { name: "Start at", exact: true }),
  ).toHaveValue("0:02");
});
