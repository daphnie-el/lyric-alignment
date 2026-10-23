import { test, expect, type Page } from "./fixtures";
import { createWav, mockAudio, waitForAudio } from "./helpers/audio";
import type { TrackPayload } from "../apps/web/src/utils/types";

const guidance = "No song loaded. Use Load song to choose an audio file from your device or enter a direct audio URL.";
const lyricGuidance = "No lyrics yet. Enter lyrics in the lyric sheet, one line per lyric, then choose Add all lines.";
const track: TrackPayload = {
  id: "empty-sheet", title: "New song", artist: "", duration_seconds: 8,
  audio_url: "/empty-sheet.wav", lines: [], version: 0, alignment: null,
};
const lyrics = (page: Page) => page.getByRole("region", { name: "Lyrics", exact: true });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline", exact: true });

for (const width of [1440, 375]) {
  test(`empty workspace explains how to load a track and disables editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/track", (route) => route.fulfill({ status: 404, json: { error: "no_current_track" } }));
    await page.goto("/");
    await expect(lyrics(page).getByText(guidance, { exact: true })).toBeVisible();
    await expect(timeline(page).getByText(guidance, { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await expect(page.locator("#load-song")).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Lyric sheet", exact: true })).toBeDisabled();
    for (const name of ["Add all lines", "+ Add line", "Save alignment", "Undo", "Redo", "Export LRC", "Zoom in", "Zoom out", "Set lyric start time"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(page.locator("audio")).toHaveCount(0);
    await expect(page.getByTestId("timeline-track")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const failure of ["unrelated404", "server", "network"]) {
  test(`${failure} remains an error with Retry instead of an empty workspace`, async ({ page }) => {
    let failed = true;
    await page.route("**/api/v1/track", async (route) => {
      if (!failed) { await route.fulfill({ status: 404, json: { error: "no_current_track" } }); return; }
      if (failure === "network") await route.abort();
      else await route.fulfill({ status: failure === "server" ? 503 : 404, json: { error: "not_found" } });
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Could not load the track.");
    await expect(page.getByText(guidance, { exact: true })).toHaveCount(0);
    failed = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText(guidance, { exact: true })).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("loading stays distinct from an empty workspace", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/track", async (route) => { await pending; await route.fulfill({ status: 404, json: { error: "no_current_track" } }); });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Loading track…");
  await expect(page.getByText(guidance, { exact: true })).toHaveCount(0);
  await expect(page.locator("#load-song")).toBeDisabled();
  release();
  await expect(page.getByText(guidance, { exact: true })).toHaveCount(2);
});

for (const source of ["file", "url"]) {
  test(`${source} imports from an empty workspace, then lyrics can be added, timed, saved, and reloaded`, async ({ page }) => {
    let current: TrackPayload | null = null;
    let posts = 0;
    await mockAudio(page, track.audio_url, track.duration_seconds);
    await page.route("**/api/v1/track", async (route) => {
      if (route.request().method() === "POST") { posts++; current = structuredClone(track); await route.fulfill({ status: 201, json: current }); }
      else if (current) await route.fulfill({ json: current });
      else await route.fulfill({ status: 404, json: { error: "no_current_track" } });
    });
    await page.route("**/api/v1/track/alignment", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.track_id).toBe(track.id);
      current = { ...track, lines: body.lines, alignment: { segments: body.segments }, version: 1 };
      await route.fulfill({ json: current });
    });
    await page.goto("/");
    await expect(page.getByText(guidance, { exact: true })).toHaveCount(2);
    await page.locator("#load-song").click();
    if (source === "file") {
      await page.getByRole("radio", { name: "Device file", exact: true }).check();
      await page.getByLabel("Audio file", { exact: true }).setInputFiles({ name: "New song.wav", mimeType: "audio/wav", buffer: createWav(8) });
    } else {
      await page.getByRole("radio", { name: "Audio URL", exact: true }).check();
      await page.getByRole("textbox", { name: "Direct audio URL" }).fill(`http://localhost:5173${track.audio_url}`);
    }
    await page.getByRole("dialog").getByRole("button", { name: "Load song", exact: true }).click();
    await expect(page.getByText("Song loaded, please add lyrics to the lyrics sheet.", { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(guidance, { exact: true })).toHaveCount(0);
    await expect(lyrics(page).getByText(lyricGuidance, { exact: true })).toBeVisible();
    await expect(timeline(page)).toContainText("Add lyrics to the lyric sheet and choose Add all lines.");
    await page.getByRole("textbox", { name: "Lyric sheet", exact: true }).fill("First lyric\nSecond lyric");
    await page.getByRole("button", { name: "Add all lines", exact: true }).click();
    await expect(page.getByText(lyricGuidance, { exact: true })).toHaveCount(0);
    await expect(timeline(page)).toContainText("Drag a lyric here, or select a lyric and use Stamp current time");
    await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
    await expect(timeline(page).locator(".timeline-block")).toHaveCount(1);
    await expect(timeline(page).locator(".timeline-hint")).toHaveCount(0);
    await page.getByRole("button", { name: "Save alignment", exact: true }).click();
    await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
    await page.reload();
    await waitForAudio(page);
    await expect(page.getByRole("list", { name: "Lyric lines" }).locator("li")).toHaveCount(2);
    await expect(timeline(page).locator(".timeline-block")).toHaveCount(1);
  });
}
