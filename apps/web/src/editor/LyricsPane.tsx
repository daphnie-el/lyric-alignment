import { useDraggable } from "@dnd-kit/react";
import { useRef, useState } from "react";
import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { formatTime } from "../utils/formatTime";
import type { LyricLine, Segment } from "../utils/types";
import TrackEmptyState from "./TrackEmptyState";

function LyricItem({
  line,
  index,
  segment,
  selected,
}: {
  line: LyricLine;
  index: number;
  segment?: Segment;
  selected: boolean;
}) {
  const dispatch = useEditorDispatch();
  const { editingLocked: saving } = useEditorState();
  const { ref, isDragging, isDropping } = useDraggable({
    disabled: saving,
    id: `lyric-${line.id}`,
    data: {
      lineId: line.id,
      kind: "lyric",
      text: line.text,
      placed: !!segment,
    },
  });
  return (
    <Button
      disabled={saving}
      ref={ref}
      className="lyric-button flex w-full items-start gap-3 text-left"
      aria-current={selected}
      style={{
        touchAction: segment ? "auto" : "none",
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={() => {
        if (isDragging || isDropping) return;
        dispatch({ type: "selectLine", id: line.id });
      }}
    >
      <span
        aria-hidden="true"
        className="pt-0.5 font-mono text-xs text-(--color-text-muted)"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 wrap-break-word">
        <span className="block">{line.text}</span>
        <span
          className={
            segment
              ? "mt-1 block font-mono text-xs text-(--color-text-muted)"
              : "mt-1 inline-block rounded-md border border-(--color-danger) bg-(--color-danger-bg) px-2 py-0.5 text-xs font-medium text-(--color-danger)"
          }
        >
          {segment ? formatTime(segment.start_ms, true) : "Untimed"}
        </span>
      </span>
    </Button>
  );
}

export default function LyricsPane() {
  const { track, selectedLineId, status, editingLocked: saving, interacting } =
    useEditorState();
  const dispatch = useEditorDispatch();
  const [draft, setDraft] = useState("");
  const lyricSheetRef = useRef<HTMLTextAreaElement>(null);
  const editingDisabled = status !== "ready" || !track || saving || interacting;
  const text = draft.trim();
  const placed =
    track?.lines.filter((line) =>
      track.segments.some((segment) => segment.line_id === line.id),
    ).length ?? 0;

  return (
    <section
      aria-labelledby="lyrics-heading"
      className="lyrics-pane flex min-h-0 min-w-0 flex-col gap-4 p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lyrics-heading" className="m-0">
          Lyrics
        </h2>
        <span className="text-sm text-(--color-text-muted)">
          {track?.lines.length ?? 0} lines · {placed} placed
        </span>
      </div>
      {!track ? <TrackEmptyState /> : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="lyric-sheet" className="text-sm text-(--color-text)">
          Lyric sheet
        </label>
        <textarea
          id="lyric-sheet"
          ref={lyricSheetRef}
          disabled={editingDisabled}
          placeholder="Enter lyrics, one line per lyric…"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          rows={3}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={editingDisabled || !text}
            onClick={() => {
              if (editingDisabled || !text) return;
              const lines = draft
                .split(/\r\n|[\r\n]/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((text) => ({ id: crypto.randomUUID(), text }));
              dispatch({ type: "addLines", lines });
              setDraft("");
              lyricSheetRef.current?.focus();
            }}
          >
            Add all lines
          </Button>
          <Button
            disabled={editingDisabled || !text}
            onClick={() => {
              if (editingDisabled || !text) return;
              dispatch({ type: "addLine", id: crypto.randomUUID(), text });
              setDraft("");
              lyricSheetRef.current?.focus();
            }}
          >
            + Add line
          </Button>
        </div>
        <p className="m-0 text-xs">
          Add all lines creates one lyric per line and skips blank lines. Add
          line keeps the text as one lyric. Edit added lines in the inspector.
        </p>
      </div>
      <ol
        aria-label="Lyric lines"
        className="lyric-list m-0 flex min-h-0 flex-col gap-2 overflow-y-auto p-1"
      >
        {track?.lines.map((line, index) => {
          const segment = track.segments.find(
            (item) => item.line_id === line.id,
          );
          return (
            <li key={line.id}>
              <LyricItem
                line={line}
                index={index}
                segment={segment}
                selected={selectedLineId === line.id}
              />
            </li>
          );
        })}
      </ol>
      {status === "ready" && track && !track.lines.length ? (
        <p>No lyrics yet. Enter lyrics in the lyric sheet, one line per lyric, then choose Add all lines.</p>
      ) : null}
    </section>
  );
}
