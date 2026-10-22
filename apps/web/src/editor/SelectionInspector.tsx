import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../components/Button";
import { DialogFooter } from "../components/DialogFooter";
import { Input } from "../components/Input";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { formatTime } from "../utils/formatTime";
import {
  lyricWords,
  parseSplitTime,
  splitLyricText,
} from "../utils/splitLyric";
import { timingError } from "../utils/timing";
import { LyricLine, Segment } from "../utils/types";

export default function SelectionInspector() {
  const lyricInputId = useId();
  const lyricHintId = useId();
  const {
    track,
    selectedLineId,
    selectedTimelineIds,
    status,
    interacting,
    editingLocked: saving,
  } = useEditorState();
  const dispatch = useEditorDispatch();
  const line = track?.lines.find((item) => item.id === selectedLineId);
  const segment = track?.segments.find(
    (item) => item.line_id === selectedLineId,
  );
  const singleLine = selectedTimelineIds.length <= 1 ? line : undefined;
  const mergeDisabled =
    saving ||
    interacting ||
    status !== "ready" ||
    !singleLine ||
    track?.lines.at(-1)?.id === singleLine.id;

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
              className="mb-0 mt-2 italic text-xs text-(--color-text-muted)"
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
            className="w-full bg-none border border-(--color-danger)/50 text-(--color-danger) hover:bg-(--color-danger-bg)/50"
            onClick={() => dispatch({ type: "removeSegment", lineId: line.id })}
          >
            Remove Segment
          </Button>
        </>
      ) : (
        <p className="mt-5 text-sm">Select a lyric line to view its timing.</p>
      )}
      {singleLine ? (
        <div className="mt-6 flex flex-col gap-2 border-t border-(--color-border) pt-5">
          <Button
            disabled={mergeDisabled}
            onClick={() =>
              dispatch({ type: "mergeWithNext", lineId: singleLine.id })
            }
            color="outline"
          >
            Merge with next lyric
          </Button>
          <SplitLyric
            key={singleLine.id}
            line={singleLine}
            segment={segment}
            disabled={saving || interacting || status !== "ready"}
          />
          <Button
            color="danger"
            disabled={saving}
            onClick={() =>
              dispatch({ type: "deleteLine", lineId: singleLine.id })
            }
          >
            Delete
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function SplitLyric({
  line,
  segment,
  disabled,
}: {
  line: LyricLine;
  segment: Segment | undefined;
  disabled: boolean;
}) {
  const source = JSON.stringify([
    line.text,
    segment?.start_ms,
    segment?.end_ms,
  ]);
  const [form, setForm] = useState({ source, open: false });
  // Reset during render so a changed source cannot submit a stale boundary.
  if (form.source !== source) setForm({ source, open: false });
  const unavailable =
    disabled ||
    lyricWords(line.text).length < 3 ||
    (!!segment && segment.end_ms - segment.start_ms < 2);

  return (
    <>
      <Button
        disabled={unavailable}
        aria-haspopup="dialog"
        aria-expanded={form.source === source && form.open}
        onClick={() => setForm({ source, open: true })}
      >
        Split
      </Button>
      {form.source === source && form.open ? (
        <SplitDialog
          line={line}
          segment={segment}
          disabled={unavailable}
          onClose={() => setForm({ source, open: false })}
        />
      ) : null}
    </>
  );
}

function SplitDialog({
  line,
  segment,
  disabled,
  onClose,
}: {
  line: LyricLine;
  segment: Segment | undefined;
  disabled: boolean;
  onClose: () => void;
}) {
  const dispatch = useEditorDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boundaryRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const boundaryId = useId();
  const timeId = useId();
  const words = lyricWords(line.text);
  const [afterWord, setAfterWord] = useState(Math.floor(words.length / 2));
  const [time, setTime] = useState(() =>
    segment
      ? formatTime(
          segment.start_ms +
            Math.floor((segment.end_ms - segment.start_ms) / 2),
          true,
        )
      : "",
  );
  const splitMs = parseSplitTime(time);
  const error = segment
    ? splitMs === undefined
      ? "Enter a time as m:ss or m:ss.SSS."
      : splitMs <= segment.start_ms || splitMs >= segment.end_ms
        ? "Split time must be strictly between Start and End."
        : undefined
    : undefined;
  const parts = splitLyricText(line.text, afterWord);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    boundaryRef.current?.focus();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-(--color-border) bg-(--color-surface) p-0 text-(--color-text) shadow-xl backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && event.target === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="flex items-center justify-between gap-4 px-6 py-5">
        <h2 id={titleId} className="m-0 leading-tight">
          Split lyric
        </h2>
        <Button
          aria-label="Close split dialog"
          className="grid size-8 shrink-0 place-items-center border-0 bg-transparent p-0"
          onClick={close}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </Button>
      </header>
      <form
        aria-label="Split lyric"
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || error || !parts) return;
          dispatch({
            type: "splitLine",
            lineId: line.id,
            newId: crypto.randomUUID(),
            afterWord,
            splitMs: segment ? splitMs : undefined,
          });
          close();
        }}
      >
        <div className="flex flex-col gap-3 px-6 pb-6">
          <label htmlFor={boundaryId}>Split after word</label>
          <select
            ref={boundaryRef}
            id={boundaryId}
            className="input"
            disabled={disabled}
            value={afterWord}
            onChange={(event) =>
              setAfterWord(Number(event.currentTarget.value))
            }
          >
            {words.slice(0, -1).map((word, index) => (
              <option key={index} value={index + 1}>
                {index + 1}: {word.text}
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-4 py-1">
            <div>
              <span className="mb-2 inline-block rounded-full bg-(--color-primary-button) px-3 py-1 text-xs font-semibold text-(--color-on-primary)">
                First part
              </span>
              <p className="m-0 whitespace-pre-wrap wrap-break-word text-(--color-text)">
                {parts?.[0]}
              </p>
            </div>
            <div>
              <span className="mb-2 inline-block rounded-full bg-(--color-primary-button) px-3 py-1 text-xs font-semibold text-(--color-on-primary)">
                Second part
              </span>
              <p className="m-0 whitespace-pre-wrap wrap-break-word text-(--color-text)">
                {parts?.[1]}
              </p>
            </div>
          </div>
          {segment ? (
            <>
              <label htmlFor={timeId}>Split timestamp</label>
              <Input
                id={timeId}
                value={time}
                disabled={disabled}
                placeholder="m:ss.SSS"
                error={error}
                onChange={(event) => setTime(event.currentTarget.value)}
              />
              <p className="m-0 text-xs">
                Choose a time between {formatTime(segment.start_ms, true)} and{" "}
                {formatTime(segment.end_ms, true)}.
              </p>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            color="primary"
            type="submit"
            disabled={disabled || !!error || !parts}
          >
            Split
          </Button>
        </DialogFooter>
      </form>
    </dialog>
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
  const { editingLocked: saving } = useEditorState();
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
