import { Button } from "../components/Button";
import { useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";
export default function Timeline() {
  const { track } = useEditorState();
  return (
    <section
      aria-labelledby="timeline-heading"
      className="flex min-h-80 min-w-0 flex-1 flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-heading" className="m-0">
          Timeline
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-(--color-text-muted)">Zoom</span>
          <Button disabled aria-label="Zoom out">
            −
          </Button>
          <Button disabled aria-label="Zoom in">
            +
          </Button>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex justify-between border-b border-(--color-border) pb-2 font-mono text-xs text-(--color-text-muted)"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <span key={fraction}>
            {formatTime((track?.durationMs ?? 0) * fraction)}
          </span>
        ))}
      </div>
      <div className="timeline-placeholder flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border(--color-border) p-6 text-center">
        <span className="eyebrow">Timeline placeholder</span>
        <p className="m-0 font-medium text(--color-text)">
          A place for every line
        </p>
        <p className="m-0 max-w-sm text-sm">
          Waveform rendering and segment editing are coming later. Select a
          lyric to inspect its timing.
        </p>
      </div>
      <p className="m-0 text-xs">
        {track?.segments.length ?? 0} saved segments
      </p>
    </section>
  );
}
