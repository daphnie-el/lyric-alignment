import {
  usePlaybackControls,
  usePlaybackState,
} from "../editor/PlaybackContext";
import { formatTime } from "../editor/formatTime";

function PlaybackPosition() {
  const { positionMs, playing } = usePlaybackState();
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-(--color-text-muted)">
      <span>{playing ? "Playing" : "Paused"}</span>
      <span
        className="font-mono tabular-nums"
        aria-label="Current playback position"
      >
        {formatTime(positionMs, true)}
      </span>
    </div>
  );
}

const AudioPlayer = ({ src }: { src: string }) => {
  const { attachAudio } = usePlaybackControls();

  return (
    <div className="w-full min-w-0">
      <audio
        ref={attachAudio}
        src={src}
        key={src}
        controls
        className="w-full min-w-0 max-w-none"
        aria-label="Track playback"
      />

      <PlaybackPosition />
    </div>
  );
};
export default AudioPlayer;
