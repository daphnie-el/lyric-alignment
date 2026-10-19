export type Segment = { line_id: string; start_ms: number; end_ms: number };
export const DEFAULT_DURATION_MS = 3000;
export type TimingResult =
  | { segments: Segment[]; error?: never }
  | { error: string; segments?: never };

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
