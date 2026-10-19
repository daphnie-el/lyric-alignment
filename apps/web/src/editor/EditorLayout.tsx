import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "./EditorContext";
import KaraokeReadout from "./KaraokeReadout";
import LyricsPane from "./LyricsPane";
import SelectionInspector from "./SelectionInspector";
import Timeline from "./Timeline";
import Toolbar from "./Toolbar";

const sensors = [
  PointerSensor.configure({ preventActivation: (_event, source) => source.data.placed === true }),
  KeyboardSensor.configure({ preventActivation: (event, source) => event.key === "Enter" || source.data.placed === true || source.data.kind === "segment" }),
];

function LoadStatus() {
  const { status, error } = useEditorState();
  const dispatch = useEditorDispatch();
  if (status === "ready") return null;
  return (
    <div className="border-b border(--color-border) px-5 py-3">
      {status === "loading" ? (
        <p role="status" className="m-0">
          Loading track…
        </p>
      ) : (
        <div
          role="alert"
          className="load-error flex flex-wrap items-center gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium text(--color-danger)">
              Could not load the track.
            </p>
            <p className="m-0 wrap-break-word text-sm">{error}</p>
          </div>
          <Button onClick={() => dispatch({ type: "retry" })}>Retry</Button>
        </div>
      )}
    </div>
  );
}

export function EditorLayout() {
  return (
    <DragDropProvider sensors={sensors}>
    <main className="editor-shell flex min-h-screen flex-col">
      <Toolbar />
      <LoadStatus />
      <div className="editor-grid min-h-0 flex-1">
        <LyricsPane />
        <div className="workspace flex min-h-0 min-w-0 flex-col gap-6 p-5 lg:p-7">
          <Timeline />
          <KaraokeReadout />
        </div>
        <SelectionInspector />
      </div>
    </main>
    <DragOverlay dropAnimation={null}>{source => <div className="timeline-drag-overlay">{String(source.data.text ?? "")}</div>}</DragOverlay>
    </DragDropProvider>
  );
}
