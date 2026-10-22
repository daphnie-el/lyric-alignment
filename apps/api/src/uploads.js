import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MAX_AUDIO_BYTES, UPLOAD_DIR } from './config.js';
import { badRequest, HttpError } from './http.js';

const TYPES = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const GENERATED_FILE = /^[0-9a-f-]{36}\.(mp3|wav|ogg|m4a)$/;
export const UPLOAD_PREFIX = '/api/audio/uploads/';

export function audioExtension(filename) {
  const extension = extname(filename).toLowerCase();
  if (!TYPES.has(extension)) {
    throw badRequest('unsupported_audio', 'Choose an MP3, WAV, Ogg, or M4A audio file.');
  }
  return extension;
}

export function uploadedFilePath(url) {
  if (!url?.startsWith(UPLOAD_PREFIX)) return null;
  const name = url.slice(UPLOAD_PREFIX.length);
  return GENERATED_FILE.test(name) ? join(UPLOAD_DIR, name) : null;
}

export async function removeUpload(url) {
  const path = uploadedFilePath(url);
  if (path) await unlink(path).catch((error) => {
    if (error.code !== 'ENOENT') console.error('Could not remove audio upload:', error);
  });
}

/** Bounded multipart parsing with disk backpressure, never a whole-file buffer. */
export async function readAudioUpload(req) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  let parser;
  try {
    parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: {
      // Busboy emits partsLimit on reaching the threshold, including the final
      // boundary. Permit three valid parts; reject a fourth via these limits.
      fileSize: MAX_AUDIO_BYTES + 1, files: 1, fields: 2, parts: 4, fieldSize: 1024,
    } });
  } catch {
    throw badRequest('invalid_multipart', 'Send multipart/form-data with an audio file.');
  }
  const fields = {};
  let filename;
  let audioUrl;
  let fileStream;
  const writes = [];
  let failure;
  const fail = (error) => {
    failure ??= error;
    // Let Busboy finish its current parsing callback before tearing down streams.
    queueMicrotask(() => { if (!parser.destroyed) parser.destroy(error); });
  };
  const tooLarge = () => fail(new HttpError(413, {
    error: 'payload_too_large', hint: 'Audio files must be no larger than 100 MiB.',
  }));
  // Also bound multipart overhead, including requests without Content-Length.
  let received = 0;
  const countBytes = (chunk) => {
    received += chunk.length;
    if (received > MAX_AUDIO_BYTES + 64 * 1024) tooLarge();
  };
  const aborted = () => fail(badRequest('upload_interrupted', 'The upload was interrupted. Try again.'));
  req.on('data', countBytes);
  req.on('aborted', aborted);
  req.on('error', fail);
  try {
    await new Promise((resolve, reject) => {
      parser.on('field', (name, value, info) => {
        if (!['title', 'duration_seconds'].includes(name) || Object.hasOwn(fields, name) || info.valueTruncated || info.nameTruncated) {
          fail(badRequest('invalid_field', 'Send title and duration_seconds at most once each, under 1024 bytes.'));
        } else fields[name] = value;
      });
      parser.on('file', (name, stream, info) => {
        fileStream = stream;
        try {
          if (name !== 'file') throw badRequest('invalid_file', 'Use the multipart field "file" for audio.');
          filename = info.filename;
          const extension = audioExtension(filename);
          audioUrl = `${UPLOAD_PREFIX}${randomUUID()}${extension}`;
          stream.on('limit', tooLarge);
          const write = pipeline(stream, createWriteStream(uploadedFilePath(audioUrl), { flags: 'wx' }));
          writes.push(write);
          // Attach immediately so early disk failures never become unhandled rejections.
          void write.catch(fail);
        } catch (error) {
          stream.resume();
          fail(error);
        }
      });
      parser.on('filesLimit', () => fail(badRequest('invalid_file', 'Send exactly one audio file.')));
      parser.on('fieldsLimit', () => fail(badRequest('invalid_field', 'Only title and duration_seconds are accepted.')));
      parser.on('partsLimit', () => fail(badRequest('invalid_multipart', 'Send one file and at most two fields.')));
      parser.on('error', reject);
      parser.on('close', resolve);
      req.pipe(parser);
    });
    await Promise.all(writes);
    if (failure) throw failure;
    if (!audioUrl) throw badRequest('missing_file', 'Choose an audio file.');
    // The browser will verify decodability; the server rejects obvious format mismatches.
    // Read just a header, rather than decoding or buffering an entire song.
    const file = await open(uploadedFilePath(audioUrl), 'r');
    const header = Buffer.alloc(12);
    try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
    const extension = extname(filename).toLowerCase();
    const valid = extension === '.wav'
      ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE'
      : extension === '.ogg' ? header.toString('ascii', 0, 4) === 'OggS'
      : extension === '.m4a' ? header.toString('ascii', 4, 8) === 'ftyp'
      : header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
    if (!valid) throw badRequest('unsupported_audio', 'The file contents do not match its audio format.');
    return { ...fields, filename, audio_url: audioUrl };
  } catch (error) {
    req.unpipe(parser);
    fileStream?.destroy();
    if (!parser.destroyed) parser.destroy();
    req.resume();
    await Promise.allSettled(writes);
    await removeUpload(audioUrl);
    if (failure instanceof HttpError) throw failure;
    if (error instanceof HttpError) throw error;
    if (error.code && !error.code.startsWith('ERR_STREAM')) throw error;
    throw badRequest('invalid_multipart', 'The audio upload is incomplete or malformed. Try again.');
  } finally {
    req.off('data', countBytes);
    req.off('aborted', aborted);
    req.off('error', fail);
  }
}
