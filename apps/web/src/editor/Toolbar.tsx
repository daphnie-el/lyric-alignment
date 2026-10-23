import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useRef } from "react";
import AudioPlayer from "../components/AudioPlayer";
import { Button } from "../components/Button";
import { DialogFooter } from "../components/DialogFooter";
import ThemeToggle from "../components/ThemeToggle";
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { formatTime } from "../utils/formatTime";
import { downloadTrackLrc } from "../utils/helpers";
export default function Toolbar() {
  const { track, status, interacting, saving, importing, unsavedChanges, saveConflict } =
    useEditorState();
  const dispatch = useEditorDispatch();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const confirmExportRef = useRef<HTMLButtonElement>(null);
  const timedIds = new Set(track?.segments.map((segment) => segment.line_id));
  const total = track?.lines.length ?? 0;
  const timed =
    track?.lines.filter((line) => timedIds.has(line.id)).length ?? 0;
  const untimed = total - timed;
  const exportDisabled =
    status !== "ready" || !track || !timed || interacting || saving || importing;

  function exportLrc() {
    if (exportDisabled || !track) return;
    downloadTrackLrc(track);
  }
  return (
    <header className="editor-toolbar flex flex-wrap items-center gap-5 border-b border-(--color-border) p-5">
      <Button
        id="load-song"
        color="primary"
        disabled={status === "loading" || saving || importing || interacting}
        onClick={() => dispatch({ type: "openImport" })}
        className="font-semibold"
      >
        Load song
      </Button>
      <div className="min-w-0 flex-1 basis-48">
        <span className="eyebrow">Lyric alignment</span>
        <h1 className="wrap-break-word">
          {track?.title ?? "Alignment editor"}
        </h1>
        <p className="m-0 wrap-break-word text-sm">
          {track
            ? [track.artist, formatTime(track.durationMs)].filter(Boolean).join(" · ")
            : "Your workspace for timing lyrics"}
        </p>
      </div>
      {track ? <AudioPlayer src={track.audio_url} /> : null}
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-2">
          <Button
            ref={exportButtonRef}
            title="LRC export"
            color="outline"
            className="font-semibold"
            disabled={exportDisabled}
            aria-describedby={track && !timed ? "export-guidance" : undefined}
            onClick={() => {
              if (exportDisabled) return;
              if (!untimed && !unsavedChanges) {
                exportLrc();
                return;
              }
              dialogRef.current?.showModal();
              keepEditingRef.current?.focus();
            }}
          >
            Export LRC
          </Button>
          {track && !timed ? (
            <p id="export-guidance" className="m-0 text-xs">
              Time at least one lyric line to export.
            </p>
          ) : null}
        </div>
        <ThemeToggle />
      </div>
      <dialog
        ref={dialogRef}
        aria-labelledby="export-dialog-title"
        aria-describedby="export-dialog-description"
        className="m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-(--color-border) bg-(--color-surface) p-0 text-(--color-text) shadow-xl backdrop:bg-black/50"
        onClose={() => exportButtonRef.current?.focus()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== "Tab") return;
          if (event.shiftKey && event.target === closeDialogRef.current) {
            event.preventDefault();
            confirmExportRef.current?.focus();
          } else if (
            !event.shiftKey &&
            event.target === confirmExportRef.current
          ) {
            event.preventDefault();
            closeDialogRef.current?.focus();
          }
        }}
      >
        <div className="flex items-center gap-4 px-6 py-5">
          <h2
            id="export-dialog-title"
            className="m-0 min-w-0 flex-1 wrap-break-word"
          >
            {unsavedChanges
              ? "Export unsaved changes?"
              : "Some lines aren’t timed yet"}
          </h2>
          <Button
            ref={closeDialogRef}
            aria-label="Close export dialog"
            className="grid size-8 shrink-0 place-items-center border-0 bg-transparent p-0"
            onClick={() => dialogRef.current?.close()}
          >
            <XIcon weight="fill" size={20} aria-hidden="true" />
          </Button>
        </div>
        <p id="export-dialog-description" className="m-0 px-6 pb-6">
          {unsavedChanges
            ? "Your changes haven’t been saved. You can save before exporting or export without saving. "
            : null}
          {untimed ? (
            <>
              {untimed} of {total} {total === 1 ? "line" : "lines"}{" "}
              {untimed === 1 ? "hasn’t" : "haven’t"} been placed on the
              timeline. Exporting now will include only the {timed} timed{" "}
              {timed === 1 ? "line" : "lines"}.
            </>
          ) : null}
        </p>
        <DialogFooter>
          <Button
            ref={keepEditingRef}
            onClick={() => dialogRef.current?.close()}
          >
            Keep editing
          </Button>
          <Button
            ref={unsavedChanges ? undefined : confirmExportRef}
            color={unsavedChanges ? "neutral" : "primary"}
            disabled={exportDisabled}
            onClick={() => {
              exportLrc();
              dialogRef.current?.close();
            }}
          >
            {unsavedChanges
              ? "Export without saving"
              : `Export ${timed} timed ${timed === 1 ? "line" : "lines"}`}
          </Button>
          {unsavedChanges ? (
            <Button
              ref={confirmExportRef}
              color="primary"
              disabled={exportDisabled || !!saveConflict}
              onClick={() => {
                if (exportDisabled || saveConflict) return;
                dispatch({ type: "saveStart", exportAfterSave: true });
                dialogRef.current?.close();
              }}
            >
              Save and export
            </Button>
          ) : null}
        </DialogFooter>
      </dialog>
    </header>
  );
}
