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
import { useEditorDispatch, useEditorState } from "../context/EditorContext";
import { usePlaybackControls } from "../context/PlaybackContext";
import { formatTime } from "../utils/formatTime";
import { moveSegments, placeSegment } from "../utils/timing";
import { DEFAULT_DURATION_MS, Segment } from "../utils/types";
import LyricBlock from "./LyricBlock";
import StampControls from "./StampControls";
import TimelinePlayhead from "./TimelinePlayhead";
import TrackEmptyState from "./TrackEmptyState";

export default function Timeline() {
  const {
    track,
    selectedTimelineIds,
    timingError,
    past,
    future,
    saving,
    editingLocked,
    saveError,
    unsavedChanges,
    interacting: interactionActive,
  } = useEditorState();
  const dispatch = useEditorDispatch();
  const { seek } = usePlaybackControls();
  const [scale, setScale] = useState(40); // pixels per second
  const [preview, setPreview] = useState<Segment | null>(null);
  const [dragLineIds, setDragLineIds] = useState<string[]>([]);
  const canvas = useRef<HTMLDivElement | null>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const grabOffset = useRef(0);
  const interacting = useRef(false);
  const seekGesture = useRef<{ x: number; y: number } | null>(null);
  const { ref, isDropTarget } = useDroppable({
    id: "timeline",
    disabled: !track || editingLocked,
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
    dispatch({ type: "selectLine", id: null });
    seek(Math.max(0, Math.min(duration, positionMs)));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      )
        return;
      if (event.key === "Escape" && !interacting.current) {
        dispatch({ type: "selectLine", id: null });
        return;
      }
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
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
      if (editingLocked) {
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
      const ids =
        source?.data.kind === "segment" && segment
          ? selectedTimelineIds.includes(segment.line_id)
            ? selectedTimelineIds
            : [segment.line_id]
          : [];
      setDragLineIds(ids);
      if (
        segment &&
        source?.data.kind === "segment" &&
        !selectedTimelineIds.includes(segment.line_id)
      )
        dispatch({ type: "selectLine", id: segment.line_id });
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
      setDragLineIds([]);
      if (event.canceled || !next) return;
      if (dragLineIds.length > 1 && track) {
        const original = track.segments.find((s) => s.line_id === next.line_id);
        if (original)
          dispatch({
            type: "moveSegments",
            lineIds: dragLineIds,
            offsetMs: next.start_ms - original.start_ms,
          });
        return;
      }
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

  const groupPreview = preview && dragLineIds.length > 1;
  const original = track?.segments.find((s) => s.line_id === preview?.line_id);
  const offsetMs =
    preview && original ? preview.start_ms - original.start_ms : 0;
  const previewSegments = preview
    ? groupPreview
      ? (track?.segments ?? [])
          .filter((s) => dragLineIds.includes(s.line_id))
          .map((s) => ({
            ...s,
            start_ms: s.start_ms + offsetMs,
            end_ms: s.end_ms + offsetMs,
          }))
      : [preview]
    : [];
  const previewIds = new Set(previewSegments.map((s) => s.line_id));
  const previewResult =
    preview && track
      ? groupPreview
        ? moveSegments(track.segments, dragLineIds, offsetMs, duration)
        : placeSegment(track.segments, preview, duration)
      : null;
  const displayed = previewResult?.segments ?? track?.segments ?? [];
  const tickStep = scale >= 40 ? 5000 : 10000;
  const ticks = Array.from(
    { length: Math.ceil(duration / tickStep) },
    (_, i) => i * tickStep,
  );

  useEffect(() => {
    return () => {
      dispatch({ type: "interaction", active: false });
    };
  }, [dispatch]);

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
            disabled={!track || editingLocked || !past.length}
            title="Undo (Ctrl+Z / ⌘Z)"
            aria-keyshortcuts="Control+z Meta+z"
            onClick={() => {
              if (!interacting.current) dispatch({ type: "undo" });
            }}
          >
            Undo
          </Button>
          <Button
            disabled={!track || editingLocked || !future.length}
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
            className=""
            loading={saving}
            disabled={!track || !unsavedChanges || editingLocked || interactionActive}
            onClick={() => {
              if (!interacting.current) dispatch({ type: "saveStart" });
            }}
          >
            Save alignment
          </Button>

          <Button
            disabled={!track || scale <= 20}
            aria-label="Zoom out"
            onClick={() => setScale((s) => s / 2)}
            title="Zoom timeline out"
          >
            −
          </Button>
          <Button
            disabled={!track || scale >= 160}
            aria-label="Zoom in"
            onClick={() => setScale((s) => s * 2)}
            title="Zoom timeline in"
          >
            +
          </Button>
        </div>
      </div>
      {!track ? <TrackEmptyState /> : (
        <div
          className="timeline-scroll shrink-0"
          ref={scrollContainer}
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
                {track.lines.length
                  ? "Drag a lyric here, or select a lyric and use Stamp current time to place it at playback time."
                  : "Add lyrics to the lyric sheet and choose Add all lines. Then drag a lyric here or use Stamp current time."}
              </p>
            ) : null}
            {displayed.map((segment) => (
              <LyricBlock
                key={segment.line_id}
                segment={
                  previewIds.has(segment.line_id)
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
                selected={selectedTimelineIds.includes(segment.line_id)}
                onPreview={setPreview}
                onInteractionChange={setInteracting}
              />
            ))}
            {previewSegments.map((item) => (
              <div
                key={item.line_id}
                className={`timeline-preview ${previewResult?.error ? "timeline-invalid" : ""}`}
                style={{
                  left: pixels(item.start_ms),
                  width: pixels(item.end_ms - item.start_ms),
                }}
              >
                {formatTime(item.start_ms, true)} –{" "}
                {formatTime(item.end_ms, true)}
              </div>
            ))}
            {track ? (
              <TimelinePlayhead
                scale={scale}
                durationMs={duration}
                scrollContainer={scrollContainer}
              />
            ) : null}
          </div>
        </div>
      )}
      {/* <PlaybackSeek durationMs={duration} /> */}
      <StampControls />
      {track ? (
        <div className="border-t border-(--color-border) pt-3 text-xs text-(--color-text-muted)">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="rounded-md bg-(--color-elevated) px-2 py-1 font-medium text-(--color-text)">
              {track?.segments.length ?? 0} placed{" "}
              {track?.segments.length === 1 ? "segment" : "segments"}
            </span>
            <span>Drag to move · Pull an edge to resize</span>
          </div>
          <details className="mt-3">
            <summary className="w-fit cursor-pointer rounded-sm font-medium text-(--color-text) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-primary)">
              Timeline shortcuts
            </summary>
            <dl className="mb-0 mt-3 grid gap-x-6 gap-y-4 rounded-lg border border-(--color-border) bg-(--color-surface) p-4 sm:grid-cols-2">
              <div>
                <dt className="mb-1 font-medium text-(--color-text)">
                  Fine adjustments
                </dt>
                <dd className="m-0 leading-relaxed">
                  <kbd>←</kbd> <kbd>→</kbd> move a focused block by 100 ms. Hold{" "}
                  <kbd>Shift</kbd> for 1 second.
                </dd>
              </div>
              <div>
                <dt className="mb-1 font-medium text-(--color-text)">
                  Move a group
                </dt>
                <dd className="m-0 leading-relaxed">
                  <kbd>Shift</kbd> + click to toggle lines, then drag any selected
                  line. Spacing is preserved; other lines cannot overlap.
                </dd>
              </div>
              <div>
                <dt className="mb-1 font-medium text-(--color-text)">
                  Clear selection
                </dt>
                <dd className="m-0 leading-relaxed">
                  Press <kbd>Esc</kbd> to deselect all lines.
                </dd>
              </div>
              <div>
                <dt className="mb-1 font-medium text-(--color-text)">
                  Seek playback
                </dt>
                <dd className="m-0 leading-relaxed">
                  Click the ruler or empty timeline to seek and clear selection,
                  or use the playback slider.
                </dd>
              </div>
            </dl>
          </details>
        </div>
      ) : null}
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
