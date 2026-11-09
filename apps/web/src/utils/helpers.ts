import type { SaveConflict } from "./saveConflict";
import type {
  EditorState,
  EditorTrack,
  HistoryEntry,
  LyricLine,
  Segment,
} from "./types";

const formatLrcTimestamp = (milliseconds: number): string => {
  const totalCentiseconds = Math.round(milliseconds / 10);

  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}]`;
};

export const HISTORY_LIMIT = 100;
export const segmentsToLrc = (
  segments: Segment[],
  lyrics: LyricLine[],
): string => {
  const lyricsMap = new Map(lyrics.map((line) => [line.id, line]));

  return [...segments]
    .filter((segment) => lyricsMap.has(segment.line_id))
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((segment) => {
      const lyric = lyricsMap.get(segment.line_id)!;

      const text = lyric.text.replace(
        /[^\S\r\n]*(?:\r\n|[\r\n])[^\S\r\n]*/g,
        " ",
      );
      return `${formatLrcTimestamp(segment.start_ms)}${text}`;
    })
    .join("\n");
};

export const downloadLrc = (
  segments: Segment[],
  lyrics: LyricLine[],
  filename: string,
): void => {
  const content = segmentsToLrc(segments, lyrics);

  const blob = new Blob([content], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "lyrics.lrc";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
};

export function downloadTrackLrc(
  track: Pick<EditorTrack, "title" | "lines" | "segments">,
): void {
  // Control characters cannot appear in a portable filename.
  // eslint-disable-next-line no-control-regex
  const title = track.title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  downloadLrc(track.segments, track.lines, `${title || "lyrics"}.lrc`);
}

// Compare persisted values, independent of server array order or history depth.
export function contentSnapshot(
  lines: LyricLine[],
  segments: Segment[],
): string {
  return JSON.stringify({
    lines: [...lines]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, index, text }) => ({ id, index, text })),
    segments: [...segments]
      .sort((a, b) => a.line_id.localeCompare(b.line_id))
      .map(({ line_id, start_ms, end_ms }) => ({ line_id, start_ms, end_ms })),
  });
}
export function hasUnsavedChanges(
  state: Pick<EditorState, "track" | "savedContent">,
): boolean {
  return (
    !!state.track &&
    contentSnapshot(state.track.lines, state.track.segments) !==
      state.savedContent
  );
}

export function historyEntry(track: EditorTrack): HistoryEntry {
  return { lines: track.lines, segments: track.segments };
}

export function commitSegments(
  state: EditorState,
  segments: Segment[],
  selectedLineId: string | null,
  selectedTimelineIds = selectedLineId &&
  segments.some((segment) => segment.line_id === selectedLineId)
    ? [selectedLineId]
    : [],
): EditorState {
  const track = state.track;
  if (!track) return state;
  const changed =
    segments.length !== track.segments.length ||
    segments.some((segment, index) => {
      const previous = track.segments[index];
      return (
        !previous ||
        segment.line_id !== previous.line_id ||
        segment.start_ms !== previous.start_ms ||
        segment.end_ms !== previous.end_ms
      );
    });
  return {
    ...state,
    selectedLineId,
    selectedTimelineIds,
    timingError: null,
    track: changed ? { ...track, segments } : track,
    past: changed
      ? [...state.past, historyEntry(track)].slice(-HISTORY_LIMIT)
      : state.past,
    future: changed ? [] : state.future,
  };
}

export function conflictMessage(conflict: SaveConflict): string {
  if (conflict.kind === "track")
    return "The current song changed in another session. Your local changes are still here. Load the latest song to continue.";
  if (conflict.kind === "unknown")
    return "Another session saved a newer version, but its state could not be retrieved. Your changes are still here. Retry recovery or load the latest song.";
  return "Another session saved a newer version. Your changes are still here and have not been saved. Choose how to resolve the conflict.";
}
