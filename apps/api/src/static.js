import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { PUBLIC_DIR } from './config.js';
import { notFound } from './http.js';
import { uploadedFilePath, UPLOAD_PREFIX } from './uploads.js';

const TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

function pipeAudio(file, res, options) {
  const stream = createReadStream(file, options);
  // Replacement can unlink a previous upload between stat and open.
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

/**
 * Serves the fixture audio. Unauthenticated on purpose: an <audio> element
 * cannot attach an Authorization header, so gating this would make the track
 * unplayable. Not part of the /api/v1 surface - it is an asset, not an endpoint.
 * Range requests are honoured so seeking around the file actually works.
 */
export function serveAudio(req, res, relPath) {
  const root = resolve(PUBLIC_DIR, 'audio');
  const file = relPath.startsWith('uploads/')
    ? uploadedFilePath(`${UPLOAD_PREFIX}${relPath.slice('uploads/'.length)}`)
    : resolve(root, relPath);
  if (!file || (!relPath.startsWith('uploads/') && !file.startsWith(root + sep))) throw notFound('no such asset');

  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    throw notFound('no such audio asset');
  }

  const type = TYPES[extname(file)] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const suffix = !m[1] && !!m[2];
      const start = suffix ? Math.max(0, stat.size - Number(m[2])) : Number(m[1] || 0);
      const end = !suffix && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if ((!m[1] && !m[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'public, max-age=3600',
      });
      return pipeAudio(file, res, { start, end });
    }
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  });
  pipeAudio(file, res);
}
