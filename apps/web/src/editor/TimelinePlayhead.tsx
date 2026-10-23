import { useEffect, useLayoutEffect, useRef, type RefObject, type PointerEvent } from "react";
import { usePlaybackControls, usePlaybackState } from "../context/PlaybackContext";
import { formatTime } from "../utils/formatTime";

function keepVisible(container: HTMLDivElement, positionPx: number) {
  const { clientWidth, scrollLeft, scrollWidth } = container;
  if (!clientWidth) return;
  const margin = 64;
  let next = scrollLeft;
  if (positionPx < scrollLeft + margin) next = positionPx - margin;
  else if (positionPx + 2 > scrollLeft + clientWidth - margin)
    next = positionPx + 2 + margin - clientWidth;
  next = Math.max(0, Math.min(scrollWidth - clientWidth, next));
  if (next !== scrollLeft) container.scrollLeft = next;
}

export default function TimelinePlayhead({
  scale,
  durationMs,
  scrollContainer,
}: {
  scale: number;
  durationMs: number;
  scrollContainer: RefObject<HTMLDivElement>;
}) {
  const { positionMs, ready, scrubbing } = usePlaybackState();
  const { seek, beginScrub, endScrub, cancelScrub, getSnapshot } = usePlaybackControls();
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const position = Math.min(positionMs, durationMs);
  const positionPx = (position * scale) / 1000;
  const latestPosition = useRef(positionPx);

  useEffect(() => () => { cancelScrub(); }, [cancelScrub]);

  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !getSnapshot().scrubbing) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const x = event.clientX - track.getBoundingClientRect().left - gesture.offset;
    seek(Math.max(0, Math.min(durationMs, Math.round(x * 1000 / scale))));
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    endScrub();
  }

  useLayoutEffect(() => {
    latestPosition.current = positionPx;
    if (scrollContainer.current)
      keepVisible(scrollContainer.current, positionPx);
  }, [positionPx, scale, durationMs, scrollContainer]);

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      keepVisible(container, latestPosition.current);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainer]);

  return (
    <div
      className="timeline-playhead"
      data-testid="timeline-playhead"
      data-scrubbing={scrubbing}
      role="slider"
      aria-label="Playback position"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={position}
      aria-valuetext={formatTime(position, true)}
      aria-disabled={!ready}
      tabIndex={ready ? 0 : -1}
      style={{ transform: `translateX(${positionPx}px)` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || !beginScrub()) return;
        event.preventDefault();
        const track = event.currentTarget.parentElement!;
        drag.current = {
          pointerId: event.pointerId,
          offset: event.clientX - track.getBoundingClientRect().left - positionPx,
        };
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={(event) => { move(event); finish(event); }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!ready || drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
        let next: number;
        switch (event.key) {
          case "ArrowLeft": case "ArrowDown": next = position - 100; break;
          case "ArrowRight": case "ArrowUp": next = position + 100; break;
          case "Home": next = 0; break;
          case "End": next = durationMs; break;
          default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        seek(next);
      }}
    />
  );
}
