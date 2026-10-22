import { usePlaybackState } from "../context/PlaybackContext";

export default function TimelinePlayhead({
  scale,
  durationMs,
}: {
  scale: number;
  durationMs: number;
}) {
  const { positionMs } = usePlaybackState();
  const position = Math.min(positionMs, durationMs);

  return (
    <div
      className="timeline-playhead"
      data-testid="timeline-playhead"
      aria-hidden="true"
      style={{ transform: `translateX(${(position * scale) / 1000}px)` }}
    />
  );
}
