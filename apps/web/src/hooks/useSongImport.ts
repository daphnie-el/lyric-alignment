import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import { ApiError, api } from "../api";
import { downloadTrackLrc } from "../utils/helpers";
import { probeAudio } from "../utils/probeAudio";
import type { EditorTrack, TrackPayload } from "../utils/types";

type Candidate = { source: File | string; durationSeconds: number };
type Phase = "idle" | "probing" | "storing" | "awaitingPlayback";
type Options = {
  track: EditorTrack | null;
  canImport: boolean;
  importLockRef: MutableRefObject<boolean>;
  onStored: (payload: TrackPayload) => void;
};

/** One workflow instance survives replacement of the keyed playback session. */
export function useSongImport({
  track,
  canImport,
  importLockRef,
  onStored,
}: Options) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sourceType, setSourceType] = useState<"file" | "url">("url");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingTrack = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const changePhase = useCallback((next: Phase) => {
    // Lock immediately, before React renders disabled controls.
    importLockRef.current = next === "storing" || next === "awaitingPlayback";
    setPhase(next);
  }, [importLockRef]);

  useEffect(() => () => {
    requestRef.current?.abort();
  }, []);

  function open() {
    if (!canImport || importLockRef.current) return;
    setSourceType("url");
    setFile(null);
    setUrl("");
    setCandidate(null);
    setError(null);
    setDialogOpen(true);
  }

  function chooseAnotherSource() {
    if (importLockRef.current) return;
    setCandidate(null);
    setFile(null);
    setError(null);
  }

  const reportPlaybackReady = useCallback((trackId: string) => {
    if (pendingTrack.current !== trackId) return;
    pendingTrack.current = null;
    changePhase("idle");
    setDialogOpen(false);
    setCandidate(null);
    setFile(null);
    setUrl("");
    setError(null);
    toast.success("Song loaded, please add lyrics to the lyrics sheet.");
  }, [changePhase]);

  const reportPlaybackFailure = useCallback((trackId: string, message: string) => {
    if (pendingTrack.current !== trackId) return;
    pendingTrack.current = null;
    changePhase("idle");
    setError(message);
  }, [changePhase]);

  function reportError(value: unknown) {
    const body = value instanceof ApiError ? value.body : null;
    const hint =
      body &&
      typeof body === "object" &&
      "hint" in body &&
      typeof body.hint === "string"
        ? body.hint
        : null;
    const text =
      hint ??
      (value instanceof ApiError
        ? "Could not store the song. Try again."
        : value instanceof Error
          ? value.message
          : "Could not load the song. Try again.");
    setError(text);
    toast.error(text);
  }

  async function persist(next: Candidate) {
    if (importLockRef.current || !canImport) return;
    changePhase("storing");
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120000);
    try {
      let body: FormData | string;
      if (next.source instanceof File) {
        body = new FormData();
        body.append("file", next.source);
        body.append("duration_seconds", String(next.durationSeconds));
      } else {
        body = JSON.stringify({
          audio_url: next.source,
          duration_seconds: next.durationSeconds,
        });
      }
      const payload = await api<TrackPayload>("/api/v1/track", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        pendingTrack.current = payload.id;
        changePhase("awaitingPlayback");
        onStored(payload);
      }
    } catch (value) {
      if (controller.signal.aborted && !timedOut) return;
      const text =
        value instanceof ApiError
          ? "Could not store the song. Your current work is still here. Try again."
          : timedOut
            ? "Storing the song timed out. Your work is still here; retry or reload to check whether it was stored."
            : "Could not confirm the song was stored. Your work is still here; check your connection and retry or reload.";
      changePhase("idle");
      reportError(value instanceof ApiError ? value : new Error(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkSource() {
    if (busyRef.current || importLockRef.current || !dialogOpen || !canImport) return;
    const source = sourceType === "file" ? file : url.trim();
    if (!source) {
      reportError(
        new Error("Choose an audio file or enter a direct audio URL."),
      );
      return;
    }
    busyRef.current = true;
    setError(null);
    changePhase("probing");
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      const durationSeconds = await probeAudio(source, controller.signal);
      if (controller.signal.aborted) return;
      const next = { source, durationSeconds };
      if (track) {
        setCandidate(next);
        changePhase("idle");
      } else await persist(next);
    } catch (value) {
      if (!controller.signal.aborted) {
        changePhase("idle");
        reportError(value);
      }
    } finally {
      if (!controller.signal.aborted) {
        busyRef.current = false;
      }
    }
  }

  async function continueImport(exportFirst: boolean) {
    if (!candidate || importLockRef.current || busyRef.current || !canImport) return;
    setError(null);
    if (exportFirst && track) {
      try {
        downloadTrackLrc(track);
      } catch {
        reportError(
          new Error(
            "The download could not start. Try exporting again or continue without exporting.",
          ),
        );
        return;
      }
    }
    busyRef.current = true;
    try {
      await persist(candidate);
    } finally {
      busyRef.current = false;
    }
  }

  function close() {
    if (importLockRef.current) return;
    requestRef.current?.abort();
    busyRef.current = false;
    changePhase("idle");
    setDialogOpen(false);
    setCandidate(null);
    setFile(null);
    setUrl("");
  }

  return {
    dialogOpen,
    phase,
    sourceType,
    file,
    url,
    candidate,
    error,
    importing: phase === "storing" || phase === "awaitingPlayback",
    importPlaybackPending: phase === "awaitingPlayback",
    probing: phase === "probing",
    setSourceType,
    setFile,
    setUrl,
    setError,
    open,
    close,
    chooseAnotherSource,
    checkSource,
    continueImport,
    reportPlaybackReady,
    reportPlaybackFailure,
  };
}
