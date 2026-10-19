import AudioPlayer from "../components/AudioPlayer";
import { Button } from "../components/Button";
import { useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";
export default function Toolbar() {
  const { track } = useEditorState();
  return (
    <header className="editor-toolbar flex flex-wrap items-center gap-5 border-b border-(--color-border) p-5">
      <Button
        color="primary"
        disabled
        title="Audio import is coming later"
        className="font-semibold"
      >
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
        <div className="w-full min-w-0 md:w-auto md:flex-2 md:basis-96">
          <AudioPlayer src={track.audio_url} />
        </div>
      ) : null}
      <Button
        title="LRC export"
        color="outline"
        className="font-semibold"
        // disabled={!track}
        disabled
      >
        Export LRC
      </Button>
    </header>
  );
}
