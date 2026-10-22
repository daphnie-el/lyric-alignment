import { send, readJsonBody, HttpError } from '../http.js';
import { getTrack, currentState, saveAlignment } from '../store.js';
import { parsePutBody } from '../validate.js';

/**
 * Carries lines as well as segments, so pasting a sheet, adding a line, and
 * splitting or merging all persist through this one call.
 *
 * Two ways to fail, in this order: shape (400, hinted), then a stale version
 * (409, which hands back the server's current state). Nothing else is policed -
 * segments may overlap, sit in any order, or leave lines untimed. Whether that
 * is a good idea is the client's call to make, not this server's.
 */
export async function putAlignment(req, res) {
  const raw = await readJsonBody(req);
  const { version, lines, segments } = parsePutBody(raw);
  // Read after the await: a replacement may have committed while reading input.
  const track = getTrack();
  if (!track) throw new HttpError(404, { error: 'no_current_track', hint: 'Load a song first.' });
  if (raw.track_id !== String(track.id)) {
    throw new HttpError(409, { error: 'track_conflict', hint: 'The current song changed. Reload before saving.', track_id: String(track.id) });
  }

  const state = currentState(track.id);
  if (version !== state.version) {
    // Carries the server's current state, so a client that has fallen behind
    // can reconcile without a second round trip.
    throw new HttpError(409, {
      error: 'version_conflict',
      expected_version: state.version,
      received_version: version,
      version: state.version,
      lines: state.lines,
      alignment: state.alignment,
    });
  }

  const newVersion = saveAlignment(track.id, lines, segments);
  const saved = currentState(track.id);

  send(res, 200, { version: newVersion, lines: saved.lines, alignment: saved.alignment });
}
