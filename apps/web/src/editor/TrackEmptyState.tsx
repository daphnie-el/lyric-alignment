import { useEditorState } from "../context/EditorContext";

export default function TrackEmptyState() {
  const { status } = useEditorState();
  return (
    <div className="rounded-lg border border-dashed border-(--color-border) bg-(--color-surface) p-5 text-sm">
      <p className="m-0">
        {status === "empty"
          ? "No song loaded. Use Load song to choose an audio file from your device or enter a direct audio URL."
          : status === "loading"
            ? "Loading song…"
            : "Song unavailable. Use Retry above to try again, or Load song to choose another source."}
      </p>
    </div>
  );
}
