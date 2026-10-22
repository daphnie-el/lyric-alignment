import { Segment, TimingResult } from "../utils/types";

export function timingError(
  segment: Segment,
  durationMs: number,
): string | undefined {
  if (
    !Number.isInteger(segment.start_ms) ||
    !Number.isInteger(segment.end_ms) ||
    segment.start_ms < 0
  )
    return "Lyrics cannot start before the song begins.";
  if (segment.end_ms <= segment.start_ms) return "End must be after Start.";
  if (segment.end_ms > durationMs)
    return "Lyrics cannot extend past the end of the song.";
}

export function normalizeSegments(
  segments: Segment[],
  durationMs: number,
  lineIds: Set<string>,
): TimingResult {
  const seen = new Set<string>();
  for (const segment of segments) {
    if (!lineIds.has(segment.line_id))
      return { error: "Alignment references an unknown lyric." };
    if (seen.has(segment.line_id))
      return { error: "Alignment contains duplicate lyrics." };
    seen.add(segment.line_id);
    const error = timingError(segment, durationMs);
    if (error) return { error };
  }
  let end = 0;
  const result = [...segments]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((segment) => {
      const start = Math.max(end, segment.start_ms);
      end = start + segment.end_ms - segment.start_ms;
      return { ...segment, start_ms: start, end_ms: end };
    });
  return end > durationMs
    ? { error: "These lyrics cannot fit within the track duration." }
    : { segments: result };
}

// The edited block takes priority. Earlier blocks that intersect it join the
// forward ripple; blocks ending before it and gaps farther ahead stay intact.
export function placeSegment(
  segments: Segment[],
  candidate: Segment,
  durationMs: number,
): TimingResult {
  const error = timingError(candidate, durationMs);
  if (error) return { error };
  const others = segments
    .filter((s) => s.line_id !== candidate.line_id)
    .sort((a, b) => a.start_ms - b.start_ms);
  const before = others.filter((s) => s.end_ms <= candidate.start_ms);
  const after = others.filter((s) => s.end_ms > candidate.start_ms);
  let end = candidate.end_ms;
  const shifted = after.map((segment) => {
    const start = Math.max(segment.start_ms, end);
    end = start + segment.end_ms - segment.start_ms;
    return { ...segment, start_ms: start, end_ms: end };
  });
  return end > durationMs
    ? { error: "These lyrics cannot fit within the track duration." }
    : { segments: [...before, candidate, ...shifted] };
}

// Sheet order defines neighbors, including when lyrics are stamped out of order.
// Linear scans keep this O(lines + segments), without changing the inputs.
export function stampSegment(
  segments: readonly Segment[],
  orderedLineIds: readonly string[],
  lineId: string,
  startMs: number,
  durationMs: number,
): TimingResult {
  if (!Number.isInteger(startMs) || startMs < 0 || startMs >= durationMs)
    return { error: "Stamp before the end of the track." };
  if (!orderedLineIds.includes(lineId))
    return { error: "This lyric is not in the lyric sheet." };

  const byId = new Map(segments.map((segment) => [segment.line_id, segment]));
  const result: Segment[] = [];
  let targetIndex = -1;
  for (const id of orderedLineIds) {
    if (id === lineId) {
      targetIndex = result.length;
      result.push({ line_id: lineId, start_ms: startMs, end_ms: durationMs });
    } else {
      const segment = byId.get(id);
      if (segment) result.push(segment);
    }
  }

  const previous = result[targetIndex - 1];
  const next = result[targetIndex + 1];
  if (previous) {
    if (startMs - previous.start_ms < 2)
      return {
        error: "Stamp at least 2 ms after the previous timed lyric's start.",
      };
    result[targetIndex - 1] = { ...previous, end_ms: startMs - 1 };
  }
  if (next) {
    if (next.start_ms - startMs < 2)
      return {
        error: "Stamp at least 2 ms before the next timed lyric's start.",
      };
    result[targetIndex] = { ...result[targetIndex], end_ms: next.start_ms - 1 };
  }

  // Manual edits may have changed sheet order. Reject conflicts rather than
  // moving other starts or repairing saved alignments as a side effect.
  for (let index = 0; index < result.length; index += 1) {
    const segment = result[index];
    const error = timingError(segment, durationMs);
    if (error) return { error };
    if (index > 0 && segment.start_ms < result[index - 1].end_ms)
      return {
        error: "Stamp times must follow lyric-sheet order without overlaps.",
      };
  }
  return { segments: result };
}

// Move a temporary selection as one rigid group without disturbing other lines.
export function moveSegments(
  segments: readonly Segment[],
  lineIds: readonly string[],
  offsetMs: number,
  durationMs: number,
): TimingResult {
  if (!Number.isSafeInteger(offsetMs))
    return { error: "Move lyrics by a whole number of milliseconds." };
  const selected = new Set(lineIds);
  if (
    !selected.size ||
    [...selected].some((id) => !segments.some((s) => s.line_id === id))
  )
    return { error: "Select placed lyrics to move." };
  const result = segments
    .map((segment) =>
      selected.has(segment.line_id)
        ? {
            ...segment,
            start_ms: segment.start_ms + offsetMs,
            end_ms: segment.end_ms + offsetMs,
          }
        : segment,
    )
    .sort((a, b) => a.start_ms - b.start_ms);
  for (let index = 0; index < result.length; index += 1) {
    const error = timingError(result[index], durationMs);
    if (error) return { error };
    if (index > 0 && result[index].start_ms < result[index - 1].end_ms)
      return {
        error:
          "Selected lyrics would overlap another line. Move them into a free space.",
      };
  }
  return { segments: result };
}
