import { useRef, useState } from "react";

const AudioPlayer = ({ src }: { src: string }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <div className="w-full min-w-0">
      <audio
        ref={audioRef}
        src={src}
        key={src}
        controls
        className="w-full min-w-0 max-w-none"
        aria-label="Track playback"
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime * 1000);
          }
        }}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Current playback position</span>

        <span className="rounded-md bg-violet-500/10 px-3 py-1 font-mono text-sm font-medium tabular-nums text-violet-300">
          {(currentTime / 1000).toFixed(2)}s
        </span>
      </div>
    </div>
  );
};
export default AudioPlayer;
