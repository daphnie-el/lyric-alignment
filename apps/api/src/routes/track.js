import { basename, extname } from 'node:path';
import { send, HttpError, badRequest, readJsonBody } from '../http.js';
import { getTrack, currentState, replaceTrack } from '../store.js';
import { readAudioUpload, removeUpload, uploadedFilePath } from '../uploads.js';

function payload(track) {
  return {
    id: String(track.id), title: track.title, artist: track.artist,
    duration_seconds: track.duration_seconds, audio_url: track.audio_url,
    ...currentState(track.id),
  };
}

/** Everything a client needs in one payload. */
export function getTrackPayload(_req, res) {
  const track = getTrack();
  if (!track) throw new HttpError(404, { error: 'no_current_track', hint: 'Load a song from your device or a direct audio URL.' });
  send(res, 200, payload(track));
}

function parseMetadata(body, multipart) {
  const duration = multipart && typeof body.duration_seconds === 'string' && body.duration_seconds.trim()
    ? Number(body.duration_seconds) : body.duration_seconds;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > Number.MAX_SAFE_INTEGER / 1000) {
    throw badRequest('invalid_duration', 'duration_seconds must be a finite positive number from the audio metadata.');
  }
  // eslint-disable-next-line no-control-regex
  const controlCharacters = /[\u0000-\u001f]/;
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length > 255 || controlCharacters.test(body.title))) {
    throw badRequest('invalid_title', 'title must be text of at most 255 characters without control characters.');
  }
  let filename = body.filename;
  if (!multipart) {
    let url;
    try { url = new URL(body.audio_url); } catch {
      throw badRequest('invalid_audio_url', 'Enter a direct HTTP or HTTPS audio URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw badRequest('invalid_audio_url', 'Use an HTTP or HTTPS audio URL without embedded credentials.');
    }
    body.audio_url = url.href;
    try { filename = decodeURIComponent(url.pathname.split('/').at(-1)); } catch { filename = ''; }
  }
  const fallback = basename((filename || '').replaceAll('\\', '/'), extname(filename || '')).replace(new RegExp(controlCharacters, 'g'), '').trim();
  return { title: body.title?.trim() || fallback.slice(0, 255) || 'Untitled song', duration_seconds: duration, audio_url: body.audio_url };
}

export async function postTrack(req, res) {
  let uploadedUrl;
  let committed = false;
  try {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const multipart = type === 'multipart/form-data';
    if (!multipart && type !== 'application/json') {
      throw new HttpError(415, { error: 'unsupported_media_type', hint: 'Send application/json for a URL or multipart/form-data for a file.' });
    }
    const body = multipart ? await readAudioUpload(req) : await readJsonBody(req);
    if (multipart) uploadedUrl = body.audio_url;
    const metadata = parseMetadata(body, multipart);
    if (!multipart) {
      const current = getTrack();
      const source = new URL(metadata.audio_url);
      // Origin preserves the browser origin behind the development proxy,
      // which rewrites Host. Direct API clients use the request's own origin.
      const origins = [req.headers.origin, `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`];
      const sameOrigin = origins.some((origin) => {
        try { return new URL(origin).origin === source.origin; } catch { return false; }
      });
      if (sameOrigin && uploadedFilePath(current?.audio_url) && source.pathname === current.audio_url) {
        // Keep owned audio in its canonical form so a later replacement can
        // still identify and remove it. Reusing it resets lyrics as usual.
        metadata.audio_url = current.audio_url;
        if (!body.title?.trim()) metadata.title = current.title;
      }
    }
    const { track, previous } = replaceTrack(metadata);
    committed = true;
    const result = payload(track);
    // Only recognizes generated upload URLs, never bundled audio or remote URLs.
    if (previous?.audio_url !== track.audio_url) await removeUpload(previous?.audio_url);
    send(res, 201, result);
  } catch (error) {
    if (!committed) await removeUpload(uploadedUrl);
    if (error instanceof HttpError) throw error;
    console.error('Could not store track:', error);
    throw new HttpError(500, { error: 'track_storage_failed', hint: 'Could not store the song. Check available storage and try again.' });
  }
}
