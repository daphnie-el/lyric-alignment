import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";

export default function SaveRecovery() {
  const { saveConflict, editingLocked, interacting } = useEditorState();
  const dispatch = useEditorDispatch();
  if (!saveConflict) return null;
  const disabled = editingLocked || interacting;
  return (
    <div aria-label="Save conflict recovery" className="flex flex-wrap items-center gap-2">
      {saveConflict.kind === "version" ? (
        <Button disabled={disabled} onClick={() => {
          if (window.confirm("Replace the newer server version with your current local lyrics and timings? Other sessions' changes will be overwritten."))
            dispatch({ type: "replaceServer" });
        }}>Replace server version</Button>
      ) : saveConflict.kind === "unknown" ? (
        <Button disabled={disabled} onClick={() => dispatch({ type: "retryRecovery" })}>Retry recovery</Button>
      ) : null}
      <Button disabled={disabled} onClick={() => {
        if (window.confirm("Load the latest song and discard your local edits and undo history?"))
          dispatch({ type: "reloadLatest" });
      }}>Load latest</Button>
    </div>
  );
}
