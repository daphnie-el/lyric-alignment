import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { ApiError, api } from "../api";
import { Button } from "../components/Button";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { downloadTrackLrc } from "../utils/helpers";
import { probeAudio } from "../utils/probeAudio";
import type { TrackPayload } from "../utils/types";

type Candidate = { source: File | string; durationSeconds: number };

/** Outside the keyed playback session so the dialog survives track replacement. */
export default function SongImport() {
  const { importDialogOpen } = useEditorState();
  return importDialogOpen ? <LoadSongDialog /> : null;
}

function LoadSongDialog() {
  const {
    track,
    unsavedChanges,
    importing,
    importPlaybackPending,
    importError,
  } = useEditorState();
  const dispatch = useEditorDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [sourceType, setSourceType] = useState<"file" | "url">("url");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timedIds = new Set(track?.segments.map((segment) => segment.line_id));
  const timed =
    track?.lines.filter((line) => timedIds.has(line.id)).length ?? 0;
  const untimed = (track?.lines.length ?? 0) - timed;
  const message = error ?? importError;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      requestRef.current?.abort();
      dialog?.close();
      document.getElementById("load-song")?.focus();
    };
  }, []);

  useEffect(() => {
    if (candidate) headingRef.current?.focus();
  }, [candidate]);

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
    if (importing) return;
    dispatch({ type: "importStart" });
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
      if (!controller.signal.aborted)
        dispatch({ type: "importStored", payload });
    } catch (value) {
      if (controller.signal.aborted && !timedOut) return;
      const text =
        value instanceof ApiError
          ? "Could not store the song. Your current work is still here. Try again."
          : timedOut
            ? "Storing the song timed out. Your work is still here; retry or reload to check whether it was stored."
            : "Could not confirm the song was stored. Your work is still here; check your connection and retry or reload.";
      dispatch({ type: "importFailure", error: text });
      reportError(value instanceof ApiError ? value : new Error(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkSource(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || importing) return;
    const source = sourceType === "file" ? file : url.trim();
    if (!source) {
      reportError(
        new Error("Choose an audio file or enter a direct audio URL."),
      );
      return;
    }
    busyRef.current = true;
    setError(null);
    setProbing(true);
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      const durationSeconds = await probeAudio(source, controller.signal);
      if (controller.signal.aborted) return;
      const next = { source, durationSeconds };
      if (track) setCandidate(next);
      else await persist(next);
    } catch (value) {
      if (!controller.signal.aborted) reportError(value);
    } finally {
      if (!controller.signal.aborted) {
        setProbing(false);
        busyRef.current = false;
      }
    }
  }

  async function continueImport(exportFirst: boolean) {
    if (!candidate || importing || busyRef.current) return;
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
    if (importing) return;
    requestRef.current?.abort();
    dispatch({ type: "closeImport" });
  }

  function containKeys(event: KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const elements = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "button:enabled, input:enabled, [tabindex='0']",
      ),
    ].filter((element) => element.getClientRects().length);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    if (
      event.shiftKey &&
      (event.target === first || event.target === headingRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby="load-song-title"
      aria-describedby="load-song-description"
      aria-busy={importing || probing}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-(--color-border) bg-(--color-surface) p-6 text-(--color-text) shadow-xl backdrop:bg-black/50"
      onKeyDown={containKeys}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="load-song-title" ref={headingRef} tabIndex={-1} className="m-0">
          {candidate ? "Replace current song?" : "Load song"}
        </h2>
        <Button
          aria-label="Close load song dialog"
          disabled={importing}
          className="shrink-0 border-0 p-0"
          onClick={close}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </Button>
      </div>
      {candidate ? (
        <>
          <p id="load-song-description">
            Loading a new song removes the current song, lyrics, and alignment.
            Previous files are not kept.
            {unsavedChanges ? " You have unsaved changes." : ""} Export your
            timed lyrics before continuing if you want to keep them.
          </p>
          <p className="text-sm">
            LRC export includes {timed} timed {timed === 1 ? "line" : "lines"}.
            Audio and {untimed} untimed{" "}
            {untimed === 1 ? "line is" : "lines are"} excluded.
          </p>
          <p className="wrap-break-word text-sm">
            New song:{" "}
            {candidate.source instanceof File
              ? candidate.source.name
              : candidate.source}
          </p>
          {!timed ? (
            <p className="text-sm">
              There are no timed lyrics to export. Close this dialog to keep
              working, or continue to replace the song.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              disabled={importing || !timed}
              onClick={() => void continueImport(true)}
            >
              Export and continue
            </Button>
            <Button
              color="primary"
              loading={importing}
              onClick={() => void continueImport(false)}
            >
              Continue
            </Button>
          </div>
          <Button
            disabled={importing}
            className="mt-3"
            onClick={() => {
              setCandidate(null);
              setFile(null);
              setError(null);
              dispatch({ type: "openImport" });
            }}
          >
            Choose another source
          </Button>
        </>
      ) : (
        <form onSubmit={(event) => void checkSource(event)}>
          <p id="load-song-description">
            Choose an MP3, WAV, Ogg, or M4A file up to 100 MiB, or enter a
            direct audio URL. Streaming-service webpage links are not supported.
          </p>
          <fieldset disabled={probing || importing} className="mb-4 flex gap-4">
            <legend className="mb-2 text-sm">Audio source</legend>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="song-source"
                checked={sourceType === "url"}
                onChange={() => {
                  setSourceType("url");
                  setFile(null);
                  setError(null);
                }}
              />
              Audio URL
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="song-source"
                checked={sourceType === "file"}
                onChange={() => {
                  setSourceType("file");
                  setError(null);
                }}
              />
              Device file
            </label>
          </fieldset>
          {sourceType === "file" ? (
            <label className="flex flex-col gap-2">
              Audio file
              <input
                type="file"
                accept=".mp3,.wav,.ogg,.m4a"
                disabled={probing || importing}
                onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </label>
          ) : (
            <label className="flex flex-col gap-2">
              Direct audio URL
              <input
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="https://example.com/song.mp3"
                value={url}
                disabled={probing || importing}
                onChange={(event) => {
                  setUrl(event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              type="submit"
              color="primary"
              loading={probing || importing}
              disabled={sourceType === "file" ? !file : !url.trim()}
            >
              Load song
            </Button>
          </div>
        </form>
      )}
      {probing || importing ? (
        <p role="status">
          {importPlaybackPending
            ? "Loading song into player…"
            : importing
              ? "Storing song…"
              : "Checking audio…"}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-4 wrap-break-word text-(--color-danger)">
          {message}
        </p>
      ) : null}
    </dialog>
  );
}
