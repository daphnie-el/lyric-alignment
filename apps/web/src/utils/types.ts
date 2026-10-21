export type Segment = { line_id: string; start_ms: number; end_ms: number };

export const DEFAULT_DURATION_MS = 3000;

export type TimingResult =
  | { segments: Segment[]; error?: never }
  | { error: string; segments?: never };

export type LyricLine = { id: string; index: number; text: string };

export type TrackPayload = {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  audio_url: string;
  lines: LyricLine[];
  version: number;
  alignment: { segments: Segment[] } | null;
};

export type EditorTrack = Omit<
  TrackPayload,
  "duration_seconds" | "alignment"
> & {
  durationMs: number;
  segments: Segment[];
};

export type SaveAlignmentRequest = {
  version: number;
  lines: LyricLine[];
  segments: Segment[];
};
export type SaveAlignmentResponse = Pick<
  TrackPayload,
  "version" | "lines" | "alignment"
>;
