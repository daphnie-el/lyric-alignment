import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { Button } from "./Button";
import { usePlaybackControls } from "../context/PlaybackContext";

const AudioPlayer = ({ src }: { src: string }) => {
  const { attachAudio } = usePlaybackControls();
  const { track, importPlaybackPending } = useEditorState();
  const dispatch = useEditorDispatch();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const failureReported = useRef(false);
  const importReported = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const trackId = track?.id;
  const attach = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    attachAudio(element);
  }, [attachAudio]);

  const fail = useCallback(() => {
    if (failureReported.current) return;
    failureReported.current = true;
    const message = importPlaybackPending
      ? "The song was stored, but playback could not load. Try loading it again or choose a different source."
      : "Could not play this song. Check your connection, retry playback, or use Load song to choose another source.";
    setError(message);
    toast.error(message);
    if (importPlaybackPending && trackId) dispatch({ type: "importFailure", error: message, trackId });
  }, [dispatch, importPlaybackPending, trackId]);

  useEffect(() => {
    if (!importPlaybackPending) return;
    const timer = setTimeout(fail, 30000);
    return () => clearTimeout(timer);
  }, [importPlaybackPending, fail]);

  return (
    <>
      <audio
        ref={attach}
        src={src}
        key={src}
        hidden
        preload="auto"
        onCanPlay={(event) => {
          if (!Number.isFinite(event.currentTarget.duration) || event.currentTarget.duration <= 0) {
            fail();
            return;
          }
          setError(null);
          failureReported.current = false;
          if (importPlaybackPending && trackId && !importReported.current) {
            importReported.current = true;
            dispatch({ type: "importReady", trackId });
            toast.success("Song loaded, please add lyrics to the lyrics sheet.");
          }
        }}
        onError={fail}
        className="w-full min-w-0 max-w-none"
        aria-label="Track playback"
      />

      {error ? (
        <div className="w-full min-w-0 text-sm">
          <p role="alert" className="text-(--color-danger)">{error}</p>
          <Button onClick={() => { failureReported.current = false; setError(null); audioRef.current?.load(); }}>Retry playback</Button>
        </div>
      ) : null}
    </>
  );
};
export default AudioPlayer;
