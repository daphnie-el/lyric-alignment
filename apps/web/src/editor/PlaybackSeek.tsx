import { usePlaybackControls, usePlaybackState } from "./PlaybackContext";
import { formatTime } from "./formatTime";

export default function PlaybackSeek({ durationMs }: { durationMs: number }) {
  const { positionMs, ready } = usePlaybackState();
  const { seek } = usePlaybackControls();

  return (
    <label className="flex flex-col gap-2 text-sm text-(--color-text-muted)">
      Seek playback
      <input
        type="range"
        min={0}
        max={durationMs}
        step={100}
        value={Math.min(positionMs, durationMs)}
        disabled={!ready || durationMs <= 0}
        aria-valuetext={formatTime(positionMs, true)}
        onChange={(event) => seek(event.currentTarget.valueAsNumber)}
        className="w-full accent-(--color-primary)"
      />
    </label>
  );
}
