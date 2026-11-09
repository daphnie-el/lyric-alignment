import { SaveConflict } from "./saveConflict";

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
  track_id: string;
  version: number;
  lines: LyricLine[];
  segments: Segment[];
};
export type SaveAlignmentResponse = Pick<
  TrackPayload,
  "version" | "lines" | "alignment"
>;

export type HistoryEntry = Pick<EditorTrack, "lines" | "segments">;

export type EditorState = {
  status: "loading" | "empty" | "ready" | "error";
  track: EditorTrack | null;
  error: string | null;
  selectedLineId: string | null;
  selectedTimelineIds: string[];
  retryCount: number;
  timingError: string | null;
  saving: boolean;
  exportAfterSave: boolean;
  saveError: string | null;
  saveConflict: SaveConflict | null;
  saveOperation: "save" | "reload" | "recover";
  saveVersion: number | null;
  savedContent: string | null;
  interacting: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
};
export type updateSegmentPayload = {
  lineId: string;
  field: "start_ms" | "end_ms";
  value: number | undefined;
};
