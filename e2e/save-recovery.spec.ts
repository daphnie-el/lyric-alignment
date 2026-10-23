import { expect, test, type Page } from "./fixtures";
import type { TrackPayload } from "../apps/web/src/utils/types";
import { mockAudio, waitForAudio } from "./helpers/audio";

const track: TrackPayload = {
  id: "recovery", title: "Recovery song", artist: "", duration_seconds: 20,
  audio_url: "/recovery.wav", version: 3,
  lines: [{ id: "a", index: 0, text: "Local lyric" }],
  alignment: { segments: [{ line_id: "a", start_ms: 0, end_ms: 3000 }] },
};
const save = (page: Page) => page.getByRole("button", { name: "Save alignment", exact: true });
const replace = (page: Page) => page.getByRole("button", { name: "Replace server version", exact: true });
const latest = (page: Page) => page.getByRole("button", { name: "Load latest", exact: true });
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const segment = (page: Page) => page.getByTestId("segment-a");
async function load(page: Page) {
  await mockAudio(page, track.audio_url, track.duration_seconds);
  await page.route("**/api/v1/track", route => route.fulfill({ json: track }));
  await page.goto("/");
  await waitForAudio(page);
  await page.getByRole("button", { name: "Move Local lyric", exact: true }).press("ArrowRight");
}
async function confirm(page: Page, action: ReturnType<typeof replace>, accept = true) {
  page.once("dialog", prompt => accept ? prompt.accept() : prompt.dismiss());
  await action.click();
}
function newer(version = 4): TrackPayload {
  return { ...track, version, lines: [{ id: "a", index: 0, text: "Server lyric" }] };
}

test("conflicts require confirmation, use the returned version, and require a fresh choice after another conflict", async ({ page }) => {
  await load(page);
  let server = newer();
  const versions: number[] = [];
  await page.route("**/api/v1/track/alignment", async route => {
    const body = route.request().postDataJSON();
    versions.push(body.version);
    if (versions.length === 2) server = newer(5);
    if (body.version !== server.version) {
      await route.fulfill({ status: 409, json: { error: "version_conflict", ...server } });
    } else {
      expect(body.lines).toEqual(track.lines);
      expect(body.segments[0].start_ms).toBe(200);
      await route.fulfill({ json: { ...server, version: 6, lines: body.lines, alignment: { segments: body.segments } } });
    }
  });
  await save(page).click();
  await expect(replace(page)).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await expect(undo(page)).toBeEnabled();
  await expect(segment(page)).toContainText("0:00.100");
  await confirm(page, replace(page), false);
  await confirm(page, latest(page), false);
  expect(versions).toEqual([3]);
  // Replacement must use the latest local edits, not the original failed payload.
  await page.getByRole("button", { name: "Move Local lyric", exact: true }).press("ArrowRight");
  await confirm(page, replace(page));
  await expect(replace(page)).toBeEnabled();
  expect(versions).toEqual([3, 4]);
  await expect(page.getByText("Changes saved successfully", { exact: true })).toHaveCount(0);
  await confirm(page, replace(page));
  await expect(replace(page)).toHaveCount(0);
  expect(versions).toEqual([3, 4, 5]);
  await expect(undo(page)).toBeDisabled();
  await expect(segment(page)).toContainText("0:00.200");
});

test("load latest fetches fresh state, preserves work after failures, and resets history only on success", async ({ page }) => {
  await load(page);
  await page.route("**/api/v1/track/alignment", route => route.fulfill({ status: 409, json: { error: "version_conflict", ...newer() } }));
  await save(page).click();
  await expect(latest(page)).toBeVisible();
  let reads = 0;
  await page.route("**/api/v1/track", route => {
    reads++;
    if (reads === 1) return route.abort();
    if (reads === 2) return route.fulfill({ json: { ...newer(), lines: null } });
    if (reads === 3) return route.fulfill({ json: { ...newer(), alignment: { segments: [{ line_id: "a", start_ms: 0, end_ms: 30000 }] } } });
    return route.fulfill({ json: newer(7) });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await confirm(page, latest(page));
    await expect(page.getByRole("alert")).toContainText("Could not load the latest song");
    await expect(segment(page)).toContainText("0:00.100");
    await expect(undo(page)).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Lyric text", exact: true })).toHaveValue("Local lyric");
  }
  await confirm(page, latest(page));
  await expect(latest(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move Server lyric", exact: true })).toBeVisible();
  await expect(segment(page)).toContainText("0:00.000");
  await expect(undo(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
});

for (const response of ["valid", "malformed", "unavailable"] as const) {
  test(`incomplete conflict snapshot fetches recovery information: ${response}`, async ({ page }) => {
    await load(page);
    let reads = 0;
    await page.route("**/api/v1/track", route => {
      reads++;
      if (response === "unavailable" && reads === 1) return route.abort();
      return route.fulfill({ json: newer(8) });
    });
    let writes = 0;
    await page.route("**/api/v1/track/alignment", route => {
      writes++;
      return route.fulfill({ status: 409, json: response === "malformed"
        ? { error: "version_conflict", version: "invalid", lines: [null], alignment: { segments: [null] } }
        : { error: "version_conflict" } });
    });
    await save(page).click();
    if (response === "unavailable") {
      const retry = page.getByRole("button", { name: "Retry recovery", exact: true });
      await expect(retry).toBeVisible();
      await expect(replace(page)).toHaveCount(0);
      await retry.click();
    }
    await expect(replace(page)).toBeVisible();
    expect(reads).toBe(response === "unavailable" ? 2 : 1);
    expect(writes).toBe(1);
    await expect(segment(page)).toContainText("0:00.100");
    await expect(undo(page)).toBeEnabled();
  });
}

for (const explicit of [true, false]) {
  test(`replacement song cannot receive old lyrics (${explicit ? "track conflict" : "fallback read"})`, async ({ page }) => {
    await load(page);
    const replacement = { ...newer(), id: "replacement", title: "Different song" };
    await page.route("**/api/v1/track", route => route.fulfill({ json: replacement }));
    let writes = 0;
    await page.route("**/api/v1/track/alignment", route => {
      writes++;
      return route.fulfill({ status: 409, json: { error: explicit ? "track_conflict" : "version_conflict" } });
    });
    await save(page).click();
    await expect(page.getByRole("alert")).toContainText("current song changed");
    await expect(replace(page)).toHaveCount(0);
    await expect(save(page)).toBeDisabled();
    await confirm(page, latest(page));
    await expect(page.getByRole("heading", { name: "Different song", exact: true })).toBeVisible();
    expect(writes).toBe(1);
  });
}

test("failed replacement retains local history and recovery choices", async ({ page }) => {
  await load(page);
  let writes = 0;
  await page.route("**/api/v1/track/alignment", route => {
    writes++;
    if (writes === 1) return route.fulfill({ status: 409, json: { error: "version_conflict", ...newer() } });
    expect(route.request().postDataJSON().version).toBe(4);
    return route.abort();
  });
  await save(page).click();
  await expect(replace(page)).toBeVisible();
  await confirm(page, replace(page));
  await expect(page.getByRole("alert")).toContainText("Could not save your changes");
  await expect(replace(page)).toBeEnabled();
  await expect(segment(page)).toContainText("0:00.100");
  await undo(page).click();
  await expect(segment(page)).toContainText("0:00.000");
});

test("timed out save unlocks controls, ignores late success, and resolves an uncertain commit through conflict recovery", async ({ page }) => {
  await page.clock.install();
  await load(page);
  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const versions: number[] = [];
  await page.route("**/api/v1/track/alignment", async route => {
    const body = route.request().postDataJSON();
    versions.push(body.version);
    if (versions.length === 1) {
      await pending;
      await route.fulfill({ json: { ...track, version: 4, alignment: { segments: body.segments } } });
    } else if (body.version === 3) {
      await route.fulfill({ status: 409, json: { error: "version_conflict", ...newer(4) } });
    } else {
      expect(body.version).toBe(4);
      await route.fulfill({ json: { ...track, version: 5, alignment: { segments: body.segments } } });
    }
  });
  await page.getByRole("button", { name: "Export LRC", exact: true }).click();
  await page.getByRole("button", { name: "Save and export", exact: true }).click();
  await expect(save(page)).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(30001);
  await expect(page.getByRole("alert")).toContainText("server may have saved");
  await expect(save(page)).toBeEnabled();
  await expect(undo(page)).toBeEnabled();
  await expect(page.locator("#load-song")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export LRC", exact: true })).toBeEnabled();
  await expect(segment(page)).toContainText("0:00.100");
  release();
  await save(page).click();
  await expect(replace(page)).toBeVisible();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toHaveCount(0);
  await confirm(page, replace(page));
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  expect(versions).toEqual([3, 3, 4]);
  expect(downloads).toEqual([]);
});

test("deleting the final lyric supports history and persists an empty sheet", async ({ page }) => {
  await load(page);
  let persisted = structuredClone(track);
  await page.route("**/api/v1/track", route => route.fulfill({ json: persisted }));
  await page.route("**/api/v1/track/alignment", route => {
    const body = route.request().postDataJSON();
    expect(body.lines).toEqual([]);
    expect(body.segments).toEqual([]);
    persisted = { ...track, version: 4, lines: [], alignment: { segments: [] } };
    return route.fulfill({ json: persisted });
  });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(segment(page)).toHaveCount(0);
  await expect(page.getByText("Select a lyric line to view its timing.")).toBeVisible();
  await undo(page).click();
  await expect(segment(page)).toContainText("0:00.100");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(segment(page)).toHaveCount(0);
  await save(page).click();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Lyric lines" }).locator("li")).toHaveCount(0);
  await expect(page.getByText(/No lyrics yet/)).toBeVisible();
  await expect(save(page)).toBeDisabled();
});

test("loading latest times out without discarding work and can retry into an empty workspace", async ({ page }) => {
  await page.clock.install();
  await load(page);
  await page.route("**/api/v1/track/alignment", route => route.fulfill({ status: 409, json: { error: "track_conflict" } }));
  await save(page).click();
  await expect(latest(page)).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/v1/track", async route => {
    reads++;
    if (reads === 1) await pending;
    await route.fulfill({ status: 404, json: { error: "no_current_track" } });
  });
  await confirm(page, latest(page));
  await expect(latest(page)).toBeDisabled();
  await page.clock.fastForward(30001);
  await expect(page.getByRole("alert")).toContainText("Loading the latest song timed out");
  await expect(segment(page)).toContainText("0:00.100");
  await expect(undo(page)).toBeEnabled();
  release();
  await confirm(page, latest(page));
  await expect(page.getByRole("heading", { name: "Alignment editor", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(latest(page)).toHaveCount(0);
});

test("a late successful response cannot clear a newer edit or start an export", async ({ page }) => {
  await page.clock.install();
  await load(page);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/alignment")) {
        const body = JSON.parse(String(init?.body));
        // Simulate a transport that completes even after its signal was aborted.
        return new Promise<Response>(resolve => setTimeout(() => resolve(new Response(JSON.stringify({
          version: 4, lines: body.lines, alignment: { segments: body.segments },
        }), { status: 200 })), 40000));
      }
      return originalFetch(input, init);
    };
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Export LRC", exact: true }).click();
  await page.getByRole("button", { name: "Save and export", exact: true }).click();
  await expect(save(page)).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(30001);
  await expect(save(page)).toBeEnabled();
  await page.getByRole("button", { name: "Move Local lyric", exact: true }).press("ArrowRight");
  await page.clock.fastForward(10000);
  await expect(segment(page)).toContainText("0:00.200");
  await expect(page.getByRole("alert")).toContainText("Saving timed out");
  await expect(page.getByText("Changes saved successfully", { exact: true })).toHaveCount(0);
  await expect(undo(page)).toBeEnabled();
  expect(downloads).toBe(0);
});

test("successful saves clear their timeout", async ({ page }) => {
  await page.clock.install();
  await load(page);
  await page.route("**/api/v1/track/alignment", route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { ...track, version: 4, alignment: { segments: body.segments } } });
  });
  await save(page).click();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
  await page.clock.fastForward(30001);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(save(page)).toBeDisabled();
});
