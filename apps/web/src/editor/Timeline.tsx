import {
  useDragDropMonitor,
  useDroppable,
  type DragMoveEvent,
} from "@dnd-kit/react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { Button } from "../components/Button";
import {
  useEditorDispatch,
  useEditorState,
  type Segment,
} from "./EditorContext";
import { formatTime } from "./formatTime";
import LyricBlock from "./LyricBlock";
import TimelinePlayhead from "./TimelinePlayhead";
import PlaybackSeek from "./PlaybackSeek";
import StampControls from "./StampControls";
import { usePlaybackControls } from "./PlaybackContext";
import { DEFAULT_DURATION_MS, placeSegment } from "./timing";

export default function Timeline() {
  const {
    track,
    selectedLineId,
    timingError,
    past,
    future,
    saving,
    saveError,
    unsavedChanges,
    interacting: interactionActive,
  } = useEditorState();
  const dispatch = useEditorDispatch();
  const { seek } = usePlaybackControls();
  const [scale, setScale] = useState(40); // pixels per second
  const [preview, setPreview] = useState<Segment | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const grabOffset = useRef(0);
  const interacting = useRef(false);
  const seekGesture = useRef<{ x: number; y: number } | null>(null);
  const { ref, isDropTarget } = useDroppable({
    id: "timeline",
    disabled: !track || saving,
  });
  function setInteracting(active: boolean) {
    if (active) seekGesture.current = null;
    interacting.current = active;
    dispatch({ type: "interaction", active });
  }
  const duration = track?.durationMs ?? 0;
  const pixels = (ms: number) => (ms * scale) / 1000;

  function beginSeek(event: PointerEvent<HTMLDivElement>) {
    seekGesture.current = null;
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      interacting.current ||
      (event.target instanceof Element &&
        event.target.closest(".timeline-block, .timeline-preview"))
    )
      return;
    seekGesture.current = { x: event.clientX, y: event.clientY };
  }

  function cancelMovedSeek(event: PointerEvent<HTMLDivElement>) {
    const gesture = seekGesture.current;
    if (
      gesture &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4
    )
      seekGesture.current = null;
  }

  function seekFromClick(event: MouseEvent<HTMLDivElement>) {
    const gesture = seekGesture.current;
    seekGesture.current = null;
    if (!track || !gesture || interacting.current || event.defaultPrevented)
      return;
    // The canvas rectangle moves with horizontal scrolling, so this offset is
    // already relative to the entire track rather than the visible viewport.
    const offset =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    const positionMs = Math.round((offset * 1000) / scale);
    seek(Math.max(0, Math.min(duration, positionMs)));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      )
        return;
      const key = event.key.toLowerCase();
      const action =
        key === "z"
          ? event.shiftKey
            ? "redo"
            : "undo"
          : key === "y" && !event.shiftKey
            ? "redo"
            : null;
      if (!action) return;
      event.preventDefault();
      if (!interacting.current) dispatch({ type: action });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  function candidate(event: Pick<DragMoveEvent, "operation">): Segment | null {
    const source = event.operation.source;
    if (
      !canvas.current ||
      !source ||
      !track ||
      event.operation.target?.id !== "timeline"
    )
      return null;
    const lineId = String(source.data.lineId);
    const current = track.segments.find((s) => s.line_id === lineId);
    const start = Math.round(
      ((event.operation.position.current.x -
        canvas.current.getBoundingClientRect().left -
        grabOffset.current) *
        1000) /
        scale,
    );
    return {
      line_id: lineId,
      start_ms: start,
      end_ms:
        start +
        (source.data.kind === "segment" && current
          ? current.end_ms - current.start_ms
          : DEFAULT_DURATION_MS),
    };
  }

  useDragDropMonitor({
    onBeforeDragStart(event) {
      if (saving) {
        event.preventDefault();
        return;
      }
      if (
        event.operation.source?.data.kind === "lyric" &&
        track?.segments.some(
          (s) => s.line_id === event.operation.source?.data.lineId,
        )
      )
        event.preventDefault();
    },
    onDragStart(event) {
      setInteracting(true);
      const source = event.operation.source;
      const segment = track?.segments.find(
        (s) => s.line_id === source?.data.lineId,
      );
      grabOffset.current =
        source?.data.kind === "segment" && segment && canvas.current
          ? event.operation.position.initial.x -
            canvas.current.getBoundingClientRect().left -
            pixels(segment.start_ms)
          : 0;
    },
    onDragMove(event) {
      setPreview(candidate(event));
    },
    onDragOver(event) {
      setPreview(candidate(event));
    },
    onDragEnd(event) {
      setInteracting(false);
      const next = candidate(event);
      setPreview(null);
      if (event.canceled || !next) return;
      dispatch({
        type:
          event.operation.source?.data.kind === "segment"
            ? "moveSegment"
            : "insertSegment",
        lineId: next.line_id,
        startMs: next.start_ms,
      });
    },
  });

  const previewResult =
    preview && track ? placeSegment(track.segments, preview, duration) : null;
  const displayed = previewResult?.segments ?? track?.segments ?? [];
  const tickStep = scale >= 40 ? 5000 : 10000;
  const ticks = Array.from(
    { length: Math.ceil(duration / tickStep) },
    (_, i) => i * tickStep,
  );

  return (
    <section
      aria-labelledby="timeline-heading"
      className="flex min-w-0 flex-1 flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <h2 id="timeline-heading" className="m-0">
            Timeline
          </h2>
          {track ? (
            <span
              role="status"
              className={
                unsavedChanges && !saving
                  ? "rounded-md border border-(--color-danger) bg-(--color-danger-bg) px-2.5 py-1 text-sm font-medium text-(--color-danger)"
                  : "text-sm text-(--color-text-muted)"
              }
            >
              {saving ? "Saving…" : unsavedChanges ? "Unsaved changes" : ""}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!track || saving || !past.length}
            title="Undo (Ctrl+Z / ⌘Z)"
            aria-keyshortcuts="Control+z Meta+z"
            onClick={() => {
              if (!interacting.current) dispatch({ type: "undo" });
            }}
          >
            Undo
          </Button>
          <Button
            disabled={!track || saving || !future.length}
            title="Redo (Ctrl+Y / Ctrl+Shift+Z / ⌘⇧Z)"
            aria-keyshortcuts="Control+y Control+Shift+z Meta+Shift+z"
            onClick={() => {
              if (!interacting.current) dispatch({ type: "redo" });
            }}
          >
            Redo
          </Button>
          <Button
            color="primary"
            loading={saving}
            disabled={!track || !unsavedChanges || saving || interactionActive}
            onClick={() => {
              if (!interacting.current) dispatch({ type: "saveStart" });
            }}
          >
            Save
          </Button>

          <Button
            disabled={scale <= 20}
            aria-label="Zoom out"
            onClick={() => setScale((s) => s / 2)}
            title="Zoom timeline out"
          >
            −
          </Button>
          <Button
            disabled={scale >= 160}
            aria-label="Zoom in"
            onClick={() => setScale((s) => s * 2)}
            title="Zoom timeline in"
          >
            +
          </Button>
        </div>
      </div>
      <div
        className="timeline-scroll shrink-0"
        aria-label="Scrollable timeline"
        tabIndex={0}
      >
        <div
          ref={(element) => {
            canvas.current = element;
            ref(element);
          }}
          data-testid="timeline-track"
          onPointerDownCapture={beginSeek}
          onPointerMoveCapture={cancelMovedSeek}
          onPointerCancelCapture={() => {
            seekGesture.current = null;
          }}
          onClick={seekFromClick}
          className={`timeline-track ${isDropTarget ? "timeline-active" : ""}`}
          style={{ width: Math.max(1, pixels(duration)) }}
        >
          <div className="timeline-ruler" aria-hidden="true">
            {ticks.map((ms) => (
              <span key={ms} style={{ left: pixels(ms) }}>
                {formatTime(ms)}
              </span>
            ))}
            <span className="timeline-end" style={{ left: pixels(duration) }}>
              {formatTime(duration)}
            </span>
          </div>
          {!displayed.length ? (
            <p className="timeline-hint">
              Drag a lyric here, or click an untimed lyric to stamp it at playback time.
            </p>
          ) : null}
          {displayed.map((segment) => (
            <LyricBlock
              key={segment.line_id}
              segment={
                segment.line_id === preview?.line_id
                  ? (track!.segments.find(
                      (s) => s.line_id === segment.line_id,
                    ) ?? segment)
                  : segment
              }
              scale={scale}
              text={
                track?.lines.find((line) => line.id === segment.line_id)
                  ?.text ?? ""
              }
              selected={selectedLineId === segment.line_id}
              onPreview={setPreview}
              onInteractionChange={setInteracting}
            />
          ))}
          {preview ? (
            <div
              className={`timeline-preview ${previewResult?.error ? "timeline-invalid" : ""}`}
              style={{
                left: pixels(preview.start_ms),
                width: pixels(preview.end_ms - preview.start_ms),
              }}
            >
              {formatTime(preview.start_ms, true)} –{" "}
              {formatTime(preview.end_ms, true)}
            </div>
          ) : null}
          {track ? (
            <TimelinePlayhead scale={scale} durationMs={duration} />
          ) : null}
        </div>
      </div>
      <PlaybackSeek durationMs={duration} />
      <StampControls />
      <p className="m-0 text-xs">
        {track?.segments.length ?? 0} placed segments · Drag to move; resize
        either edge. Arrow keys adjust blocks by 100 ms; Shift by 1 second.
        Click the ruler or empty space to seek, or use the playback slider.
      </p>
      {saveError ? (
        <p role="alert" className="input-error">
          {saveError}
        </p>
      ) : null}
      {timingError ? (
        <p role="alert" className="input-error">
          {timingError}
        </p>
      ) : null}
      {previewResult?.error ? (
        <p role="status" className="input-error">
          {previewResult.error}
        </p>
      ) : null}
    </section>
  );
}
