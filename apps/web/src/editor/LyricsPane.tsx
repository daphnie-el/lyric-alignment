import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";
export default function LyricsPane() {
  const { track, selectedLineId, status } = useEditorState();
  const dispatch = useEditorDispatch();
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
      <div className="flex flex-col gap-2">
        <label
          htmlFor="lyric-sheet"
          className="text-sm text-(--color-text-muted)"
        >
          Lyric sheet
        </label>
        <textarea
          id="lyric-sheet"
          disabled
          placeholder="Paste full lyrics…"
          rows={3}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button disabled>Add all lines</Button>
          <Button disabled>+ Add line</Button>
        </div>
        <p className="m-0 text-xs">Lyric editing is coming later.</p>
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
              <Button
                className="lyric-button flex w-full items-start gap-3 text-left"
                aria-pressed={selectedLineId === line.id}
                onClick={() => dispatch({ type: "selectLine", id: line.id })}
              >
                <span
                  aria-hidden="true"
                  className="pt-0.5 font-mono text-xs text-(--color-text-muted)"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 wrap-break-word">
                  <span className="block">{line.text}</span>
                  <span className="mt-1 block font-mono text-xs text-(--color-text-muted)">
                    {segment ? formatTime(segment.start_ms, true) : "Untimed"}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
      {status === "ready" && !track?.lines.length ? (
        <p>No lyrics yet. This track has no lines to select.</p>
      ) : null}
    </section>
  );
}
