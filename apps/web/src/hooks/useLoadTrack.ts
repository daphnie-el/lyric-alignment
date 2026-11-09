// hooks/useLoadTrack.ts
import { useEffect } from "react";
import { ApiError, api } from "../api";
import type { TrackPayload } from "../utils/types";

type Options = {
  retryCount: number;
  onSuccess: (track: TrackPayload) => void;
  onEmpty: () => void;
  onFailure: (message: string) => void;
};

export function useLoadTrack({
  retryCount,
  onSuccess,
  onEmpty,
  onFailure,
}: Options) {
  useEffect(() => {
    const controller = new AbortController();

    async function loadTrack() {
      try {
        const payload = await api<TrackPayload>("/api/v1/track", {
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          onSuccess(payload);
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;

        if (
          error instanceof ApiError &&
          error.status === 404 &&
          typeof error.body === "object" &&
          error.body !== null &&
          "error" in error.body &&
          error.body.error === "no_current_track"
        ) {
          onEmpty();
          return;
        }

        onFailure(error instanceof Error ? error.message : String(error));
      }
    }

    void loadTrack();
    return () => controller.abort();
  }, [retryCount, onSuccess, onEmpty, onFailure]);
}
