import { expect, test, type Page } from "@playwright/test";
import {
  lyricWords,
  parseSplitTime,
  splitLyricText,
} from "../apps/web/src/utils/splitLyric";
import type { TrackPayload } from "../apps/web/src/utils/types";
import { mockAudio } from "./helpers/audio";

const track: TrackPayload = {
  id: "split-track",
  title: "Split test",
  artist: "Artist",
  duration_seconds: 20,
  audio_url: "/test-audio.mp3",
  version: 3,
  lines: [
    { id: "before", index: 1, text: "Earlier lyric" },
    { id: "a", index: 4, text: "Hello,  世界!\nAgain love" },
    { id: "b", index: 9, text: "Later lyric" },
  ],
  alignment: {
    segments: [
      { line_id: "before", start_ms: 0, end_ms: 500 },
      { line_id: "a", start_ms: 1001, end_ms: 5002 },
      { line_id: "b", start_ms: 8000, end_ms: 10000 },
    ],
  },
};
const split = (page: Page) =>
  page.getByRole("button", { name: "Split", exact: true });
const confirm = (page: Page) =>
  page.getByRole("dialog", { name: "Split lyric" })
    .getByRole("button", { name: "Split", exact: true });
const sheet = (page: Page) => page.getByRole("list", { name: "Lyric lines" });
const text = (page: Page) =>
  page.getByRole("textbox", { name: "Lyric text", exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "Save alignment", exact: true });

async function load(page: Page, payload = track) {
  await mockAudio(page, payload.audio_url, payload.duration_seconds);
  await page.route("**/api/v1/track", (route) =>
    route.fulfill({ json: payload }),
  );
  await page.goto("/");
  await expect(sheet(page).getByRole("button")).toHaveCount(
    payload.lines.length,
  );
}

test("text boundaries preserve punctuation, Unicode and whitespace", () => {
  const source = "  Hello,  世界!\nAgain\t love  ";
  expect(lyricWords(source).map((word) => word.text)).toEqual([
    "Hello,",
    "世界!",
    "Again",
    "love",
  ]);
  expect(splitLyricText(source, 1)).toEqual([
    "  Hello,",
    "世界!\nAgain\t love  ",
  ]);
  expect(splitLyricText(source, 2)).toEqual([
    "  Hello,  世界!",
    "Again\t love  ",
  ]);
  expect(splitLyricText(source, 3)).toEqual([
    "  Hello,  世界!\nAgain",
    "love  ",
  ]);
  for (const boundary of [-1, 0, 4, 1.5, NaN]) {
    expect(splitLyricText(source, boundary)).toBeUndefined();
  }
  for (const source of ["", " \n ", "one", "one two"]) {
    expect(splitLyricText(source, 1)).toBeUndefined();
  }
  expect(splitLyricText("one two three", 1)).toEqual(["one", "two three"]);
});

test("timestamp parsing supports integer milliseconds and rejects malformed times", () => {
  expect(parseSplitTime("1:02")).toBe(62000);
  expect(parseSplitTime(" 1:02.001 ")).toBe(62001);
  expect(parseSplitTime("0:01.1")).toBe(1100);
  expect(parseSplitTime("0:01.12")).toBe(1120);
  for (const value of [
    "",
    "2",
    "0:1",
    "0:60",
    "-1:02",
    "0:01.1234",
    "NaN",
    "9999999999999999:00",
  ]) {
    expect(parseSplitTime(value)).toBeUndefined();
  }
});

for (const timed of [true, false]) {
  test(`${timed ? "timed" : "untimed"} split persists IDs, indexes, selection and one undo step`, async ({
    page,
  }) => {
    let persisted: TrackPayload = {
      ...track,
      alignment: {
        segments: track.alignment!.segments.filter(
          (s) => timed || s.line_id !== "a",
        ),
      },
    };
    await load(page, persisted);
    const original = structuredClone(persisted);
    await page.unroute("**/api/v1/track");
    await page.route("**/api/v1/track", (route) =>
      route.fulfill({ json: persisted }),
    );
    let newId = "";
    await page.route("**/api/v1/track/alignment", async (route) => {
      const body = route.request().postDataJSON();
      newId = body.lines[2].id;
      expect(newId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(body.lines).toEqual([
        original.lines[0],
        { id: "a", index: 4, text: "Hello,  世界!" },
        { id: newId, index: 5, text: "Again love" },
        { ...original.lines[2], index: 6 },
      ]);
      expect(body.segments).toEqual([
        original.alignment!.segments[0],
        ...(timed
          ? [
              { line_id: "a", start_ms: 1001, end_ms: 2501 },
              { line_id: newId, start_ms: 2501, end_ms: 5002 },
            ]
          : []),
        track.alignment!.segments[2],
      ]);
      persisted = {
        ...persisted,
        lines: body.lines,
        alignment: { segments: body.segments },
        version: 4,
      };
      await route.fulfill({
        json: {
          lines: persisted.lines,
          alignment: persisted.alignment,
          version: 4,
        },
      });
    });
    await expect(split(page)).toHaveCount(0);
    await sheet(page).getByRole("button").nth(1).click();
    await split(page).click();
    await expect(page.getByLabel("Split after word")).toHaveValue("2");
    if (timed) {
      await expect(page.getByLabel("Split timestamp")).toHaveValue("0:03.001");
      await page.getByLabel("Split timestamp").fill("0:02.501");
    } else await expect(page.getByLabel("Split timestamp")).toHaveCount(0);
    await confirm(page).click();
    await expect(sheet(page).getByRole("button")).toHaveCount(4);
    await expect(sheet(page).getByRole("button").nth(1)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(text(page)).toHaveValue("Hello,  世界!");
    await expect(page.getByRole("form", { name: "Split lyric" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    const timeline = await page.locator(".timeline-block").allTextContents();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(sheet(page).getByRole("button")).toHaveCount(3);
    await expect(text(page)).toHaveValue(original.lines[1].text);
    await expect(save(page)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(sheet(page).getByRole("button")).toHaveCount(4);
    expect(await page.locator(".timeline-block").allTextContents()).toEqual(
      timeline,
    );
    await save(page).click();
    await expect(
      page.getByText("Changes saved successfully", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(sheet(page).getByRole("button")).toHaveCount(4);
    await expect(sheet(page).getByRole("button").nth(2)).toContainText(
      "Again love",
    );
    await expect(save(page)).toBeDisabled();
    expect(persisted.lines[2].id).toBe(newId);
  });
}

test("validates timestamps at both endpoints and allows a 1 ms first or second segment", async ({
  page,
}) => {
  await load(page);
  await sheet(page).getByRole("button").nth(1).click();
  await split(page).click();
  const time = page.getByLabel("Split timestamp", { exact: true });
  for (const value of [
    "0:01.001",
    "0:05.002",
    "0:00.999",
    "0:06",
    "bad",
    "0:02.1234",
  ]) {
    await time.fill(value);
    await expect(time).toHaveAttribute("aria-invalid", "true");
    await expect(confirm(page)).toBeDisabled();
    await expect(save(page)).toBeDisabled();
  }
  for (const value of ["0:01.002", "0:05.001", "0:03"]) {
    await time.fill(value);
    await expect(confirm(page)).toBeEnabled();
  }
  await page.getByLabel("Split after word").selectOption("1");
  await time.fill("0:01.002");
  await confirm(page).click();
  await expect(page.getByTestId("segment-a")).toContainText(
    "0:01.001 – 0:01.002",
  );
});

test("commits draft text before opening, cancels and resets on source changes", async ({
  page,
}) => {
  await load(page);
  await sheet(page).getByRole("button").nth(1).click();
  await text(page).fill("Changed text has five words");
  await split(page).click();
  await expect(
    page.getByLabel("Split after word").getByRole("option"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("form", { name: "Split lyric" })).toHaveCount(0);
  await split(page).click();
  await page.keyboard.press("Escape");
  await text(page).fill("Another set of words");
  await text(page).blur();
  await expect(page.getByRole("form", { name: "Split lyric" })).toHaveCount(0);
  await split(page).click();
  await page.getByRole("button", { name: "Close split dialog" }).click();
  await page.getByRole("textbox", { name: "End", exact: true }).fill("0:06");
  await page.getByRole("textbox", { name: "End", exact: true }).blur();
  await expect(page.getByRole("form", { name: "Split lyric" })).toHaveCount(0);
  await split(page).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await sheet(page).getByRole("button").last().click();
  await expect(split(page)).toBeDisabled();
  await sheet(page).getByRole("button").nth(1).click();
  await expect(page.getByRole("form", { name: "Split lyric" })).toHaveCount(0);
});

test("reducer rejects invalid operations and preserves exact history and unrelated references", async ({
  page,
}) => {
  await load(page);
  const result = await page.evaluate(async (payload) => {
    const modulePath = "/src/context/EditorContext.tsx";
    const { reducer, initialState } = (await import(
      modulePath
    )) as typeof import("../apps/web/src/context/EditorContext");
    const loaded = reducer(initialState, { type: "loadSuccess", payload });
    const state = reducer(loaded, { type: "selectLine", id: "a" });
    const action = {
      type: "splitLine",
      lineId: "a",
      newId: "new-id",
      afterWord: 2,
      splitMs: 3000,
    } as const;
    const invalidStates = [
      loaded,
      { ...state, status: "loading" as const },
      { ...state, status: "error" as const },
      { ...state, saving: true },
      { ...state, importing: true },
      { ...state, interacting: true },
      { ...state, selectedTimelineIds: ["a", "b"] },
      { ...state, selectedLineId: "missing" },
    ];
    const guards = invalidStates.every((s) => reducer(s, action) === s);
    const noOps = [
      { ...action, newId: "a" },
      { ...action, newId: " " },
      { ...action, afterWord: 0 },
      { ...action, afterWord: 4 },
      { ...action, afterWord: 1.5 },
    ].every((a) => reducer(state, a) === state);
    const invalidTimes = [undefined, NaN, 1001, 5002, 1000, 5003, 2000.5].every(
      (splitMs) => {
        const result = reducer(state, { ...action, splitMs });
        return (
          !!result.timingError &&
          result.track === state.track &&
          result.past === state.past &&
          result.future === state.future
        );
      },
    );
    const merged = reducer(state, action);
    const undone = reducer(merged, { type: "undo" });
    const redone = reducer(undone, { type: "redo" });
    const changed = reducer(undone, { ...action, newId: "different-id" });
    const short = {
      ...state,
      track: {
        ...state.track!,
        lines: state.track!.lines.map((l) =>
          l.id === "a" ? { ...l, text: "two words" } : l,
        ),
      },
    };
    const minimal = {
      ...state,
      track: {
        ...state.track!,
        segments: state.track!.segments.map((s) =>
          s.line_id === "a" ? { ...s, end_ms: s.start_ms + 2 } : s,
        ),
      },
    };
    const minimalResult = reducer(minimal, { ...action, splitMs: 1002 });
    return {
      guards,
      noOps,
      invalidTimes,
      shortRejected: reducer(short, action) === short,
      exactUndo:
        undone.track!.lines === state.track!.lines &&
        undone.track!.segments === state.track!.segments,
      exactRedo:
        redone.track!.lines === merged.track!.lines &&
        redone.track!.segments === merged.track!.segments,
      untouched:
        merged.track!.lines[0] === state.track!.lines[0] &&
        merged.track!.segments[0] === state.track!.segments[0] &&
        merged.track!.segments[3] === state.track!.segments[2],
      redoId: redone.track!.lines[2].id,
      redoCleared: changed.future.length === 0,
      history: merged.past.length,
      minimalDurations: minimalResult
        .track!.segments.filter((s) => ["a", "new-id"].includes(s.line_id))
        .map((s) => s.end_ms - s.start_ms),
    };
  }, track);
  expect(result).toEqual({
    guards: true,
    noOps: true,
    invalidTimes: true,
    shortRejected: true,
    exactUndo: true,
    exactRedo: true,
    untouched: true,
    redoId: "new-id",
    redoCleared: true,
    history: 1,
    minimalDurations: [1, 1],
  });
});

test("disables short lyrics and sub-2 ms timing, and hides Split for multiple selections", async ({
  page,
}) => {
  await load(page, {
    ...track,
    alignment: {
      segments: track.alignment!.segments.map((s) =>
        s.line_id === "a" ? { ...s, end_ms: s.start_ms + 1 } : s,
      ),
    },
  });
  await sheet(page).getByRole("button").nth(1).click();
  await expect(split(page)).toBeDisabled();
  await sheet(page).getByRole("button").first().click();
  await expect(split(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Move Later lyric", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(split(page)).toHaveCount(0);
});

test("locks split controls during timeline interaction and saving", async ({
  page,
}) => {
  await load(page);
  await sheet(page).getByRole("button").nth(1).click();
  await text(page).fill("One two three four");
  await text(page).blur();
  const handle = page.getByRole("button", {
    name: "Resize end of One two three four",
    exact: true,
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30);
  await expect(split(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(split(page)).toBeEnabled();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/track/alignment", async (route) => {
    await pending;
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        lines: body.lines,
        alignment: { segments: body.segments },
        version: 4,
      },
    });
  });
  await save(page).click();
  await expect(split(page)).toBeDisabled();
  release();
  await expect(
    page.getByText("Changes saved successfully", { exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 375]) {
  test(`split dialog contains focus and shortcuts and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    await sheet(page).getByRole("button").nth(1).click();
    await text(page).fill("Changed lyric with four words");
    await split(page).click();
    const dialog = page.getByRole("dialog", { name: "Split lyric" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Split after word")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(dialog).toContainText("Changed lyric");
    const close = dialog.getByRole("button", { name: "Close split dialog" });
    await confirm(page).focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(split(page)).toBeFocused();
    await expect(text(page)).toHaveValue("Changed lyric with four words");
    await expect(sheet(page).getByRole("button")).toHaveCount(3);
    await expect(sheet(page).getByRole("button").nth(1)).toHaveAttribute("aria-current", "true");
    await split(page).click();
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(split(page)).toBeFocused();
  });
}
