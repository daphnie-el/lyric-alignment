import { useLayoutEffect, useRef, type RefObject } from "react";
import { usePlaybackState } from "../context/PlaybackContext";

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
  const { positionMs } = usePlaybackState();
  const position = Math.min(positionMs, durationMs);
  const positionPx = (position * scale) / 1000;
  const latestPosition = useRef(positionPx);

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
      aria-hidden="true"
      style={{ transform: `translateX(${positionPx}px)` }}
    />
  );
}
