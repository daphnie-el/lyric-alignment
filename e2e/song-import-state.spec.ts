import { test, expect } from "./fixtures";
import { mockAudio } from "./helpers/audio";
import type { TrackPayload } from "../apps/web/src/utils/types";

const original: TrackPayload = {
  id: "old", title: "Original", artist: "", duration_seconds: 10,
  audio_url: "/source.wav", version: 0,
  lines: [{ id: "a", index: 0, text: "Original lyric" }], alignment: null,
};
const imported: TrackPayload = {
  ...original, id: "new", title: "Imported", lines: [],
};

test("import context isolates drafts, locks dispatch immediately, and ignores stale playback reports", async ({ page }) => {
  let trackReads = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await mockAudio(page, "/source.wav", 10);
  await page.route("**/api/v1/track", async route => {
    if (route.request().method() === "POST") {
      await pending;
      await route.fulfill({ status: 201, json: imported });
    } else {
      trackReads++;
      await route.fulfill({ json: original });
    }
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const editorPath = "/src/context/EditorContext.tsx";
    const importPath = "/src/context/SongImportContext.ts";
    const [{ default: React }, { default: { createRoot } }, editor, song] = await Promise.all([
      import(reactPath),
      import(domPath),
      import(editorPath) as Promise<typeof import("../apps/web/src/context/EditorContext")>,
      import(importPath) as Promise<typeof import("../apps/web/src/context/SongImportContext")>,
    ]);
    // Count committed editor-context changes, independently of import consumers.
    let editorUpdates = 0;
    const observer = document.createElement("output");
    observer.dataset.testid = "editor-context-updates";
    document.body.append(observer);
    const EditorObserver = React.memo(function EditorObserver() {
      const state = editor.useEditorState();
      React.useEffect(() => { observer.textContent = String(++editorUpdates); }, [state]);
      return null;
    });
    function Probe() {
      const flow = song.useSongImportContext();
      const state = editor.useEditorState();
      const dispatch = editor.useEditorDispatch();
      const button = (label: string, onClick: () => void) => React.createElement("button", { onClick }, label);
      return React.createElement("section", { "data-testid": "import-harness" },
        React.createElement("output", { "data-testid": "import-phase" }, flow.phase),
        React.createElement("output", { "data-testid": "import-error" }, flow.error),
        React.createElement("output", { "data-testid": "import-open" }, String(flow.dialogOpen)),
        React.createElement("output", { "data-testid": "document" }, JSON.stringify(state.track)),
        button("Open", flow.open),
        button("Set source", () => flow.setUrl("http://localhost:5173/source.wav")),
        button("Probe", () => { void flow.checkSource(); }),
        button("Import and attempt queued edit", () => {
          void flow.continueImport(false);
          dispatch({ type: "editLine", lineId: "a", text: "Should be blocked" });
        }),
        button("Attempt replacement", () => dispatch({ type: "loadSuccess", payload: {
          id: "unexpected", title: "Unexpected", artist: "", duration_seconds: 10,
          audio_url: "/source.wav", version: 0, lines: [], alignment: null,
        } })),
        button("Old readiness", () => flow.reportPlaybackReady("old")),
        button("Old failure", () => flow.reportPlaybackFailure("old", "Stale failure")),
        button("New readiness", () => flow.reportPlaybackReady("new")),
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    createRoot(container).render(React.createElement(editor.EditorProvider, null,
      React.createElement(EditorObserver), React.createElement(Probe)));
  });
  const harness = page.getByTestId("import-harness");
  const documentState = harness.getByTestId("document");
  await expect(documentState).toContainText("Original lyric");
  const initialTrackReads = trackReads;
  const updates = await page.getByTestId("editor-context-updates").textContent();
  await harness.getByRole("button", { name: "Open", exact: true }).click();
  await harness.getByRole("button", { name: "Set source", exact: true }).click();
  await harness.getByRole("button", { name: "Probe", exact: true }).click();
  await expect(harness.getByTestId("import-phase")).toHaveText("idle");
  await expect(page.getByTestId("editor-context-updates")).toHaveText(updates!);
  await harness.getByRole("button", { name: "Import and attempt queued edit" }).click();
  await expect(harness.getByTestId("import-phase")).toHaveText("storing");
  await expect(documentState).toContainText("Original lyric");
  release();
  await expect(harness.getByTestId("import-phase")).toHaveText("awaitingPlayback");
  await expect(documentState).toContainText('"id":"new"');
  await harness.getByRole("button", { name: "Old readiness" }).click();
  await harness.getByRole("button", { name: "Old failure" }).click();
  await harness.getByRole("button", { name: "Attempt replacement" }).click();
  await expect(harness.getByTestId("import-phase")).toHaveText("awaitingPlayback");
  await expect(harness.getByTestId("import-open")).toHaveText("true");
  await expect(harness.getByTestId("import-error")).toBeEmpty();
  await expect(documentState).toContainText('"id":"new"');
  await harness.getByRole("button", { name: "New readiness" }).click();
  await expect(harness.getByTestId("import-open")).toHaveText("false");
  await expect(harness.getByTestId("import-phase")).toHaveText("idle");
  await harness.getByRole("button", { name: "Attempt replacement" }).click();
  await expect(documentState).toContainText('"id":"unexpected"');
  expect(trackReads).toBe(initialTrackReads);
});
