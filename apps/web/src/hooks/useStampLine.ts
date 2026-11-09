import { useCallback } from "react";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { usePlaybackControls } from "../context/PlaybackContext";

export function useStampLine() {
  const { editingLocked: saving, interacting } = useEditorState();
  const dispatch = useEditorDispatch();
  const playback = usePlaybackControls();

  return useCallback(
    (lineId?: string, advance = true) => {
      if (saving || interacting || !playback.getReady()) return;
      dispatch({
        type: "stampLine",
        lineId,
        advance,
        startMs: playback.getCurrentTimeMs(),
      });
    },
    [saving, interacting, dispatch, playback],
  );
}
