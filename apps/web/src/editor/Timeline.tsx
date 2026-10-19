import {
  useDragDropMonitor,
  useDraggable,
  useDroppable,
  type DragMoveEvent,
} from "@dnd-kit/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "../components/Button";
import {
  useEditorDispatch,
  useEditorState,
  type Segment,
} from "./EditorContext";
import { formatTime } from "./formatTime";
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
  const [scale, setScale] = useState(40); // pixels per second
  const [preview, setPreview] = useState<Segment | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const grabOffset = useRef(0);
  const interacting = useRef(false);
  const { ref, isDropTarget } = useDroppable({
    id: "timeline",
    disabled: !track || saving,
  });
  function setInteracting(active: boolean) {
    interacting.current = active;
    dispatch({ type: "interaction", active });
  }
  const duration = track?.durationMs ?? 0;
  const pixels = (ms: number) => (ms * scale) / 1000;

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
      className="flex min-h-80 min-w-0 flex-1 flex-col gap-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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
              {saving
                ? "Saving…"
                : unsavedChanges
                  ? "Unsaved changes"
                  : "All changes saved"}
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
            loadingText="Saving…"
            disabled={!track || !unsavedChanges || saving || interactionActive}
            onClick={() => {
              if (!interacting.current) dispatch({ type: "saveStart" });
            }}
          >
            Save
          </Button>
          <span className="text-sm text-(--color-text-muted)">Zoom</span>
          <Button
            disabled={scale <= 20}
            aria-label="Zoom out"
            onClick={() => setScale((s) => s / 2)}
          >
            −
          </Button>
          <Button
            disabled={scale >= 160}
            aria-label="Zoom in"
            onClick={() => setScale((s) => s * 2)}
          >
            +
          </Button>
        </div>
      </div>
      <div
        className="timeline-scroll"
        aria-label="Scrollable timeline"
        tabIndex={0}
      >
        <div
          ref={(element) => {
            canvas.current = element;
            ref(element);
          }}
          data-testid="timeline-track"
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
              Drag a lyric here or click a lyric to add it.
            </p>
          ) : null}
          {displayed.map((segment) => (
            <TimelineBlock
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
        </div>
      </div>
      <p className="m-0 text-xs">
        {track?.segments.length ?? 0} placed segments · Drag to move; resize
        either edge. Arrow keys adjust by 100 ms; Shift by 1 second.
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

function TimelineBlock({
  segment,
  text,
  selected,
  scale,
  onPreview,
  onInteractionChange,
}: {
  segment: Segment;
  text: string;
  selected: boolean;
  scale: number;
  onPreview: (segment: Segment | null) => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const dispatch = useEditorDispatch();
  const { saving } = useEditorState();
  const { ref, handleRef, isDragging, isDropping } = useDraggable({
    disabled: saving,
    id: `segment-${segment.line_id}`,
    data: { kind: "segment", lineId: segment.line_id, text },
  });
  const gesture = useRef<{
    x: number;
    value: number;
    next: number;
    field: "start_ms" | "end_ms";
  } | null>(null);
  const resize = (field: "start_ms" | "end_ms", value: number) =>
    dispatch({ type: "resizeSegment", lineId: segment.line_id, field, value });

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active) return;
    active.next =
      active.value + Math.round(((event.clientX - active.x) * 1000) / scale);
    onPreview({ ...segment, [active.field]: active.next });
  }
  function cancel() {
    gesture.current = null;
    onPreview(null);
    onInteractionChange(false);
  }

  return (
    <div
      ref={ref}
      data-testid={`segment-${segment.line_id}`}
      className={`timeline-block ${selected ? "timeline-selected" : ""}`}
      style={{
        left: (segment.start_ms * scale) / 1000,
        width: ((segment.end_ms - segment.start_ms) * scale) / 1000,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <button
        disabled={saving}
        ref={handleRef}
        className="timeline-block-body"
        aria-label={`Move ${text}`}
        aria-pressed={selected}
        onClick={() => {
          if (!isDragging && !isDropping)
            dispatch({ type: "selectLine", id: segment.line_id });
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          dispatch({
            type: "moveSegment",
            lineId: segment.line_id,
            startMs:
              segment.start_ms +
              (event.key === "ArrowRight" ? 1 : -1) *
                (event.shiftKey ? 1000 : 100),
          });
        }}
      >
        <span>{text}</span>
        <small>
          {formatTime(segment.start_ms, true)} –{" "}
          {formatTime(segment.end_ms, true)}
        </small>
      </button>
      {(["start_ms", "end_ms"] as const).map((field) => (
        <button
          disabled={saving}
          key={field}
          className={`timeline-resize ${field === "start_ms" ? "timeline-left" : "timeline-right"}`}
          aria-label={`Resize ${field === "start_ms" ? "start" : "end"} of ${text}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current = {
              x: event.clientX,
              value: segment[field],
              next: segment[field],
              field,
            };
            onInteractionChange(true);
            dispatch({ type: "selectLine", id: segment.line_id });
          }}
          onPointerMove={move}
          onPointerUp={(event) => {
            const active = gesture.current;
            if (!active) return;
            move(event);
            resize(active.field, active.next);
            cancel();
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.stopPropagation();
            resize(
              field,
              segment[field] +
                (event.key === "ArrowRight" ? 1 : -1) *
                  (event.shiftKey ? 1000 : 100),
            );
          }}
        />
      ))}
    </div>
  );
}
