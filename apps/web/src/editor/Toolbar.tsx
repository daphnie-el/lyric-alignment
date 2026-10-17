import { Button } from "../components/Button";
import { useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";
export default function Toolbar() {
  const { track } = useEditorState();
  return (
    <header className="editor-toolbar flex flex-wrap items-center gap-5 border-b border-(--color-border) p-5">
      <Button color="primary" disabled title="Audio import is coming later">
        Load song
      </Button>
      <div className="min-w-0 flex-1 basis-48">
        <span className="eyebrow">Lyric alignment</span>
        <h1 className="wrap-break-word">
          {track?.title ?? "Alignment editor"}
        </h1>
        <p className="m-0 wrap-break-word text-sm">
          {track
            ? `${track.artist} · ${formatTime(track.durationMs)}`
            : "Your workspace for timing lyrics"}
        </p>
      </div>
      {track ? (
        <audio
          key={track.audio_url}
          controls
          preload="metadata"
          src={track.audio_url}
          aria-label="Track playback"
        />
      ) : null}
      <Button title="LRC export">Export LRC</Button>
    </header>
  );
}
