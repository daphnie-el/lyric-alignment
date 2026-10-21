import { useDraggable } from "@dnd-kit/react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Segment } from "../utils/types";
import { useEditorDispatch, useEditorState } from "./EditorContext";
import { formatTime } from "./formatTime";
const LyricBlock = ({
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
}) => {
  const dispatch = useEditorDispatch();
  const { saving, interacting, selectedTimelineIds } = useEditorState();
  const grouped = selectedTimelineIds.length > 1;
  // Use the block as the activator so the sensor applies its movement threshold.
  // A dedicated handle activates immediately and consumes ordinary clicks.
  const { ref, isDragging, isDropping } = useDraggable({
    disabled: saving,
    id: `segment-${segment.line_id}`,
    data: { kind: "segment", lineId: segment.line_id, text },
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
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
      data-testid={`segment-${segment.line_id}`}
      className={`timeline-block ${selected ? "timeline-selected" : ""}`}
      style={{
        left: (segment.start_ms * scale) / 1000,
        width: ((segment.end_ms - segment.start_ms) * scale) / 1000,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <button
        ref={ref}
        disabled={saving}
        className="timeline-block-body"
        aria-label={`Move ${text}`}
        aria-current={selected}
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          const moved =
            event.detail > 0 &&
            start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
          if (!moved && !isDragging && !isDropping)
            dispatch({
              type: event.shiftKey ? "toggleTimelineLine" : "selectLine",
              id: segment.line_id,
            });
        }}
        onKeyDown={(event) => {
          if (
            (event.key === "Delete" || event.key === "Backspace") &&
            selected
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (
              !saving &&
              !interacting &&
              !isDragging &&
              !isDropping &&
              !gesture.current &&
              !event.nativeEvent.isComposing
            )
              dispatch({
                type: "removeSegments",
                lineIds: selectedTimelineIds,
              });
            return;
          }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          const offsetMs =
            (event.key === "ArrowRight" ? 1 : -1) *
            (event.shiftKey ? 1000 : 100);
          if (grouped && selected) {
            dispatch({
              type: "moveSegments",
              lineIds: selectedTimelineIds,
              offsetMs,
            });
            return;
          }
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
          disabled={saving || grouped}
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
};

export default LyricBlock;
