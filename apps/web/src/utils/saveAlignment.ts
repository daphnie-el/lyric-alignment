import { ApiError, api } from "../api";
import { conflictMessage } from "./helpers";
import { readSaveConflict } from "./readSaveConflict";
import {
  isAlignmentSnapshot,
  isTrackPayload,
  type SaveConflict,
} from "./saveConflict";
import { normalizeSegments } from "./timing";
import type { EditorTrack, SaveAlignmentRequest, TrackPayload } from "./types";

export type SaveOperation = "save" | "reload" | "recover";
export type SaveResult =
  | { kind: "saved" | "loaded"; payload: TrackPayload }
  | { kind: "empty" }
  | { kind: "failure"; error: string; conflict?: SaveConflict };

export const FAILURE_MESSAGES: Record<SaveOperation, string> = {
  save: "Could not save your changes. Your changes are still here and remain unsaved. Check your connection and try Save again.",
  reload: "Could not load the latest song. Your local changes are still here. Try Load latest again.",
  recover: conflictMessage({ kind: "unknown" }),
};

const INVALID_SAVE_RESPONSE =
  "Could not confirm the saved changes because the server returned an invalid response. Your local changes are still here. The server may have saved them; retry saving to confirm.";

export async function resolveSaveConflict(
  trackId: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<SaveResult> {
  let conflict: SaveConflict;
  if (
    body && typeof body === "object" && "error" in body &&
    body.error === "track_conflict"
  ) {
    conflict = { kind: "track" };
  } else if (
    body && typeof body === "object" && "error" in body &&
    body.error === "version_conflict" && isAlignmentSnapshot(body)
  ) {
    conflict = { kind: "version", snapshot: body };
  } else {
    conflict = await readSaveConflict(trackId, signal);
  }
  return { kind: "failure", error: conflictMessage(conflict), conflict };
}

export async function reloadLatestTrack(signal: AbortSignal): Promise<SaveResult> {
  let payload: unknown;
  try {
    payload = await api<unknown>("/api/v1/track", { signal });
  } catch (error) {
    if (
      error instanceof ApiError && error.status === 404 &&
      error.body && typeof error.body === "object" &&
      "error" in error.body && error.body.error === "no_current_track"
    ) return { kind: "empty" };
    throw error;
  }
  if (!isTrackPayload(payload)) throw new Error("Invalid track response");
  const normalized = normalizeSegments(
    payload.alignment?.segments ?? [],
    Math.round(payload.duration_seconds * 1000),
    new Set(payload.lines.map(line => line.id)),
  );
  if (normalized.error) throw new Error(normalized.error);
  return { kind: "loaded", payload };
}

export async function saveAlignmentRequest(
  track: EditorTrack,
  version: number | null,
  signal: AbortSignal,
): Promise<SaveResult> {
  const body: SaveAlignmentRequest = {
    track_id: track.id,
    version: version ?? track.version,
    lines: track.lines,
    segments: track.segments,
  };
  let saved: unknown;
  try {
    saved = await api<unknown>("/api/v1/track/alignment", {
      method: "PUT",
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return resolveSaveConflict(track.id, signal, error.body);
    }
    throw error;
  }
  if (!isAlignmentSnapshot(saved)) {
    return { kind: "failure", error: INVALID_SAVE_RESPONSE };
  }
  const normalized = normalizeSegments(
    saved.alignment?.segments ?? [],
    track.durationMs,
    new Set(saved.lines.map(line => line.id)),
  );
  if (normalized.error) return { kind: "failure", error: INVALID_SAVE_RESPONSE };

  // Pass the wire timings through: the reducer retains their saved baseline
  // and marks any normalization repairs as unsaved editor changes.
  return {
    kind: "saved",
    payload: {
      id: track.id,
      title: track.title,
      artist: track.artist,
      audio_url: track.audio_url,
      duration_seconds: track.durationMs / 1000,
      version: saved.version,
      lines: saved.lines,
      alignment: saved.alignment,
    },
  };
}
