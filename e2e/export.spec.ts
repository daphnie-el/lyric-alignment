import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "./fixtures";
import { segmentsToLrc } from "../apps/web/src/utils/helpers";
import type { Segment } from "../apps/web/src/utils/types";
import { mockAudio, waitForAudio } from "./helpers/audio";

const track = {
  id: 1,
  title: '  Cântec: "夜"/live?  ',
  artist: "Artist",
  duration_seconds: 70,
  audio_url: "/export.wav",
  version: 1,
  lines: [
    { id: "a", index: 0, text: "Bună seara 🌙" },
    { id: "b", index: 1, text: "夜の歌" },
    { id: "c", index: 2, text: "Final lyric" },
  ],
  alignment: { segments: [
    { line_id: "a", start_ms: 1234, end_ms: 3000 },
    { line_id: "b", start_ms: 59996, end_ms: 63000 },
    { line_id: "c", start_ms: 65000, end_ms: 68000 },
  ] },
};
const exportButton = (page: Page) => page.getByRole("button", { name: "Export LRC", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: /Some lines aren’t timed yet|Export unsaved changes\?/ });

async function load(page: Page, segments: Segment[] = track.alignment.segments, title = track.title) {
  await page.route("**/api/v1/track", route => route.fulfill({
    json: { ...track, title, alignment: { segments } },
  }));
  await mockAudio(page, track.audio_url, track.duration_seconds);
  await page.goto("/");
  await waitForAudio(page);
}

async function content(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!, "utf8");
}

test("serialization sorts a copy, omits unknown lyrics, and preserves Unicode", () => {
  const segments = [...track.alignment.segments].reverse();
  segments.push({ line_id: "unknown", start_ms: 0, end_ms: 1000 });
  const original = structuredClone(segments);
  expect(segmentsToLrc(segments, track.lines)).toBe(
    "[00:01.23]Bună seara 🌙\n[01:00.00]夜の歌\n[01:05.00]Final lyric",
  );
  expect(segments).toEqual(original);
});

test("complete export downloads current unsaved lyrics with a safe filename", async ({ page }) => {
  await load(page, [...track.alignment.segments].reverse());
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").first().click();
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).fill("Updated 🌙");
  let saves = 0;
  await page.route("**/api/v1/track/alignment", route => { saves++; return route.abort(); });
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("Your changes haven’t been saved.");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export without saving", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Cântec_ _夜__live_.lrc");
  expect(await content(download)).toBe("[00:01.23]Updated 🌙\n[01:00.00]夜の歌\n[01:05.00]Final lyric");
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  expect(saves).toBe(0);
});

test("partial export explains omissions and downloads only after confirmation", async ({ page }) => {
  await load(page, track.alignment.segments.slice(0, 1));
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("2 of 3 lines haven’t been placed on the timeline. Exporting now will include only the 1 timed line.");
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  expect(downloads).toHaveLength(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export 1 timed line", exact: true }).click();
  expect(await content(await downloadPromise)).toBe("[00:01.23]Bună seara 🌙");
  await expect(dialog(page)).not.toBeVisible();
  await expect(exportButton(page)).toBeFocused();
});

test("cancel and Escape keep editing without downloading and focus stays in the modal", async ({ page }) => {
  await load(page, track.alignment.segments.slice(0, 2));
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("1 of 3 lines hasn’t been placed on the timeline.");
  const keepEditing = page.getByRole("button", { name: "Keep editing" });
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close export dialog" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Export 2 timed lines", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close export dialog" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keepEditing).toBeFocused();
  await keepEditing.click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(exportButton(page)).toBeFocused();
  await exportButton(page).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(exportButton(page)).toBeFocused();
  expect(downloads).toHaveLength(0);
});

test("counts follow removed and restored timing and newly added lyrics", async ({ page }) => {
  await load(page, track.alignment.segments.slice(0, 2));
  await page.getByRole("button", { name: "Move 夜の歌", exact: true }).click();
  await page.getByRole("button", { name: "Remove Segment", exact: true }).click();
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("2 of 3 lines haven’t");
  // Editor shortcuts must not change the document behind the modal.
  await page.keyboard.press("Control+z");
  await expect(dialog(page)).toContainText("2 of 3 lines haven’t");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("1 of 3 lines hasn’t");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("textbox", { name: "Lyric sheet", exact: true }).fill("New line");
  await page.getByRole("button", { name: "+ Add line", exact: true }).click();
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("2 of 4 lines haven’t");
});

test("export is disabled without timing and during timeline interaction", async ({ page }) => {
  await load(page, []);
  await expect(exportButton(page)).toBeDisabled();
  await expect(exportButton(page)).toHaveAccessibleDescription("Time at least one lyric line to export.");
  await expect(page.getByText("Time at least one lyric line to export.")).toBeVisible();
  await page.getByRole("button", { name: "Set lyric start time", exact: true }).click();
  await expect(exportButton(page)).toBeEnabled();
  const box = (await page.getByRole("button", { name: "Resize start of Bună seara 🌙" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await expect(exportButton(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(exportButton(page)).toBeEnabled();
});

test("blank titles fall back to lyrics.lrc", async ({ page }) => {
  await load(page, track.alignment.segments, "   ");
  const downloadPromise = page.waitForEvent("download");
  await exportButton(page).click();
  expect((await downloadPromise).suggestedFilename()).toBe("lyrics.lrc");
});

test("export stays disabled while loading and after a load failure", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/track", async route => {
    await pending;
    await route.fulfill({ status: 503 });
  });
  await page.goto("/");
  await expect(exportButton(page)).toBeDisabled();
  release();
  await expect(page.getByText("Could not load the track.")).toBeVisible();
  await expect(exportButton(page)).toBeDisabled();
});

async function editFirstLine(page: Page, text = "Unsaved lyric 🌙") {
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").first().click();
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).fill(text);
}

for (const unsaved of [false, true]) {
  test(`close icon dismisses ${unsaved ? "unsaved" : "untimed"} dialog without saving or exporting on a narrow screen`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await load(page, track.alignment.segments.slice(0, 1));
    let saves = 0;
    await page.route("**/api/v1/track/alignment", route => { saves++; return route.abort(); });
    const downloads: Download[] = [];
    page.on("download", download => downloads.push(download));
    if (unsaved) await editFirstLine(page);
    await exportButton(page).click();
    await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
    const close = page.getByRole("button", { name: "Close export dialog", exact: true });
    await expect(close).toBeVisible();
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBe(32);
    expect(closeBox.height).toBe(32);
    const titleBox = (await dialog(page).getByRole("heading").boundingBox())!;
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
    await close.click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(exportButton(page)).toBeFocused();
    expect(saves).toBe(0);
    expect(downloads).toHaveLength(0);
  });
}

test("save and export waits, prevents duplicates, and downloads returned saved content", async ({ page }) => {
  await load(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: { version: number; lines: typeof track.lines; segments: Segment[] }[] = [];
  await page.route("**/api/v1/track/alignment", async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1) await pending;
    await route.fulfill({ json: {
      version: requests.length + 1,
      lines: body.lines.map((line: typeof track.lines[number]) => line.id === "a" ? { ...line, text: "Saved by server 🌙" } : line),
      alignment: { segments: body.segments.map((segment: Segment) => segment.line_id === "a" ? { ...segment, start_ms: 2000 } : segment) },
    } });
  });
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await editFirstLine(page);
  await exportButton(page).click();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close export dialog" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Save and export", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close export dialog" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.getByRole("button", { name: "Save and export", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click(); button.click();
  });
  await expect(exportButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].lines[0].text).toBe("Unsaved lyric 🌙");
  expect(downloads).toHaveLength(0);
  const downloadPromise = page.waitForEvent("download");
  release();
  expect(await content(await downloadPromise)).toBe("[00:02.00]Saved by server 🌙\n[01:00.00]夜の歌\n[01:05.00]Final lyric");
  await expect(exportButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await expect(page.getByText("Unsaved changes", { exact: true })).not.toBeVisible();
  expect(downloads).toHaveLength(1);
  await editFirstLine(page, "Next edit");
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).blur();
  await page.getByRole("button", { name: "Save alignment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  expect(requests[1].version).toBe(2);
  expect(downloads).toHaveLength(1);
});

for (const failure of ["network", "server", "conflict"] as const) {
  test(`${failure} failure preserves changes and clears export intent before ordinary save`, async ({ page }) => {
    await load(page);
    let calls = 0;
    await page.route("**/api/v1/track/alignment", async route => {
      calls++;
      if (calls === 1) {
        if (failure === "network") return route.abort();
        return route.fulfill({ status: failure === "conflict" ? 409 : 500, json: failure === "conflict" ? { error: "version_conflict", version: 2, lines: track.lines, alignment: track.alignment } : { error: failure } });
      }
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { version: 2, lines: body.lines, alignment: { segments: body.segments } } });
    });
    const downloads: Download[] = [];
    page.on("download", download => downloads.push(download));
    await editFirstLine(page);
    await exportButton(page).click();
    await page.getByRole("button", { name: "Save and export", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(failure === "conflict" ? "Another session saved a newer version" : "Could not save your changes");
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
    expect(downloads).toHaveLength(0);
    if (failure === "conflict") {
      page.once("dialog", prompt => prompt.accept());
      await page.getByRole("button", { name: "Replace server version", exact: true }).click();
    } else await page.getByRole("button", { name: "Save alignment", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
    await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
    expect(calls).toBe(2);
    expect(downloads).toHaveLength(0);
  });
}

test("unsaved partial export combines warnings and cancellation makes no requests or downloads", async ({ page }) => {
  await load(page, track.alignment.segments.slice(0, 1));
  let saves = 0;
  await page.route("**/api/v1/track/alignment", route => { saves++; return route.abort(); });
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await editFirstLine(page);
  await exportButton(page).click();
  await expect(dialog(page)).toContainText("Your changes haven’t been saved.");
  await expect(dialog(page)).toContainText("2 of 3 lines haven’t been placed on the timeline.");
  await expect(page.getByRole("button", { name: "Export without saving", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and export", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(exportButton(page)).toBeFocused();
  await exportButton(page).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(exportButton(page)).toBeFocused();
  expect(saves).toBe(0);
  expect(downloads).toHaveLength(0);
  await exportButton(page).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export without saving", exact: true }).click();
  expect(await content(await downloadPromise)).toBe("[00:01.23]Unsaved lyric 🌙");
  expect(saves).toBe(0);
});

test("undo back to saved content exports immediately even with redo history", async ({ page }) => {
  await load(page);
  let saves = 0;
  await page.route("**/api/v1/track/alignment", route => { saves++; return route.abort(); });
  await editFirstLine(page);
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).blur();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportButton(page).click();
  expect(await content(await downloadPromise)).toContain("[00:01.23]Bună seara 🌙");
  await expect(dialog(page)).not.toBeVisible();
  expect(saves).toBe(0);
});

for (const newline of ["\n", "\r\n", "\r"]) {
  test(`multiline serialization normalizes ${JSON.stringify(newline)} without changing editor text`, () => {
    const lines = [{ id: "a", index: 0, text: `Bună 🌙 \t${newline}\t 夜の歌!` }];
    const original = structuredClone(lines);
    expect(segmentsToLrc([track.alignment.segments[0]], lines)).toBe("[00:01.23]Bună 🌙 夜の歌!");
    expect(lines).toEqual(original);
  });
}

test("multiline lyric downloads as one timestamped LRC line", async ({ page }) => {
  await load(page);
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").first().click();
  const text = page.getByRole("textbox", { name: "Lyric text", exact: true });
  await text.fill("First 🌙 \n\tSecond 夜");
  await exportButton(page).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export without saving", exact: true }).click();
  expect(await content(await downloading)).toBe("[00:01.23]First 🌙 Second 夜\n[01:00.00]夜の歌\n[01:05.00]Final lyric");
  await expect(text).toHaveValue("First 🌙 \n\tSecond 夜");
});
