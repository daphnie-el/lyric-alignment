import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { StopIcon } from "@phosphor-icons/react/dist/csr/Stop";
import { TooltipButton } from "../components/TooltipButton";
import { usePlaybackControls, usePlaybackState } from "../context/PlaybackContext";
import { formatTime } from "../utils/formatTime";

export default function PlaybackControls() {
  const { playing, positionMs, ready, scrubbing, error } = usePlaybackState();
  const { play, pause, stop } = usePlaybackControls();
  const action = playing ? "Pause" : "Play";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TooltipButton
        aria-label={action}
        tooltip={action}
        disabled={!ready || scrubbing}
        onClick={() => { if (playing) pause(); else void play(); }}
      >
        {playing ? <PauseIcon weight="fill" size={20} aria-hidden="true" /> : <PlayIcon weight="fill" size={20} aria-hidden="true" />}
      </TooltipButton>
      <TooltipButton aria-label="Stop" tooltip="Stop" disabled={!ready} onClick={stop}>
        <StopIcon weight="fill" size={20} aria-hidden="true" />
      </TooltipButton>
      <span aria-label="Current playback position" className="font-mono text-sm tabular-nums text-(--color-text-muted)">
        {formatTime(positionMs, true)}
      </span>
      {error ? <p role="alert" className="m-0 text-sm text-(--color-danger)">{error}</p> : null}
    </div>
  );
}
