import { expect, test, type Locator } from "./fixtures";
import { mockAudio, waitForAudio } from "./helpers/audio";

const track = {
  id: "dialog-track", title: "Dialog layout", artist: "Artist",
  duration_seconds: 20, audio_url: "/dialog.wav", version: 0,
  lines: [
    { id: "a", index: 0, text: "One two three four" },
    { id: "b", index: 1, text: "Untimed lyric" },
  ],
  alignment: { segments: [{ line_id: "a", start_ms: 1000, end_ms: 5000 }] },
};

async function expectFooter(dialog: Locator, labels: string[], primary: string) {
  const footer = dialog.locator("footer");
  await expect(footer).toBeVisible();
  await expect(footer.getByRole("button")).toHaveText(labels);
  const appearance = await footer.evaluate(element => {
    const styles = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const dialogBounds = element.closest("dialog")!.getBoundingClientRect();
    return {
      divider: parseFloat(styles.borderTopWidth),
      background: styles.backgroundColor,
      dialogBackground: getComputedStyle(element.closest("dialog")!).backgroundColor,
      alignment: styles.justifyContent,
      left: bounds.left - dialogBounds.left,
      right: dialogBounds.right - bounds.right,
      bottom: dialogBounds.bottom - bounds.bottom,
    };
  });
  expect(appearance.divider).toBeGreaterThan(0);
  expect(appearance.background).not.toBe(appearance.dialogBackground);
  expect(appearance.alignment).toBe("flex-end");
  expect(appearance.left).toBeLessThanOrEqual(2);
  expect(appearance.right).toBeLessThanOrEqual(2);
  expect(appearance.bottom).toBeLessThanOrEqual(2);
  const bounds = (await footer.boundingBox())!;
  for (const label of labels) {
    const button = footer.getByRole("button", { name: label, exact: true });
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await expect(footer.getByRole("button").last()).toHaveText(primary);
  const close = dialog.getByRole("button", { name: /^Close .* dialog$/ });
  await expect(close).toHaveCSS("border-top-width", "0px");
  const closeBounds = (await close.boundingBox())!;
  const titleBounds = (await dialog.getByRole("heading").boundingBox())!;
  expect(Math.abs(closeBounds.y + closeBounds.height / 2 - titleBounds.y - titleBounds.height / 2)).toBeLessThan(2);
}

for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`all dialog actions share a footer at ${width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await mockAudio(page, track.audio_url, 20);
      await mockAudio(page, "/source.wav", 8);
      await page.route("**/api/v1/track", route => route.fulfill({ json: track }));
      await page.goto("/");
      await waitForAudio(page);
      await page.locator("html").evaluate((element, theme) => element.setAttribute("data-theme", theme), theme);

      await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").first().click();
      await page.getByRole("button", { name: "Split", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expectFooter(dialog, ["Cancel", "Split"], "Split");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByRole("button", { name: "Export LRC", exact: true }).click();
      await expectFooter(dialog, ["Keep editing", "Export 1 timed line"], "Export 1 timed line");
      await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
      const text = page.getByRole("textbox", { name: "Lyric text", exact: true });
      await text.fill("Edited lyric with four words");
      await text.blur();
      await page.getByRole("button", { name: "Export LRC", exact: true }).click();
      await expectFooter(dialog, ["Keep editing", "Export without saving", "Save and export"], "Save and export");
      await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();

      await page.locator("#load-song").click();
      await expectFooter(dialog, ["Load song"], "Load song");
      // The submit button lives in the footer, outside the source form.
      // Enter must still submit the form and open the replacement confirmation.
      const url = dialog.getByRole("textbox", { name: "Direct audio URL" });
      await url.fill("http://localhost:5173/source.wav");
      await url.press("Enter");
      await expect(dialog).toHaveAccessibleName("Replace current song?");
      await expectFooter(dialog, ["Choose another source", "Export and continue", "Continue"], "Continue");
      await dialog.getByRole("button", { name: "Choose another source", exact: true }).click();
      await expectFooter(dialog, ["Load song"], "Load song");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  }
}
