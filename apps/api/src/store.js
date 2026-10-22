import { getDb } from './db.js';

const segment = (row) => ({ line_id: String(row.line_id), start_ms: row.start_ms, end_ms: row.end_ms });

export function getTrack(trackId) {
  return trackId === undefined
    ? getDb().prepare('SELECT * FROM tracks ORDER BY id DESC LIMIT 1').get()
    : getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
}

/** Insert before deleting so a replacement always gets a different identity. */
export function replaceTrack({ title, duration_seconds, audio_url }) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = getTrack();
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO tracks (title, artist, duration_seconds, audio_url) VALUES (?, ?, ?, ?)',
    ).run(title, '', duration_seconds, audio_url);
    const id = Number(lastInsertRowid);
    db.prepare('DELETE FROM tracks WHERE id != ?').run(id);
    const track = getTrack(id);
    db.exec('COMMIT');
    return { track, previous };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function latestAlignment(trackId) {
  return getDb()
    .prepare('SELECT id, version FROM alignments WHERE track_id = ? ORDER BY version DESC LIMIT 1')
    .get(trackId);
}

/**
 * The track's current state. Before anything is saved, version is 0, the lines
 * are the seeded sheet, and there is no alignment. After a save, both the lines
 * and the segments come from that saved version - PUT carries lines, so each
 * version owns its own lyric sheet.
 */
export function currentState(trackId = getTrack()?.id) {
  const db = getDb();
  const latest = latestAlignment(trackId);

  if (!latest) {
    const lines = db
      .prepare('SELECT id, idx, text FROM lyric_lines WHERE track_id = ? ORDER BY idx')
      .all(trackId)
      .map((r) => ({ id: String(r.id), index: r.idx, text: r.text }));
    return { version: 0, lines, alignment: null };
  }

  const lines = db
    .prepare('SELECT line_id, idx, text FROM alignment_lines WHERE alignment_id = ? ORDER BY idx')
    .all(latest.id)
    .map((r) => ({ id: String(r.line_id), index: r.idx, text: r.text }));

  const segments = db
    .prepare('SELECT line_id, start_ms, end_ms FROM alignment_segments WHERE alignment_id = ? ORDER BY ord')
    .all(latest.id)
    .map(segment);

  return { version: latest.version, lines, alignment: { segments } };
}

/** Appends a new version. Caller has already validated and checked the version. */
export function saveAlignment(trackId, lines, segments) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const prev = latestAlignment(trackId);
    const version = (prev?.version ?? 0) + 1;

    const { lastInsertRowid } = db
      .prepare('INSERT INTO alignments (track_id, version, created_at) VALUES (?, ?, ?)')
      .run(trackId, version, new Date().toISOString());
    const alignmentId = Number(lastInsertRowid);

    const insLine = db.prepare('INSERT INTO alignment_lines (alignment_id, line_id, idx, text) VALUES (?, ?, ?, ?)');
    for (const l of lines) insLine.run(alignmentId, l.id, l.index, l.text);

    const insSeg = db.prepare('INSERT INTO alignment_segments (alignment_id, line_id, start_ms, end_ms, ord) VALUES (?, ?, ?, ?, ?)');
    segments.forEach((s, ord) => insSeg.run(alignmentId, s.line_id, s.start_ms, s.end_ms, ord));

    db.exec('COMMIT');
    return version;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
