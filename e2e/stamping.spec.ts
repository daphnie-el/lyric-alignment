import { expect, test, type Page } from "@playwright/test";
import { stampSegment } from "../apps/web/src/utils/timing";
import type { SaveAlignmentRequest, Segment } from "../apps/web/src/utils/types";
import { mockAudio, waitForAudio } from "./helpers/audio";

const track = {
  id: "stamping-track",
  title: "Stamping another song",
  artist: "Test artist",
  duration_seconds: 14.25,
  audio_url: "/stamp.wav",
  version: 2,
  lines: ["verse", "chorus", "bridge"].map((id, index) => ({
    id,
    index,
    text: `Stamp ${id}`,
  })),
  alignment: { segments: [] as Segment[] },
};

const button = (page: Page) =>
  page.getByRole("button", { name: "Stamp current time", exact: true });
const segment = (page: Page, id: string) => page.getByTestId(`segment-${id}`);
const lyric = (page: Page, id: string) =>
  page.getByRole("list", { name: "Lyric lines" })
    .getByRole("button", { name: new RegExp(`Stamp ${id}`) });
const s = (line_id: string, start_ms: number, end_ms: number): Segment => ({
  line_id,
  start_ms,
  end_ms,
});

async function load(page: Page, segments: Segment[] = []) {
  await page.route("**/api/v1/track", (route) =>
    route.fulfill({ json: { ...track, alignment: { segments } } }),
  );
  await mockAudio(page, track.audio_url, track.duration_seconds);
  await page.goto("/");
  await waitForAudio(page);
  await expect(button(page)).toBeEnabled();
}

async function seek(page: Page, seconds: number) {
  await page.locator("audio").evaluate((audio: HTMLAudioElement, time) => {
    audio.currentTime = time;
  }, seconds);
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.seeking))
    .toBe(false);
}

async function backgroundSpace(page: Page) {
  await page.getByLabel("Scrollable timeline").focus();
  await page.keyboard.press("Space");
}

async function endpoints(page: Page, id: string) {
  return (await segment(page, id).locator("small").innerText()).split(" – ");
}

const order = ["verse", "chorus", "bridge"];
const stamp = (segments: readonly Segment[], id: string, start: number) =>
  stampSegment(segments, order, id, start, 14250);

function milliseconds(time: string) {
  const [minutes, seconds] = time.split(":");
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 1000);
}

test("stamps use sheet neighbors, skip untimed lyrics, and preserve other starts", () => {
  expect(stamp([], "verse", 0).segments).toEqual([s("verse", 0, 14250)]);
  const skipped = [s("bridge", 10000, 12000)];
  const first = stamp(skipped, "verse", 1000).segments!;
  expect(first).toEqual([s("verse", 1000, 9999), skipped[0]]);
  expect(stamp(first, "chorus", 4500).segments).toEqual([
    s("verse", 1000, 4499), s("chorus", 4500, 9999), skipped[0],
  ]);
  const complete = [s("bridge", 10000, 12000), s("verse", 1000, 2000), s("chorus", 4500, 6000)];
  const restamped = stamp(complete, "chorus", 6000).segments!;
  expect(restamped).toEqual([
    s("verse", 1000, 5999), s("chorus", 6000, 9999), complete[0],
  ]);
  expect(restamped[2]).toBe(complete[0]);
  expect(stamp(restamped, "bridge", 12000).segments).toEqual([
    restamped[0], s("chorus", 6000, 11999), s("bridge", 12000, 14250),
  ]);
  expect(stamp([s("chorus", 5000, 6000)], "verse", 3000).segments).toEqual([
    s("verse", 3000, 4999), s("chorus", 5000, 6000),
  ]);
  expect(complete).toEqual([
    s("bridge", 10000, 12000), s("verse", 1000, 2000), s("chorus", 4500, 6000),
  ]);
});

test("stamps enforce positive durations and a one-millisecond gap at boundaries", () => {
  const source = [s("verse", 1000, 1001), s("bridge", 1004, 14250)];
  expect(stamp(source, "chorus", 1002).segments).toEqual([
    s("verse", 1000, 1001), s("chorus", 1002, 1003), source[1],
  ]);
  for (const invalid of [0, 1000, 1001, 1003, 1004, 1005])
    expect(stamp(source, "chorus", invalid).error).toBeTruthy();
  for (const invalid of [-1, 0.5, NaN, Infinity, 14250, 14251])
    expect(stamp([], "verse", invalid).error).toBeTruthy();
  expect(stamp([], "verse", 14249).segments).toEqual([s("verse", 14249, 14250)]);
  expect(stamp(source, "unknown", 1002).error).toContain("lyric sheet");
  const reversed = [s("chorus", 1000, 2000), s("verse", 3000, 4000)];
  expect(stamp(reversed, "bridge", 6000).error).toContain("sheet order");
  expect(source).toEqual([s("verse", 1000, 1001), s("bridge", 1004, 14250)]);
});

test("Space closes the previous lyric one millisecond early in one undo step", async ({ page }) => {
  await load(page);
  await backgroundSpace(page);
  await expect(segment(page, "verse")).toContainText("0:00.000 – 0:14.250");
  await expect(lyric(page, "chorus")).toHaveAttribute("aria-current", "true");
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.play());
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.4);
  await backgroundSpace(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.pause());
  const chorusStart = milliseconds((await endpoints(page, "chorus"))[0]);
  expect(milliseconds((await endpoints(page, "verse"))[1])).toBe(chorusStart - 1);
  await expect(lyric(page, "bridge")).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(segment(page, "chorus")).toHaveCount(0);
  await expect(segment(page, "verse")).toContainText("0:00.000 – 0:14.250");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(milliseconds((await endpoints(page, "verse"))[1])).toBe(chorusStart - 1);
  await seek(page, 8);
  await backgroundSpace(page);
  await expect(segment(page, "chorus")).toContainText("0:07.999");
  await expect(segment(page, "bridge")).toContainText("0:08.000 – 0:14.250");
  await expect(button(page)).toBeDisabled();
});

test("explicit stamps and restamping update both sheet neighbors; lyric clicks only select", async ({ page }) => {
  await load(page, [s("bridge", 10000, 12000)]);
  await seek(page, 1);
  await lyric(page, "verse").click();
  await button(page).click();
  await expect(segment(page, "verse")).toContainText("0:01.000 – 0:09.999");
  await seek(page, 4.321);
  await lyric(page, "chorus").click();
  await button(page).click();
  await expect(segment(page, "verse")).toContainText("0:01.000 – 0:04.320");
  await expect(segment(page, "chorus")).toContainText("0:04.321 – 0:09.999");
  await expect(lyric(page, "bridge")).toHaveAttribute("aria-current", "true");
  await seek(page, 8);
  await lyric(page, "chorus").click();
  await expect(segment(page, "chorus")).toContainText("0:04.321 – 0:09.999");
  await button(page).click();
  await expect(segment(page, "verse")).toContainText("0:01.000 – 0:07.999");
  await expect(segment(page, "chorus")).toContainText("0:08.000 – 0:09.999");
  await expect(segment(page, "bridge")).toContainText("0:10.000 – 0:12.000");
  await lyric(page, "chorus").click();
  await seek(page, 9.999);
  await button(page).click();
  await expect(page.getByRole("alert")).toContainText("before the next");
  await expect(lyric(page, "chorus")).toHaveAttribute("aria-current", "true");
  await expect(segment(page, "verse")).toContainText("0:01.000 – 0:07.999");
  await expect(segment(page, "chorus")).toContainText("0:08.000 – 0:09.999");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(segment(page, "verse")).toContainText("0:01.000 – 0:04.320");
  await expect(segment(page, "chorus")).toContainText("0:04.321 – 0:09.999");
});

test("rejected stamps preserve selection and history through seeking", async ({ page }) => {
  await load(page);
  await button(page).click();
  await button(page).click();
  await expect(page.getByRole("alert")).toContainText("after the previous");
  await expect(lyric(page, "chorus")).toHaveAttribute("aria-current", "true");
  await expect(segment(page, "chorus")).toHaveCount(0);
  await seek(page, 14.25);
  await button(page).click();
  await expect(page.getByRole("alert")).toContainText("before the end");
  await seek(page, 14.2);
  await button(page).click();
  await expect(segment(page, "verse")).toContainText("0:00.000 – 0:14.199");
  await expect(segment(page, "chorus")).toContainText("0:14.200 – 0:14.250");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(segment(page, "chorus")).toHaveCount(0);
  await expect(segment(page, "verse")).toContainText("0:00.000 – 0:14.250");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(segment(page, "verse")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Space leaves focused controls, editable content, modified and repeated keys alone", async ({ page }) => {
  await load(page);
  const prevented = await page.evaluate(() => {
    const selectors = ["input", "textarea", "select", "button", "audio", "a", "summary", "div"];
    return selectors.map((tag) => {
      const element = document.createElement(tag);
      if (tag === "div") element.contentEditable = "true";
      document.querySelector("main")!.append(element);
      const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      element.remove();
      return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual(Array(8).fill(false));
  await page.getByLabel("Scrollable timeline").focus();
  const ignoredKeys = [
    { repeat: true }, { isComposing: true }, { ctrlKey: true },
    { metaKey: true }, { altKey: true }, { shiftKey: true },
  ];
  for (const options of ignoredKeys) {
    await page.getByLabel("Scrollable timeline").dispatchEvent("keydown", { key: " ", ...options });
  }
  await expect(segment(page, "verse")).toHaveCount(0);
  await page.getByLabel("Scrollable timeline").evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    });
    event.preventDefault();
    element.dispatchEvent(event);
  });
  await expect(segment(page, "verse")).toHaveCount(0);
  // Space on an untimed lyric uses native button activation to select only.
  await lyric(page, "chorus").press("Space");
  await expect(segment(page, "chorus")).toHaveCount(0);
  await expect(lyric(page, "chorus")).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".timeline-preview")).toHaveCount(0);
});

test("saving stamped timings preserves sheet-based boundaries", async ({ page }) => {
  await load(page);
  let saved: SaveAlignmentRequest | undefined;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/track/alignment", async (route) => {
    const payload = route.request().postDataJSON() as SaveAlignmentRequest;
    saved = payload;
    await pending;
    await route.fulfill({
      json: {
        version: 3,
        lines: payload.lines,
        alignment: { segments: payload.segments },
      },
    });
  });
  await button(page).click();
  await page.getByRole("button", { name: "Save alignment", exact: true }).click();
  await expect(button(page)).toBeDisabled();
  await backgroundSpace(page);
  await expect(segment(page, "chorus")).toHaveCount(0);
  release();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  expect(saved).toEqual({ version: 2, lines: track.lines, segments: [s("verse", 0, 14250)] });
  await seek(page, 5);
  await button(page).click();
  await expect(segment(page, "chorus")).toContainText("0:05.000 – 0:14.250");
  await expect(segment(page, "verse")).toContainText("0:00.000 – 0:04.999");
});

test("stamping is blocked during resizing and when audio is unavailable", async ({ page }) => {
  await load(page, [s("verse", 0, 3000)]);
  const handle = (await page
    .getByRole("button", { name: "Resize end of Stamp verse" })
    .boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 20);
  await page.mouse.down();
  await expect(button(page)).toBeDisabled();
  await page.getByLabel("Scrollable timeline").dispatchEvent("keydown", { key: " " });
  await expect(segment(page, "chorus")).toHaveCount(0);
  await page.mouse.up();
  await expect(button(page)).toBeEnabled();

  await page.route("**/stamp.wav", (route) => route.fulfill({ status: 404 }));
  await page.reload();
  await expect(button(page)).toBeDisabled();
  await lyric(page, "chorus").click();
  await backgroundSpace(page);
  await expect(segment(page, "chorus")).toHaveCount(0);
});
