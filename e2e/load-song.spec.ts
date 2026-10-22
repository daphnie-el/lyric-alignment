import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page, type Request } from "@playwright/test";
import type { TrackPayload } from "../apps/web/src/utils/types";
import { createWav, mockAudio, waitForAudio } from "./helpers/audio";

const original: TrackPayload = {
  id: "old", title: "Original song", artist: "Artist", duration_seconds: 30,
  audio_url: "/original.wav", version: 0,
  lines: [{ id: "a", index: 0, text: "Timed lyric" }, { id: "b", index: 1, text: "Untimed lyric" }],
  alignment: { segments: [{ line_id: "a", start_ms: 1000, end_ms: 4000 }] },
};
const imported: TrackPayload = {
  id: "new", title: "New song", artist: "", duration_seconds: 8,
  audio_url: "/new.wav", version: 0, lines: [], alignment: null,
};
const success = "Song loaded, please add lyrics to the lyrics sheet.";
const loadButton = (page: Page) => page.locator("#load-song");
const dialog = (page: Page) => page.getByRole("dialog");
const confirm = (page: Page) => dialog(page).getByRole("button", { name: "Continue", exact: true });
const close = (page: Page) => page.getByRole("button", { name: "Close load song dialog" });

async function setup(page: Page, initial: TrackPayload = original) {
  let persisted = structuredClone(initial);
  const posts: Request[] = [];
  await mockAudio(page, "/original.wav", 30);
  await mockAudio(page, "/new.wav", 8);
  await mockAudio(page, "/source.wav", 8);
  await page.route("**/api/v1/track", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request());
      persisted = structuredClone(imported);
      await route.fulfill({ status: 201, json: persisted });
    } else await route.fulfill({ json: persisted });
  });
  await page.goto("/");
  await waitForAudio(page);
  return posts;
}

async function chooseFile(page: Page, name = "My song.wav", buffer = createWav(8)) {
  await loadButton(page).click();
  await page.getByRole("radio", { name: "Device file", exact: true }).check();
  await dialog(page).getByLabel("Audio file", { exact: true }).setInputFiles({ name, mimeType: "audio/wav", buffer });
  await dialog(page).getByRole("button", { name: "Load song", exact: true }).click();
}

async function chooseUrl(page: Page, value = "http://localhost:5173/source.wav") {
  await loadButton(page).click();
  await page.getByRole("radio", { name: "Audio URL", exact: true }).check();
  await page.getByRole("textbox", { name: "Direct audio URL" }).fill(value);
  await dialog(page).getByRole("button", { name: "Load song", exact: true }).click();
}

test("device file import warns, submits multipart, resets editor/player, and survives refresh", async ({ page }) => {
  const posts = await setup(page);
  await page.getByRole("button", { name: "Move Timed lyric", exact: true }).press("ArrowRight");
  await page.getByRole("textbox", { name: "Lyric sheet", exact: true }).fill("Old draft");
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = 5; });
  await chooseFile(page);
  await expect(dialog(page)).toHaveAccessibleName("Replace current song?");
  await expect(dialog(page)).toContainText("You have unsaved changes.");
  await expect(dialog(page)).toContainText("Audio and 1 untimed line is excluded.");
  expect(posts).toHaveLength(0);
  await confirm(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  const body = posts[0].postDataBuffer()!.toString("latin1");
  expect(body).toContain('name="file"; filename="My song.wav"');
  expect(body).toContain('name="duration_seconds"');
  expect(body).toContain("RIFF");
  await expect(page.getByRole("list", { name: "Lyric lines" }).locator("li")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Lyric sheet", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await expect(page.getByText("Select a lyric line to view its timing.")).toBeVisible();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused && audio.currentTime === 0)).toBe(true);
  await expect(loadButton(page)).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { name: "New song", exact: true })).toBeVisible();
  await expect(page.getByText(success, { exact: true })).toHaveCount(0);
});

test("switching sources never submits a file hidden by an empty picker", async ({ page }) => {
  const posts = await setup(page);
  await chooseFile(page);
  await page.getByRole("button", { name: "Choose another source" }).click();
  const submit = dialog(page).getByRole("button", { name: "Load song", exact: true });
  await expect(submit).toBeDisabled();
  await dialog(page).getByLabel("Audio file", { exact: true }).setInputFiles({ name: "Another.wav", mimeType: "audio/wav", buffer: createWav(8) });
  await expect(submit).toBeEnabled();
  await page.getByRole("radio", { name: "Audio URL", exact: true }).check();
  await page.getByRole("radio", { name: "Device file", exact: true }).check();
  await expect(submit).toBeDisabled();
  expect(posts).toHaveLength(0);
});

test("URL import warns for saved tracks and sends measured duration", async ({ page }) => {
  const posts = await setup(page);
  await chooseUrl(page);
  await expect(dialog(page)).toHaveAccessibleName("Replace current song?");
  await expect(dialog(page)).not.toContainText("You have unsaved changes.");
  expect(posts).toHaveLength(0);
  await confirm(page).click();
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  expect(posts[0].postDataJSON()).toEqual({ audio_url: "http://localhost:5173/source.wav", duration_seconds: 8 });
});

test("X, Escape, focus containment, and modal shortcuts preserve the old song", async ({ page }) => {
  const posts = await setup(page);
  await chooseFile(page);
  await expect(dialog(page)).toHaveAccessibleName("Replace current song?");
  await expect(page.getByRole("heading", { name: "Replace current song?" })).toBeFocused();
  await close(page).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Choose another source" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close(page)).toBeFocused();
  await page.getByRole("heading", { name: "Replace current song?" }).focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Space");
  await expect(dialog(page)).toContainText("1 timed line");
  await close(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(loadButton(page)).toBeFocused();
  await chooseUrl(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Original song", exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
});

test("export and continue downloads current edits and only timed lyrics", async ({ page }) => {
  await setup(page);
  await page.getByRole("list", { name: "Lyric lines" }).getByRole("button").first().click();
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).fill("Current edited lyric");
  await chooseFile(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export and continue", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Original song.lrc");
  expect(await readFile((await download.path())!, "utf8")).toBe("[00:01.00]Current edited lyric");
  await expect(page.getByText(success, { exact: true })).toBeVisible();
});

test("no timed lines disables export but allows replacement", async ({ page }) => {
  await setup(page, { ...original, alignment: null });
  await chooseFile(page);
  await expect(page.getByRole("button", { name: "Export and continue", exact: true })).toBeDisabled();
  await expect(dialog(page)).toContainText("There are no timed lyrics to export.");
  await confirm(page).click();
  await expect(page.getByText(success, { exact: true })).toBeVisible();
});

for (const [name, source] of [["unsupported file", "text"], ["corrupt file", "corrupt"], ["invalid URL", "invalid"], ["non-audio URL", "html"]]) {
  test(`${name} shows inline and toast errors without posting`, async ({ page }) => {
    const posts = await setup(page);
    if (source === "text") await chooseFile(page, "notes.txt", Buffer.from("text"));
    if (source === "corrupt") await chooseFile(page, "broken.wav", Buffer.from("not audio"));
    if (source === "invalid") await chooseUrl(page, "file:///tmp/audio.wav");
    if (source === "html") {
      await page.route("**/not-audio", (route) => route.fulfill({ contentType: "text/html", body: "<p>Web page</p>" }));
      await chooseUrl(page, "http://localhost:5173/not-audio");
    }
    await expect(dialog(page).getByRole("alert")).toBeVisible();
    await expect(page.locator("[data-sonner-toast][data-type='error']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Original song", exact: true })).toBeVisible();
    expect(posts).toHaveLength(0);
  });
}

test("API failure preserves current edits and can retry without duplicate submissions", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Move Timed lyric", exact: true }).press("ArrowRight");
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/track", async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    requests++;
    if (requests === 1) { await pending; await route.fulfill({ status: 500, json: { error: "track_storage_failed", hint: "Storage is full. Try again." } }); }
    else await route.fulfill({ status: 201, json: imported });
  });
  await chooseFile(page);
  await confirm(page).click();
  await expect(close(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save alignment", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Lyric sheet", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  expect(requests).toBe(1);
  release();
  await expect(dialog(page).getByRole("alert")).toHaveText("Storage is full. Try again.");
  await expect(page.getByTestId("segment-a")).toContainText("0:01.100");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await confirm(page).click();
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test("success waits for the stored player's canplay event", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/new.wav", async (route) => { await pending; await route.fallback(); });
  await chooseFile(page);
  await confirm(page).click();
  await expect(dialog(page).getByRole("status")).toHaveText("Loading song into player…");
  await expect(page.getByText(success, { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("stored audio failure leaves a retryable dialog and reports no success", async ({ page }) => {
  await setup(page);
  await page.route("**/new.wav", (route) => route.fulfill({ status: 404 }));
  await chooseFile(page);
  await confirm(page).click();
  await expect(dialog(page).getByRole("alert")).toContainText("The song was stored, but playback could not load.");
  await expect(page.getByText(success, { exact: true })).toHaveCount(0);
  await expect(confirm(page)).toBeEnabled();
  await close(page).click();
  await expect(page.getByRole("button", { name: "Retry playback" })).toBeVisible();
});

test("closing a probe cancels it, revokes object URLs, and ignores late results", async ({ page }) => {
  const posts = await setup(page);
  await page.evaluate(() => {
    const original = URL.revokeObjectURL;
    const revoked: string[] = [];
    Object.assign(window, { revokedAudioUrls: revoked });
    URL.revokeObjectURL = (url) => { revoked.push(url); original.call(URL, url); };
  });
  await chooseFile(page);
  await expect(dialog(page)).toHaveAccessibleName("Replace current song?");
  expect(await page.evaluate(() => (window as unknown as { revokedAudioUrls: string[] }).revokedAudioUrls.length)).toBe(1);
  await close(page).click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/slow.wav", async (route) => { await pending; await route.fulfill({ contentType: "audio/wav", body: createWav(8) }); });
  await chooseUrl(page, "http://localhost:5173/slow.wav");
  await expect(dialog(page).getByRole("status")).toHaveText("Checking audio…");
  await close(page).click();
  release();
  await expect(dialog(page)).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test("probe timeout shows actionable feedback", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/timeout.wav", async (route) => { await pending; await route.abort(); });
  await chooseUrl(page, "http://localhost:5173/timeout.wav");
  await expect(dialog(page).getByRole("status")).toHaveText("Checking audio…");
  await page.clock.fastForward(30001);
  await expect(dialog(page).getByRole("alert")).toContainText("Audio took too long to load.");
  release();
});

test("stored player timeout unlocks the dialog without a success toast", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/new.wav", async (route) => { await pending; await route.abort(); });
  await chooseFile(page);
  await confirm(page).click();
  await expect(dialog(page).getByRole("status")).toHaveText("Loading song into player…");
  await page.clock.fastForward(30001);
  await expect(dialog(page).getByRole("alert")).toContainText("The song was stored, but playback could not load.");
  await expect(close(page)).toBeEnabled();
  await expect(page.getByText(success, { exact: true })).toHaveCount(0);
  release();
});

test("storage timeout and network failure preserve work and allow retry", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/track", async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    await pending;
    await route.abort();
  });
  await chooseFile(page);
  await confirm(page).click();
  await expect(dialog(page).getByRole("status")).toHaveText("Storing song…");
  await page.clock.fastForward(120001);
  await expect(dialog(page).getByRole("alert")).toContainText("Storing the song timed out.");
  await expect(confirm(page)).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Original song", exact: true })).toBeVisible();
  release();
  await confirm(page).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Could not confirm the song was stored.");
});

test("playback errors after a successful import can be retried", async ({ page }) => {
  await setup(page);
  await chooseFile(page);
  await confirm(page).click();
  await expect(page.getByText(success, { exact: true })).toBeVisible();
  let broken = true;
  await page.route("**/new.wav", async (route) => {
    if (broken) await route.fulfill({ status: 404 });
    else await route.fallback();
  });
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.load());
  await expect(page.getByRole("alert")).toContainText("Could not play this song.");
  broken = false;
  await page.getByRole("button", { name: "Retry playback" }).click();
  await waitForAudio(page);
  await expect(page.getByRole("button", { name: "Retry playback" })).toHaveCount(0);
});

test("device upload persists through the real API in an isolated database", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "lyric-import-ui-"));
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/api/src/server.js"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DB_PATH: join(directory, "test.db"), UPLOAD_DIR: join(directory, "uploads"), SEED_ON_START: "true", API_TOKEN: "lyric-align-dev-token-7f3a91" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      server.stdout.on("data", (chunk) => { output += chunk; const port = output.match(/localhost:(\d+)/)?.[1]; if (port) resolve(`http://127.0.0.1:${port}`); });
      server.stderr.on("data", (chunk) => { output += chunk; });
      server.once("error", reject);
      server.once("exit", () => reject(new Error(output)));
    });
    await page.route("**/api/v1/track", async (route) => {
      const response = await route.fetch({ url: `${base}/api/v1/track` });
      await route.fulfill({ response });
    });
    await page.route("**/api/audio/uploads/**", async (route) => {
      const response = await route.fetch({ url: base + new URL(route.request().url()).pathname });
      await route.fulfill({ response });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "You Verse You", exact: true })).toBeVisible();
    await chooseFile(page, "Custom song.wav");
    await confirm(page).click();
    await expect(page.getByText(success, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Custom song", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Custom song", exact: true })).toBeVisible();
    await waitForAudio(page);
    await expect(page.getByRole("list", { name: "Lyric lines" }).locator("li")).toHaveCount(0);
    const ownedPath = (await page.locator("audio").getAttribute("src"))!;
    await chooseUrl(page, new URL(ownedPath, "http://localhost:5173").href);
    await confirm(page).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(success, { exact: true })).toBeVisible();
    await expect(page.locator("audio")).toHaveAttribute("src", ownedPath);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Custom song", exact: true })).toBeVisible();
    await waitForAudio(page);
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit"); server.kill("SIGTERM"); await exited;
    }
    await rm(directory, { force: true, recursive: true });
  }
});
