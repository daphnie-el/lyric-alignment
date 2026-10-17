import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";

export default function SelectionInspector() {
  const { track, selectedLineId } = useEditorState();
  const dispatch = useEditorDispatch();
  const line = track?.lines.find((item) => item.id === selectedLineId);
  const segment = track?.segments.find(
    (item) => item.line_id === selectedLineId,
  );
  return (
    <aside
      aria-labelledby="selection-heading"
      className="inspector min-w-0 p-5"
    >
      <span className="eyebrow">Inspector</span>
      <h2 id="selection-heading">Selection</h2>
      {line ? (
        <>
          <p className="mt-5 wrap-break-word font-medium text-(--color-text)">
            {line.text}
          </p>
          <dl className="my-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-4 text-sm">
            <dt>Start</dt>
            <dd className="m-0 text-right font-mono">
              {segment ? formatTime(segment.start_ms, true) : "Untimed"}
            </dd>
            <dt>End</dt>
            <dd className="m-0 text-right font-mono">
              {segment ? formatTime(segment.end_ms, true) : "Untimed"}
            </dd>
            <dt>Duration</dt>
            <dd className="m-0 text-right font-mono">
              {segment
                ? formatTime(segment.end_ms - segment.start_ms, true)
                : "Untimed"}
            </dd>
          </dl>
          <Button
            className="w-full"
            onClick={() => dispatch({ type: "selectLine", id: null })}
          >
            Clear selection
          </Button>
        </>
      ) : (
        <p className="mt-5 text-sm">Select a lyric line to view its timing.</p>
      )}
      <div className="mt-6 flex flex-col gap-2 border-t border-(--color-border) pt-5">
        <Button disabled>Merge with next</Button>
        <Button disabled>Split</Button>
        <Button color="danger" disabled>
          Delete
        </Button>
        <p className="mt-1 text-xs">
          Timing and segment edits are coming later.
        </p>
      </div>
    </aside>
  );
}
