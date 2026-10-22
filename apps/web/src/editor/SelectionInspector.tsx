import { useId, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { formatTime } from "../utils/formatTime";
import { timingError } from "../utils/timing";
import { Segment } from "../utils/types";

export default function SelectionInspector() {
  const lyricInputId = useId();
  const lyricHintId = useId();
  const { track, selectedLineId, selectedTimelineIds, saving } =
    useEditorState();
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
      {selectedTimelineIds.length > 1 ? (
        <div className="my-6 text-sm">
          <p className="font-medium">
            {selectedTimelineIds.length} lines selected
          </p>
          <p>
            Drag any selected line to move the group. Arrow keys move by 100 ms;
            hold Shift for 1 second.
          </p>
          <p>
            Shift + click toggles lines. Press Escape to clear the selection.
            Select one line to resize or edit its timing.
          </p>
        </div>
      ) : line && track ? (
        <>
          <div className="mt-5">
            <label
              htmlFor={lyricInputId}
              className="mb-2 block text-sm font-medium text-(--color-text)"
            >
              Lyric text
            </label>
            <div className="relative">
              <textarea
                key={`${line.id}:${line.text}`}
                id={lyricInputId}
                aria-describedby={lyricHintId}
                className="input lyric-text-input"
                rows={2}
                disabled={saving}
                defaultValue={line.text}
                onBlur={(event) => {
                  const text = event.currentTarget.value;
                  if (text !== line.text) {
                    dispatch({ type: "editLine", lineId: line.id, text });
                  }
                }}
              />
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-3 size-4 text-(--color-text-muted)"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m16 4 4 4M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15l-1 6Z" />
              </svg>
            </div>
            <p
              id={lyricHintId}
              className="mb-0 mt-2 italic text-[10px] text-(--color-text-muted)"
            >
              Edit your lyric, then click outside or press <kbd>Tab</kbd> to
              apply.
            </p>
          </div>
          <TimingFields
            key={`${line.id}:${segment?.start_ms}:${segment?.end_ms}`}
            lineId={line.id}
            segment={segment}
            durationMs={track.durationMs}
          />
          <Button
            disabled={saving}
            className="w-full"
            onClick={() => dispatch({ type: "removeSegment", lineId: line.id })}
          >
            Remove Segment
          </Button>
          <div className="mt-6 flex flex-col gap-2 border-t border-(--color-border) pt-5">
            <Button disabled>Merge with next</Button>
            <Button disabled>Split</Button>
            <Button
              color="danger"
              disabled={saving}
              onClick={() => dispatch({ type: "deleteLine", lineId: line.id })}
            >
              Delete
            </Button>
            <p className="mt-1 text-xs">
              Drag timeline blocks or edit their timing here.
            </p>
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm">Select a lyric line to view its timing.</p>
      )}
    </aside>
  );
}

function TimingFields({
  lineId,
  segment,
  durationMs,
}: {
  lineId: string;
  segment: Segment | undefined;
  durationMs: number;
}) {
  const dispatch = useEditorDispatch();
  const { saving } = useEditorState();
  const [drafts, setDrafts] = useState({
    start_ms: segment ? formatTime(segment.start_ms) : "",
    end_ms: segment ? formatTime(segment.end_ms) : "",
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof typeof drafts, string>>
  >({});

  function parseTime(draft: string) {
    const match = /^(\d+):([0-5]\d)$/.exec(draft.trim());
    if (!match) return undefined;
    const value = (Number(match[1]) * 60 + Number(match[2])) * 1000;
    return Number.isSafeInteger(value) ? value : undefined;
  }

  function validate(field: keyof typeof drafts, draft: string) {
    if (!segment || draft === "") return "Both timing endpoints are required.";
    if (draft === formatTime(segment[field])) return undefined;
    const value = parseTime(draft);
    if (value === undefined) return "Enter a time as m:ss, for example 1:30.";
    return timingError({ ...segment, [field]: value }, durationMs);
  }

  function commit(field: keyof typeof drafts) {
    const draft = drafts[field];
    const error = validate(field, draft);
    setErrors((current) => ({ ...current, [field]: error }));
    if (!error && segment && draft !== formatTime(segment[field])) {
      const value = parseTime(draft);
      dispatch({ type: "updateSegment", payload: { lineId, field, value } });
    }
  }

  return (
    <dl className="my-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-4 text-sm">
      {(["start_ms", "end_ms"] as const).map((field) => {
        const label = field === "start_ms" ? "Start" : "End";
        return (
          <div key={field} className="contents">
            <dt>{label}</dt>
            <dd className="m-0 min-w-0 text-right font-mono">
              <Input
                aria-label={label}
                disabled={!segment || saving}
                placeholder="m:ss"
                value={drafts[field]}
                error={errors[field]}
                onChange={(event) => {
                  const draft = event.target.value;
                  setDrafts({ ...drafts, [field]: draft });
                  setErrors((current) => ({
                    ...current,
                    [field]: validate(field, draft),
                  }));
                }}
                onBlur={() => commit(field)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </dd>
          </div>
        );
      })}
      <dt>Duration</dt>
      <dd className="m-0 min-w-0 text-right font-mono">
        {segment?.start_ms !== undefined && segment.end_ms !== undefined
          ? formatTime(segment.end_ms - segment.start_ms)
          : ""}
      </dd>
    </dl>
  );
}
