import { api } from "../api";
import { isTrackPayload, type SaveConflict } from "./saveConflict";

export async function readSaveConflict(
  trackId: string,
  signal: AbortSignal,
): Promise<SaveConflict> {
  try {
    const latest = await api<unknown>("/api/v1/track", { signal });
    if (isTrackPayload(latest))
      return latest.id === trackId
        ? { kind: "version", snapshot: latest }
        : { kind: "track" };
  } catch {
    // Keep the local draft even when recovery information is unavailable.
  }
  return { kind: "unknown" };
}
