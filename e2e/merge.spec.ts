import { expect, test, type Page } from "./fixtures";
import type { Segment, TrackPayload } from "../apps/web/src/utils/types";
import { mockAudio } from "./helpers/audio";

const segment = (line_id: string, start_ms: number, end_ms: number): Segment =>
  ({ line_id, start_ms, end_ms });
const track: TrackPayload = {
  id: "merge-track", title: "Merge test", artist: "Artist", duration_seconds: 30,
  audio_url: "/test-audio.mp3", version: 1,
  lines: [
    { id: "a", index: 2, text: "First  words \n" },
    { id: "b", index: 7, text: "\tNext words" },
    { id: "c", index: 9, text: "Other lyric" },
    { id: "d", index: 12, text: "Last lyric" },
  ],
  alignment: { segments: [segment("a", 1000, 3000), segment("b", 4000, 6000), segment("c", 8000, 10000)] },
};
const merge = (page: Page) => page.getByRole("button", { name: "Merge with next lyric", exact: true });
const sheet = (page: Page) => page.getByRole("list", { name: "Lyric lines" });
const save = (page: Page) => page.getByRole("button", { name: "Save alignment", exact: true });
async function load(page: Page, data = track) {
  await mockAudio(page, data.audio_url, data.duration_seconds);
  await page.route("**/api/v1/track", route => route.fulfill({ json: data }));
  await page.goto("/");
  await expect(sheet(page).getByRole("button")).toHaveCount(data.lines.length);
}

for (const selectedTimed of [false, true]) {
  for (const incomingTimed of [false, true]) {
    test(`merge timing selected=${selectedTimed}, incoming=${incomingTimed}, undo/redo and persistence`, async ({ page }) => {
      let persisted: TrackPayload = {
        ...track,
        alignment: { segments: track.alignment!.segments.filter(s =>
          (s.line_id !== "a" || selectedTimed) && (s.line_id !== "b" || incomingTimed)) },
      };
      await load(page, persisted);
      const original = structuredClone(persisted);
      await page.unroute("**/api/v1/track");
      await page.route("**/api/v1/track", route => route.fulfill({ json: persisted }));
      const expectedSegment = selectedTimed || incomingTimed
        ? segment("a", selectedTimed ? 1000 : 4000, incomingTimed ? 6000 : 3000)
        : undefined;
      await page.route("**/api/v1/track/alignment", async route => {
        const body = route.request().postDataJSON();
        expect(body.lines).toEqual([
          { ...track.lines[0], text: "First  words, Next words" }, ...track.lines.slice(2),
        ]);
        expect(body.segments).toEqual([
          ...(expectedSegment ? [expectedSegment] : []), segment("c", 8000, 10000),
        ]);
        persisted = { ...persisted, lines: body.lines, alignment: { segments: body.segments }, version: 2 };
        await route.fulfill({ json: { lines: persisted.lines, alignment: persisted.alignment, version: 2 } });
      });
      await expect(merge(page)).toHaveCount(0);
      await sheet(page).getByRole("button").last().click();
      await expect(merge(page)).toBeDisabled();
      await sheet(page).getByRole("button").first().click();
      await merge(page).click();
      await expect(sheet(page).getByRole("button")).toHaveCount(3);
      await expect(sheet(page).getByRole("button").first()).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("textbox", { name: "Lyric text", exact: true })).toHaveValue("First  words, Next words");
      await expect(save(page)).toBeEnabled();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(sheet(page).getByRole("button")).toHaveCount(original.lines.length);
      await expect(save(page)).toBeDisabled();
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(sheet(page).getByRole("button")).toHaveCount(3);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await merge(page).click();
      await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
      await save(page).click();
      await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
      await page.reload();
      await expect(sheet(page).getByRole("button")).toHaveCount(3);
      await expect(sheet(page).getByRole("button").first()).toContainText("First words, Next words");
      await expect(save(page)).toBeDisabled();
    });
  }
}

test("commits the text draft before merging and locks merge during save and interaction", async ({ page }) => {
  await load(page);
  await sheet(page).getByRole("button").first().click();
  await page.getByRole("textbox", { name: "Lyric text", exact: true }).fill("Edited lyric");
  await merge(page).click();
  await expect(page.getByRole("textbox", { name: "Lyric text", exact: true })).toHaveValue("Edited lyric, Next words");
  const handle = page.getByRole("button", { name: "Resize end of Edited lyric, Next words" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30);
  await expect(merge(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(merge(page)).toBeEnabled();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/track/alignment", async route => {
    await pending;
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { lines: body.lines, alignment: { segments: body.segments }, version: 2 } });
  });
  await save(page).click();
  await expect(merge(page)).toBeDisabled();
  release();
  await expect(page.getByText("Changes saved successfully", { exact: true })).toBeVisible();
});

test("uses sheet neighbors and rejects conflicting timing without changing content or history", async ({ page }) => {
  await load(page);
  const results = await page.evaluate(async payload => {
    const modulePath = "/src/context/EditorContext.tsx";
    const { reducer, initialState } = await import(modulePath) as typeof import("../apps/web/src/context/EditorContext");
    const loaded = reducer(initialState, { type: "loadSuccess", payload });
    const selected = reducer(loaded, { type: "selectLine", id: "a" });
    const action = { type: "mergeWithNext", lineId: "a" } as const;
    const blockedStates = [
      loaded, { ...selected, selectedLineId: "missing" },
      { ...selected, status: "loading" as const }, { ...selected, status: "error" as const },
      { ...selected, saving: true }, { ...selected, importing: true },
      { ...selected, interacting: true }, { ...selected, selectedTimelineIds: ["a", "c"] },
    ];
    const last = reducer(loaded, { type: "selectLine", id: "d" });
    const reversed = {
      ...selected, track: { ...selected.track!, segments: [segmentValue("b", 0, 500), segmentValue("a", 1000, 3000), segmentValue("c", 8000, 10000)] },
    };
    const overlap = {
      ...selected, track: { ...selected.track!, segments: [segmentValue("a", 1000, 3000), segmentValue("c", 3000, 4000), segmentValue("b", 4000, 6000)] },
    };
    const failures = [reversed, overlap].map(state => {
      const result = reducer(state, action);
      return { error: result.timingError, unchanged: result.track === state.track && result.past === state.past && result.future === state.future };
    });
    // The untimed sheet neighbor must be chosen ahead of the next timeline block.
    const untimedNeighbor = { ...selected, track: { ...selected.track!, segments: selected.track!.segments.filter(s => s.line_id !== "b") } };
    const merged = reducer(untimedNeighbor, action);
    const restored = reducer(merged, { type: "undo" });
    return {
      guards: blockedStates.every(state => reducer(state, action) === state) && reducer(last, { ...action, lineId: "d" }) === last,
      failures,
      remaining: merged.track!.lines.map(line => line.id),
      segmentUnchanged: merged.track!.segments.find(s => s.line_id === "c") === untimedNeighbor.track.segments.find(s => s.line_id === "c"),
      undoExact: restored.track!.lines === untimedNeighbor.track.lines && restored.track!.segments === untimedNeighbor.track.segments,
      history: merged.past.length,
    };
    function segmentValue(line_id: string, start_ms: number, end_ms: number) { return { line_id, start_ms, end_ms }; }
  }, track);
  expect(results).toEqual({
    guards: true,
    failures: [
      { error: "Choose an end time after the start time.", unchanged: true },
      { error: "Merging these lyrics would overlap another line.", unchanged: true },
    ],
    remaining: ["a", "c", "d"], segmentUnchanged: true, undoExact: true, history: 1,
  });
});

test("shows timing conflicts in the editor and hides merge for multiple selections", async ({ page }) => {
  await load(page, { ...track, alignment: { segments: [segment("a", 1000, 3000), segment("c", 3000, 4000), segment("b", 4000, 6000)] } });
  await sheet(page).getByRole("button").first().click();
  await merge(page).click();
  await expect(page.getByRole("alert")).toHaveText("Merging these lyrics would overlap another line.");
  await expect(sheet(page).getByRole("button")).toHaveCount(4);
  await expect(save(page)).toBeDisabled();
  await page.getByRole("button", { name: "Move First words", exact: true }).click();
  await page.getByRole("button", { name: "Move Other lyric", exact: true }).click({ modifiers: ["Shift"] });
  await expect(merge(page)).toHaveCount(0);
});
