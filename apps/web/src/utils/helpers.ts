import type { EditorTrack, LyricLine, Segment } from "./types";

const formatLrcTimestamp = (milliseconds: number): string => {
  const totalCentiseconds = Math.round(milliseconds / 10);

  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}]`;
};

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

      return `${formatLrcTimestamp(segment.start_ms)}${lyric.text}`;
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
