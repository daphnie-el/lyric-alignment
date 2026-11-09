import { useEffect } from "react";
import { toast } from "sonner";
import { downloadTrackLrc } from "../utils/helpers";
import {
  FAILURE_MESSAGES,
  reloadLatestTrack,
  resolveSaveConflict,
  saveAlignmentRequest,
  type SaveOperation,
  type SaveResult,
} from "../utils/saveAlignment";
import type { SaveConflict } from "../utils/saveConflict";
import type { EditorTrack, TrackPayload } from "../utils/types";

type Options = {
  saving: boolean;
  track: EditorTrack | null;
  operation: SaveOperation;
  version: number | null;
  exportAfterSave: boolean;
  onSuccess: (payload: TrackPayload) => void;
  onEmpty: () => void;
  onFailure: (error: string, conflict?: SaveConflict) => void;
};

const SAVE_TIMEOUT_MS = 30_000;
const TIMEOUT_MESSAGES: Record<SaveOperation, string> = {
  save: "Saving timed out. The server may have saved your changes, but we could not confirm it. Your local changes are still here. Try saving again.",
  reload: "Loading the latest song timed out. Your local changes are still here. Try Load latest again.",
  recover: "Checking the latest version timed out. Your local changes are still here. Try Retry recovery again.",
};

function exportSavedTrack(payload: TrackPayload) {
  try {
    downloadTrackLrc({
      title: payload.title,
      lines: payload.lines,
      segments: payload.alignment?.segments ?? [],
    });
  } catch {
    toast.error(
      "Your changes were saved, but the download could not start. Try Export LRC again.",
    );
  }
}

export function useSaveAlignment({
  saving,
  track,
  operation,
  version,
  exportAfterSave,
  onSuccess,
  onEmpty,
  onFailure,
}: Options) {
  useEffect(() => {
    if (!saving || !track) return;
    const currentTrack = track;
    const controller = new AbortController();
    const { signal } = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      onFailure(TIMEOUT_MESSAGES[operation]);
    }, SAVE_TIMEOUT_MS);

    async function runOperation() {
      try {
        let result: SaveResult;
        try {
          switch (operation) {
            case "save":
              result = await saveAlignmentRequest(currentTrack, version, signal);
              break;
            case "reload":
              result = await reloadLatestTrack(signal);
              break;
            case "recover":
              result = await resolveSaveConflict(currentTrack.id, signal);
              break;
          }
        } catch {
          result = { kind: "failure", error: FAILURE_MESSAGES[operation] };
        }
        if (signal.aborted) return;

        switch (result.kind) {
          case "failure":
            onFailure(result.error, result.conflict);
            break;
          case "empty":
            onEmpty();
            break;
          case "loaded":
            onSuccess(result.payload);
            break;
          case "saved":
            onSuccess(result.payload);
            toast.success("Changes saved successfully");
            if (exportAfterSave && !signal.aborted) {
              exportSavedTrack(result.payload);
            }
            break;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    void runOperation();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    saving,
    track,
    operation,
    version,
    exportAfterSave,
    onSuccess,
    onEmpty,
    onFailure,
  ]);
}
