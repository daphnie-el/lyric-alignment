import { useEffect } from "react";
import { Button } from "../components/Button";
import { useEditorState } from "../context/EditorContext";
import { usePlaybackReady } from "../context/PlaybackContext";
import { useStampLine } from "../utils/useStampLine";

const interactiveSelector = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "audio",
  "video",
  "summary",
  "[contenteditable]",
  "[role='button']",
  "[role='slider']",
  "[role='textbox']",
].join(", ");

export default function StampControls() {
  const {
    track,
    selectedLineId,
    editingLocked: saving,
    interacting,
  } = useEditorState();
  const ready = usePlaybackReady();
  const stamp = useStampLine();
  const target =
    track?.lines.find((line) => line.id === selectedLineId) ??
    track?.lines.find(
      (line) => !track.segments.some((segment) => segment.line_id === line.id),
    );
  const disabled = !ready || !target || saving || interacting;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        disabled ||
        (event.key !== " " && event.key !== "Enter") ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const element = event.target;
      if (element instanceof Element && element.closest(interactiveSelector))
        return;
      event.preventDefault();
      stamp();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, stamp]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Button
          data-tour="stamp"
          disabled={disabled}
          onClick={() => stamp()}
          aria-describedby={target ? "stamp-target stamp-hint" : "stamp-hint"}
          color="outline"
        >
          Set lyric start time
        </Button>

        <p id="stamp-hint" className="text-xs text-(--color-text-muted)">
          Press <kbd>Space</kbd> to stamp when this lyric begins.
        </p>
      </div>
    </div>
  );
}
