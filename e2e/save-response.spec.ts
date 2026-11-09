import { expect, test, type Download, type Page } from "./fixtures";
import { mockAudio } from "./helpers/audio";
import type { SaveAlignmentResponse, TrackPayload } from "../apps/web/src/utils/types";

const track: TrackPayload = {
  id: "save-response", title: "Save response", artist: "Artist",
  duration_seconds: 20, audio_url: "/save-response.wav", version: 3,
  lines: ["a", "b"].map((id, index) => ({ id, index, text: `Lyric ${id}` })),
  alignment: { segments: [{ line_id: "a", start_ms: 0, end_ms: 3000 }] },
};
const valid: SaveAlignmentResponse = {
  version: 4, lines: track.lines, alignment: track.alignment,
};
const invalidMessage = "Could not confirm the saved changes because the server returned an invalid response. Your local changes are still here. The server may have saved them; retry saving to confirm.";
const save = (page: Page) => page.getByRole("button", { name: "Save alignment", exact: true });
const move = (page: Page) => page.getByRole("button", { name: "Move Lyric a", exact: true });

async function loadAndEdit(page: Page) {
  await mockAudio(page, track.audio_url, 20);
  await page.route("**/api/v1/track", route => route.fulfill({ json: track }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: track.title, exact: true })).toBeVisible();
  await move(page).press("ArrowRight");
  await expect(page.getByTestId("segment-a")).toContainText("0:00.100 – 0:03.100");
}

const malformedResponses: [string, unknown][] = [
  ["missing fields", { version: 4 }],
  ["invalid version", { ...valid, version: "4" }],
  ["invalid lyric", { ...valid, lines: [null] }],
  ["invalid segment", { ...valid, alignment: { segments: [null] } }],
  ["unknown lyric reference", { ...valid, alignment: { segments: [{ line_id: "missing", start_ms: 0, end_ms: 1000 }] } }],
  ["timing outside the song", { ...valid, alignment: { segments: [{ line_id: "a", start_ms: 0, end_ms: 21000 }] } }],
  ["overlap that cannot be repaired", { ...valid, alignment: { segments: [
    { line_id: "a", start_ms: 0, end_ms: 15000 },
    { line_id: "b", start_ms: 10000, end_ms: 20000 },
  ] } }],
];

for (const [name, response] of malformedResponses) {
  test(`${name} preserves local work, prevents export, and allows a successful retry`, async ({ page }) => {
    let requests = 0;
    const downloads: Download[] = [];
    const errors: string[] = [];
    page.on("download", download => downloads.push(download));
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/track/alignment", async route => {
      requests++;
      const body = route.request().postDataJSON();
      expect(body.version).toBe(3);
      await route.fulfill({ json: requests === 1 ? response : {
        version: 4, lines: body.lines, alignment: { segments: body.segments },
      } });
    });
    await loadAndEdit(page);
    await page.getByRole("button", { name: "Export LRC", exact: true }).click();
    await page.getByRole("button", { name: "Save and export", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(invalidMessage);
    await expect(page.getByText("Changes saved successfully", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
    await expect(page.getByTestId("segment-a")).toContainText("0:00.100 – 0:03.100");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Lyric sheet", exact: true })).toBeEnabled();
    await expect(save(page)).toBeEnabled();
    expect(downloads).toHaveLength(0);
    expect(errors).toHaveLength(0);

    // Failure retains actual undo history, not just enabled controls.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByTestId("segment-a")).toContainText("0:00.000 – 0:03.000");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByTestId("segment-a")).toContainText("0:00.100 – 0:03.100");
    await save(page).click();
    await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
    await expect(save(page)).toBeDisabled();
    expect(requests).toBe(2);
    expect(downloads).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
}

test("repairable saved timings retain the server baseline and mark repairs unsaved", async ({ page }) => {
  await page.route("**/api/v1/track/alignment", route => route.fulfill({ json: {
    ...valid, alignment: { segments: [
      { line_id: "a", start_ms: 0, end_ms: 3000 },
      { line_id: "b", start_ms: 2000, end_ms: 4000 },
    ] },
  } }));
  await loadAndEdit(page);
  await save(page).click();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  await expect(page.getByTestId("segment-b")).toContainText("0:03.000 – 0:05.000");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(save(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("an export exception does not turn a confirmed save into a save failure", async ({ page }) => {
  await page.route("**/api/v1/track/alignment", async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { version: 4, lines: body.lines, alignment: { segments: body.segments } } });
  });
  await loadAndEdit(page);
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) throw new Error("Download unavailable");
      return click.call(this);
    };
  });
  await page.getByRole("button", { name: "Export LRC", exact: true }).click();
  await page.getByRole("button", { name: "Save and export", exact: true }).click();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  await expect(page.getByText("Your changes were saved, but the download could not start. Try Export LRC again.", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
});
