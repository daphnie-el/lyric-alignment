import { badRequest } from './http.js';

const isInt = (v) => Number.isInteger(v);

function lineId(v, where) {
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  throw badRequest('invalid_line_id', `${where} must be a non-empty string or an integer`);
}

/**
 * Shape validation, and nothing beyond it. Returns a normalised body.
 *
 * What this rejects is malformed - a missing version, a segment pointing at a
 * line that is not in the request, seconds where milliseconds belong. Every one
 * of those answers 400 with a hint that says what to send instead.
 *
 * What this deliberately does *not* reject: overlapping segments, segments
 * whose order disagrees with the line order, gaps in the line indexes, lines
 * with no segment, segments past the end of the audio. Those are all editorial
 * questions, and the client is a better place to answer them than a fixture
 * server. If you want them enforced, the code is yours - add them here.
 */
export function parsePutBody(body) {
  if (typeof body.track_id !== 'string' || !body.track_id.trim()) {
    throw badRequest('invalid_track_id', 'send the string "track_id" from GET /api/v1/track');
  }
  if (!isInt(body.version) || body.version < 0) {
    throw badRequest('invalid_version', 'send the integer "version" you last read from GET /api/v1/track; it is 0 before anything has been saved');
  }
  if (!Array.isArray(body.lines)) {
    throw badRequest('invalid_lines', '"lines" must be an array of { id, index, text }');
  }
  if (!Array.isArray(body.segments)) {
    throw badRequest('invalid_segments', '"segments" must be an array of { line_id, start_ms, end_ms }');
  }

  const lines = body.lines.map((l, i) => {
    if (l === null || typeof l !== 'object' || Array.isArray(l)) {
      throw badRequest('invalid_lines', `lines[${i}] must be an object { id, index, text }`);
    }
    if (typeof l.text !== 'string') throw badRequest('invalid_lines', `lines[${i}].text must be a string`);
    if (!isInt(l.index) || l.index < 0) throw badRequest('invalid_lines', `lines[${i}].index must be a non-negative integer`);
    return { id: lineId(l.id, `lines[${i}].id`), index: l.index, text: l.text };
  });

  // Unique ids, because a line is stored under its id and two lines sharing one
  // would mean the second silently replacing the first.
  const seenIds = new Set();
  for (const l of lines) {
    if (seenIds.has(l.id)) throw badRequest('duplicate_line_id', `line id "${l.id}" appears more than once; ids must be unique within the request`);
    seenIds.add(l.id);
  }

  const segments = body.segments.map((s, i) => {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      throw badRequest('invalid_segments', `segments[${i}] must be an object { line_id, start_ms, end_ms }`);
    }
    const id = lineId(s.line_id, `segments[${i}].line_id`);
    if (!isInt(s.start_ms) || !isInt(s.end_ms)) {
      throw badRequest('invalid_segment_times', `segments[${i}] start_ms and end_ms must be integer milliseconds; duration_seconds is a float but segment times are not`);
    }
    if (s.start_ms < 0) throw badRequest('invalid_segment_times', `segments[${i}].start_ms must not be negative`);
    if (s.end_ms <= s.start_ms) throw badRequest('invalid_segment_times', `segments[${i}].end_ms must be greater than start_ms`);
    if (!seenIds.has(id)) {
      throw badRequest('unknown_line_id', `segments[${i}].line_id "${id}" is not in the "lines" array of this request`);
    }
    return { line_id: id, start_ms: s.start_ms, end_ms: s.end_ms };
  });

  // One segment per line: the table stores them keyed by line id, so two
  // segments for one line have nowhere to both live.
  const seenSeg = new Set();
  for (const s of segments) {
    if (seenSeg.has(s.line_id)) throw badRequest('duplicate_segment', `more than one segment references line "${s.line_id}"; a line carries at most one segment`);
    seenSeg.add(s.line_id);
  }

  return { version: body.version, lines, segments };
}
