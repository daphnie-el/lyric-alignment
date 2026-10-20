import { useCallback } from "react";
import { useEditorDispatch, useEditorState } from "./EditorContext";
import { usePlaybackControls } from "./PlaybackContext";

export function useStampLine() {
  const { saving, interacting } = useEditorState();
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
