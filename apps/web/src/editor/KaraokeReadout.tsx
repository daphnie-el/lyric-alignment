import { useMemo } from "react";
import { useEditorState } from "../context/EditorContext";
import { usePlaybackState } from "../context/PlaybackContext";
export default function KaraokeReadout() {
  const { track } = useEditorState();

  const { positionMs } = usePlaybackState();

  const lines = track?.lines;

  const lineIndexById = useMemo(
    () => new Map(lines?.map((line, index) => [line.id, index])),
    [lines],
  );

  const activeSegment = track?.segments.find(
    (segment) => positionMs >= segment.start_ms && positionMs < segment.end_ms,
  );

  const index = activeSegment
    ? (lineIndexById.get(activeSegment.line_id) ?? -1)
    : -1;

  return (
    <section
      aria-labelledby="preview-heading"
      className="rounded-lg border border-(--color-border) bg-(--color-surface) p-6 text-center"
    >
      <h2 id="preview-heading" className="eyebrow">
        Karaoke · selection preview
      </h2>
      {!track ? (
        <p className="m-0">Load a song, then add and time lyrics to preview them here.</p>
      ) : null}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex min-h-32 flex-col justify-center gap-3"
      >
        {track && index >= 0 ? (
          <>
            <p className="m-0 wrap-break-word text-sm">
              {track.lines[index - 1]?.text}
            </p>
            <p className="m-0 wrap-break-word text-2xl font-semibold text(--color-text)]">
              {track.lines[index].text}
            </p>
            <p className="m-0 wrap-break-word text-sm">
              {track.lines[index + 1]?.text}
            </p>
          </>
        ) : (
          <p className="m-0">♪ ♪ ♪</p>
        )}
      </div>
    </section>
  );
}
