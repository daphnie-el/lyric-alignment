import type { SaveAlignmentResponse, TrackPayload } from "./types";

export type SaveConflict =
  | { kind: "version"; snapshot: SaveAlignmentResponse }
  | { kind: "track" }
  | { kind: "unknown" };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Validate the wire shape separately from the editor's non-overlap policy.
// Even an alignment the editor cannot load may be replaced by valid local work.
export function isAlignmentSnapshot(value: unknown): value is SaveAlignmentResponse {
  if (!object(value) || !nonnegativeInteger(value.version) || !Array.isArray(value.lines))
    return false;
  const ids = new Set<string>();
  for (const line of value.lines) {
    if (
      !object(line) || typeof line.id !== "string" || !line.id.trim() ||
      ids.has(line.id) || !nonnegativeInteger(line.index) || typeof line.text !== "string"
    ) return false;
    ids.add(line.id);
  }
  if (value.alignment === null) return true;
  if (!object(value.alignment) || !Array.isArray(value.alignment.segments)) return false;
  const placedIds = new Set<string>();
  for (const segment of value.alignment.segments) {
    if (
      !object(segment) || typeof segment.line_id !== "string" ||
      !ids.has(segment.line_id) || placedIds.has(segment.line_id) ||
      !nonnegativeInteger(segment.start_ms) || !nonnegativeInteger(segment.end_ms) ||
      segment.end_ms <= segment.start_ms
    ) return false;
    placedIds.add(segment.line_id);
  }
  return true;
}

export function isTrackPayload(value: unknown): value is TrackPayload {
  return object(value) && typeof value.id === "string" && !!value.id.trim() &&
    typeof value.title === "string" && typeof value.artist === "string" &&
    typeof value.audio_url === "string" && !!value.audio_url.trim() &&
    typeof value.duration_seconds === "number" && Number.isFinite(value.duration_seconds) &&
    value.duration_seconds > 0 && Number.isSafeInteger(Math.round(value.duration_seconds * 1000)) &&
    isAlignmentSnapshot(value);
}
