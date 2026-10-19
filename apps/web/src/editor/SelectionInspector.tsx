import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import {
  useEditorDispatch,
  useEditorState,
  type Segment,
} from "./EditorContext";
import { formatTime } from "./formatTime";
import { timingError } from "./timing";

export default function SelectionInspector() {
  const { track, selectedLineId, saving } = useEditorState();
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
      {line && track ? (
        <>
          <p className="mt-5 wrap-break-word font-medium text-(--color-text)">
            {line.text}
          </p>
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
          Drag timeline blocks or edit their timing here.
        </p>
      </div>
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
    start_ms: String(segment?.start_ms ?? ""),
    end_ms: String(segment?.end_ms ?? ""),
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof typeof drafts, string>>
  >({});

  function validate(field: keyof typeof drafts, draft: string) {
    if (!segment || draft === "") return "Both timing endpoints are required.";
    if (!/^\d+$/.test(draft))
      return "Enter a nonnegative integer in milliseconds.";
    return timingError({ ...segment, [field]: Number(draft) }, durationMs);
  }

  function commit(field: keyof typeof drafts) {
    const draft = drafts[field];
    const error = validate(field, draft);
    setErrors((current) => ({ ...current, [field]: error }));
    if (!error) {
      const value = draft === "" ? undefined : Number(draft);
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
                numbersOnly
                disabled={!segment || saving}
                placeholder="Milliseconds"
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
              />
            </dd>
          </div>
        );
      })}
      <dt>Duration</dt>
      <dd className="m-0 min-w-0 text-right font-mono">
        {segment?.start_ms !== undefined && segment.end_ms !== undefined
          ? formatTime(segment.end_ms - segment.start_ms, true)
          : ""}
      </dd>
    </dl>
  );
}
